import { randomUUID } from "node:crypto";
import {
  ConcurrencyError,
  PolicyError,
  ValidationError,
} from "../domain/errors";
import type {
  Approval,
  EvidenceManifest,
  OutboxMessage,
  SpecificationVersion,
  StageAttempt,
  WorkItem,
  Workflow,
  WorkflowEvent,
} from "../domain/model";
import { applyTransition } from "../domain/state-machine";
import type {
  ClaimInput,
  IntakeInput,
  TransitionInput,
  WorkflowStore,
} from "../core/ports";
import type { ProjectConfig } from "../config/schema";
import { hashObject } from "../core/hashing";

function copy<T>(value: T): T {
  return structuredClone(value);
}

export class MemoryWorkflowStore implements WorkflowStore {
  private readonly workItems = new Map<string, WorkItem>();
  private readonly workflows = new Map<string, Workflow>();
  private readonly events = new Map<string, WorkflowEvent[]>();
  private readonly specifications = new Map<string, SpecificationVersion>();
  private readonly approvals = new Map<string, Approval[]>();
  private readonly attempts = new Map<string, StageAttempt[]>();
  private readonly evidence = new Map<string, EvidenceManifest>();
  private readonly outbox = new Map<string, OutboxMessage>();
  private readonly controls = new Map<
    string,
    "active" | "paused" | "draining"
  >();

  async healthcheck(): Promise<{ ok: boolean; detail: string }> {
    return { ok: true, detail: "in-memory test store" };
  }

  async registerProject(
    _config: ProjectConfig,
    _fingerprint: string,
    _updatedAt: string,
  ): Promise<void> {}

  async getProjectControl(
    projectId: string,
  ): Promise<{ mode: "active" | "paused" | "draining" }> {
    return { mode: this.controls.get(projectId) ?? "active" };
  }

  async setProjectControl(
    projectId: string,
    mode: "active" | "paused" | "draining",
    _actorId: string,
    _updatedAt: string,
  ): Promise<void> {
    this.controls.set(projectId, mode);
  }

  async createIntake(
    input: IntakeInput,
  ): Promise<{ workItem: WorkItem; workflow: Workflow }> {
    const existing = await this.findWorkflowByExternalItem(
      input.workItem.projectId,
      input.workItem.externalSource,
      input.workItem.externalId,
    );
    if (existing) {
      const workItem = this.workItems.get(existing.workItemId);
      if (!workItem)
        throw new ValidationError("Workflow references a missing work item");
      return { workItem: copy(workItem), workflow: existing };
    }

    this.workItems.set(input.workItem.id, copy(input.workItem));
    this.workflows.set(input.workflow.id, copy(input.workflow));
    this.events.set(input.workflow.id, [copy(input.event)]);
    return { workItem: copy(input.workItem), workflow: copy(input.workflow) };
  }

  async getWorkItem(id: string): Promise<WorkItem | undefined> {
    const item = this.workItems.get(id);
    return item ? copy(item) : undefined;
  }

  async getWorkflow(id: string): Promise<Workflow | undefined> {
    const workflow = this.workflows.get(id);
    return workflow ? copy(workflow) : undefined;
  }

  async findWorkflowByExternalItem(
    projectId: string,
    source: WorkItem["externalSource"],
    externalId: string,
  ): Promise<Workflow | undefined> {
    const workItem = [...this.workItems.values()].find(
      (candidate) =>
        candidate.projectId === projectId &&
        candidate.externalSource === source &&
        candidate.externalId === externalId,
    );
    if (!workItem) return undefined;
    const workflow = [...this.workflows.values()].find(
      (candidate) => candidate.workItemId === workItem.id,
    );
    return workflow ? copy(workflow) : undefined;
  }

  async listEvents(workflowId: string): Promise<readonly WorkflowEvent[]> {
    return copy(this.events.get(workflowId) ?? []);
  }

  async transition(input: TransitionInput): Promise<Workflow> {
    const priorEvent = (this.events.get(input.workflowId) ?? []).find(
      (event) => event.idempotencyKey === input.idempotencyKey,
    );
    if (priorEvent) {
      const current = this.workflows.get(input.workflowId);
      if (!current) throw new ValidationError("Workflow does not exist");
      return copy(current);
    }

    const current = this.workflows.get(input.workflowId);
    if (!current)
      throw new ValidationError("Workflow does not exist", {
        id: input.workflowId,
      });
    if (current.stateVersion !== input.expectedVersion) {
      throw new ConcurrencyError(input.workflowId, input.expectedVersion);
    }

    const updated = applyTransition(
      current,
      input.to,
      input.occurredAt,
      input.patch,
    );
    this.workflows.set(updated.id, copy(updated));
    const workflowEvents = this.events.get(updated.id) ?? [];
    workflowEvents.push({
      id: randomUUID(),
      workflowId: updated.id,
      sequence: workflowEvents.length + 1,
      type: input.eventType,
      actorId: input.actorId,
      idempotencyKey: input.idempotencyKey,
      fromState: current.state,
      toState: input.to,
      payload: { ...(input.payload ?? {}) },
      occurredAt: input.occurredAt,
    });
    this.events.set(updated.id, workflowEvents);

    for (const message of input.outbox ?? []) {
      const existing = [...this.outbox.values()].find(
        (candidate) => candidate.idempotencyKey === message.idempotencyKey,
      );
      if (!existing) {
        const outboxMessage: OutboxMessage = {
          ...message,
          id: randomUUID(),
          workflowId: updated.id,
          attemptCount: 0,
        };
        this.outbox.set(outboxMessage.id, outboxMessage);
      }
    }

    return copy(updated);
  }

  async claimNext(input: ClaimInput): Promise<Workflow | undefined> {
    const nowMs = new Date(input.occurredAt).getTime();
    const candidate = [...this.workflows.values()]
      .filter(
        (workflow) =>
          workflow.state === "ready_for_execution" &&
          (!input.projectIds ||
            input.projectIds.includes(workflow.projectId)) &&
          (!workflow.leaseExpiresAt ||
            new Date(workflow.leaseExpiresAt).getTime() <= nowMs),
      )
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))[0];
    if (!candidate) return undefined;

    const leaseExpiresAt = new Date(
      nowMs + input.leaseSeconds * 1000,
    ).toISOString();
    return this.transition({
      workflowId: candidate.id,
      expectedVersion: candidate.stateVersion,
      to: "claimed",
      actorId: input.runnerId,
      eventType: "workflow_claimed",
      idempotencyKey: input.idempotencyKey,
      payload: { runnerId: input.runnerId, leaseExpiresAt },
      patch: {
        leaseOwner: input.runnerId,
        leaseExpiresAt,
        heartbeatAt: input.occurredAt,
      },
      occurredAt: input.occurredAt,
    });
  }

  async heartbeat(
    workflowId: string,
    runnerId: string,
    leaseSeconds: number,
    occurredAt: string,
  ): Promise<Workflow> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow)
      throw new ValidationError("Workflow does not exist", { workflowId });
    if (workflow.leaseOwner !== runnerId) {
      throw new PolicyError("Runner does not own the workflow lease", {
        workflowId,
        runnerId,
      });
    }
    const updated: Workflow = {
      ...workflow,
      heartbeatAt: occurredAt,
      leaseExpiresAt: new Date(
        new Date(occurredAt).getTime() + leaseSeconds * 1000,
      ).toISOString(),
      updatedAt: occurredAt,
    };
    this.workflows.set(workflowId, updated);
    return copy(updated);
  }

  async releaseLease(
    workflowId: string,
    runnerId: string,
    _reason: string,
    occurredAt: string,
  ): Promise<void> {
    const workflow = this.workflows.get(workflowId);
    if (!workflow) return;
    if (workflow.leaseOwner !== runnerId) {
      throw new PolicyError("Runner cannot release a lease it does not own", {
        workflowId,
        runnerId,
      });
    }
    this.workflows.set(workflowId, {
      ...workflow,
      leaseOwner: undefined,
      leaseExpiresAt: undefined,
      heartbeatAt: undefined,
      updatedAt: occurredAt,
    });
  }

  async saveSpecification(
    specification: SpecificationVersion,
  ): Promise<SpecificationVersion> {
    const existing = [...this.specifications.values()].find(
      (candidate) =>
        candidate.workItemId === specification.workItemId &&
        candidate.contentSha256 === specification.contentSha256,
    );
    if (existing) return copy(existing);
    this.specifications.set(specification.id, copy(specification));
    return copy(specification);
  }

  async getSpecification(
    id: string,
  ): Promise<SpecificationVersion | undefined> {
    const specification = this.specifications.get(id);
    return specification ? copy(specification) : undefined;
  }

  async recordApproval(approval: Approval): Promise<Approval> {
    const workflowApprovals = this.approvals.get(approval.workflowId) ?? [];
    const existing = workflowApprovals.find(
      (candidate) => candidate.idempotencyKey === approval.idempotencyKey,
    );
    if (existing) return copy(existing);
    workflowApprovals.push(copy(approval));
    this.approvals.set(approval.workflowId, workflowApprovals);
    return copy(approval);
  }

  async listApprovals(workflowId: string): Promise<readonly Approval[]> {
    return copy(this.approvals.get(workflowId) ?? []);
  }

  async startAttempt(attempt: StageAttempt): Promise<StageAttempt> {
    const workflowAttempts = this.attempts.get(attempt.workflowId) ?? [];
    const existing = workflowAttempts.find(
      (candidate) => candidate.id === attempt.id,
    );
    if (existing) return copy(existing);
    workflowAttempts.push(copy(attempt));
    this.attempts.set(attempt.workflowId, workflowAttempts);
    return copy(attempt);
  }

  async completeAttempt(attempt: StageAttempt): Promise<StageAttempt> {
    const workflowAttempts = this.attempts.get(attempt.workflowId) ?? [];
    const index = workflowAttempts.findIndex(
      (candidate) => candidate.id === attempt.id,
    );
    if (index < 0)
      throw new ValidationError("Attempt does not exist", {
        attemptId: attempt.id,
      });
    workflowAttempts[index] = copy(attempt);
    return copy(attempt);
  }

  async listAttempts(workflowId: string): Promise<readonly StageAttempt[]> {
    return copy(this.attempts.get(workflowId) ?? []);
  }

  async saveEvidence(
    manifest: EvidenceManifest,
    manifestSha256: string,
  ): Promise<void> {
    const existing = this.evidence.get(manifestSha256);
    if (existing && hashObject(existing) !== manifestSha256) {
      throw new PolicyError(
        "Evidence hash collision or manifest mutation detected",
      );
    }
    this.evidence.set(manifestSha256, copy(manifest));
  }

  async getEvidence(
    manifestSha256: string,
  ): Promise<EvidenceManifest | undefined> {
    const manifest = this.evidence.get(manifestSha256);
    return manifest ? copy(manifest) : undefined;
  }

  async pullOutbox(
    limit: number,
    now: string,
  ): Promise<readonly OutboxMessage[]> {
    return copy(
      [...this.outbox.values()]
        .filter((message) => !message.deliveredAt && message.availableAt <= now)
        .sort((left, right) =>
          left.availableAt.localeCompare(right.availableAt),
        )
        .slice(0, limit),
    );
  }

  async markOutboxDelivered(id: string, deliveredAt: string): Promise<void> {
    const message = this.outbox.get(id);
    if (!message)
      throw new ValidationError("Outbox message does not exist", { id });
    this.outbox.set(id, { ...message, deliveredAt });
  }

  async markOutboxFailed(
    id: string,
    error: string,
    availableAt: string,
  ): Promise<void> {
    const message = this.outbox.get(id);
    if (!message)
      throw new ValidationError("Outbox message does not exist", { id });
    this.outbox.set(id, {
      ...message,
      attemptCount: message.attemptCount + 1,
      lastError: error,
      availableAt,
    });
  }

  async close(): Promise<void> {}
}

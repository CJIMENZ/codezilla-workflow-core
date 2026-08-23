import { randomUUID } from "node:crypto";
import type { ProjectConfig } from "../config/schema";
import {
  ConcurrencyError,
  PolicyError,
  ValidationError,
} from "../domain/errors";
import {
  ApprovalSchema,
  SpecificationVersionSchema,
  WorkItemSchema,
  WorkflowEventSchema,
  WorkflowSchema,
  type Approval,
  type Risk,
  type WorkItem,
  type Workflow,
  type WorkflowState,
} from "../domain/model";
import { assertRiskWithinCeiling, assertHumanApproval } from "./policy";
import { sha256 } from "./hashing";
import type { Clock, WorkflowStore } from "./ports";

export class WorkflowService {
  constructor(
    private readonly store: WorkflowStore,
    private readonly config: ProjectConfig,
    private readonly clock: Clock,
  ) {}

  async intake(input: {
    source: WorkItem["externalSource"];
    externalId: string;
    externalUrl?: string;
    intakeRevision: string;
    title: string;
    requestedOutcome: string;
    risk: Risk;
    actorId: string;
    idempotencyKey: string;
  }): Promise<Workflow> {
    const project = this.config.project;
    assertRiskWithinCeiling(input.risk, project.riskCeiling);

    const existing = await this.store.findWorkflowByExternalItem(
      project.id,
      input.source,
      input.externalId,
    );
    if (existing) return existing;

    const now = this.clock.now().toISOString();
    const workItemId = randomUUID();
    const workflowId = randomUUID();
    const workItem = WorkItemSchema.parse({
      id: workItemId,
      projectId: project.id,
      externalSource: input.source,
      externalId: input.externalId,
      externalUrl: input.externalUrl,
      title: input.title,
      requestedOutcome: input.requestedOutcome,
      intakeRevision: input.intakeRevision,
      risk: input.risk,
      createdAt: now,
      updatedAt: now,
    });
    const workflow = WorkflowSchema.parse({
      id: workflowId,
      projectId: project.id,
      workItemId,
      state: "intake_received",
      stateVersion: 0,
      risk: input.risk,
      policyVersion: this.policyVersion,
      retryCounters: {},
      createdAt: now,
      updatedAt: now,
    });
    const event = WorkflowEventSchema.parse({
      id: randomUUID(),
      workflowId,
      sequence: 1,
      type: "intake_created",
      actorId: input.actorId,
      idempotencyKey: input.idempotencyKey,
      toState: "intake_received",
      payload: { source: input.source, externalId: input.externalId },
      occurredAt: now,
    });

    return (await this.store.createIntake({ workItem, workflow, event }))
      .workflow;
  }

  async transition(input: {
    workflowId: string;
    expectedVersion: number;
    to: WorkflowState;
    actorId: string;
    reason: string;
    idempotencyKey: string;
    patch?: Partial<Workflow>;
  }): Promise<Workflow> {
    const current = await this.requireWorkflow(input.workflowId);
    if (current.stateVersion !== input.expectedVersion) {
      throw new ConcurrencyError(input.workflowId, input.expectedVersion);
    }

    const now = this.clock.now().toISOString();
    const transitionInput = {
      workflowId: input.workflowId,
      expectedVersion: input.expectedVersion,
      to: input.to,
      actorId: input.actorId,
      eventType: "workflow_transitioned",
      idempotencyKey: input.idempotencyKey,
      payload: { reason: input.reason },
      occurredAt: now,
      outbox: [this.projectionMessage(current, input.expectedVersion + 1, now)],
      ...(input.patch ? { patch: input.patch } : {}),
    };
    return this.store.transition(transitionInput);
  }

  async freezeSpecification(input: {
    workflowId: string;
    expectedVersion: number;
    content: string;
    goal: string;
    nonGoals: readonly string[];
    acceptanceCriteria: readonly string[];
    testPlan: readonly (readonly string[])[];
    baseCommitSha: string;
    branchName: string;
    repositoryPath: string;
    actorId: string;
    idempotencyKey: string;
    headSha: string;
    pullRequestNumber: number;
    pullRequestUrl: string;
  }): Promise<{ workflow: Workflow; specificationSha256: string }> {
    const workflow = await this.requireWorkflow(input.workflowId);
    if (workflow.state !== "drafting_spec") {
      throw new PolicyError(
        "Specification can only be frozen while drafting_spec",
        {
          state: workflow.state,
        },
      );
    }
    if (workflow.stateVersion !== input.expectedVersion) {
      throw new ConcurrencyError(input.workflowId, input.expectedVersion);
    }

    const existingEvents = await this.store.listEvents(workflow.id);
    const version =
      existingEvents.filter((event) => event.type === "specification_frozen")
        .length + 1;
    const now = this.clock.now().toISOString();
    const specification = SpecificationVersionSchema.parse({
      id: randomUUID(),
      workItemId: workflow.workItemId,
      version,
      content: input.content,
      contentSha256: sha256(input.content),
      goal: input.goal,
      nonGoals: input.nonGoals,
      acceptanceCriteria: input.acceptanceCriteria,
      testPlan: input.testPlan,
      baseCommitSha: input.baseCommitSha,
      branchName: input.branchName,
      repositoryPath: input.repositoryPath,
      createdBy: input.actorId,
      createdAt: now,
    });
    await this.store.saveSpecification(specification);

    const updated = await this.store.transition({
      workflowId: workflow.id,
      expectedVersion: workflow.stateVersion,
      to: "awaiting_spec_approval",
      actorId: input.actorId,
      eventType: "specification_frozen",
      idempotencyKey: input.idempotencyKey,
      payload: {
        specificationVersionId: specification.id,
        contentSha256: specification.contentSha256,
      },
      patch: {
        specificationVersionId: specification.id,
        branchName: specification.branchName,
        baseSha: specification.baseCommitSha,
        headSha: input.headSha,
        pullRequestNumber: input.pullRequestNumber,
        pullRequestUrl: input.pullRequestUrl,
      },
      occurredAt: now,
      outbox: [
        this.projectionMessage(workflow, workflow.stateVersion + 1, now),
      ],
    });

    return {
      workflow: updated,
      specificationSha256: specification.contentSha256,
    };
  }

  async recordApproval(
    input: Omit<Approval, "id" | "decidedAt" | "policyVersion">,
  ): Promise<Approval> {
    const workflow = await this.requireWorkflow(input.workflowId);
    const approval = ApprovalSchema.parse({
      ...input,
      id: randomUUID(),
      policyVersion: workflow.policyVersion,
      decidedAt: this.clock.now().toISOString(),
    });
    return this.store.recordApproval(approval);
  }

  async authorizeBuild(input: {
    workflowId: string;
    expectedVersion: number;
    actorId: string;
    idempotencyKey: string;
  }): Promise<Workflow> {
    const workflow = await this.requireWorkflow(input.workflowId);
    if (
      workflow.state !== "awaiting_spec_approval" ||
      !workflow.specificationVersionId
    ) {
      throw new PolicyError(
        "Workflow is not awaiting approval of a frozen specification",
      );
    }
    const specification = await this.store.getSpecification(
      workflow.specificationVersionId,
    );
    if (!specification)
      throw new ValidationError("Frozen specification is missing");
    const approvals = await this.store.listApprovals(workflow.id);
    assertHumanApproval({
      approvals,
      type: "specification",
      subjectValue: specification.contentSha256,
      policyVersion: workflow.policyVersion,
      allowedActorIds:
        this.config.project.approvals.specification.allowedActorIds,
      minimum:
        this.config.project.approvals.specification.minimumHumanApprovals,
    });

    const now = this.clock.now().toISOString();
    return this.store.transition({
      workflowId: workflow.id,
      expectedVersion: input.expectedVersion,
      to: "ready_for_execution",
      actorId: input.actorId,
      eventType: "build_authorized",
      idempotencyKey: input.idempotencyKey,
      payload: { specificationSha256: specification.contentSha256 },
      occurredAt: now,
      outbox: [
        this.projectionMessage(workflow, workflow.stateVersion + 1, now),
      ],
    });
  }

  async authorizeMerge(input: {
    workflowId: string;
    expectedVersion: number;
    actorId: string;
    idempotencyKey: string;
  }): Promise<Workflow> {
    const workflow = await this.requireWorkflow(input.workflowId);
    if (
      workflow.state !== "awaiting_human_review" ||
      !workflow.headSha ||
      !workflow.evidenceManifestSha256
    ) {
      throw new PolicyError(
        "Workflow is not ready for exact-head implementation approval",
      );
    }
    const approvals = await this.store.listApprovals(workflow.id);
    assertHumanApproval({
      approvals,
      type: "implementation",
      subjectValue: workflow.headSha,
      policyVersion: workflow.policyVersion,
      allowedActorIds:
        this.config.project.approvals.implementation.allowedActorIds,
      minimum:
        this.config.project.approvals.implementation.minimumHumanApprovals,
    });

    const now = this.clock.now().toISOString();
    return this.store.transition({
      workflowId: workflow.id,
      expectedVersion: input.expectedVersion,
      to: "merge_ready",
      actorId: input.actorId,
      eventType: "merge_authorized",
      idempotencyKey: input.idempotencyKey,
      payload: {
        headSha: workflow.headSha,
        evidenceManifestSha256: workflow.evidenceManifestSha256,
      },
      occurredAt: now,
      outbox: [
        this.projectionMessage(workflow, workflow.stateVersion + 1, now),
      ],
    });
  }

  get policyVersion(): string {
    return `project-config:${this.config.schemaVersion}`;
  }

  private async requireWorkflow(id: string): Promise<Workflow> {
    const workflow = await this.store.getWorkflow(id);
    if (!workflow)
      throw new ValidationError("Workflow does not exist", { workflowId: id });
    return workflow;
  }

  private projectionMessage(
    workflow: Workflow,
    nextVersion: number,
    availableAt: string,
  ) {
    return {
      destination: "clickup" as const,
      messageType: "workflow_projection",
      idempotencyKey: `projection:clickup:${workflow.id}:${nextVersion}`,
      payload: { workflowId: workflow.id },
      availableAt,
    };
  }
}

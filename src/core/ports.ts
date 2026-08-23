import type {
  Approval,
  CompletionPacket,
  EvidenceArtifact,
  EvidenceManifest,
  OutboxMessage,
  PlanningPacket,
  SpecificationDraft,
  SpecificationVersion,
  StageAttempt,
  WorkItem,
  Workflow,
  WorkflowEvent,
  WorkflowState,
  WorkPacket,
} from "../domain/model";
import type { ProjectConfig } from "../config/schema";

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export interface TransitionInput {
  workflowId: string;
  expectedVersion: number;
  to: WorkflowState;
  actorId: string;
  eventType: string;
  idempotencyKey: string;
  payload?: Readonly<Record<string, unknown>>;
  patch?: Partial<Workflow>;
  outbox?: readonly Omit<OutboxMessage, "id" | "workflowId" | "attemptCount">[];
  occurredAt: string;
}

export interface IntakeInput {
  workItem: WorkItem;
  workflow: Workflow;
  event: WorkflowEvent;
}

export interface ClaimInput {
  runnerId: string;
  projectIds?: readonly string[];
  leaseSeconds: number;
  occurredAt: string;
  idempotencyKey: string;
}

export interface WorkflowStore {
  healthcheck(): Promise<{ ok: boolean; detail: string }>;
  registerProject(
    config: ProjectConfig,
    fingerprint: string,
    updatedAt: string,
  ): Promise<void>;
  getProjectControl(
    projectId: string,
  ): Promise<{ mode: "active" | "paused" | "draining" }>;
  setProjectControl(
    projectId: string,
    mode: "active" | "paused" | "draining",
    actorId: string,
    updatedAt: string,
  ): Promise<void>;
  createIntake(
    input: IntakeInput,
  ): Promise<{ workItem: WorkItem; workflow: Workflow }>;
  getWorkItem(id: string): Promise<WorkItem | undefined>;
  getWorkflow(id: string): Promise<Workflow | undefined>;
  findWorkflowByExternalItem(
    projectId: string,
    source: WorkItem["externalSource"],
    externalId: string,
  ): Promise<Workflow | undefined>;
  listEvents(workflowId: string): Promise<readonly WorkflowEvent[]>;
  transition(input: TransitionInput): Promise<Workflow>;
  claimNext(input: ClaimInput): Promise<Workflow | undefined>;
  heartbeat(
    workflowId: string,
    runnerId: string,
    leaseSeconds: number,
    occurredAt: string,
  ): Promise<Workflow>;
  releaseLease(
    workflowId: string,
    runnerId: string,
    reason: string,
    occurredAt: string,
  ): Promise<void>;
  saveSpecification(
    specification: SpecificationVersion,
  ): Promise<SpecificationVersion>;
  saveSpecificationAndTransition(
    specification: SpecificationVersion,
    transition: TransitionInput,
  ): Promise<{ specification: SpecificationVersion; workflow: Workflow }>;
  getSpecification(id: string): Promise<SpecificationVersion | undefined>;
  recordApproval(approval: Approval): Promise<Approval>;
  listApprovals(workflowId: string): Promise<readonly Approval[]>;
  startAttempt(attempt: StageAttempt): Promise<StageAttempt>;
  completeAttempt(attempt: StageAttempt): Promise<StageAttempt>;
  listAttempts(workflowId: string): Promise<readonly StageAttempt[]>;
  saveEvidence(manifest: EvidenceManifest, sha256: string): Promise<void>;
  getEvidence(sha256: string): Promise<EvidenceManifest | undefined>;
  pullOutbox(limit: number, now: string): Promise<readonly OutboxMessage[]>;
  markOutboxDelivered(id: string, deliveredAt: string): Promise<void>;
  markOutboxFailed(
    id: string,
    error: string,
    availableAt: string,
  ): Promise<void>;
  close(): Promise<void>;
}

export interface AgentExecutionContext {
  packet: WorkPacket;
  packetSha256: string;
  workingDirectory: string;
  signal: AbortSignal;
}

export interface PlanningExecutionContext {
  packet: PlanningPacket;
  packetSha256: string;
  workingDirectory: string;
  signal: AbortSignal;
}

export interface AgentExecutor {
  readonly profileId: string;
  readonly provider: string;
  readonly adapterVersion: string;
  execute(context: AgentExecutionContext): Promise<CompletionPacket>;
  plan(context: PlanningExecutionContext): Promise<SpecificationDraft>;
  healthcheck(): Promise<{ ok: boolean; detail: string }>;
}

export interface SourceControlPort {
  ensureBranch(input: {
    repositoryPath: string;
    branchName: string;
    baseSha: string;
  }): Promise<{ headSha: string }>;
  commitAndPush(input: {
    repositoryPath: string;
    branchName: string;
    message: string;
    allowedPaths: readonly string[];
  }): Promise<{ headSha: string }>;
  ensurePullRequest(input: {
    owner: string;
    repository: string;
    branchName: string;
    baseBranch: string;
    title: string;
    body: string;
    draft: boolean;
  }): Promise<{ number: number; url: string; headSha: string }>;
  getPullRequest(input: {
    owner: string;
    repository: string;
    number: number;
  }): Promise<{
    state: "open" | "closed" | "merged";
    headSha: string;
    mergeable: boolean | null;
    checksPassing: boolean;
  }>;
  mergePullRequest(input: {
    owner: string;
    repository: string;
    number: number;
    expectedHeadSha: string;
    method: "squash" | "merge" | "rebase";
  }): Promise<{ mergeCommitSha: string }>;
}

export interface CoordinationPort {
  readIntake(cursor?: string): Promise<{
    items: readonly {
      externalId: string;
      externalUrl: string;
      revision: string;
      title: string;
      requestedOutcome: string;
    }[];
    cursor?: string;
  }>;
  projectWorkflow(input: {
    externalId: string;
    workflow: Workflow;
    specificationSha256?: string;
    reviewUrl?: string;
    message?: string;
  }): Promise<void>;
  healthcheck(): Promise<{ ok: boolean; detail: string }>;
}

export interface EvidencePort {
  put(input: {
    workflowId: string;
    name: string;
    mediaType: string;
    body: Uint8Array;
    classification: EvidenceArtifact["classification"];
  }): Promise<EvidenceArtifact>;
  get(location: string): Promise<Uint8Array>;
  healthcheck(): Promise<{ ok: boolean; detail: string }>;
}

export interface OutboxDestination {
  readonly destination: OutboxMessage["destination"];
  deliver(message: OutboxMessage): Promise<void>;
}

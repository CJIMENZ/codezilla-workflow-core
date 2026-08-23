import { z } from "zod";

const IdentifierSchema = z.string().min(1).max(200);
const UuidSchema = z.string().uuid();
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
const GitShaSchema = z.string().regex(/^[a-f0-9]{7,64}$/);
const TimestampSchema = z.string().datetime({ offset: true });

export const RiskSchema = z.enum(["low", "medium", "high", "prohibited"]);
export type Risk = z.infer<typeof RiskSchema>;

export const WorkflowStateSchema = z.enum([
  "intake_received",
  "triaging",
  "needs_clarification",
  "drafting_spec",
  "awaiting_spec_approval",
  "ready_for_execution",
  "claimed",
  "executing",
  "awaiting_agent_review",
  "qa_running",
  "awaiting_human_review",
  "merge_ready",
  "merged",
  "verifying",
  "done",
  "blocked",
  "cancelling",
  "cancelled",
]);
export type WorkflowState = z.infer<typeof WorkflowStateSchema>;

export const StageSchema = z.enum([
  "triage",
  "planner",
  "coder",
  "reviewer",
  "qa",
  "merge_readiness",
  "verification",
]);
export type Stage = z.infer<typeof StageSchema>;

export const ProjectReferenceSchema = z.object({
  id: UuidSchema,
  name: z.string().min(1),
  repositoryOwner: IdentifierSchema,
  repositoryName: IdentifierSchema,
  defaultBranch: IdentifierSchema,
});
export type ProjectReference = z.infer<typeof ProjectReferenceSchema>;

export const WorkItemSchema = z.object({
  id: UuidSchema,
  projectId: UuidSchema,
  externalSource: z.enum(["clickup", "manual", "fixture"]),
  externalId: IdentifierSchema,
  externalUrl: z.string().url().optional(),
  title: z.string().min(1).max(500),
  requestedOutcome: z.string().min(1),
  intakeRevision: IdentifierSchema,
  risk: RiskSchema,
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type WorkItem = z.infer<typeof WorkItemSchema>;

export const SpecificationVersionSchema = z.object({
  id: UuidSchema,
  workItemId: UuidSchema,
  version: z.number().int().positive(),
  content: z.string().min(1),
  contentSha256: Sha256Schema,
  goal: z.string().min(1),
  nonGoals: z.array(z.string()),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  testPlan: z.array(z.array(z.string().min(1)).min(1)).min(1),
  baseCommitSha: GitShaSchema,
  branchName: IdentifierSchema,
  repositoryPath: z.string().min(1),
  createdBy: IdentifierSchema,
  createdAt: TimestampSchema,
});
export type SpecificationVersion = z.infer<typeof SpecificationVersionSchema>;

export const WorkflowSchema = z.object({
  id: UuidSchema,
  projectId: UuidSchema,
  workItemId: UuidSchema,
  specificationVersionId: UuidSchema.optional(),
  state: WorkflowStateSchema,
  stateVersion: z.number().int().nonnegative(),
  risk: RiskSchema,
  policyVersion: IdentifierSchema,
  branchName: IdentifierSchema.optional(),
  baseSha: GitShaSchema.optional(),
  headSha: GitShaSchema.optional(),
  pullRequestNumber: z.number().int().positive().optional(),
  pullRequestUrl: z.string().url().optional(),
  evidenceManifestSha256: Sha256Schema.optional(),
  mergeCommitSha: GitShaSchema.optional(),
  blockerCode: IdentifierSchema.optional(),
  blockerMessage: z.string().optional(),
  retryCounters: z
    .record(z.string(), z.number().int().nonnegative())
    .default({}),
  leaseOwner: IdentifierSchema.optional(),
  leaseExpiresAt: TimestampSchema.optional(),
  heartbeatAt: TimestampSchema.optional(),
  createdAt: TimestampSchema,
  updatedAt: TimestampSchema,
});
export type Workflow = z.infer<typeof WorkflowSchema>;

export const ApprovalTypeSchema = z.enum([
  "specification",
  "implementation",
  "merge",
  "deploy",
  "destructive_action",
]);
export type ApprovalType = z.infer<typeof ApprovalTypeSchema>;

export const ApprovalSchema = z.object({
  id: UuidSchema,
  workflowId: UuidSchema,
  type: ApprovalTypeSchema,
  subjectType: z.enum([
    "spec_hash",
    "commit_sha",
    "evidence_manifest_hash",
    "review_bundle_hash",
    "command_hash",
  ]),
  subjectValue: IdentifierSchema,
  decision: z.enum(["approved", "rejected", "revoked", "expired"]),
  actorId: IdentifierSchema,
  source: z.enum(["cli", "clickup", "github", "api", "test"]),
  policyVersion: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  decidedAt: TimestampSchema,
});
export type Approval = z.infer<typeof ApprovalSchema>;

export const WorkflowEventSchema = z.object({
  id: UuidSchema,
  workflowId: UuidSchema,
  sequence: z.number().int().positive(),
  type: IdentifierSchema,
  actorId: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  fromState: WorkflowStateSchema.optional(),
  toState: WorkflowStateSchema.optional(),
  payload: z.record(z.string(), z.unknown()),
  occurredAt: TimestampSchema,
});
export type WorkflowEvent = z.infer<typeof WorkflowEventSchema>;

export const StageAttemptSchema = z.object({
  id: UuidSchema,
  workflowId: UuidSchema,
  stage: StageSchema,
  ordinal: z.number().int().positive(),
  providerProfileId: IdentifierSchema,
  workPacketSha256: Sha256Schema,
  completionPacketSha256: Sha256Schema.optional(),
  status: z.enum(["running", "completed", "failed", "cancelled", "ambiguous"]),
  resultClass: z.string().optional(),
  failureClass: z.string().optional(),
  startedAt: TimestampSchema,
  heartbeatAt: TimestampSchema,
  endedAt: TimestampSchema.optional(),
});
export type StageAttempt = z.infer<typeof StageAttemptSchema>;

export const WorkPacketSchema = z.object({
  schemaVersion: z.literal(1),
  workflowId: UuidSchema,
  workItemId: UuidSchema,
  project: ProjectReferenceSchema,
  stage: StageSchema,
  attemptId: UuidSchema,
  specification: z.object({
    versionId: UuidSchema,
    content: z.string().min(1),
    sha256: Sha256Schema,
  }),
  repository: z.object({
    worktreePath: z.string().min(1),
    baseSha: GitShaSchema,
    branchName: IdentifierSchema,
    headSha: GitShaSchema,
  }),
  goal: z.string().min(1),
  acceptanceCriteria: z.array(z.string().min(1)).min(1),
  nonGoals: z.array(z.string()),
  risk: RiskSchema,
  policyVersion: IdentifierSchema,
  allowedFilesystemRoots: z.array(z.string().min(1)).min(1),
  allowedCommands: z.array(z.array(z.string().min(1)).min(1)),
  prohibitedActions: z.array(z.string().min(1)),
  timeoutSeconds: z.number().int().positive(),
  retryOrdinal: z.number().int().nonnegative(),
  priorFailureSummaries: z.array(z.string()),
  issuedAt: TimestampSchema,
});
export type WorkPacket = z.infer<typeof WorkPacketSchema>;

export const CommandResultSchema = z.object({
  argv: z.array(z.string()).min(1),
  exitCode: z.number().int(),
  durationMs: z.number().int().nonnegative(),
  stdoutArtifact: z.string().optional(),
  stderrArtifact: z.string().optional(),
});
export type CommandResult = z.infer<typeof CommandResultSchema>;

export const CompletionPacketSchema = z.object({
  schemaVersion: z.literal(1),
  workflowId: UuidSchema,
  attemptId: UuidSchema,
  stage: StageSchema,
  result: z.enum([
    "completed",
    "changes_requested",
    "blocked",
    "failed",
    "cancelled",
  ]),
  summary: z.string().min(1),
  acceptanceCriteria: z.array(
    z.object({
      criterion: z.string().min(1),
      status: z.enum(["passed", "failed", "not_evaluated"]),
      evidence: z.string().optional(),
    }),
  ),
  filesChanged: z.array(z.string()),
  finalHeadSha: GitShaSchema.optional(),
  commands: z.array(CommandResultSchema),
  findings: z.array(z.string()),
  unresolvedRisks: z.array(z.string()),
  assumptionsEncountered: z.array(z.string()),
  followUps: z.array(z.string()),
  failureClass: z.string().optional(),
  workPacketSha256: Sha256Schema,
  providerProfileId: IdentifierSchema,
  adapterVersion: IdentifierSchema,
  startedAt: TimestampSchema,
  completedAt: TimestampSchema,
  usage: z.record(z.string(), z.number()).optional(),
});
export type CompletionPacket = z.infer<typeof CompletionPacketSchema>;

export const PlanningPacketSchema = z.object({
  schemaVersion: z.literal(1),
  workflowId: UuidSchema,
  workItemId: UuidSchema,
  project: ProjectReferenceSchema,
  repository: z.object({
    worktreePath: z.string().min(1),
    baseSha: GitShaSchema,
    branchName: IdentifierSchema,
  }),
  title: z.string().min(1),
  requestedOutcome: z.string().min(1),
  intakeRevision: IdentifierSchema,
  risk: RiskSchema,
  policyVersion: IdentifierSchema,
  allowedFilesystemRoots: z.array(z.string().min(1)).min(1),
  prohibitedActions: z.array(z.string().min(1)),
  issuedAt: TimestampSchema,
});
export type PlanningPacket = z.infer<typeof PlanningPacketSchema>;

export const SpecificationDraftSchema = z.object({
  schemaVersion: z.literal(1),
  workflowId: UuidSchema,
  result: z.enum(["ready", "needs_clarification", "blocked"]),
  title: z.string().min(1),
  goal: z.string().min(1),
  nonGoals: z.array(z.string()),
  constraints: z.array(z.string()),
  acceptanceCriteria: z.array(z.string().min(1)),
  testPlan: z.array(z.array(z.string().min(1)).min(1)).min(1),
  dependencies: z.array(z.string()),
  assumptions: z.array(z.string()),
  openQuestions: z.array(z.string()),
  risk: RiskSchema,
  markdown: z.string().min(1),
  planningPacketSha256: Sha256Schema,
  providerProfileId: IdentifierSchema,
  adapterVersion: IdentifierSchema,
  completedAt: TimestampSchema,
});
export type SpecificationDraft = z.infer<typeof SpecificationDraftSchema>;

export const EvidenceArtifactSchema = z.object({
  name: IdentifierSchema,
  mediaType: IdentifierSchema,
  sha256: Sha256Schema,
  sizeBytes: z.number().int().nonnegative(),
  location: z.string().min(1),
  classification: z.enum(["internal", "confidential", "quarantined"]),
});
export type EvidenceArtifact = z.infer<typeof EvidenceArtifactSchema>;

export const EvidenceManifestSchema = z.object({
  schemaVersion: z.literal(1),
  id: UuidSchema,
  workflowId: UuidSchema,
  attemptId: UuidSchema.optional(),
  projectId: UuidSchema,
  repository: z.object({ owner: IdentifierSchema, name: IdentifierSchema }),
  commitSha: GitShaSchema,
  policyVersion: IdentifierSchema,
  toolVersions: z.record(z.string(), z.string()),
  commands: z.array(CommandResultSchema),
  outcomes: z.array(z.string()),
  warnings: z.array(z.string()),
  artifacts: z.array(EvidenceArtifactSchema),
  collectedAt: TimestampSchema,
});
export type EvidenceManifest = z.infer<typeof EvidenceManifestSchema>;

export const OutboxMessageSchema = z.object({
  id: UuidSchema,
  workflowId: UuidSchema,
  destination: z.enum(["clickup", "github", "notification"]),
  messageType: IdentifierSchema,
  idempotencyKey: IdentifierSchema,
  payload: z.record(z.string(), z.unknown()),
  attemptCount: z.number().int().nonnegative(),
  availableAt: TimestampSchema,
  deliveredAt: TimestampSchema.optional(),
  lastError: z.string().optional(),
});
export type OutboxMessage = z.infer<typeof OutboxMessageSchema>;

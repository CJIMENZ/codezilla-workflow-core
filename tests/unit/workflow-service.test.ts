import { describe, expect, it } from "vitest";
import { WorkflowService } from "../../src/core/workflow-service";
import { PolicyError } from "../../src/domain/errors";
import { MemoryWorkflowStore } from "../../src/storage/memory-store";
import { fixedClock, projectConfig } from "../fixtures";

describe("WorkflowService", () => {
  it("deduplicates intake and rejects stale specification approval", async () => {
    const store = new MemoryWorkflowStore();
    const service = new WorkflowService(store, projectConfig(), fixedClock);
    const first = await service.intake({
      source: "manual",
      externalId: "TASK-1",
      intakeRevision: "1",
      title: "Fixture",
      requestedOutcome: "Add a fixture",
      risk: "low",
      actorId: "github:CJIMENZ",
      idempotencyKey: "intake-1",
    });
    const duplicate = await service.intake({
      source: "manual",
      externalId: "TASK-1",
      intakeRevision: "1",
      title: "Fixture duplicate",
      requestedOutcome: "Should not duplicate",
      risk: "low",
      actorId: "github:CJIMENZ",
      idempotencyKey: "intake-1-duplicate",
    });
    expect(duplicate.id).toBe(first.id);

    let current = await service.transition({
      workflowId: first.id,
      expectedVersion: 0,
      to: "triaging",
      actorId: "runner:test",
      reason: "ready",
      idempotencyKey: "transition-1",
    });
    current = await service.transition({
      workflowId: first.id,
      expectedVersion: current.stateVersion,
      to: "drafting_spec",
      actorId: "runner:test",
      reason: "planned",
      idempotencyKey: "transition-2",
    });
    const frozen = await service.freezeSpecification({
      workflowId: first.id,
      expectedVersion: current.stateVersion,
      content: "# Frozen spec\n",
      goal: "Add fixture",
      nonGoals: [],
      acceptanceCriteria: ["Fixture exists"],
      testPlan: [["node", "-e", "process.exit(0)"]],
      baseCommitSha: "a".repeat(40),
      branchName: "codezilla/task-1",
      repositoryPath: "docs/specs/task-1/spec.md",
      actorId: "runner:test",
      idempotencyKey: "freeze-1",
      headSha: "b".repeat(40),
      pullRequestNumber: 1,
      pullRequestUrl: "https://github.com/CJIMENZ/fixture/pull/1",
    });
    await service.recordApproval({
      workflowId: first.id,
      type: "specification",
      subjectType: "spec_hash",
      subjectValue: "0".repeat(64),
      decision: "approved",
      actorId: "github:CJIMENZ",
      source: "test",
      idempotencyKey: "wrong-approval",
    });
    await expect(
      service.authorizeBuild({
        workflowId: first.id,
        expectedVersion: frozen.workflow.stateVersion,
        actorId: "github:CJIMENZ",
        idempotencyKey: "authorize-wrong",
      }),
    ).rejects.toBeInstanceOf(PolicyError);

    await service.recordApproval({
      workflowId: first.id,
      type: "specification",
      subjectType: "spec_hash",
      subjectValue: frozen.specificationSha256,
      decision: "approved",
      actorId: "github:CJIMENZ",
      source: "test",
      idempotencyKey: "correct-approval",
    });
    const ready = await service.authorizeBuild({
      workflowId: first.id,
      expectedVersion: frozen.workflow.stateVersion,
      actorId: "github:CJIMENZ",
      idempotencyKey: "authorize-correct",
    });
    expect(ready.state).toBe("ready_for_execution");
    expect(
      (await store.pullOutbox(20, fixedClock.now().toISOString())).length,
    ).toBeGreaterThan(0);
  });

  it("allows only one runner to claim a ready workflow", async () => {
    const store = new MemoryWorkflowStore();
    const service = new WorkflowService(store, projectConfig(), fixedClock);
    let current = await service.intake({
      source: "fixture",
      externalId: "CLAIM-1",
      intakeRevision: "1",
      title: "Claim",
      requestedOutcome: "Test claims",
      risk: "low",
      actorId: "test",
      idempotencyKey: "claim-intake",
    });
    current = await service.transition({
      workflowId: current.id,
      expectedVersion: current.stateVersion,
      to: "triaging",
      actorId: "test",
      reason: "test",
      idempotencyKey: "claim-triage",
    });
    current = await service.transition({
      workflowId: current.id,
      expectedVersion: current.stateVersion,
      to: "drafting_spec",
      actorId: "test",
      reason: "test",
      idempotencyKey: "claim-draft",
    });
    const frozen = await service.freezeSpecification({
      workflowId: current.id,
      expectedVersion: current.stateVersion,
      content: "spec",
      goal: "claim",
      nonGoals: [],
      acceptanceCriteria: ["claimed once"],
      testPlan: [["node", "-e", "process.exit(0)"]],
      baseCommitSha: "a".repeat(40),
      branchName: "codezilla/claim",
      repositoryPath: "docs/spec.md",
      actorId: "test",
      idempotencyKey: "claim-freeze",
      headSha: "b".repeat(40),
      pullRequestNumber: 1,
      pullRequestUrl: "https://github.com/CJIMENZ/fixture/pull/1",
    });
    await service.recordApproval({
      workflowId: current.id,
      type: "specification",
      subjectType: "spec_hash",
      subjectValue: frozen.specificationSha256,
      decision: "approved",
      actorId: "github:CJIMENZ",
      source: "test",
      idempotencyKey: "claim-approval",
    });
    await service.authorizeBuild({
      workflowId: current.id,
      expectedVersion: frozen.workflow.stateVersion,
      actorId: "github:CJIMENZ",
      idempotencyKey: "claim-authorize",
    });

    const [left, right] = await Promise.all([
      store.claimNext({
        runnerId: "runner:left",
        leaseSeconds: 60,
        occurredAt: fixedClock.now().toISOString(),
        idempotencyKey: "claim-left",
      }),
      store.claimNext({
        runnerId: "runner:right",
        leaseSeconds: 60,
        occurredAt: fixedClock.now().toISOString(),
        idempotencyKey: "claim-right",
      }),
    ]);
    expect([left, right].filter(Boolean)).toHaveLength(1);
  });
});

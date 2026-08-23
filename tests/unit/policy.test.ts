import { describe, expect, it } from "vitest";
import {
  assertCommandAllowed,
  assertHumanApproval,
  assertIndependentReview,
} from "../../src/core/policy";
import { PolicyError } from "../../src/domain/errors";
import { ApprovalSchema } from "../../src/domain/model";

describe("policy gates", () => {
  it("compares commands as exact argv without shell interpretation", () => {
    expect(() =>
      assertCommandAllowed(["npm", "test"], [["npm", "test"]]),
    ).not.toThrow();
    expect(() =>
      assertCommandAllowed(["npm", "test", "--", "extra"], [["npm", "test"]]),
    ).toThrow(PolicyError);
  });

  it("requires a distinct reviewer profile", () => {
    expect(() => assertIndependentReview("profile-a", "profile-a")).toThrow(
      PolicyError,
    );
    expect(() =>
      assertIndependentReview("profile-a", "profile-b"),
    ).not.toThrow();
  });

  it("uses the latest decision per actor and subject", () => {
    const base = {
      workflowId: "00000000-0000-4000-8000-000000000011",
      type: "implementation" as const,
      subjectType: "commit_sha" as const,
      subjectValue: "a".repeat(40),
      actorId: "github:CJIMENZ",
      source: "test" as const,
      policyVersion: "test/1",
    };
    const approvals = [
      ApprovalSchema.parse({
        ...base,
        id: "00000000-0000-4000-8000-000000000021",
        decision: "approved",
        idempotencyKey: "approval-1",
        decidedAt: "2026-08-23T12:00:00.000Z",
      }),
      ApprovalSchema.parse({
        ...base,
        id: "00000000-0000-4000-8000-000000000022",
        decision: "revoked",
        idempotencyKey: "approval-2",
        decidedAt: "2026-08-23T12:01:00.000Z",
      }),
    ];
    expect(() =>
      assertHumanApproval({
        approvals,
        type: "implementation",
        subjectValue: base.subjectValue,
        policyVersion: "test/1",
        allowedActorIds: [base.actorId],
        minimum: 1,
      }),
    ).toThrow(PolicyError);
  });
});

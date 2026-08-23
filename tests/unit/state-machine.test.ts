import { describe, expect, it } from "vitest";
import { InvalidTransitionError } from "../../src/domain/errors";
import {
  applyTransition,
  canTransition,
  terminalStates,
} from "../../src/domain/state-machine";
import { WorkflowSchema } from "../../src/domain/model";

const workflow = WorkflowSchema.parse({
  id: "00000000-0000-4000-8000-000000000011",
  projectId: "00000000-0000-4000-8000-000000000001",
  workItemId: "00000000-0000-4000-8000-000000000012",
  state: "intake_received",
  stateVersion: 0,
  risk: "low",
  policyVersion: "test/1",
  retryCounters: {},
  createdAt: "2026-08-23T12:00:00.000Z",
  updatedAt: "2026-08-23T12:00:00.000Z",
});

describe("workflow state machine", () => {
  it("increments the version on a legal transition", () => {
    const transitioned = applyTransition(
      workflow,
      "triaging",
      "2026-08-23T12:01:00.000Z",
    );
    expect(transitioned.state).toBe("triaging");
    expect(transitioned.stateVersion).toBe(1);
  });

  it("fails closed on an illegal transition", () => {
    expect(() =>
      applyTransition(workflow, "done", "2026-08-23T12:01:00.000Z"),
    ).toThrow(InvalidTransitionError);
  });

  it("keeps terminal states terminal", () => {
    expect(terminalStates).toEqual(new Set(["done", "cancelled"]));
    expect(canTransition("done", "intake_received")).toBe(false);
    expect(canTransition("cancelled", "ready_for_execution")).toBe(false);
  });
});

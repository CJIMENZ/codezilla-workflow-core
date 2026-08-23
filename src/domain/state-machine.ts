import { InvalidTransitionError } from "./errors";
import type { Workflow, WorkflowState } from "./model";

export const terminalStates = new Set<WorkflowState>(["done", "cancelled"]);

export const transitionMap = {
  intake_received: ["triaging", "cancelled"],
  triaging: ["needs_clarification", "drafting_spec", "blocked"],
  needs_clarification: ["triaging", "cancelled"],
  drafting_spec: ["awaiting_spec_approval", "blocked"],
  awaiting_spec_approval: ["drafting_spec", "ready_for_execution", "cancelled"],
  ready_for_execution: ["claimed", "blocked", "cancelled"],
  claimed: ["executing", "blocked", "cancelling"],
  executing: ["awaiting_agent_review", "blocked", "cancelling"],
  awaiting_agent_review: ["executing", "qa_running", "blocked", "cancelling"],
  qa_running: ["executing", "awaiting_human_review", "blocked", "cancelling"],
  awaiting_human_review: ["executing", "merge_ready", "blocked", "cancelling"],
  merge_ready: ["merged", "blocked", "cancelling"],
  merged: ["verifying", "blocked"],
  verifying: ["done", "blocked"],
  blocked: ["ready_for_execution", "cancelled"],
  cancelling: ["cancelled", "blocked"],
  done: [],
  cancelled: [],
} as const satisfies Record<WorkflowState, readonly WorkflowState[]>;

export function canTransition(from: WorkflowState, to: WorkflowState): boolean {
  return (transitionMap[from] as readonly WorkflowState[]).includes(to);
}

export function assertTransition(from: WorkflowState, to: WorkflowState): void {
  if (!canTransition(from, to)) {
    throw new InvalidTransitionError(from, to);
  }
}

export function applyTransition(
  workflow: Workflow,
  to: WorkflowState,
  now: string,
  patch: Partial<Workflow> = {},
): Workflow {
  assertTransition(workflow.state, to);
  return {
    ...workflow,
    ...patch,
    id: workflow.id,
    state: to,
    stateVersion: workflow.stateVersion + 1,
    updatedAt: now,
  };
}

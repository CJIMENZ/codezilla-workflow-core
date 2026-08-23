export class CodezillaError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends CodezillaError {
  constructor(
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message, "validation_failed", details);
  }
}

export class InvalidTransitionError extends CodezillaError {
  constructor(from: string, to: string) {
    super(
      `Workflow cannot transition from ${from} to ${to}`,
      "invalid_transition",
      {
        from,
        to,
      },
    );
  }
}

export class ConcurrencyError extends CodezillaError {
  constructor(workflowId: string, expectedVersion: number) {
    super(
      "Workflow was changed by another writer",
      "optimistic_concurrency_conflict",
      {
        workflowId,
        expectedVersion,
      },
    );
  }
}

export class PolicyError extends CodezillaError {
  constructor(
    message: string,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message, "policy_denied", details);
  }
}

export class AdapterError extends CodezillaError {
  constructor(
    message: string,
    readonly classification:
      | "transient"
      | "capacity"
      | "authentication"
      | "input"
      | "policy"
      | "integrity"
      | "permanent",
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message, "adapter_error", { ...details, classification });
  }
}

import type { ProjectConfig } from "../src/config/schema";

export function projectConfig(
  overrides: {
    checkoutRoot?: string;
    worktreeRoot?: string;
    enabled?: boolean;
  } = {},
): ProjectConfig {
  return {
    schemaVersion: 1,
    project: {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Fixture Project",
      enabled: overrides.enabled ?? true,
      mode: "personal",
      riskCeiling: "low",
      owner: { id: "github:CJIMENZ", githubLogin: "CJIMENZ" },
      secrets: { source: "environment" },
      repository: {
        owner: "CJIMENZ",
        name: "fixture",
        defaultBranch: "main",
        localCheckoutRoot: overrides.checkoutRoot ?? "/tmp/codezilla-fixture",
        visibility: "private",
      },
      execution: {
        maxConcurrentWorkflows: 1,
        minimumFreeDiskGiB: 0.001,
        leaseSeconds: 300,
        heartbeatSeconds: 30,
        commandTimeoutSeconds: 30,
        worktreeRoot: overrides.worktreeRoot ?? "/tmp/codezilla-worktrees",
        allowedChangePaths: ["src", "tests", "docs", "package.json"],
        allowedCommands: [["node", "-e", "process.exit(0)"]],
      },
      approvals: {
        specification: {
          minimumHumanApprovals: 1,
          allowedActorIds: ["github:CJIMENZ"],
        },
        implementation: {
          minimumHumanApprovals: 1,
          allowedActorIds: ["github:CJIMENZ"],
        },
        requireIndependentAgentReview: true,
      },
      retryBudget: {
        providerFailoversPerStage: 2,
        coderReviewLoops: 2,
        qaLoops: 2,
        totalModelAttempts: 8,
      },
      providerProfiles: [
        {
          id: "planner-reviewer",
          provider: "custom",
          enabled: true,
          roles: ["planner", "reviewer"],
          command: "fixture",
          args: [],
          sandbox: "read-only",
          maxConcurrency: 1,
          timeoutSeconds: 30,
          environmentAllowlist: ["PATH"],
        },
        {
          id: "coder",
          provider: "custom",
          enabled: true,
          roles: ["coder"],
          command: "fixture",
          args: [],
          sandbox: "workspace-write",
          maxConcurrency: 1,
          timeoutSeconds: 30,
          environmentAllowlist: ["PATH"],
        },
      ],
    },
  };
}

export const fixedClock = {
  now: () => new Date("2026-08-23T12:00:00.000Z"),
};

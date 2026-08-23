import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import YAML from "yaml";
import { z } from "zod";
import { ValidationError } from "../domain/errors";
import { RiskSchema, StageSchema } from "../domain/model";
import { hashObject } from "../core/hashing";

const ApprovalPolicySchema = z.object({
  minimumHumanApprovals: z.number().int().nonnegative(),
  allowedActorIds: z.array(z.string().min(1)),
});

export const ProviderProfileConfigSchema = z.object({
  id: z.string().min(1),
  provider: z.enum(["codex", "claude", "gemini", "ollama", "custom"]),
  enabled: z.boolean().default(true),
  roles: z.array(StageSchema).min(1),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  sandbox: z.enum(["read-only", "workspace-write"]),
  maxConcurrency: z.number().int().positive().default(1),
  timeoutSeconds: z.number().int().positive().default(1800),
  environmentAllowlist: z.array(z.string()).default(["PATH", "TMPDIR", "LANG"]),
});
export type ProviderProfileConfig = z.infer<typeof ProviderProfileConfigSchema>;

export const ProjectConfigSchema = z.object({
  schemaVersion: z.literal(1),
  project: z.object({
    id: z.string().uuid(),
    name: z.string().min(1),
    enabled: z.boolean(),
    mode: z.enum(["personal", "team"]),
    riskCeiling: RiskSchema,
    owner: z.object({
      id: z.string().min(1),
      githubLogin: z.string().min(1),
    }),
    secrets: z
      .discriminatedUnion("source", [
        z.object({ source: z.literal("environment") }),
        z.object({
          source: z.literal("macos-keychain"),
          service: z.string().min(1),
        }),
      ])
      .default({ source: "environment" }),
    repository: z.object({
      owner: z.string().min(1),
      name: z.string().min(1),
      defaultBranch: z.string().min(1),
      localCheckoutRoot: z.string().min(1),
      visibility: z.enum(["private", "public"]),
    }),
    clickup: z
      .object({
        workspaceId: z.string().min(1),
        listId: z.string().min(1),
        managedCustomFieldIds: z.record(z.string(), z.string()),
        statusByWorkflowState: z.record(z.string(), z.string()).default({}),
      })
      .optional(),
    execution: z.object({
      maxConcurrentWorkflows: z.number().int().positive().max(2),
      minimumFreeDiskGiB: z.number().positive(),
      leaseSeconds: z.number().int().positive(),
      heartbeatSeconds: z.number().int().positive(),
      commandTimeoutSeconds: z.number().int().positive(),
      allowedCommands: z.array(z.array(z.string().min(1)).min(1)),
      worktreeRoot: z.string().min(1),
      allowedChangePaths: z.array(z.string().min(1)).min(1),
    }),
    approvals: z.object({
      specification: ApprovalPolicySchema,
      implementation: ApprovalPolicySchema,
      requireIndependentAgentReview: z.boolean(),
    }),
    retryBudget: z.object({
      providerFailoversPerStage: z.number().int().nonnegative().max(5),
      coderReviewLoops: z.number().int().nonnegative().max(5),
      qaLoops: z.number().int().nonnegative().max(5),
      totalModelAttempts: z.number().int().positive().max(30),
    }),
    providerProfiles: z.array(ProviderProfileConfigSchema),
  }),
});
export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;

export interface LoadedProjectConfig {
  path: string;
  fingerprint: string;
  config: ProjectConfig;
}

export async function loadProjectConfig(
  path: string,
): Promise<LoadedProjectConfig> {
  const absolutePath = resolve(path);
  const source = await readFile(absolutePath, "utf8");
  const parsedYaml: unknown = YAML.parse(source);
  const result = ProjectConfigSchema.safeParse(parsedYaml);

  if (!result.success) {
    throw new ValidationError("Project configuration is invalid", {
      path: absolutePath,
      issues: result.error.issues,
    });
  }

  if (!isAbsolute(result.data.project.repository.localCheckoutRoot)) {
    throw new ValidationError(
      "repository.localCheckoutRoot must be an absolute path",
      {
        path: result.data.project.repository.localCheckoutRoot,
      },
    );
  }

  if (!isAbsolute(result.data.project.execution.worktreeRoot)) {
    throw new ValidationError(
      "execution.worktreeRoot must be an absolute path",
      {
        path: result.data.project.execution.worktreeRoot,
      },
    );
  }

  if (
    result.data.project.execution.heartbeatSeconds >=
    result.data.project.execution.leaseSeconds
  ) {
    throw new ValidationError(
      "heartbeatSeconds must be shorter than leaseSeconds",
    );
  }

  if (
    result.data.project.mode === "personal" &&
    !result.data.project.approvals.specification.allowedActorIds.includes(
      result.data.project.owner.id,
    )
  ) {
    throw new ValidationError(
      "Personal project owner must be a specification approver",
    );
  }

  return {
    path: absolutePath,
    fingerprint: hashObject(result.data),
    config: result.data,
  };
}

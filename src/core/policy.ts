import { realpath } from "node:fs/promises";
import { relative, resolve } from "node:path";
import type { ProjectConfig } from "../config/schema";
import { PolicyError } from "../domain/errors";
import type { Approval, Risk, Stage } from "../domain/model";

const riskRank: Readonly<Record<Risk, number>> = {
  low: 0,
  medium: 1,
  high: 2,
  prohibited: 3,
};

export function assertRiskWithinCeiling(risk: Risk, ceiling: Risk): void {
  if (riskRank[risk] > riskRank[ceiling] || risk === "prohibited") {
    throw new PolicyError(
      "Work-item risk exceeds the project's approved ceiling",
      {
        risk,
        ceiling,
      },
    );
  }
}

export function assertCommandAllowed(
  argv: readonly string[],
  allowedCommands: readonly (readonly string[])[],
): void {
  const matches = allowedCommands.some(
    (allowed) =>
      allowed.length === argv.length &&
      allowed.every((value, index) => argv[index] === value),
  );

  if (!matches) {
    throw new PolicyError(
      "Command is not on the project's exact-argv allowlist",
      { argv },
    );
  }
}

export async function assertPathWithinRoot(
  path: string,
  root: string,
): Promise<void> {
  const [resolvedPath, resolvedRoot] = await Promise.all([
    realpath(path),
    realpath(root),
  ]);
  const pathFromRoot = relative(resolvedRoot, resolvedPath);
  if (
    pathFromRoot.startsWith("..") ||
    resolve(resolvedRoot, pathFromRoot) !== resolvedPath
  ) {
    throw new PolicyError("Resolved path escapes the configured project root", {
      path: resolvedPath,
      root: resolvedRoot,
    });
  }
}

export function assertProfileMayRunStage(
  profile: ProjectConfig["project"]["providerProfiles"][number],
  stage: Stage,
): void {
  if (!profile.enabled || !profile.roles.includes(stage)) {
    throw new PolicyError("Provider profile is not enabled for this stage", {
      profileId: profile.id,
      stage,
    });
  }

  if (
    (stage === "triage" ||
      stage === "planner" ||
      stage === "reviewer" ||
      stage === "qa") &&
    profile.sandbox !== "read-only"
  ) {
    throw new PolicyError(
      "Read-only stage requires a read-only provider profile",
      {
        profileId: profile.id,
        stage,
      },
    );
  }
}

export function assertIndependentReview(
  authorProfileId: string,
  reviewerProfileId: string,
): void {
  if (authorProfileId === reviewerProfileId) {
    throw new PolicyError(
      "Agent review must use a profile distinct from the author",
      {
        authorProfileId,
        reviewerProfileId,
      },
    );
  }
}

function latestDecisions(
  approvals: readonly Approval[],
  type: Approval["type"],
  subjectValue: string,
  policyVersion: string,
): Map<string, Approval> {
  const decisions = new Map<string, Approval>();
  for (const approval of [...approvals].sort((left, right) =>
    left.decidedAt.localeCompare(right.decidedAt),
  )) {
    if (
      approval.type === type &&
      approval.subjectValue === subjectValue &&
      approval.policyVersion === policyVersion
    ) {
      decisions.set(approval.actorId, approval);
    }
  }
  return decisions;
}

export function assertHumanApproval(input: {
  approvals: readonly Approval[];
  type: Approval["type"];
  subjectValue: string;
  policyVersion: string;
  allowedActorIds: readonly string[];
  minimum: number;
}): void {
  const current = latestDecisions(
    input.approvals,
    input.type,
    input.subjectValue,
    input.policyVersion,
  );
  const valid = [...current.values()].filter(
    (approval) =>
      approval.decision === "approved" &&
      input.allowedActorIds.includes(approval.actorId),
  );

  if (valid.length < input.minimum) {
    throw new PolicyError(
      "Matching approval threshold has not been satisfied",
      {
        approvalType: input.type,
        subjectValue: input.subjectValue,
        validApprovals: valid.length,
        requiredApprovals: input.minimum,
      },
    );
  }
}

/**
 * AzureDevOpsCli - Effect service contract for `az repos` process interactions.
 *
 * Provides thin command execution helpers for Azure DevOps PR workflows.
 *
 * @module AzureDevOpsCli
 */
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProcessRunResult } from "../../processRunner";
import type { AzureDevOpsCliError } from "../Errors.ts";

export interface AzureDevOpsPullRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly state?: "open" | "closed" | "merged";
}

export interface AzureDevOpsRepositoryCloneUrls {
  readonly nameWithOwner: string;
  readonly url: string;
  readonly sshUrl: string;
}

/**
 * AzureDevOpsCliShape - Service API for executing Azure DevOps CLI commands.
 */
export interface AzureDevOpsCliShape {
  readonly execute: (input: {
    readonly cwd: string;
    readonly args: ReadonlyArray<string>;
    readonly timeoutMs?: number;
  }) => Effect.Effect<ProcessRunResult, AzureDevOpsCliError>;

  readonly listOpenPullRequests: (input: {
    readonly cwd: string;
    readonly headSelector: string;
    readonly limit?: number;
  }) => Effect.Effect<ReadonlyArray<AzureDevOpsPullRequestSummary>, AzureDevOpsCliError>;

  readonly getPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
  }) => Effect.Effect<AzureDevOpsPullRequestSummary, AzureDevOpsCliError>;

  readonly getRepositoryCloneUrls: (input: {
    readonly cwd: string;
    readonly repository: string;
  }) => Effect.Effect<AzureDevOpsRepositoryCloneUrls, AzureDevOpsCliError>;

  readonly createPullRequest: (input: {
    readonly cwd: string;
    readonly baseBranch: string;
    readonly headSelector: string;
    readonly title: string;
    readonly bodyFile: string;
  }) => Effect.Effect<void, AzureDevOpsCliError>;

  readonly getDefaultBranch: (input: {
    readonly cwd: string;
  }) => Effect.Effect<string | null, AzureDevOpsCliError>;

  readonly checkoutPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
    readonly force?: boolean;
  }) => Effect.Effect<void, AzureDevOpsCliError>;
}

/**
 * AzureDevOpsCli - Service tag for Azure DevOps CLI process execution.
 */
export class AzureDevOpsCli extends ServiceMap.Service<AzureDevOpsCli, AzureDevOpsCliShape>()(
  "t3/git/Services/AzureDevOpsCli",
) {}

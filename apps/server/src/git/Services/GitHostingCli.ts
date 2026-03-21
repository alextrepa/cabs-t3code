/**
 * GitHostingCli - Provider-agnostic service contract for hosting platform CLI operations.
 *
 * Abstracts over platform-specific CLIs (GitHub `gh`, Azure DevOps `az repos`,
 * and future providers like GitLab `glab`, Bitbucket, etc.) so that
 * GitManager can work with any hosting provider transparently.
 *
 * To add a new provider:
 * 1. Register it in hosting.ts (provider registration list)
 * 2. Create a Services/<Provider>Cli.ts interface
 * 3. Create a Layers/<Provider>Cli.ts implementation
 * 4. Register the adapter in Layers/GitHostingCliResolver.ts
 *
 * @module GitHostingCli
 */
import { ServiceMap } from "effect";
import type { Effect } from "effect";

import type { ProcessRunResult } from "../../processRunner";
import type { GitHostingCliError } from "../Errors.ts";
import type { GitHostingProviderKind } from "../hosting.ts";

export interface HostingPullRequestSummary {
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly baseRefName: string;
  readonly headRefName: string;
  readonly state?: "open" | "closed" | "merged";
  readonly isCrossRepository?: boolean;
  readonly headRepositoryNameWithOwner?: string | null;
  readonly headRepositoryOwnerLogin?: string | null;
}

export interface HostingRepositoryCloneUrls {
  readonly nameWithOwner: string;
  readonly url: string;
  readonly sshUrl: string;
}

/**
 * GitHostingCliShape - Provider-agnostic service API for hosting platform CLI commands.
 */
export interface GitHostingCliShape {
  /** The detected hosting provider kind for this instance. */
  readonly provider: GitHostingProviderKind;

  /** Execute a hosting CLI command and return full process output. */
  readonly execute: (input: {
    readonly cwd: string;
    readonly args: ReadonlyArray<string>;
    readonly timeoutMs?: number;
  }) => Effect.Effect<ProcessRunResult, GitHostingCliError>;

  /** List open pull requests for a head branch. */
  readonly listOpenPullRequests: (input: {
    readonly cwd: string;
    readonly headSelector: string;
    readonly limit?: number;
  }) => Effect.Effect<ReadonlyArray<HostingPullRequestSummary>, GitHostingCliError>;

  /** Resolve a pull request by URL, number, or branch-ish identifier. */
  readonly getPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
  }) => Effect.Effect<HostingPullRequestSummary, GitHostingCliError>;

  /** Resolve clone URLs for a repository. */
  readonly getRepositoryCloneUrls: (input: {
    readonly cwd: string;
    readonly repository: string;
  }) => Effect.Effect<HostingRepositoryCloneUrls, GitHostingCliError>;

  /** Create a pull request from branch context and body file. */
  readonly createPullRequest: (input: {
    readonly cwd: string;
    readonly baseBranch: string;
    readonly headSelector: string;
    readonly title: string;
    readonly bodyFile: string;
  }) => Effect.Effect<void, GitHostingCliError>;

  /** Resolve repository default branch through hosting metadata. */
  readonly getDefaultBranch: (input: {
    readonly cwd: string;
  }) => Effect.Effect<string | null, GitHostingCliError>;

  /** Checkout a pull request into the current repository worktree. */
  readonly checkoutPullRequest: (input: {
    readonly cwd: string;
    readonly reference: string;
    readonly force?: boolean;
  }) => Effect.Effect<void, GitHostingCliError>;
}

/**
 * GitHostingCli - Service tag for hosting platform CLI execution.
 */
export class GitHostingCli extends ServiceMap.Service<GitHostingCli, GitHostingCliShape>()(
  "t3/git/Services/GitHostingCli",
) {}

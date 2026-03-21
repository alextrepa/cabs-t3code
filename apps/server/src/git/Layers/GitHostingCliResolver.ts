/**
 * GitHostingCliResolver - Resolves the correct hosting CLI based on git remote URL.
 *
 * Uses the hosting provider registry to detect the provider from the remote URL,
 * then delegates all operations to the matching CLI adapter.
 *
 * To add a new hosting provider:
 * 1. Register it in hosting.ts (provider registration list)
 * 2. Create a Services/<Provider>Cli.ts service interface
 * 3. Create a Layers/<Provider>Cli.ts implementation layer
 * 4. Add the adapter to the `adapters` map in this file
 * 5. Provide the layer in serverLayers.ts
 *
 * @module GitHostingCliResolver
 */
import { Effect, Layer } from "effect";

import { GitHubCli } from "../Services/GitHubCli.ts";
import { AzureDevOpsCli } from "../Services/AzureDevOpsCli.ts";
import { GitHostingCli, type GitHostingCliShape } from "../Services/GitHostingCli.ts";
import { GitCore } from "../Services/GitCore.ts";
import {
  detectHostingProvider,
  HOSTING_GITHUB,
  HOSTING_AZURE_DEVOPS,
  type GitHostingProviderKind,
} from "../hosting.ts";

/**
 * A hosting CLI adapter provides all the operations for a specific provider.
 * Each registered provider must supply one.
 */
interface HostingCliAdapter {
  readonly execute: GitHostingCliShape["execute"];
  readonly listOpenPullRequests: GitHostingCliShape["listOpenPullRequests"];
  readonly getPullRequest: GitHostingCliShape["getPullRequest"];
  readonly getRepositoryCloneUrls: GitHostingCliShape["getRepositoryCloneUrls"];
  readonly createPullRequest: GitHostingCliShape["createPullRequest"];
  readonly getDefaultBranch: GitHostingCliShape["getDefaultBranch"];
  readonly checkoutPullRequest: GitHostingCliShape["checkoutPullRequest"];
}

const makeGitHostingCli = Effect.gen(function* () {
  const gitCore = yield* GitCore;
  const gitHubCli = yield* GitHubCli;
  const azureDevOpsCli = yield* AzureDevOpsCli;

  // ─── Adapter registry ─────────────────────────────────────────────
  // Map each provider kind to its CLI adapter.
  // To add a new provider, add a new entry here.
  const adapters = new Map<GitHostingProviderKind, HostingCliAdapter>([
    [
      HOSTING_GITHUB,
      {
        execute: gitHubCli.execute,
        listOpenPullRequests: (input) => gitHubCli.listOpenPullRequests(input),
        getPullRequest: (input) => gitHubCli.getPullRequest(input),
        getRepositoryCloneUrls: (input) => gitHubCli.getRepositoryCloneUrls(input),
        createPullRequest: (input) => gitHubCli.createPullRequest(input),
        getDefaultBranch: (input) => gitHubCli.getDefaultBranch(input),
        checkoutPullRequest: (input) => gitHubCli.checkoutPullRequest(input),
      },
    ],
    [
      HOSTING_AZURE_DEVOPS,
      {
        execute: azureDevOpsCli.execute,
        listOpenPullRequests: (input) => azureDevOpsCli.listOpenPullRequests(input),
        getPullRequest: (input) => azureDevOpsCli.getPullRequest(input),
        getRepositoryCloneUrls: (input) => azureDevOpsCli.getRepositoryCloneUrls(input),
        createPullRequest: (input) => azureDevOpsCli.createPullRequest(input),
        getDefaultBranch: (input) => azureDevOpsCli.getDefaultBranch(input),
        checkoutPullRequest: (input) => azureDevOpsCli.checkoutPullRequest(input),
      },
    ],
    // Future providers:
    // [HOSTING_GITLAB, { ... }],
    // [HOSTING_BITBUCKET, { ... }],
  ]);

  const defaultAdapter = adapters.get(HOSTING_GITHUB)!;

  // Cache: cwd -> provider kind
  const providerCache = new Map<string, GitHostingProviderKind>();

  const resolveProvider = (cwd: string) =>
    Effect.gen(function* () {
      const cached = providerCache.get(cwd);
      if (cached) return cached;

      const originUrl = yield* gitCore
        .readConfigValue(cwd, "remote.origin.url")
        .pipe(Effect.catch(() => Effect.succeed(null)));

      const provider = detectHostingProvider(originUrl);
      providerCache.set(cwd, provider);
      return provider;
    });

  const resolveAdapter = (cwd: string) =>
    resolveProvider(cwd).pipe(
      Effect.map((kind) => ({
        kind,
        adapter: adapters.get(kind) ?? defaultAdapter,
      })),
    );

  return {
    // Default provider — may be refined per-call via the adapter resolution
    provider: HOSTING_GITHUB,
    execute: (input) =>
      resolveAdapter(input.cwd).pipe(
        Effect.flatMap(({ adapter }) => adapter.execute(input)),
      ),
    listOpenPullRequests: (input) =>
      resolveAdapter(input.cwd).pipe(
        Effect.flatMap(({ adapter }) => adapter.listOpenPullRequests(input)),
      ),
    getPullRequest: (input) =>
      resolveAdapter(input.cwd).pipe(
        Effect.flatMap(({ adapter }) => adapter.getPullRequest(input)),
      ),
    getRepositoryCloneUrls: (input) =>
      resolveAdapter(input.cwd).pipe(
        Effect.flatMap(({ adapter }) => adapter.getRepositoryCloneUrls(input)),
      ),
    createPullRequest: (input) =>
      resolveAdapter(input.cwd).pipe(
        Effect.flatMap(({ adapter }) => adapter.createPullRequest(input)),
      ),
    getDefaultBranch: (input) =>
      resolveAdapter(input.cwd).pipe(
        Effect.flatMap(({ adapter }) => adapter.getDefaultBranch(input)),
      ),
    checkoutPullRequest: (input) =>
      resolveAdapter(input.cwd).pipe(
        Effect.flatMap(({ adapter }) => adapter.checkoutPullRequest(input)),
      ),
  } satisfies GitHostingCliShape;
});

export const GitHostingCliLive = Layer.effect(GitHostingCli, makeGitHostingCli);

/**
 * GitHostingCliResolver - Resolves the correct hosting CLI based on git remote URL.
 *
 * Each call extracts the cwd from the input, reads the origin remote URL,
 * and delegates to either the GitHub CLI or Azure DevOps CLI implementation.
 *
 * @module GitHostingCliResolver
 */
import { Effect, Layer } from "effect";

import { GitHubCli } from "../Services/GitHubCli.ts";
import { AzureDevOpsCli } from "../Services/AzureDevOpsCli.ts";
import { GitHostingCli, type GitHostingCliShape } from "../Services/GitHostingCli.ts";
import { GitCore } from "../Services/GitCore.ts";
import { detectHostingProvider, type GitHostingProvider } from "../hosting.ts";

const makeGitHostingCli = Effect.gen(function* () {
  const gitCore = yield* GitCore;
  const gitHubCli = yield* GitHubCli;
  const azureDevOpsCli = yield* AzureDevOpsCli;

  // Cache: cwd -> provider
  const providerCache = new Map<string, GitHostingProvider>();

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

  const isAzure = (cwd: string) =>
    resolveProvider(cwd).pipe(Effect.map((p) => p === "azure-devops"));

  return {
    provider: "github",
    execute: (input) =>
      isAzure(input.cwd).pipe(
        Effect.flatMap((azure) =>
          azure ? azureDevOpsCli.execute(input) : gitHubCli.execute(input),
        ),
      ),
    listOpenPullRequests: (input) =>
      isAzure(input.cwd).pipe(
        Effect.flatMap((azure) =>
          azure
            ? azureDevOpsCli.listOpenPullRequests(input)
            : gitHubCli.listOpenPullRequests(input),
        ),
      ),
    getPullRequest: (input) =>
      isAzure(input.cwd).pipe(
        Effect.flatMap((azure) =>
          azure ? azureDevOpsCli.getPullRequest(input) : gitHubCli.getPullRequest(input),
        ),
      ),
    getRepositoryCloneUrls: (input) =>
      isAzure(input.cwd).pipe(
        Effect.flatMap((azure) =>
          azure
            ? azureDevOpsCli.getRepositoryCloneUrls(input)
            : gitHubCli.getRepositoryCloneUrls(input),
        ),
      ),
    createPullRequest: (input) =>
      isAzure(input.cwd).pipe(
        Effect.flatMap((azure) =>
          azure ? azureDevOpsCli.createPullRequest(input) : gitHubCli.createPullRequest(input),
        ),
      ),
    getDefaultBranch: (input) =>
      isAzure(input.cwd).pipe(
        Effect.flatMap((azure) =>
          azure ? azureDevOpsCli.getDefaultBranch(input) : gitHubCli.getDefaultBranch(input),
        ),
      ),
    checkoutPullRequest: (input) =>
      isAzure(input.cwd).pipe(
        Effect.flatMap((azure) =>
          azure ? azureDevOpsCli.checkoutPullRequest(input) : gitHubCli.checkoutPullRequest(input),
        ),
      ),
  } satisfies GitHostingCliShape;
});

export const GitHostingCliLive = Layer.effect(GitHostingCli, makeGitHostingCli);

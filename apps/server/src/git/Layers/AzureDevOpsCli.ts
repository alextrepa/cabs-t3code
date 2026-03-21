import { readFileSync } from "node:fs";

import { Effect, Layer } from "effect";

import { runProcess } from "../../processRunner";
import { AzureDevOpsCliError } from "../Errors.ts";
import {
  AzureDevOpsCli,
  type AzureDevOpsCliShape,
  type AzureDevOpsPullRequestSummary,
} from "../Services/AzureDevOpsCli.ts";

const DEFAULT_TIMEOUT_MS = 30_000;

function normalizeAzureDevOpsCliError(operation: string, error: unknown): AzureDevOpsCliError {
  if (error instanceof Error) {
    if (error.message.includes("Command not found: az")) {
      return new AzureDevOpsCliError({
        operation,
        detail: "Azure CLI (`az`) is required but not available on PATH.",
        cause: error,
      });
    }

    const lower = error.message.toLowerCase();
    if (
      lower.includes("az login") ||
      lower.includes("not logged in") ||
      lower.includes("please run") ||
      lower.includes("authentication")
    ) {
      return new AzureDevOpsCliError({
        operation,
        detail:
          "Azure CLI is not authenticated. Run `az login` and `az devops configure --defaults organization=<url> project=<name>` and retry.",
        cause: error,
      });
    }

    return new AzureDevOpsCliError({
      operation,
      detail: `Azure DevOps CLI command failed: ${error.message}`,
      cause: error,
    });
  }

  return new AzureDevOpsCliError({
    operation,
    detail: "Azure DevOps CLI command failed.",
    cause: error,
  });
}

function normalizeAzurePrState(status: string | null | undefined): "open" | "closed" | "merged" {
  if (!status) return "open";
  const lower = status.toLowerCase();
  if (lower === "active") return "open";
  if (lower === "completed") return "merged";
  if (lower === "abandoned") return "closed";
  return "open";
}

function parseAzurePrJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function toAzurePrSummary(record: Record<string, unknown>): AzureDevOpsPullRequestSummary | null {
  const pullRequestId = record.pullRequestId;
  const title = record.title;
  const status = record.status;
  const sourceRefName = record.sourceRefName;
  const targetRefName = record.targetRefName;
  const repository = record.repository as Record<string, unknown> | undefined;

  if (typeof pullRequestId !== "number" || typeof title !== "string") {
    return null;
  }

  const sourceBranch =
    typeof sourceRefName === "string" ? sourceRefName.replace(/^refs\/heads\//, "") : "";
  const targetBranch =
    typeof targetRefName === "string" ? targetRefName.replace(/^refs\/heads\//, "") : "";

  const webUrl = record.url;
  // Azure DevOps API returns API URLs; construct the web URL from repository info
  const repoWebUrl = (repository as Record<string, unknown> | undefined)?.webUrl;
  const prUrl =
    typeof repoWebUrl === "string"
      ? `${repoWebUrl}/pullrequest/${pullRequestId}`
      : typeof webUrl === "string"
        ? webUrl
        : "";

  return {
    number: pullRequestId,
    title,
    url: prUrl,
    baseRefName: targetBranch,
    headRefName: sourceBranch,
    state: normalizeAzurePrState(typeof status === "string" ? status : null),
  };
}

const makeAzureDevOpsCli = Effect.sync(() => {
  const execute: AzureDevOpsCliShape["execute"] = (input) =>
    Effect.tryPromise({
      try: () =>
        runProcess("az", input.args, {
          cwd: input.cwd,
          timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        }),
      catch: (error) => normalizeAzureDevOpsCliError("execute", error),
    });

  const service = {
    execute,
    listOpenPullRequests: (input) =>
      execute({
        cwd: input.cwd,
        args: [
          "repos",
          "pr",
          "list",
          "--source-branch",
          input.headSelector,
          "--status",
          "active",
          "--top",
          String(input.limit ?? 1),
          "--output",
          "json",
        ],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) => {
          if (raw.length === 0) return Effect.succeed([]);
          const parsed = parseAzurePrJson(raw);
          if (!Array.isArray(parsed)) return Effect.succeed([]);
          const results: AzureDevOpsPullRequestSummary[] = [];
          for (const entry of parsed) {
            if (!entry || typeof entry !== "object") continue;
            const summary = toAzurePrSummary(entry as Record<string, unknown>);
            if (summary) results.push(summary);
          }
          return Effect.succeed(results);
        }),
      ),
    getPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repos", "pr", "show", "--id", input.reference, "--output", "json"],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) => {
          const parsed = parseAzurePrJson(raw);
          if (!parsed || typeof parsed !== "object") {
            return Effect.fail(
              new AzureDevOpsCliError({
                operation: "getPullRequest",
                detail: "Azure DevOps CLI returned invalid pull request JSON.",
              }),
            );
          }
          const summary = toAzurePrSummary(parsed as Record<string, unknown>);
          if (!summary) {
            return Effect.fail(
              new AzureDevOpsCliError({
                operation: "getPullRequest",
                detail: "Pull request not found or invalid response.",
              }),
            );
          }
          return Effect.succeed(summary);
        }),
      ),
    getRepositoryCloneUrls: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repos", "show", "--repository", input.repository, "--output", "json"],
      }).pipe(
        Effect.map((result) => result.stdout.trim()),
        Effect.flatMap((raw) => {
          const parsed = parseAzurePrJson(raw);
          if (!parsed || typeof parsed !== "object") {
            return Effect.fail(
              new AzureDevOpsCliError({
                operation: "getRepositoryCloneUrls",
                detail: "Azure DevOps CLI returned invalid repository JSON.",
              }),
            );
          }
          const record = parsed as Record<string, unknown>;
          const name = typeof record.name === "string" ? record.name : "";
          const projectName =
            typeof (record.project as Record<string, unknown>)?.name === "string"
              ? ((record.project as Record<string, unknown>).name as string)
              : "";
          const remoteUrl = typeof record.remoteUrl === "string" ? record.remoteUrl : "";
          const sshUrl = typeof record.sshUrl === "string" ? record.sshUrl : remoteUrl;
          const nameWithOwner = projectName ? `${projectName}/${name}` : name;

          return Effect.succeed({
            nameWithOwner,
            url: remoteUrl,
            sshUrl,
          });
        }),
      ),
    createPullRequest: (input) => {
      const bodyContent = (() => {
        try {
          return readFileSync(input.bodyFile, "utf-8");
        } catch {
          return "";
        }
      })();
      return execute({
        cwd: input.cwd,
        args: [
          "repos",
          "pr",
          "create",
          "--source-branch",
          input.headSelector,
          "--target-branch",
          input.baseBranch,
          "--title",
          input.title,
          "--description",
          bodyContent,
          "--output",
          "json",
        ],
      }).pipe(Effect.asVoid);
    },
    getDefaultBranch: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repos", "show", "--output", "json"],
      }).pipe(
        Effect.map((result) => {
          const raw = result.stdout.trim();
          const parsed = parseAzurePrJson(raw);
          if (!parsed || typeof parsed !== "object") return null;
          const record = parsed as Record<string, unknown>;
          const defaultBranch =
            typeof record.defaultBranch === "string" ? record.defaultBranch : null;
          if (!defaultBranch) return null;
          return defaultBranch.replace(/^refs\/heads\//, "");
        }),
      ),
    checkoutPullRequest: (input) =>
      execute({
        cwd: input.cwd,
        args: ["repos", "pr", "checkout", "--id", input.reference],
      }).pipe(Effect.asVoid),
  } satisfies AzureDevOpsCliShape;

  return service;
});

export const AzureDevOpsCliLive = Layer.effect(AzureDevOpsCli, makeAzureDevOpsCli);

# Azure DevOps PR Support - Implementation Plan

## Architecture Overview

Introduce a **`GitHostingCli`** abstraction layer that sits between `GitManager` and the provider-specific CLI implementations (`GitHubCli`, `AzureDevOpsCli`). The hosting provider is auto-detected from the git remote origin URL. A factory layer resolves the correct implementation at runtime.

## Detection Logic

Parse the git origin remote URL:

- **Azure DevOps**: `dev.azure.com` or `*.visualstudio.com` patterns
- **GitHub**: `github.com` patterns
- **Default**: GitHub (when no recognizable provider found)

## Files to Create (new, no rebase conflicts)

### 1. `apps/server/src/git/Services/GitHostingCli.ts`

Provider-agnostic service interface for hosting platform CLI operations. Mirrors the subset of `GitHubCliShape` that `GitManager` actually uses:

- `listOpenPullRequests()`
- `getPullRequest()`
- `createPullRequest()`
- `getDefaultBranch()`
- `checkoutPullRequest()`
- `getRepositoryCloneUrls()`
- `execute()` (raw command passthrough)

### 2. `apps/server/src/git/Services/AzureDevOpsCli.ts`

Service interface for Azure DevOps CLI (`az repos`) commands - analogous to `GitHubCli` service.

### 3. `apps/server/src/git/Layers/AzureDevOpsCli.ts`

Implementation layer wrapping `az repos pr` CLI commands:

- `az repos pr create --source-branch <branch> --target-branch <branch> --title <title> --description <body>`
- `az repos pr list --source-branch <branch> --status active --output json`
- `az repos pr show --id <id> --output json`
- `az repos pr checkout --id <id>`
- `az repos pr list --target-branch <default> --top 1` (to detect default branch)

### 4. `apps/server/src/git/Layers/GitHostingCliResolver.ts`

Factory layer that:

1. Reads `git remote get-url origin`
2. Parses the URL to detect the hosting provider
3. Returns either `GitHubCli` or `AzureDevOpsCli` wrapped as `GitHostingCli`
4. Defaults to GitHub

### 5. `apps/server/src/git/hosting.ts`

Utility module with:

- `GitHostingProvider` type: `"github" | "azure-devops"`
- `detectHostingProvider(remoteUrl: string): GitHostingProvider`
- Azure DevOps URL parser: `parseAzureDevOpsProjectFromRemoteUrl()`

## Files to Modify (minimal, rebase-friendly changes)

### 6. `apps/server/src/git/Errors.ts`

Add `AzureDevOpsCliError` class (3-4 lines, mirrors `GitHubCliError`). Add to `GitManagerServiceError` union.

### 7. `apps/server/src/git/Layers/GitManager.ts`

**Key change**: Replace direct `GitHubCli` dependency with `GitHostingCli`.

- Line 14: Change `import { GitHubCli }` → `import { GitHostingCli }`
- Line 337: Change `const gitHubCli = yield* GitHubCli` → `const hostingCli = yield* GitHostingCli`
- Lines using `gitHubCli.*` → `hostingCli.*` (about 8 call sites)
- Add `parseAzureDevOpsProjectFromRemoteUrl()` call alongside existing `parseGitHubRepositoryNameWithOwnerFromRemoteUrl()` in `resolveRemoteRepositoryContext()`
- Make `resolveBranchHeadContext()` provider-aware (the `owner:branch` head selector format is GitHub-specific)

### 8. `apps/server/src/serverLayers.ts`

- Import and wire `AzureDevOpsCliLive` and `GitHostingCliResolverLive`
- Replace `Layer.provideMerge(GitHubCliLive)` with `Layer.provideMerge(GitHostingCliResolverLive)` in `gitManagerLayer`
- Provide both `GitHubCliLive` and `AzureDevOpsCliLive` to the resolver

### 9. `apps/web/src/components/Icons.tsx`

Add `AzureDevOpsIcon` SVG component (~10-15 lines).

### 10. `apps/web/src/components/GitActionsControl.tsx`

- Import `AzureDevOpsIcon`
- Conditionally render `AzureDevOpsIcon` or `GitHubIcon` based on a prop/context from the server indicating the detected hosting provider
- This requires passing `hostingProvider` through git status or a separate query

### 11. `packages/contracts/src/git.ts`

Add `hostingProvider` field to `GitStatusResult` or a new `GitHostingInfo` schema so the web UI knows which icon to show.

### 12. PR Template Support

In the `runPrStep()` function in `GitManager.ts`:

- Before generating PR content, check for `.azuredevops/pull_request_template.md`
- If found, read it and pass it to `textGeneration.generatePrContent()` as template context
- The text generation prompt should instruct the AI to fill in the template sections

In `TextGeneration` service/layer:

- Add optional `template` parameter to `generatePrContent()`
- When template is provided, the prompt instructs the AI to fill template sections with change-specific content

## Fork Maintainability Analysis

### Rebase Difficulty: **LOW-MODERATE**

**New files (no conflict risk):**

- 5 new files that will never conflict with upstream: `AzureDevOpsCli.ts` (service + layer), `GitHostingCli.ts`, `GitHostingCliResolver.ts`, `hosting.ts`

**Modified files (potential conflict zones):**

| File                    | Change Size       | Conflict Risk | Notes                                                                                                 |
| ----------------------- | ----------------- | ------------- | ----------------------------------------------------------------------------------------------------- |
| `Errors.ts`             | ~5 lines added    | Very Low      | Append-only addition at end of file                                                                   |
| `GitManager.ts`         | ~15 lines changed | **Moderate**  | Variable rename `gitHubCli`→`hostingCli` touches many lines; upstream may add new `gitHubCli.*` calls |
| `serverLayers.ts`       | ~5 lines changed  | Low           | Import + 1 layer swap in `gitManagerLayer` block                                                      |
| `Icons.tsx`             | ~15 lines added   | Very Low      | Append-only addition                                                                                  |
| `GitActionsControl.tsx` | ~10 lines changed | **Moderate**  | Icon conditional rendering; upstream may refactor this component                                      |
| `contracts/git.ts`      | ~3 lines added    | Low           | New optional field on `GitStatusResult`                                                               |

**Total fork diff**: ~200-250 lines changed across 6 existing files + ~600-800 lines in 5 new files.

**Rebase strategy**: Most conflicts would be mechanical (the `gitHubCli` → `hostingCli` rename in GitManager). The new files are zero-conflict. Overall this is a **manageable fork** that should survive most rebases with minor manual resolution. The main risk is if upstream significantly refactors `GitManager.ts` or changes the `GitHubCli` service interface.

### Risk Mitigation for Fork Maintenance

1. Keep `GitHostingCli` interface identical to `GitHubCliShape` — minimizes adapter logic
2. The `GitHostingCliResolver` pattern means `GitManager` only knows about one interface
3. If upstream adds new `GitHubCli` methods, you only need to add them to `GitHostingCli` and `AzureDevOpsCli`

/**
 * Hosting provider detection and registry.
 *
 * Provides an extensible pattern for detecting git hosting platforms from
 * remote URLs. New providers (GitHub, Azure DevOps, GitLab, Bitbucket, etc.)
 * register themselves with URL matchers.
 *
 * @module hosting
 */

/**
 * Known hosting provider identifiers.
 * This is a string type so new providers can be added without changing the base type.
 */
export type GitHostingProviderKind = string;

/** Well-known provider constants. */
export const HOSTING_GITHUB = "github" as const;
export const HOSTING_AZURE_DEVOPS = "azure-devops" as const;

/**
 * A registered hosting provider with its URL detection patterns.
 */
export interface GitHostingProviderRegistration {
  /** Unique identifier for this provider. */
  readonly kind: GitHostingProviderKind;
  /** Human-readable label for display. */
  readonly label: string;
  /** Returns true if the given remote URL belongs to this provider. */
  readonly matchesRemoteUrl: (remoteUrl: string) => boolean;
  /**
   * Parse a repository name-with-owner (or equivalent identifier) from a remote URL.
   * Returns null if the URL doesn't match this provider.
   */
  readonly parseRepositoryNameWithOwner: (remoteUrl: string) => string | null;
  /**
   * Whether this provider uses `owner:branch` head selectors for cross-repo PRs.
   * GitHub uses this; most other providers do not.
   */
  readonly usesOwnerHeadSelectors: boolean;
}

// ─── Provider registrations ─────────────────────────────────────────

const GITHUB_URL_REGEX =
  /^(?:git@github\.com:|ssh:\/\/git@github\.com\/|https:\/\/github\.com\/|git:\/\/github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/i;

const githubRegistration: GitHostingProviderRegistration = {
  kind: HOSTING_GITHUB,
  label: "GitHub",
  matchesRemoteUrl: (url) => {
    const lower = url.toLowerCase();
    return lower.includes("github.com");
  },
  parseRepositoryNameWithOwner: (url) => {
    const match = GITHUB_URL_REGEX.exec(url.trim());
    return match?.[1]?.trim() ?? null;
  },
  usesOwnerHeadSelectors: true,
};

const azureDevOpsRegistration: GitHostingProviderRegistration = {
  kind: HOSTING_AZURE_DEVOPS,
  label: "Azure DevOps",
  matchesRemoteUrl: (url) => {
    const lower = url.toLowerCase();
    return lower.includes("dev.azure.com") || lower.includes(".visualstudio.com");
  },
  parseRepositoryNameWithOwner: (url) => {
    const trimmed = url.trim();

    // https://dev.azure.com/{org}/{project}/_git/{repo}
    const httpsMatch =
      /^https?:\/\/(?:[^@]+@)?dev\.azure\.com\/[^/]+\/([^/]+)\/_git\/([^/\s]+?)(?:\.git)?\/?$/i.exec(
        trimmed,
      );
    if (httpsMatch) return `${httpsMatch[1]}/${httpsMatch[2]}`;

    // git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
    const sshMatch =
      /^git@ssh\.dev\.azure\.com:v3\/[^/]+\/([^/]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(trimmed);
    if (sshMatch) return `${sshMatch[1]}/${sshMatch[2]}`;

    // https://{org}.visualstudio.com/{project}/_git/{repo}
    const vstsMatch =
      /^https?:\/\/[^.]+\.visualstudio\.com\/([^/]+)\/_git\/([^/\s]+?)(?:\.git)?\/?$/i.exec(
        trimmed,
      );
    if (vstsMatch) return `${vstsMatch[1]}/${vstsMatch[2]}`;

    return null;
  },
  usesOwnerHeadSelectors: false,
};

// ─── Registry ───────────────────────────────────────────────────────

/**
 * Ordered list of provider registrations. First match wins.
 * Add new providers here to extend detection.
 */
const providerRegistrations: GitHostingProviderRegistration[] = [
  azureDevOpsRegistration,
  githubRegistration,
  // Future: gitlabRegistration, bitbucketRegistration, etc.
];

/**
 * Detect the hosting provider from a git remote URL.
 * Walks the registration list in order; returns "github" as the default fallback.
 */
export function detectHostingProvider(remoteUrl: string | null): GitHostingProviderKind {
  const trimmed = remoteUrl?.trim() ?? "";
  if (trimmed.length === 0) return HOSTING_GITHUB;

  for (const registration of providerRegistrations) {
    if (registration.matchesRemoteUrl(trimmed)) {
      return registration.kind;
    }
  }
  return HOSTING_GITHUB;
}

/**
 * Look up a provider registration by kind.
 */
export function getProviderRegistration(
  kind: GitHostingProviderKind,
): GitHostingProviderRegistration | null {
  return providerRegistrations.find((r) => r.kind === kind) ?? null;
}

/**
 * Parse repository name-with-owner from a remote URL, trying all registered providers.
 */
export function parseRepositoryNameWithOwnerFromRemoteUrl(url: string | null): string | null {
  const trimmed = url?.trim() ?? "";
  if (trimmed.length === 0) return null;

  for (const registration of providerRegistrations) {
    const result = registration.parseRepositoryNameWithOwner(trimmed);
    if (result) return result;
  }
  return null;
}

/**
 * Get all registered provider kinds.
 */
export function getRegisteredProviderKinds(): ReadonlyArray<GitHostingProviderKind> {
  return providerRegistrations.map((r) => r.kind);
}

// ─── Azure DevOps specifics (kept for use in AzureDevOpsCli layer) ──

export interface AzureDevOpsRepoInfo {
  readonly organization: string;
  readonly project: string;
  readonly repository: string;
}

export function parseAzureDevOpsRepoFromRemoteUrl(url: string | null): AzureDevOpsRepoInfo | null {
  const trimmed = url?.trim() ?? "";
  if (trimmed.length === 0) return null;

  const httpsMatch =
    /^https?:\/\/(?:[^@]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/\s]+?)(?:\.git)?\/?$/i.exec(
      trimmed,
    );
  if (httpsMatch) {
    return { organization: httpsMatch[1]!, project: httpsMatch[2]!, repository: httpsMatch[3]! };
  }

  const sshMatch =
    /^git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(trimmed);
  if (sshMatch) {
    return { organization: sshMatch[1]!, project: sshMatch[2]!, repository: sshMatch[3]! };
  }

  const vstsMatch =
    /^https?:\/\/([^.]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/\s]+?)(?:\.git)?\/?$/i.exec(
      trimmed,
    );
  if (vstsMatch) {
    return { organization: vstsMatch[1]!, project: vstsMatch[2]!, repository: vstsMatch[3]! };
  }

  return null;
}

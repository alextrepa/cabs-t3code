/**
 * Hosting provider detection utilities.
 *
 * Parses git remote URLs to determine the hosting platform (GitHub vs Azure DevOps).
 *
 * @module hosting
 */

export type GitHostingProvider = "github" | "azure-devops";

/**
 * Detect the hosting provider from a git remote URL.
 * Returns "azure-devops" for Azure DevOps URLs, "github" otherwise (default).
 */
export function detectHostingProvider(remoteUrl: string | null): GitHostingProvider {
  const trimmed = remoteUrl?.trim() ?? "";
  if (trimmed.length === 0) return "github";

  const lower = trimmed.toLowerCase();
  if (lower.includes("dev.azure.com") || lower.includes(".visualstudio.com")) {
    return "azure-devops";
  }
  return "github";
}

/**
 * Azure DevOps remote URL formats:
 *   - https://dev.azure.com/{org}/{project}/_git/{repo}
 *   - git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
 *   - https://{org}.visualstudio.com/{project}/_git/{repo}
 */
export interface AzureDevOpsRepoInfo {
  readonly organization: string;
  readonly project: string;
  readonly repository: string;
}

export function parseAzureDevOpsRepoFromRemoteUrl(url: string | null): AzureDevOpsRepoInfo | null {
  const trimmed = url?.trim() ?? "";
  if (trimmed.length === 0) return null;

  // https://dev.azure.com/{org}/{project}/_git/{repo}
  const httpsMatch =
    /^https?:\/\/(?:[^@]+@)?dev\.azure\.com\/([^/]+)\/([^/]+)\/_git\/([^/\s]+?)(?:\.git)?\/?$/i.exec(
      trimmed,
    );
  if (httpsMatch) {
    return {
      organization: httpsMatch[1]!,
      project: httpsMatch[2]!,
      repository: httpsMatch[3]!,
    };
  }

  // git@ssh.dev.azure.com:v3/{org}/{project}/{repo}
  const sshMatch = /^git@ssh\.dev\.azure\.com:v3\/([^/]+)\/([^/]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(
    trimmed,
  );
  if (sshMatch) {
    return {
      organization: sshMatch[1]!,
      project: sshMatch[2]!,
      repository: sshMatch[3]!,
    };
  }

  // https://{org}.visualstudio.com/{project}/_git/{repo}
  const vstsMatch =
    /^https?:\/\/([^.]+)\.visualstudio\.com\/([^/]+)\/_git\/([^/\s]+?)(?:\.git)?\/?$/i.exec(
      trimmed,
    );
  if (vstsMatch) {
    return {
      organization: vstsMatch[1]!,
      project: vstsMatch[2]!,
      repository: vstsMatch[3]!,
    };
  }

  return null;
}

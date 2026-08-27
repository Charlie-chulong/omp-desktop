import {
  isCompleteGitRemote,
  parseGitHubRemoteUrl,
  parseGitRemoteLocation,
} from "@omp-desktop/protocol/git-remote";
import type { TFunction } from "i18next";
import { shortenPath } from "@/utils/shorten-path";
import type { AddProjectHost, GithubRepositoryChoice } from "./model";

export type AddProjectMethodId = "directory-search" | "browse" | "github" | "new-directory";

export interface AddProjectMethodOption {
  id: AddProjectMethodId;
  label: string;
  description: string;
  disabled?: boolean;
}

export interface AddProjectPathOption {
  id: string;
  path: string;
  displayPath: string;
  secondaryText: string | null;
  disabled: boolean;
}

export function filterAddProjectHosts(hosts: AddProjectHost[], query: string): AddProjectHost[] {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return hosts;
  return hosts.filter(
    (host) =>
      host.label.toLowerCase().includes(normalized) ||
      host.serverId.toLowerCase().includes(normalized),
  );
}

export function buildAddProjectMethods(
  host: AddProjectHost,
  t: TFunction,
): AddProjectMethodOption[] {
  if (!host.canAddProject) return [];
  const options: AddProjectMethodOption[] = [];
  options.push({
    id: "directory-search",
    label: t("addProjectFlow.methods.directorySearch.label"),
    description: t("addProjectFlow.methods.directorySearch.description", { host: host.label }),
  });
  if (host.canBrowse) {
    options.push({
      id: "browse",
      label: t("addProjectFlow.methods.browse.label"),
      description: t("addProjectFlow.methods.browse.description"),
    });
  }
  options.push({
    id: "github",
    label: t("addProjectFlow.methods.github.label"),
    description: githubMethodDescription(host, t),
    disabled: !host.canCloneGithubRepositories,
  });
  options.push({
    id: "new-directory",
    label: t("addProjectFlow.methods.newDirectory.label"),
    description: host.canCreateDirectory
      ? t("addProjectFlow.methods.newDirectory.description", { host: host.label })
      : t("addProjectFlow.methods.newDirectory.unavailableDescription"),
    disabled: !host.canCreateDirectory,
  });
  return options;
}

export function addProjectMethodEmptyText(
  host: AddProjectHost | null,
  t: TFunction,
): string {
  return host?.canAddProject === false
    ? t("addProjectFlow.updateHost")
    : t("addProjectFlow.noMatchingOptions");
}

function githubMethodDescription(host: AddProjectHost, t: TFunction): string {
  if (!host.canCloneGithubRepositories) {
    return t("addProjectFlow.methods.github.unavailableDescription");
  }
  if (host.canSearchGithubRepositories) {
    return t("addProjectFlow.methods.github.searchDescription");
  }
  return t("addProjectFlow.methods.github.manualDescription");
}

export function pathBaseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const parts = trimmed.split(/[\\/]/);
  return parts[parts.length - 1] ?? trimmed;
}

export function buildManualGithubRepositoryChoices(query: string): GithubRepositoryChoice[] {
  const repo = query.trim();
  if (!repo) return [];

  if (isCompleteGitRemote(repo)) {
    const identity = parseGitHubRemoteUrl(repo);
    const location = parseGitRemoteLocation(repo);
    const remoteName = location ? pathBaseName(location.path).replace(/\.git$/u, "") : repo;
    return [
      {
        id: `manual:${repo}`,
        nameWithOwner: identity?.repo ?? remoteName,
        cloneUrl: repo,
        description: "Clone this repository URL",
        updatedAt: null,
      },
    ];
  }

  const shorthand = repo.match(/^([^\s/]+)\/([^\s/]+)$/u);
  if (!shorthand) return [];
  const nameWithOwner = `${shorthand[1]}/${shorthand[2]}`;
  return (["https", "ssh"] as const).map((cloneProtocol) => ({
    id: `manual:${cloneProtocol}:${nameWithOwner}`,
    nameWithOwner,
    cloneUrl: nameWithOwner,
    cloneProtocol,
    description: `Clone owner/repo via ${cloneProtocol.toUpperCase()}`,
    updatedAt: null,
  }));
}

export function parentDirectory(path: string): string | null {
  const trimmed = path.replace(/[\\/]+$/, "");
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (index < 0) return null;
  if (index === 0) return trimmed.slice(0, 1);
  return trimmed.slice(0, index);
}

export function joinDirectoryPath(parent: string, name: string): string {
  const trimmedParent = parent.replace(/[\\/]+$/, "");
  const separator = trimmedParent.includes("\\") && !trimmedParent.includes("/") ? "\\" : "/";
  return `${trimmedParent}${separator}${name}`;
}

export function buildSuggestedParentDirectories(projectPaths: string[]): string[] {
  const values = [
    ...projectPaths.flatMap((path) => {
      const parent = parentDirectory(path);
      return parent ? [parent] : [];
    }),
    "~/dev",
    "~/Developer",
    "~/src",
    "~/projects",
    "~/workspace",
    "~",
  ];
  return [...new Set(values)];
}

export function buildCloneLocationOptions(input: {
  parents: string[];
  repositoryName: string;
  existingPaths: string[];
}): AddProjectPathOption[] {
  const existing = new Set(input.existingPaths.map(pathIdentity));
  const seen = new Set<string>();
  return input.parents.flatMap((parent) => {
    const path = joinDirectoryPath(parent, input.repositoryName);
    const identity = pathIdentity(path);
    if (seen.has(identity)) return [];
    seen.add(identity);
    const pathExists = existing.has(identity);
    return [
      {
        id: parent,
        path: parent,
        displayPath: path,
        secondaryText: pathExists ? "Already exists" : `Parent directory: ${parent}`,
        disabled: pathExists,
      },
    ];
  });
}

function pathIdentity(path: string): string {
  const normalized = shortenPath(path.trim()).replace(/\\/g, "/").replace(/\/+$/u, "");
  return /^[A-Za-z]:\//u.test(normalized) || normalized.startsWith("//")
    ? normalized.toLowerCase()
    : normalized;
}

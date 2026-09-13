import { existsSync, promises as fs } from "node:fs";
import { dirname, join } from "node:path";
import type { OmpSubagentSettings } from "@omp-desktop/protocol/messages";
import { isMap, parseDocument, type Document } from "yaml";

import { writeFileAtomic } from "../../../atomic-file.js";
import { resolveOmpDiagnosticPaths } from "./provider-config.js";

const BUNDLED_SUBAGENTS = [
  { name: "scout", description: "Read-only codebase research and analysis." },
  { name: "task", description: "General-purpose implementation work." },
  { name: "sonic", description: "Lightweight mechanical updates." },
  { name: "reviewer", description: "Correctness and quality review." },
  { name: "security-reviewer", description: "Security-focused review." },
] as const;

function resolveConfigPath(env: NodeJS.ProcessEnv): string {
  const agentDir = resolveOmpDiagnosticPaths(env).agentDir;
  const ymlPath = join(agentDir, "config.yml");
  if (existsSync(ymlPath)) return ymlPath;
  const yamlPath = join(agentDir, "config.yaml");
  return existsSync(yamlPath) ? yamlPath : ymlPath;
}

function parseConfig(raw: string): Document.Parsed {
  const document = parseDocument(raw.trim() ? raw : "{}\n");
  if (document.errors.length > 0) {
    throw new Error(`Invalid OMP config: ${document.errors[0]?.message ?? "YAML parse failed"}`);
  }
  return document;
}

function readModelOverrides(document: Document.Parsed): Record<string, string> {
  const root = document.toJS() as unknown;
  if (root == null) return {};
  if (typeof root !== "object" || Array.isArray(root)) {
    throw new Error("Invalid OMP config: root must be a mapping");
  }
  const task = (root as Record<string, unknown>).task;
  if (task == null) return {};
  if (typeof task !== "object" || Array.isArray(task)) {
    throw new Error("Invalid OMP config: task must be a mapping");
  }
  const value = (task as Record<string, unknown>).agentModelOverrides;
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Invalid OMP config: task.agentModelOverrides must be a mapping");
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([name, model]) =>
      typeof model === "string" && model.trim() ? [[name, model.trim()]] : [],
    ),
  );
}

function toSettings(configPath: string, document: Document.Parsed): OmpSubagentSettings {
  const overrides = readModelOverrides(document);
  return {
    configPath,
    enabled: isMap(document.getIn(["task", "agentModelOverrides"], true)),
    agents: BUNDLED_SUBAGENTS.map((agent) => ({
      ...agent,
      ...(overrides[agent.name] ? { model: overrides[agent.name] } : {}),
    })),
  };
}

export async function readOmpSubagentSettings(
  env: NodeJS.ProcessEnv = process.env,
): Promise<OmpSubagentSettings> {
  const configPath = resolveConfigPath(env);
  const raw = await fs
    .readFile(configPath, "utf8")
    .catch((error: NodeJS.ErrnoException) =>
      error.code === "ENOENT" ? "{}\n" : Promise.reject(error),
    );
  return toSettings(configPath, parseConfig(raw));
}

function assertEditableMappings(document: Document.Parsed): void {
  if (document.contents != null && !isMap(document.contents)) {
    throw new Error("Invalid OMP config: root must be a mapping");
  }
  const task = document.getIn(["task"], true);
  if (task != null && !isMap(task)) {
    throw new Error("Invalid OMP config: task must be a mapping");
  }
  const overrides = document.getIn(["task", "agentModelOverrides"], true);
  if (overrides != null && !isMap(overrides)) {
    throw new Error("Invalid OMP config: task.agentModelOverrides must be a mapping");
  }
}

function removeEmptyTaskMapping(document: Document.Parsed): void {
  const task = document.getIn(["task"], true);
  if (isMap(task) && task.items.length === 0) {
    document.deleteIn(["task"]);
  }
}

export async function updateOmpSubagentModel(
  agentName: string,
  model: string | null,
  env: NodeJS.ProcessEnv = process.env,
): Promise<OmpSubagentSettings> {
  if (!BUNDLED_SUBAGENTS.some((agent) => agent.name === agentName)) {
    throw new Error(`Unknown bundled OMP subagent: ${agentName}`);
  }
  const normalizedModel = model?.trim() || null;
  const configPath = resolveConfigPath(env);
  const raw = await fs
    .readFile(configPath, "utf8")
    .catch((error: NodeJS.ErrnoException) =>
      error.code === "ENOENT" ? "{}\n" : Promise.reject(error),
    );
  const document = parseConfig(raw);
  assertEditableMappings(document);
  if (!isMap(document.getIn(["task", "agentModelOverrides"], true))) {
    throw new Error("Enable OMP subagent model overrides before changing a model");
  }

  if (normalizedModel) {
    document.setIn(["task", "agentModelOverrides", agentName], normalizedModel);
  } else {
    document.deleteIn(["task", "agentModelOverrides", agentName]);
  }

  await fs.mkdir(dirname(configPath), { recursive: true });
  await writeFileAtomic(configPath, document.toString());
  return toSettings(configPath, document);
}

export async function updateOmpSubagentSettingsEnabled(
  enabled: boolean,
  env: NodeJS.ProcessEnv = process.env,
): Promise<OmpSubagentSettings> {
  const configPath = resolveConfigPath(env);
  const raw = await fs
    .readFile(configPath, "utf8")
    .catch((error: NodeJS.ErrnoException) =>
      error.code === "ENOENT" ? "{}\n" : Promise.reject(error),
    );
  const document = parseConfig(raw);
  assertEditableMappings(document);

  if (enabled) {
    if (!isMap(document.getIn(["task", "agentModelOverrides"], true))) {
      document.setIn(["task", "agentModelOverrides"], document.createNode({}));
    }
  } else {
    document.deleteIn(["task", "agentModelOverrides"]);
    removeEmptyTaskMapping(document);
  }

  await fs.mkdir(dirname(configPath), { recursive: true });
  await writeFileAtomic(configPath, document.toString());
  return toSettings(configPath, document);
}

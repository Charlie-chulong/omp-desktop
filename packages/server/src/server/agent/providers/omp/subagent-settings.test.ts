import { afterEach, describe, expect, test } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  readOmpSubagentSettings,
  updateOmpSubagentModel,
  updateOmpSubagentSettingsEnabled,
} from "./subagent-settings.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function createAgentDir(): Promise<{ agentDir: string; env: NodeJS.ProcessEnv }> {
  const agentDir = await mkdtemp(join(tmpdir(), "omp-subagent-settings-"));
  tempDirs.push(agentDir);
  return { agentDir, env: { PI_CODING_AGENT_DIR: agentDir } };
}

describe("OMP subagent settings", () => {
  test("lists bundled agents as inherited when config is absent", async () => {
    const { agentDir, env } = await createAgentDir();

    await expect(readOmpSubagentSettings(env)).resolves.toMatchObject({
      configPath: join(agentDir, "config.yml"),
      enabled: false,
      agents: [
        { name: "scout" },
        { name: "task" },
        { name: "sonic" },
        { name: "reviewer" },
        { name: "security-reviewer" },
      ],
    });
  });

  test("updates one model override without replacing unrelated config", async () => {
    const { agentDir, env } = await createAgentDir();
    const configPath = join(agentDir, "config.yml");
    await writeFile(
      configPath,
      "# Keep this comment\nmodelRoles:\n  review: openai/gpt-5.6-sol:high\ntask:\n  maxRecursionDepth: 3\n  agentModelOverrides:\n    scout: openai/gpt-5-mini\n",
      "utf8",
    );

    const settings = await updateOmpSubagentModel("reviewer", "@review", env);

    expect(settings.agents.find((agent) => agent.name === "reviewer")?.model).toBe("@review");
    const written = await readFile(configPath, "utf8");
    expect(written).toContain("# Keep this comment");
    expect(written).toContain("maxRecursionDepth: 3");
    expect(written).toContain("scout: openai/gpt-5-mini");
    expect(written).toContain('reviewer: "@review"');
  });

  test("removes an override to restore inheritance", async () => {
    const { agentDir, env } = await createAgentDir();
    const configPath = join(agentDir, "config.yml");
    await writeFile(
      configPath,
      "task:\n  maxRecursionDepth: 3\n  agentModelOverrides:\n    reviewer: openai/gpt-5.6-sol:high\n",
      "utf8",
    );

    const settings = await updateOmpSubagentModel("reviewer", null, env);

    expect(settings.agents.find((agent) => agent.name === "reviewer")?.model).toBeUndefined();
    const written = await readFile(configPath, "utf8");
    expect(written).toContain("maxRecursionDepth: 3");
    expect(written).toContain("agentModelOverrides: {}");
  });

  test("toggles the agentModelOverrides mapping without changing other task settings", async () => {
    const { agentDir, env } = await createAgentDir();
    const configPath = join(agentDir, "config.yml");
    await writeFile(configPath, "task:\n  maxRecursionDepth: 3\n", "utf8");

    await expect(updateOmpSubagentSettingsEnabled(true, env)).resolves.toMatchObject({
      enabled: true,
    });
    await expect(readFile(configPath, "utf8")).resolves.toContain("agentModelOverrides: {}");

    await expect(updateOmpSubagentSettingsEnabled(false, env)).resolves.toMatchObject({
      enabled: false,
    });
    const written = await readFile(configPath, "utf8");
    expect(written).toContain("maxRecursionDepth: 3");
    expect(written).not.toContain("agentModelOverrides");
  });

  test("rejects model changes while overrides are disabled", async () => {
    const { env } = await createAgentDir();

    await expect(updateOmpSubagentModel("task", "openai/gpt-5-mini", env)).rejects.toThrow(
      "Enable OMP subagent model overrides",
    );
  });

  test("rejects unknown agents and malformed task settings", async () => {
    const { agentDir, env } = await createAgentDir();
    await expect(updateOmpSubagentModel("unknown", "openai/gpt-5-mini", env)).rejects.toThrow(
      "Unknown bundled OMP subagent",
    );
    await writeFile(join(agentDir, "config.yml"), "task: disabled\n", "utf8");
    await expect(updateOmpSubagentModel("task", "openai/gpt-5-mini", env)).rejects.toThrow(
      "task must be a mapping",
    );
  });
});

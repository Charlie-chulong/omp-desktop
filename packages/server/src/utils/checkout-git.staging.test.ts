import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { commitChanges, getCheckoutDiff, stageChanges, unstageChanges } from "./checkout-git.js";

describe("checkout git staging", () => {
  let tempDir: string;
  let repoDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "checkout-git-staging-"));
    repoDir = join(tempDir, "repo");
    mkdirSync(repoDir);
    execFileSync("git", ["init", "-b", "main"], { cwd: repoDir });
    execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: repoDir });
    writeFileSync(join(repoDir, "staged.txt"), "before staged\n");
    writeFileSync(join(repoDir, "unstaged.txt"), "before unstaged\n");
    execFileSync("git", ["add", "-A"], { cwd: repoDir });
    execFileSync("git", ["-c", "commit.gpgsign=false", "commit", "-m", "initial"], {
      cwd: repoDir,
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("separates staged changes and commits only the index", async () => {
    writeFileSync(join(repoDir, "staged.txt"), "after staged\n");
    writeFileSync(join(repoDir, "unstaged.txt"), "after unstaged\n");

    await stageChanges(repoDir, ["staged.txt"]);

    const staged = await getCheckoutDiff(repoDir, { mode: "staged", includeStructured: true });
    const unstaged = await getCheckoutDiff(repoDir, { mode: "unstaged", includeStructured: true });
    expect(staged.structured?.map((file) => file.path)).toEqual(["staged.txt"]);
    expect(unstaged.structured?.map((file) => file.path)).toEqual(["unstaged.txt"]);

    await commitChanges(repoDir, { message: "commit staged only" });

    expect(execFileSync("git", ["show", "HEAD:staged.txt"], { cwd: repoDir }).toString()).toBe(
      "after staged\n",
    );
    expect(execFileSync("git", ["show", "HEAD:unstaged.txt"], { cwd: repoDir }).toString()).toBe(
      "before unstaged\n",
    );
    expect(execFileSync("git", ["status", "--short"], { cwd: repoDir }).toString()).toContain(
      " M unstaged.txt",
    );
  });

  it("moves a staged path back to unstaged changes", async () => {
    writeFileSync(join(repoDir, "staged.txt"), "after staged\n");
    await stageChanges(repoDir, ["staged.txt"]);
    await unstageChanges(repoDir, ["staged.txt"]);

    const staged = await getCheckoutDiff(repoDir, { mode: "staged", includeStructured: true });
    const unstaged = await getCheckoutDiff(repoDir, { mode: "unstaged", includeStructured: true });
    expect(staged.structured).toEqual([]);
    expect(unstaged.structured?.map((file) => file.path)).toEqual(["staged.txt"]);
  });
});

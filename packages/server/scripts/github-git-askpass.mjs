#!/usr/bin/env node

import { AsyncEntry } from "@napi-rs/keyring";

const SERVICE = "omp-desktop.github";
const host = (process.env.PASEO_GITHUB_HOST ?? "").trim().toLowerCase();
const prompt = (process.argv[2] ?? "").trim().toLowerCase();

if (!host || !prompt.includes(host)) {
  process.exitCode = 1;
} else {
  try {
    const value = await new AsyncEntry(SERVICE, host).getPassword();
    const credential = value ? JSON.parse(value) : null;
    if (!credential || credential.version !== 1 || credential.host !== host) {
      process.exitCode = 1;
    } else {
      const answer = prompt.includes("username")
        ? credential.login || "x-access-token"
        : credential.token;
      if (typeof answer !== "string" || !answer) process.exitCode = 1;
      else process.stdout.write(answer);
    }
  } catch {
    process.exitCode = 1;
  }
}

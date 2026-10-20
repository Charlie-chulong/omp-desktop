import { readFileSync } from "node:fs";
import path from "node:path";

const packageInfo: { ompDesktopDistribution?: string } = JSON.parse(
  readFileSync(path.join(__dirname, "..", "package.json"), "utf8"),
);

export const PRIVATE_PLUGIN_DISTRIBUTION =
  packageInfo.ompDesktopDistribution === "private-three-plugins";

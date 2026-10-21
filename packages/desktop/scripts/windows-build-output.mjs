import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

export function windowsBuildOutput(version, args) {
  const withPlugins = args.includes("--with-bundled-plugins");
  const channel = version.includes("-") ? version.split("-")[1].split(".")[0] : "latest";
  return {
    releaseDirectory: `packages/desktop/${withPlugins ? "release-plugins" : "release"}`,
    metadataFilename: `${channel}.yml`,
    legacyInstaller: `OMP-Desktop${withPlugins ? "-Plugins" : ""}-Setup-${version}.exe`,
  };
}

if (
  process.argv[1] &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
) {
  const [version, ...args] = process.argv.slice(2);
  const output = windowsBuildOutput(version, args);
  console.log(
    [output.releaseDirectory, output.metadataFilename, output.legacyInstaller].join("\t"),
  );
}

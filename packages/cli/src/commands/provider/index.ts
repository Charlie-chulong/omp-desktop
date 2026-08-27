import { Command } from "commander";
import { runLsCommand } from "./ls.js";
import { runModelsCommand } from "./models.js";
import { runDiagnosticCommand } from "./diagnostic.js";
import { withOutput } from "../../output/index.js";
import { addJsonAndDaemonHostOptions } from "../../utils/command-options.js";

export function createProviderCommand(): Command {
  const provider = new Command("provider").description("Inspect the OMP runtime");

  addJsonAndDaemonHostOptions(
    provider.command("ls").description("List available providers and status"),
  ).action(withOutput(runLsCommand));

  addJsonAndDaemonHostOptions(
    provider
      .command("models")
      .description("List OMP models")
      .argument("<provider>", "Provider name (omp)")
      .option("--thinking", "Include thinking option IDs for each model"),
  ).action(withOutput(runModelsCommand));

  addJsonAndDaemonHostOptions(
    provider
      .command("diagnostic")
      .description("Show OMP installation, environment, and availability diagnostics")
      .argument("<provider>", "Provider name (omp)"),
  ).action(withOutput(runDiagnosticCommand));

  return provider;
}

const fs = require("node:fs");
const path = require("node:path");

const SAFE_COMMANDS = new Set([
  "/chatpro status",
  "/workbuddy status",
  "/workbuddy start",
  "/workbuddy stop",
  "/wechat status",
  "/wechat disconnect",
]);

// This is a filesystem trust boundary shared by reinstall and conversation creation.
function resolveOwnedPath(ownedRoot, requested, errorMessage) {
  const resolved = fs.realpathSync(requested);
  const relative = path.relative(ownedRoot, resolved);
  if (
    !relative ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(errorMessage);
  }
  return resolved;
}

// Test controller only: the returned records come from the genuine packaged
// client/daemon/native plugin path. No model tool or plugin bridge is replaced.
function createPluginOperations(ownedRoot) {
  const canonicalRoot = fs.realpathSync(ownedRoot);
  const ownedAgents = new Set();
  return async (client, request) => {
    if (request.operation === "list") return client.listOmpPlugins();
    if (request.operation === "remove") {
      if (
        !["omp-bridge-chatpro", "omp-workbuddy-plugin", "omp-wechat-connector"].includes(
          request.name,
        )
      ) {
        throw new Error("Only the isolated bundled plugins may be removed");
      }
      return client.removeOmpPlugin(request.name, "user");
    }
    if (request.operation === "install") {
      const source = resolveOwnedPath(
        canonicalRoot,
        request.source,
        "Explicit plugin reinstall must stay inside the disposable sandbox",
      );
      return client.installOmpPlugin({ spec: source, scope: "user" });
    }
    if (request.operation === "create") {
      const cwd = resolveOwnedPath(
        canonicalRoot,
        request.cwd,
        "Plugin smoke conversations must stay inside the disposable sandbox",
      );
      const opened = await client.openProject(cwd);
      if (!opened.workspace) throw new Error(opened.error || "Owned plugin project did not open");
      const agent = await client.createAgent({
        provider: "omp",
        cwd,
        workspaceId: opened.workspace.id,
        title: "三插件无账号隔离验收",
        modeId: "ask",
      });
      ownedAgents.add(agent.id);
      const commands = await client.listCommands(agent.id);
      return { agent, commands };
    }
    if (!ownedAgents.has(request.agentId)) throw new Error("Plugin smoke does not own this agent");
    if (request.operation === "command") {
      if (!SAFE_COMMANDS.has(request.text)) {
        throw new Error("Only the exact no-account status/local-lifecycle commands are allowed");
      }
      await client.sendAgentMessage(request.agentId, request.text);
      return { accepted: true };
    }
    if (request.operation === "timeline") {
      return client.fetchAgentTimeline(request.agentId, { projection: "canonical", limit: 100 });
    }
    if (request.operation === "close") {
      await client.deleteAgent(request.agentId);
      ownedAgents.delete(request.agentId);
      return { closed: true };
    }
    throw new Error(`Unsupported native plugin operation: ${request.operation}`);
  };
}

module.exports = { createPluginOperations };

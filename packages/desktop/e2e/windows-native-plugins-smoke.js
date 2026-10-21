const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const EXPECTED_PLUGINS = [
  { name: "omp-bridge-chatpro", version: "0.1.0" },
  { name: "omp-workbuddy-plugin", version: "0.1.0" },
  { name: "omp-wechat-connector", version: "0.1.2" },
];

async function smokeBundledPlugins({
  command,
  page,
  stagedApp,
  profile,
  serverId,
  evidence,
  report,
  until,
  navigateChinese,
}) {
  const metadata = JSON.parse(
    fs.readFileSync(path.join(stagedApp, "resources/app/package.json"), "utf8"),
  );
  if (metadata.ompDesktopDistribution !== "private-three-plugins") return;
  const manifest = JSON.parse(
    fs.readFileSync(path.join(stagedApp, "resources/bundled-omp-plugins/manifest.json"), "utf8"),
  );
  assert.deepEqual(
    manifest.plugins.map(({ name, version }) => ({ name, version })),
    EXPECTED_PLUGINS,
  );
  const rpc = (operation, extra = {}) => command({ action: "plugins", operation, ...extra });
  const initial = await rpc("list");
  const snapshots = {};
  for (const expected of EXPECTED_PLUGINS) {
    const plugin = initial.plugins.find((entry) => entry.name === expected.name);
    assert.ok(
      plugin,
      `The real native registry must contain ${expected.name}; tolerated seed failure is not acceptance`,
    );
    assert.equal(plugin.version, expected.version);
    assert.equal(plugin.enabled, true);
    const real = fs.realpathSync(plugin.path);
    const relative = path.relative(profile, real);
    assert.ok(
      relative &&
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative),
    );
    assert.ok(
      real.split(path.sep).includes("desktop-bundled-plugins"),
      "Preinstall must reference an owned stable snapshot, not a development directory",
    );
    snapshots[plugin.name] = real;
  }
  const route = `/settings/hosts/${encodeURIComponent(serverId)}/omp-plugins`;
  await navigateChinese(page, route);
  const inspect = () =>
    page.evaluate(() => ({
      body: document.querySelector('[data-testid="omp-plugins-list-card"]')?.textContent || "",
      error: document.querySelector('[data-testid="omp-plugins-error"]')?.textContent || null,
      toggles: Array.from(document.querySelectorAll('[data-testid^="omp-plugins-toggle-"]')).map(
        (element) => ({
          id: element.getAttribute("data-testid"),
          checked: element.getAttribute("aria-checked"),
          disabled: element.getAttribute("aria-disabled") === "true",
        }),
      ),
    }));
  let rendered;
  await until(
    "all three actual preinstalled plugins in the existing Chinese settings page",
    async () => {
      rendered = await inspect();
      return (
        !rendered.error &&
        EXPECTED_PLUGINS.every(
          ({ name }) =>
            rendered.body.includes(name) &&
            rendered.toggles.some(
              (toggle) => toggle.id.includes(name) && toggle.checked === "true" && !toggle.disabled,
            ),
        )
      );
    },
  );
  await page.snapshot("bundled-plugins-renderer.png");
  const workbuddyToggle = rendered.toggles.find((toggle) =>
    toggle.id.includes("omp-workbuddy-plugin"),
  ).id;
  const clickToggle = () =>
    page.evaluate((id) => {
      const element = document.querySelector(`[data-testid="${id}"]`);
      if (!(element instanceof HTMLElement) || element.getAttribute("aria-disabled") === "true")
        throw new Error("Real plugin toggle is unavailable");
      element.scrollIntoView({ block: "center" });
      element.click();
      return true;
    }, workbuddyToggle);
  await clickToggle();
  // Management RPCs are serialized and each private launch verifies its payload.
  // Poll the real DOM without enqueueing extra CLI work behind the action being
  // observed; only after its refresh settles perform an independent readback.
  await until(
    "real plugin-page disable and completed refresh",
    async () => {
      const view = await inspect();
      assert.equal(view.error, null);
      return view.toggles.some(
        (toggle) => toggle.id === workbuddyToggle && toggle.checked === "false" && !toggle.disabled,
      );
    },
    90_000,
  );
  await page.snapshot("bundled-plugins-disabled-renderer.png");
  const disabledState = await rpc("list");
  assert.equal(
    disabledState.plugins.find((plugin) => plugin.name === "omp-workbuddy-plugin")?.enabled,
    false,
  );
  await clickToggle();
  await until(
    "real plugin-page enable and completed refresh",
    async () => {
      const view = await inspect();
      assert.equal(view.error, null);
      return view.toggles.some(
        (toggle) => toggle.id === workbuddyToggle && toggle.checked === "true" && !toggle.disabled,
      );
    },
    90_000,
  );
  await page.snapshot("bundled-plugins-enabled-renderer.png");
  const enabledState = await rpc("list");
  assert.equal(
    enabledState.plugins.find((plugin) => plugin.name === "omp-workbuddy-plugin")?.enabled,
    true,
  );
  report.bundledPlugins = {
    manifestHost: manifest.host,
    initial,
    snapshots,
    route,
    rendered,
    nativeToggleRoundTrip: true,
    disabledState,
    enabledState,
  };
  report.checks.push(
    "mandatory three genuine preinstalled native plugins and versions in owned profile snapshots; existing Chinese plugin page and real native disable/enable round trip",
  );

  const project = path.join(profile, "plugin-acceptance-project");
  fs.mkdirSync(project, { recursive: true });
  const agents = new Set();
  try {
    const created = await rpc("create", { cwd: project });
    const agentId = created.agent.id;
    agents.add(agentId);
    assert.equal(created.commands.error, null);
    const names = created.commands.commands.map((entry) => entry.name.replace(/^\//, ""));
    for (const name of ["chatpro", "workbuddy", "wechat"])
      assert.ok(names.includes(name), `Native command ${name} must be actually registered`);
    const replies = [];
    report.bundledPluginCommands = {
      agentId,
      names,
      replies,
      stage: "running-native-commands",
    };
    async function send(text, customType) {
      const before = await rpc("timeline", { agentId });
      const seen = new Set(before.entries.map((entry) => entry.item.messageId).filter(Boolean));
      await rpc("command", { agentId, text });
      let reply;
      await until(
        `native original custom reply for ${text}`,
        async () => {
          const timeline = await rpc("timeline", { agentId });
          reply = timeline.entries.find(
            (entry) =>
              entry.item.type === "assistant_message" &&
              entry.item.customMessage?.customType === customType &&
              typeof entry.item.messageId === "string" &&
              !seen.has(entry.item.messageId),
          );
          return reply;
        },
        90_000,
      );
      assert.notEqual(reply.item.customMessage.details?.event, "error", reply.item.text);
      const value = JSON.parse(reply.item.text);
      replies.push({
        command: text,
        messageId: reply.item.messageId,
        customMessage: reply.item.customMessage,
        text: reply.item.text,
      });
      return value;
    }
    const chatpro = await send("/chatpro status", "omp-bridge-chatpro");
    assert.deepEqual(
      chatpro.requests,
      [],
      "Fresh no-account consultation store must not invent a completed Pro result",
    );
    const beforeStart = await send("/workbuddy status", "omp-workbuddy-plugin");
    assert.equal(beforeStart.state, "stopped");
    assert.equal(beforeStart.automaticStartup, false);
    assert.equal(beforeStart.upstreamEnabled, false);
    const started = await send("/workbuddy start", "omp-workbuddy-plugin");
    assert.equal(started.service, "omp-workbuddy-plugin");
    assert.equal(started.upstreamEnabled, false);
    assert.ok(Number.isSafeInteger(started.pid) && started.pid > 0);
    assert.ok(Object.values(started.controls).every((enabled) => enabled === false));
    const running = await send("/workbuddy status", "omp-workbuddy-plugin");
    assert.equal(running.state, "ready");
    assert.equal(running.pid, started.pid);
    const stopped = await send("/workbuddy stop", "omp-workbuddy-plugin");
    assert.equal(stopped.state, "exited");
    const wechat = await send("/wechat status", "omp-wechat-status");
    assert.equal(wechat.state, "disconnected");
    assert.deepEqual(wechat.scope.conversations, []);
    assert.equal(wechat.cleanup_pending, false);
    const timeline = await rpc("timeline", { agentId });
    const custom = timeline.entries.filter((entry) => entry.item.type === "assistant_message");
    assert.equal(
      custom.length,
      replies.length,
      "Only genuine plugin originals, without ordinary-model rewrites or duplicate history, may appear",
    );
    assert.ok(
      custom.every((entry) =>
        ["omp-bridge-chatpro", "omp-workbuddy-plugin", "omp-wechat-status"].includes(
          entry.item.customMessage?.customType,
        ),
      ),
    );
    assert.equal(
      timeline.entries.some((entry) =>
        ["tool_call", "tool_result", "reasoning"].includes(entry.item.type),
      ),
      false,
    );
    const conversationRoute = `/h/${encodeURIComponent(serverId)}/agent/${encodeURIComponent(agentId)}`;
    report.bundledPluginCommands.conversationRoute = conversationRoute;
    report.bundledPluginCommands.stage = "validating-production-renderer";
    await navigateChinese(page, conversationRoute);
    await until(
      "native plugin original texts on the production conversation renderer",
      async () => {
        const body = await page.evaluate(() => document.body.textContent.replace(/\s+/g, ""));
        return replies.every((reply) => body.includes(reply.text.replace(/\s+/g, "")));
      },
    );
    await page.snapshot("bundled-plugin-commands-renderer.png");
    await rpc("close", { agentId });
    agents.delete(agentId);

    await navigateChinese(page, route);
    let chatproToggle;
    await until("ChatPro row ready for its real remove action", async () => {
      const view = await inspect();
      assert.equal(view.error, null);
      chatproToggle = view.toggles.find(
        (toggle) =>
          toggle.id.includes("omp-bridge-chatpro") && toggle.checked === "true" && !toggle.disabled,
      )?.id;
      return Boolean(chatproToggle);
    });
    const chatproRemove = chatproToggle.replace("omp-plugins-toggle-", "omp-plugins-remove-");
    const inspectRemoveGeometry = (shouldScroll = false) =>
      page.evaluate(
        async ({ toggleId, removeId, scroll }) => {
          const remove = document.querySelector(`[data-testid="${removeId}"]`);
          const toggle = document.querySelector(`[data-testid="${toggleId}"]`);
          if (!(remove instanceof HTMLElement) || !(toggle instanceof HTMLElement))
            throw new Error("The real ChatPro row actions must both exist");
          if (scroll) {
            remove.scrollIntoView({ block: "center", inline: "nearest" });
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            );
          }
          const rect = (element) => {
            const { x, y, width, height } = element.getBoundingClientRect();
            return { x, y, width, height };
          };
          const actions = remove.parentElement;
          const row = actions?.parentElement;
          if (!actions || !row || toggle.parentElement !== actions)
            throw new Error("The real row actions must share their existing action container");
          const actionsRect = rect(actions);
          const rowRect = rect(row);
          const actionRect = (element) => {
            const box = rect(element);
            return {
              ...box,
              relativeToActions: { x: box.x - actionsRect.x, y: box.y - actionsRect.y },
              relativeToRow: { x: box.x - rowRect.x, y: box.y - rowRect.y },
            };
          };
          const removeRect = actionRect(remove);
          const neighborRect = actionRect(toggle);
          const dialog = document.querySelector('[data-testid="confirm-dialog"]');
          const confirm = dialog?.querySelector('[data-testid="confirm-dialog-confirm"]');
          return {
            remove: removeRect,
            neighbor: neighborRect,
            actions: actionsRect,
            row: rowRect,
            actionGap: removeRect.x - neighborRect.x - neighborRect.width,
            removeLabel: remove.textContent,
            busy: remove.getAttribute("aria-busy"),
            disabled: remove.getAttribute("aria-disabled") === "true",
            neighborDisabled: toggle.getAttribute("aria-disabled") === "true",
            confirmation:
              dialog && confirm ? { text: dialog.textContent, confirm: rect(confirm) } : null,
          };
        },
        { toggleId: chatproToggle, removeId: chatproRemove, scroll: shouldScroll },
      );
    const removeButtonGeometry = {
      before: await inspectRemoveGeometry(true),
      screenshots: {
        before: "bundled-plugins-remove-before.png",
        loading: "bundled-plugins-remove-loading.png",
        restored: "bundled-plugins-remove-restored.png",
      },
    };
    report.bundledPlugins.removeButtonGeometry = removeButtonGeometry;
    assert.notEqual(removeButtonGeometry.before.busy, "true");
    assert.equal(removeButtonGeometry.before.disabled, false);
    assert.equal(removeButtonGeometry.before.confirmation, null);
    for (const action of ["remove", "neighbor"]) {
      assert.ok(removeButtonGeometry.before[action].width > 0);
      assert.ok(removeButtonGeometry.before[action].height > 0);
    }
    await page.snapshot(removeButtonGeometry.screenshots.before);
    const clickRemove = () =>
      page.evaluate((id) => {
        const remove = document.querySelector(`[data-testid="${id}"]`);
        if (!(remove instanceof HTMLElement) || remove.getAttribute("aria-disabled") === "true")
          throw new Error("The real ChatPro remove button is unavailable");
        remove.click();
      }, chatproRemove);
    // The genuine confirmation promise keeps this real row operation loading
    // until we respond through its actual UI; no IPC or dialog is substituted.
    const waitRemoveConfirmation = async () => {
      let loading;
      await until("busy remove button and genuine ChatPro confirmation", async () => {
        const geometry = await inspectRemoveGeometry();
        if (geometry.busy !== "true" || !geometry.confirmation) return false;
        if (
          !geometry.confirmation.text.includes("omp-bridge-chatpro") ||
          geometry.confirmation.confirm.width <= 0 ||
          geometry.confirmation.confirm.height <= 0
        )
          return false;
        loading = geometry;
        return true;
      });
      return loading;
    };
    await clickRemove();
    removeButtonGeometry.loading = await waitRemoveConfirmation();
    await page.snapshot(removeButtonGeometry.screenshots.loading);
    assert.equal(removeButtonGeometry.loading.disabled, true);
    assert.equal(removeButtonGeometry.loading.neighborDisabled, true);
    removeButtonGeometry.delta = {};
    const assertStableGeometry = (phase) => {
      const current = removeButtonGeometry[phase];
      const delta = { actionGap: current.actionGap - removeButtonGeometry.before.actionGap };
      for (const action of ["remove", "neighbor"]) {
        delta[action] = {};
        for (const dimension of ["width", "height"]) {
          delta[action][dimension] =
            current[action][dimension] - removeButtonGeometry.before[action][dimension];
        }
        for (const axis of ["x", "y"]) {
          delta[action][`${axis}WithinActions`] =
            current[action].relativeToActions[axis] -
            removeButtonGeometry.before[action].relativeToActions[axis];
        }
      }
      removeButtonGeometry.delta[phase] = delta;
      // Compare local action positions, not page coordinates that a modal or
      // scrollbar may translate. No translated-label width is assumed.
      for (const [action, dimensions] of Object.entries(delta)) {
        for (const [dimension, shift] of Object.entries(
          typeof dimensions === "number" ? { gap: dimensions } : dimensions,
        )) {
          assert.ok(
            Math.abs(shift) <= 0.5,
            `Real ${phase} ${action} ${dimension} shifted by ${shift} CSS px`,
          );
        }
      }
    };
    assertStableGeometry("loading");
    const respondToRemoveConfirmation = (dialogAction) =>
      page.evaluate((action) => {
        const dialog = document.querySelector('[data-testid="confirm-dialog"]');
        const button = dialog?.querySelector(`[data-testid="confirm-dialog-${action}"]`);
        if (
          !(button instanceof HTMLElement) ||
          !dialog.textContent.includes("omp-bridge-chatpro") ||
          button.getAttribute("aria-disabled") === "true"
        )
          throw new Error("The genuine ChatPro removal confirmation is unavailable");
        button.click();
      }, dialogAction);
    // Cancel once to measure the original button restored after real loading;
    // this does not invoke the native CLI or alter the registry.
    await respondToRemoveConfirmation("cancel");
    await until("remove button restored after genuine confirmation cancellation", async () => {
      const geometry = await inspectRemoveGeometry();
      if (
        geometry.busy === "true" ||
        geometry.disabled ||
        geometry.neighborDisabled ||
        geometry.confirmation
      )
        return false;
      removeButtonGeometry.restored = geometry;
      return true;
    });
    await page.snapshot(removeButtonGeometry.screenshots.restored);
    assertStableGeometry("restored");
    // Now complete the same genuine page action, retaining native readback,
    // provider-startup tombstone, and explicit reinstall checks below.
    await clickRemove();
    removeButtonGeometry.confirmedLoading = await waitRemoveConfirmation();
    assertStableGeometry("confirmedLoading");
    await respondToRemoveConfirmation("confirm");
    await until(
      "real page removal and completed management refresh",
      async () => {
        const view = await inspect();
        assert.equal(view.error, null);
        return (
          !view.toggles.some((toggle) => toggle.id === chatproToggle) &&
          view.toggles.length === EXPECTED_PLUGINS.length - 1 &&
          view.toggles.every((toggle) => !toggle.disabled)
        );
      },
      90_000,
    );
    // As with toggle acceptance, read native state once after DOM completion.
    const afterRemove = await rpc("list");
    assert.equal(
      afterRemove.plugins.some((plugin) => plugin.name === "omp-bridge-chatpro"),
      false,
    );
    const afterUninstall = await rpc("create", { cwd: project });
    agents.add(afterUninstall.agent.id);
    const withoutReinstall = await rpc("list");
    assert.equal(
      withoutReinstall.plugins.some((plugin) => plugin.name === "omp-bridge-chatpro"),
      false,
      "A later real provider session must not resurrect a user-uninstalled bundled plugin",
    );
    assert.equal(
      afterUninstall.commands.commands.some((entry) => entry.name.replace(/^\//, "") === "chatpro"),
      false,
    );
    await rpc("close", { agentId: afterUninstall.agent.id });
    agents.delete(afterUninstall.agent.id);
    const reinstalled = await rpc("install", { source: snapshots["omp-bridge-chatpro"] });
    assert.equal(reinstalled.ok, true, reinstalled.output);
    const final = await rpc("list");
    for (const expected of EXPECTED_PLUGINS) {
      const plugin = final.plugins.find((entry) => entry.name === expected.name);
      assert.equal(plugin?.version, expected.version);
      assert.equal(plugin?.enabled, true);
    }
    await navigateChinese(page, route);
    await until("reinstalled plugin visible through normal management", async () => {
      const current = await inspect();
      return current.toggles.some(
        (toggle) => toggle.id.includes("omp-bridge-chatpro") && toggle.checked === "true",
      );
    });
    report.bundledPluginCommands = {
      names,
      replies,
      localWorkbuddyPid: started.pid,
      workbuddyUpstreamEnabled: started.upstreamEnabled,
      wechat,
      conversationRoute,
      explicitUninstallPreservedAcrossProviderStartup: true,
      explicitPageRemoveWithRealConfirmation: true,
      explicitNativeReinstall: true,
      final,
    };
    report.checks.push(
      "real native plugin command registration, no-account ChatPro Go status and WorkBuddy Python lifecycle, unconnected WeChat status; full original custom replies on production renderer; real page remove and confirmation with unchanged busy-button geometry and neighboring action position; uninstall tombstone across real provider startup and explicit native reinstall",
    );
  } catch (error) {
    if (report.bundledPluginCommands) report.bundledPluginCommands.stage = "failed";
    try {
      report.bundledPluginCommandSurface = await page.evaluate(() => ({
        url: location.href,
        title: document.title,
        body: document.body.textContent,
        scrollSurfaces: Array.from(document.querySelectorAll('[id^="agent-chat-scroll"]')).map(
          (element) => ({
            id: element.id,
            scrollTop: element.scrollTop,
            scrollHeight: element.scrollHeight,
            clientHeight: element.clientHeight,
          }),
        ),
      }));
      await page.snapshot("bundled-plugin-commands-before-agent-cleanup.png");
    } catch (captureError) {
      report.bundledPluginCommandCaptureError = String(captureError);
    }
    throw error;
  } finally {
    for (const agentId of agents) await rpc("close", { agentId });
  }
  fs.writeFileSync(
    path.join(evidence, "bundled-plugins.json"),
    `${JSON.stringify({ plugins: report.bundledPlugins, commands: report.bundledPluginCommands }, null, 2)}\n`,
  );
}

module.exports = { smokeBundledPlugins };

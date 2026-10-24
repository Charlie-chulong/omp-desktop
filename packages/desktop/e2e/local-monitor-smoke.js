const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFile, spawnSync } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { setTimeout: delay } = require("node:timers/promises");

// Real product controller, preloads, HTML, collector and worker in an owned official runtime.
// Synthetic numeric OMP logs only; no daemon, provider credentials or paid model request.
if (!process.versions.electron) {
  assert.equal(
    process.platform,
    "win32",
    "This native surface smoke targets Windows mini-electron",
  );
  const {
    isolatedEnvironment,
    nativeProfilePaths,
    reserveNativeEarlyProfile,
    cleanupNativeEarlyProfile,
    cleanupOwnedProcesses,
  } = require("./windows-native-packaged-smoke.js");
  const desktopRoot = path.resolve(__dirname, "..");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "omp-local-monitor-"));
  let env, early;
  try {
    fs.copyFileSync(__filename, path.join(temporary, path.basename(__filename)));
    fs.copyFileSync(
      path.join(__dirname, "windows-native-monitor-save.ps1"),
      path.join(temporary, "windows-native-monitor-save.ps1"),
    );
    const runtime = fs.realpathSync(
      process.env.MINI_ELECTRON_DIST_PATH
        ? path.join(process.env.MINI_ELECTRON_DIST_PATH, "electron.exe")
        : require("@iriscat/mini-electron"),
    );
    const stagedRuntime = path.join(temporary, "runtime");
    fs.cpSync(path.dirname(runtime), stagedRuntime, { recursive: true, dereference: true });
    env = isolatedEnvironment({
      root: temporary,
      stagedApp: stagedRuntime,
      daemonHome: path.join(temporary, "daemon"),
      listen: "127.0.0.1:0",
      userData: path.join(temporary, "user-data"),
    });
    early = reserveNativeEarlyProfile(env);
    const metadata = JSON.parse(fs.readFileSync(path.join(desktopRoot, "package.json"), "utf8"));
    fs.writeFileSync(
      path.join(temporary, "package.json"),
      JSON.stringify({
        name: early.name,
        productName: early.name,
        version: metadata.version,
        main: path.basename(__filename),
      }),
    );
    env.OMP_MONITOR_SMOKE_ROOT = desktopRoot;
    env.OMP_MONITOR_SMOKE_PATHS = JSON.stringify(nativeProfilePaths(env));
    env.OMP_MONITOR_SMOKE_EARLY = JSON.stringify(early);
    env.OMP_MONITOR_SMOKE_EVIDENCE = path.resolve(
      process.env.PASEO_DESKTOP_SMOKE_ARTIFACT_DIR ||
        path.join(desktopRoot, "..", "..", ".dev", "local-monitor-native"),
    );
    const result = spawnSync(
      path.join(stagedRuntime, path.basename(runtime)),
      [`--app=${temporary}`],
      { cwd: temporary, env, encoding: "utf8", timeout: 150_000, windowsHide: false },
    );
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    process.exitCode = result.status === 0 ? 0 : 1;
  } finally {
    if (env) cleanupOwnedProcesses(temporary, env);
    if (early) cleanupNativeEarlyProfile(early);
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
} else {
  runNative().catch((error) => {
    console.error(error);
    require("electron").app.exit(1);
  });
}

async function until(predicate, message, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(100);
  }
  throw new Error(`Timed out: ${message}`);
}

async function evaluate(window, source) {
  let timer;
  const { promise: deadline, reject } = Promise.withResolvers();
  timer = setTimeout(() => reject(new Error("Owned renderer evaluation timed out")), 20_000);
  try {
    return await Promise.race([window.webContents.executeJavaScript(`(${source})`), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

async function runNative() {
  const { app, BrowserWindow, protocol } = require("electron");
  assert.ok(
    process.versions.miniElectron,
    "Use the real mini-electron runtime, not stock Electron",
  );
  const root = path.resolve(__dirname);
  const early = JSON.parse(process.env.OMP_MONITOR_SMOKE_EARLY);
  const marker = JSON.parse(fs.readFileSync(early.marker, "utf8"));
  const earlyData = app.getPath("userData");
  const owned = (candidate) => {
    const relative = path.relative(root, path.resolve(candidate));
    return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  assert.ok(owned(earlyData) || path.relative(early.directory, earlyData) === "");
  assert.equal(path.basename(earlyData), early.name);
  assert.equal(app.getName(), early.name);
  assert.equal(marker.token, early.token);
  for (const [name, directory] of Object.entries(JSON.parse(process.env.OMP_MONITOR_SMOKE_PATHS))) {
    assert.ok(owned(directory), `Native ${name} must stay inside the disposable profile`);
    fs.mkdirSync(directory, { recursive: true });
    app.setPath(name, directory);
  }
  app.setName("OMP Local Monitor Native Smoke");
  protocol.registerSchemesAsPrivileged([
    {
      scheme: "omp-desktop",
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true,
        corsEnabled: true,
      },
    },
  ]);
  const desktopRoot = process.env.OMP_MONITOR_SMOKE_ROOT;
  const product = (relative) => require(path.join(desktopRoot, "dist", relative));
  const { MONITOR_HTML } = product("monitor/html.js");
  const { OmpMonitorController } = product("monitor/controller.js");
  const { registerMainWindow } = product("window/main-windows.js");
  const evidence = process.env.OMP_MONITOR_SMOKE_EVIDENCE;
  fs.mkdirSync(evidence, { recursive: true });
  const sessions = path.join(root, "sessions");
  const bucket = path.join(sessions, "workspace-a");
  fs.mkdirSync(path.join(bucket, "main"), { recursive: true });
  fs.mkdirSync(path.join(sessions, "workspace-b"), { recursive: true });
  const now = Date.now();
  const iso = (offset) => new Date(now + offset).toISOString();
  const header = (name) => ({
    type: "session",
    id: name,
    timestamp: iso(-20_000),
    cwd: path.join(root, name),
  });
  const response = (id, output, stopReason = "stop", content = []) => ({
    type: "message",
    id,
    timestamp: iso(-1_000),
    message: {
      role: "assistant",
      provider: "openai",
      api: "openai-responses",
      model: "gpt-4.1",
      timestamp: now - 3_000,
      duration: 2_000,
      ttft: 150,
      stopReason,
      content,
      usage: {
        input: 10,
        output,
        cacheRead: 2,
        cacheWrite: 3,
        totalTokens: output + 25,
        cost: { total: 0.012 },
      },
    },
  });
  const writeLines = (file, records) =>
    fs.writeFileSync(file, records.map((record) => JSON.stringify(record)).join("\n") + "\n");
  const mainFile = path.join(bucket, "main.jsonl"),
    childFile = path.join(bucket, "main", "child.jsonl");
  writeLines(mainFile, [header("workspace-a"), response("main-response", 200)]);
  writeLines(childFile, [
    header("workspace-a"),
    response("child-response", 100, "toolUse", [
      { type: "toolCall", id: "tool-a", name: "read", arguments: {} },
    ]),
    {
      type: "message",
      id: "tool-result",
      timestamp: iso(-500),
      message: { role: "toolResult", toolCallId: "tool-a", toolName: "read", content: [] },
    },
  ]);
  writeLines(path.join(sessions, "workspace-b", "other.jsonl"), [
    header("workspace-b"),
    response("other-response", 50),
  ]);
  const cache = path.join(app.getPath("userData"), "local-monitor");
  fs.mkdirSync(cache, { recursive: true });
  fs.writeFileSync(
    path.join(cache, "pricing-settings.json"),
    JSON.stringify({ schema: 1, networkEnabled: false, currency: "USD" }),
  );
  await app.whenReady();
  protocol.handle("omp-desktop", (request) => {
    const url = new URL(request.url);
    if (url.hostname === "monitor" && url.pathname === "/local-monitor")
      return new Response(MONITOR_HTML, {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    if (url.hostname === "app")
      return new Response("<!doctype html><title>Owned monitor smoke launcher</title>", {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    return new Response("Not found", { status: 404 });
  });
  const main = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(desktopRoot, "dist", "preload.js"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  registerMainWindow(main);
  const controller = new OmpMonitorController({
    roots: [{ path: sessions, label: "owned-fixture" }],
  });
  controller.initialize();
  const monitors = () =>
    BrowserWindow.getAllWindows().filter(
      (window) =>
        !window.isDestroyed() &&
        window.webContents.getURL() === "omp-desktop://monitor/local-monitor",
    );
  const state = (window) => evaluate(window, "window.ompMonitor.ready()");
  const click = (window, id) =>
    evaluate(window, `document.getElementById(${JSON.stringify(id)}).click()`);
  const select = async (window, id, value) => {
    window.show();
    window.focus();
    await until(
      () =>
        evaluate(
          window,
          `(() => { const node=document.getElementById(${JSON.stringify(id)});if(!node?.options)return false;for(const option of node.options)if(option.value===${JSON.stringify(value)})return true;return false;})()`,
        ),
      `rendered ${id} option`,
    );
    const selected = await evaluate(
      window,
      `(() => { const node=document.getElementById(${JSON.stringify(id)});node.value=${JSON.stringify(value)};node.dispatchEvent(new Event('change',{bubbles:true}));return node.value;})()`,
    );
    assert.equal(selected, value, `${id} must accept the selected option`);
  };
  const capture = async (window, name) => {
    const image = await window.webContents.capturePage();
    const size = image.getSize();
    assert.ok(size.width > 0 && size.height > 0, "Native pixels must be nonempty");
    fs.writeFileSync(path.join(evidence, name), image.toPNG());
    return size;
  };
  const closeMonitor = async (window) => {
    // Closing may destroy the renderer before executeJavaScript can reply.
    // Require the real owned-window close, not a reply from its dead renderer.
    const result = click(window, "close").then(
      () => null,
      (error) => error,
    );
    await until(() => window.isDestroyed(), "owned monitor closes");
    const error = await result;
    if (error && String(error) !== "Error: renderer closed") throw error;
  };
  const saveNativeCsv = async (window) => {
    const token = randomUUID(),
      destination = path.join(root, "monitor-export.csv");
    fs.writeFileSync(
      path.join(root, ".omp-monitor-export-owner.json"),
      JSON.stringify({ token, root }),
    );
    const current = (await state(window)).snapshot;
    const handle = window.getNativeWindowHandle();
    const owner = (
      handle.length === 8 ? handle.readBigUInt64LE() : BigInt(handle.readUInt32LE())
    ).toString();
    const { promise, resolve, reject } = Promise.withResolvers();
    const exporting = evaluate(window, "window.ompMonitor.exportCsv()");
    execFile(
      path.join(
        process.env.SystemRoot || "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(root, "windows-native-monitor-save.ps1"),
      ],
      {
        encoding: "utf8",
        windowsHide: true,
        timeout: 25_000,
        env: {
          ...process.env,
          OMP_MONITOR_EXPORT_ROOT: root,
          OMP_MONITOR_EXPORT_PATH: destination,
          OMP_MONITOR_EXPORT_TOKEN: token,
          OMP_MONITOR_EXPORT_OWNER: owner,
          OMP_MONITOR_EXPORT_DEFAULT: `omp-monitor-${new Date(current.updatedAt).toISOString().slice(0, 10)}.csv`,
        },
      },
      (error, stdout, stderr) => {
        if (error)
          reject(new Error(`Owned native save-dialog driver failed: ${stderr || error.message}`));
        else resolve(JSON.parse(stdout));
      },
    );
    const [result, native] = await Promise.all([exporting, promise]);
    assert.equal(result, "saved");
    assert.equal(native.ownedNativeDialog, true);
    const csv = fs.readFileSync(destination, "utf8");
    assert.equal(csv.charCodeAt(0), 0xfeff);
    assert.ok(csv.includes('"section","label","profile","project"'));
    assert.ok(csv.includes('"today"') && csv.includes('"resources"'));
    fs.copyFileSync(destination, path.join(evidence, "native-export.csv"));
  };
  const report = {
    runtime: process.versions.miniElectron,
    nativeProfileIsolated: true,
    checks: [],
    captures: [],
  };
  try {
    await main.loadURL("omp-desktop://app/local-monitor-smoke");
    await evaluate(main, "window.paseoDesktop.monitor.open()");
    await until(() => monitors().length === 1, "main preload opens monitor");
    let first = monitors()[0];
    await until(async () => {
      const view = await state(first);
      return view.snapshot?.status === "ready" && view.snapshot.today.requests === 3;
    }, "real worker reads parent, child and another project");
    let initial = (await state(first)).snapshot;
    assert.equal(initial.today.outputTokens, 350);
    assert.equal(initial.today.totalTokens, 425);
    assert.equal(initial.agents.filter((agent) => agent.kind === "subagent").length, 1);
    assert.equal(initial.pricing.networkEnabled, false);
    assert.equal(initial.pricing.currencies.length, 38);
    assert.ok(initial.today.estimatedCostUsd > 0);
    assert.equal(await evaluate(first, "typeof require"), "undefined");
    assert.equal(await evaluate(first, "typeof process"), "undefined");
    report.checks.push(
      "real main preload, sandboxed monitor, actual worker and numeric parent/child logs",
    );
    const rogue = new BrowserWindow({
      show: false,
      webPreferences: {
        preload: path.join(desktopRoot, "dist", "preload.js"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    try {
      await rogue.loadURL("omp-desktop://app/unregistered");
      assert.equal(
        await evaluate(
          rogue,
          "(async()=>{try{await window.paseoDesktop.monitor.open();return true;}catch{return false;}})()",
        ),
        false,
      );
      assert.equal(monitors().length, 1);
    } finally {
      rogue.destroy();
    }
    report.checks.push("unregistered opening sender rejected without creating a window");
    await saveNativeCsv(first);
    report.checks.push("real owned native save dialog exports a scoped UTF-8 BOM CSV");
    await select(first, "language", "zh");
    await select(first, "effects", "off");
    const styles = await evaluate(
      first,
      "Array.from(document.getElementById('orb-style').options,option=>option.value)",
    );
    const themes = await evaluate(
      first,
      "Array.from(document.getElementById('title-theme').options,option=>option.value)",
    );
    assert.equal(styles.length, 5);
    assert.equal(themes.length, 9);
    for (const style of styles) {
      await select(first, "orb-style", style);
      assert.equal(await evaluate(first, "document.body.dataset.orb"), style);
      await capture(first, `instrument-${style}.png`);
      report.captures.push(`instrument-${style}.png`);
    }
    for (const theme of themes) {
      await select(first, "title-theme", theme);
      assert.equal(await evaluate(first, "document.getElementById('title-theme').value"), theme);
    }
    await select(first, "orb-style", "led");
    await select(first, "title-theme", "cultivation");
    await capture(first, "dashboard-zh.png");
    report.captures.push("dashboard-zh.png");
    report.checks.push(
      "five native instrument presentations, nine title themes and Chinese surface",
    );
    await select(first, "effects", "high");
    const burstNow = Date.now();
    const burst = response("measured-peak-response", 10_000);
    burst.timestamp = new Date(burstNow).toISOString();
    burst.message.timestamp = burstNow - 1_000;
    burst.message.duration = 1_000;
    fs.appendFileSync(mainFile, JSON.stringify(burst) + "\n");
    await click(first, "refresh");
    await until(
      async () => (await state(first)).snapshot?.today.peakOutputTps > initial.today.peakOutputTps,
      "fresh measured peak",
    );
    await until(
      async () => (await evaluate(first, "document.body.dataset.tier")) === "3",
      "high-throughput presentation",
    );
    const reducedMotion = await evaluate(
      first,
      "matchMedia('(prefers-reduced-motion: reduce)').matches",
    );
    assert.equal(
      await evaluate(
        first,
        "getComputedStyle(document.querySelector('.orb-effects')).display !== 'none'",
      ),
      !reducedMotion,
    );
    await capture(first, "measured-peak-effects.png");
    report.captures.push("measured-peak-effects.png");
    await select(first, "effects", "off");
    assert.equal(
      await evaluate(first, "getComputedStyle(document.querySelector('.orb-effects')).display"),
      "none",
    );
    report.checks.push(
      "measured peak, bounded flame/particle effects, reduced-motion policy and explicit Off",
    );
    await click(first, "new-window");
    await until(() => monitors().length === 2, "second independent window");
    const second = monitors().find((window) => window !== first);
    await until(async () => !!(await state(second)).snapshot, "second scoped snapshot");
    const projectB = initial.scopes.projects.find((project) => project.startsWith("workspace-b"));
    assert.ok(projectB);
    await select(second, "project", projectB);
    await until(async () => {
      const current = await state(second);
      return current.snapshot?.scope.project === projectB && current.snapshot.today.requests === 1;
    }, "project filtering changes all metrics");
    assert.equal((await state(first)).snapshot.today.requests, 4);
    assert.equal((await state(second)).snapshot.today.outputTokens, 50);
    await click(second, "compact");
    await until(async () => (await state(second)).compact, "compact native window");
    const compactBounds = second.getBounds();
    assert.ok(compactBounds.width < 500 && compactBounds.height < 400);
    await click(second, "pin");
    await until(() => second.isAlwaysOnTop(), "native pin");
    await capture(second, "floating-project-b.png");
    report.captures.push("floating-project-b.png");
    await click(second, "compact");
    await until(async () => !(await state(second)).compact, "restore dashboard");
    assert.ok(second.getBounds().width >= 700);
    report.checks.push(
      "two windows, independent true project totals, compact/expand and native pin",
    );
    await select(first, "currency", "CNY");
    await until(
      async () => (await state(first)).snapshot?.pricing.currency === "CNY",
      "offline currency conversion",
    );
    assert.equal((await state(second)).snapshot.pricing.networkEnabled, false);
    await until(
      async () => (await state(second)).snapshot?.pricing.currency === "CNY",
      "shared currency configuration",
    );
    assert.ok((await state(first)).snapshot.pricing.exchangeRate > 0);
    report.checks.push("offline bundled pricing, 38 currencies, shared converted-currency state");
    fs.appendFileSync(
      childFile,
      JSON.stringify({
        type: "custom",
        customType: "session_exit",
        id: "child-exit",
        timestamp: new Date().toISOString(),
      }) + "\n",
    );
    await click(first, "refresh");
    await until(async () => {
      const current = (await state(first)).snapshot;
      return (
        current?.agents.every((agent) => agent.phase === "idle") && current.rate.estimatedTps === 0
      );
    }, "idle transition stops estimates");
    await closeMonitor(second);
    await until(() => monitors().length === 1, "closing one keeps the other alive");
    assert.equal((await state(first)).snapshot.today.requests, 4);
    await closeMonitor(first);
    await until(() => monitors().length === 0, "last close destroys monitor");
    fs.renameSync(sessions, path.join(root, "sessions-unavailable"));
    await evaluate(main, "window.paseoDesktop.monitor.open()");
    await until(() => monitors().length === 1, "reopen after last close");
    first = monitors()[0];
    await until(
      async () => (await state(first)).snapshot?.status === "unavailable",
      "missing root remains unavailable",
    );
    await until(
      async () =>
        (await evaluate(first, "document.getElementById('today-output').textContent")) === "—",
      "missing usage is not a false zero",
    );
    assert.equal(await evaluate(first, "document.getElementById('speed-value').textContent"), "—");
    assert.equal(await evaluate(first, "document.getElementById('export').disabled"), true);
    assert.equal(await evaluate(first, "window.ompMonitor.exportCsv()"), "unavailable");
    fs.renameSync(path.join(root, "sessions-unavailable"), sessions);
    await click(first, "refresh");
    await until(async () => {
      const current = (await state(first)).snapshot;
      return (
        current?.today.requests === 4 &&
        current.pricing.currency === "CNY" &&
        !current.pricing.networkEnabled
      );
    }, "fresh collector and persisted offline preference");
    report.checks.push(
      "idle recovery, one-window close, final close/reopen without duplicated usage",
    );
    report.checks.push(
      "missing log source shows unknown metrics and cannot export fabricated zero use",
    );
    report.status = "passed";
    fs.writeFileSync(
      path.join(evidence, "native-monitor-result.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(`Local monitor native smoke passed: ${JSON.stringify(report)}`);
  } catch (error) {
    report.status = "failed";
    report.error = String(error.stack || error);
    for (const window of monitors())
      await capture(window, `failure-${window.id}.png`).catch(() => undefined);
    fs.writeFileSync(
      path.join(evidence, "native-monitor-result.json"),
      JSON.stringify(report, null, 2),
    );
    throw error;
  } finally {
    controller.dispose();
    main.destroy();
  }
  app.exit(0);
}

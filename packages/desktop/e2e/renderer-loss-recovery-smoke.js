const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const { once } = require("node:events");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");

const SMOKE_ROUTE = "/workspace/recovery?draft=unsent#message-7";
const SMOKE_SCHEME = "omp-renderer-loss-smoke";

// Run in a separate native mini-electron process and profile on Windows.
// Only this smoke's own renderer child is terminated.
if (!process.versions.electron) {
  const desktopRoot = path.resolve(__dirname, "..");
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "omp-renderer-loss-smoke-"));
  try {
    const entry = path.join(temporary, path.basename(__filename));
    fs.copyFileSync(__filename, entry);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.NODE_OPTIONS;
    console.log('Renderer-loss smoke: choose "Reload window" in the native dialog.');
    env.PASEO_RENDERER_LOSS_SMOKE_ROOT = desktopRoot;
    const executable = process.env.ELECTRON_PATH || require("@iriscat/mini-electron");
    const result = spawnSync(executable, [`--app=${entry}`], {
      env,
      stdio: "inherit",
      timeout: 60_000,
      windowsHide: false,
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(
        `Renderer-loss smoke exited unsuccessfully (status ${result.status}, signal ${result.signal || "none"})`,
      );
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 });
  }
} else {
  runNativeSmoke().catch((error) => {
    console.error(error);
    require("electron").app.exit(1);
  });
}

async function runNativeSmoke() {
  const { app, BrowserWindow, dialog, protocol } = require("electron");
  assert.equal(process.platform, "win32", "This native recovery smoke requires Windows");
  const desktopRoot = process.env.PASEO_RENDERER_LOSS_SMOKE_ROOT;
  assert.ok(desktopRoot, "The isolated launcher must provide the desktop module root");
  for (const name of ["userData", "sessionData", "logs", "crashDumps"]) {
    const directory = path.join(__dirname, name);
    fs.mkdirSync(directory);
    app.setPath(name, directory);
  }
  app.setName("OMP Renderer Loss Smoke");
  protocol.registerSchemesAsPrivileged([
    {
      scheme: SMOKE_SCHEME,
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
      },
    },
  ]);
  app.on("window-all-closed", () => {});

  const product = (relative) => require(path.join(desktopRoot, "dist", relative));
  const {
    getRendererRecoveryRoute,
    RendererLossRecoveryController,
    showRendererLossPrompt,
    showRendererRecoveryFailure,
  } = product("window/renderer-loss-recovery.js");

  await app.whenReady();
  protocol.handle(SMOKE_SCHEME, () => {
    return new Response(
      `<!doctype html>
      <html><head><meta charset="utf-8"><title>Renderer recovery smoke</title></head>
      <body style="font: 18px sans-serif; background: #181818; color: #f4f4f5; padding: 32px">
        <h1>Replacement renderer is interactive</h1>
        <p id="route"></p>
        <button id="interaction" style="font-size: 18px; padding: 10px 18px">Verify interaction</button>
        <p id="result">Waiting for interaction</p>
        <script>
          route.textContent = location.pathname + location.search + location.hash;
          interaction.addEventListener('click', () => {
            document.body.dataset.interacted = 'yes';
            result.textContent = 'Interaction verified';
          });
        </script>
      </body></html>`,
      {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      },
    );
  });

  let replacement = null;
  let recoveryPromise = null;
  const controller = new RendererLossRecoveryController({
    getReplacementOptions: (window) => ({
      initialRoute: getRendererRecoveryRoute(window.webContents.getURL()),
      pendingOpenProjectPath: null,
      restoreWindowState: true,
    }),
    showRecoveryPrompt: (window, details) =>
      showRendererLossPrompt(window, (options) => dialog.showMessageBox(window, options), details),
    showRecoveryFailure: (window, error) =>
      showRendererRecoveryFailure(
        window,
        (options) => dialog.showMessageBox(window, options),
        error,
      ),
    createWindow: async (options) => {
      assert.deepEqual(options, {
        initialRoute: SMOKE_ROUTE,
        pendingOpenProjectPath: null,
        restoreWindowState: true,
      });
      const window = new BrowserWindow({
        width: 900,
        height: 600,
        show: false,
        title: "OMP Renderer Loss Smoke — replacement",
        webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
      });
      await window.loadURL(`${SMOKE_SCHEME}://app${options.initialRoute}`);
      window.show();
      window.focus();
      replacement = window;
      return window;
    },
    closeWindow: (window) => {
      if (!window.isDestroyed()) window.destroy();
    },
    onRendererLoss: (_window, details) => {
      console.log(
        `Observed renderer loss: reason=${details.reason}, exitCode=${String(details.exitCode)}`,
      );
      console.log("STAGE renderer-loss-dialog-waiting");
    },
    onError: (error) => console.error("Renderer recovery failed", error),
  });

  const failedWindow = new BrowserWindow({
    width: 900,
    height: 600,
    show: false,
    title: "OMP Renderer Loss Smoke — original",
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  failedWindow.webContents.on("render-process-gone", (_event, details) => {
    recoveryPromise = controller.handleRendererLoss(failedWindow, details);
  });

  try {
    await failedWindow.loadURL(`${SMOKE_SCHEME}://app${SMOKE_ROUTE}`);
    failedWindow.show();
    failedWindow.focus();
    const rendererPid = failedWindow.webContents.getProcessId();
    const rendererParent = Number(
      execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${rendererPid}').ParentProcessId`,
        ],
        { encoding: "utf8", timeout: 10_000, windowsHide: true },
      ).trim(),
    );
    assert.equal(rendererParent, process.pid, "Only this smoke's renderer may be terminated");
    const rendererGone = once(failedWindow.webContents, "render-process-gone", {
      signal: AbortSignal.timeout(10_000),
    });
    console.log("STAGE original-window-ready " + JSON.stringify({ pid: process.pid, rendererPid }));
    await delay(500);
    process.kill(rendererPid, "SIGKILL");

    await rendererGone;
    assert.ok(recoveryPromise, "The controlled renderer crash must reach recovery");
    await recoveryPromise;
    assert.ok(replacement, 'Choose "Reload window" to create the replacement renderer');
    assert.equal(replacement.isVisible(), true, "The replacement window must be visible");
    assert.equal(
      replacement.webContents.isDestroyed(),
      false,
      "The replacement renderer must exist",
    );
    assert.equal(
      replacement.webContents.getURL(),
      `${SMOKE_SCHEME}://app${SMOKE_ROUTE}`,
      "The replacement must retain path, search, and hash",
    );
    const point = await replacement.webContents.executeJavaScript(`(() => {
      const bounds = document.querySelector('#interaction').getBoundingClientRect();
      return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, dpr: devicePixelRatio };
    })()`);
    console.log(
      "STAGE replacement-awaiting-interaction " + JSON.stringify({ pid: process.pid, point }),
    );
    console.log('Click "Verify interaction" in the replacement window.');
    const interactionDeadline = Date.now() + 20_000;
    let interacted;
    do {
      interacted = await replacement.webContents.executeJavaScript(
        "document.body.dataset.interacted",
      );
      if (interacted === "yes") break;
      await delay(50);
    } while (Date.now() < interactionDeadline);
    assert.equal(interacted, "yes", "The visible replacement page must accept a real input click");
    console.log("STAGE replacement-interactive");
    console.log("PASS renderer loss opened an interactive replacement window");
    const requestedHoldMs = Number(process.env.PASEO_RENDERER_LOSS_SMOKE_HOLD_MS ?? 3_000);
    const holdMs = Number.isFinite(requestedHoldMs)
      ? Math.max(0, Math.min(requestedHoldMs, 60_000))
      : 3_000;
    await delay(holdMs);
  } finally {
    controller.beginShutdown();
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.destroy();
    }
    app.quit();
  }
}

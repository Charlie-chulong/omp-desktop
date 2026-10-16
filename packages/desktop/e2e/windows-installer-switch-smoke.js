const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { UUID } = require("builder-util-runtime");
const { smokePackagedDesktopApp } = require("./packaged-app-smoke.js");

function run(executable, args, options = {}) {
  const result = spawnSync(executable, args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 300_000,
    ...options,
  });
  if (result.error || result.status !== 0) {
    throw new Error(
      `${executable} failed (${result.status}): ${result.error || result.stderr || result.stdout}`,
    );
  }
  return result.stdout.trim();
}

async function checksum(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of fs.createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

function install(installer, appPath, executableName) {
  // NSIS requires /D to be last and unquoted, including when it contains spaces.
  run(installer, ["/S", "/currentuser", `/D=${appPath}`], { windowsVerbatimArguments: true });
  assert.ok(
    fs.existsSync(path.join(appPath, `${executableName}.exe`)),
    "Desktop was not installed",
  );
}

function uninstall(appPath, root, executableName) {
  const installedUninstaller = path.join(appPath, `Uninstall ${executableName}.exe`);
  if (!fs.existsSync(installedUninstaller)) return;
  const uninstaller = path.join(root, "uninstall.exe");
  fs.copyFileSync(installedUninstaller, uninstaller);
  // Run outside INSTDIR and suppress self-copying so the process is awaited.
  run(uninstaller, ["/S", "/currentuser", `_?=${appPath}`], { windowsVerbatimArguments: true });
}

async function smokeWindowsInstallerSwitch({ standard, noOmp, configPath, updatedOmp }) {
  if (process.platform !== "win32") throw new Error("This smoke requires a real Windows machine");
  for (const installer of [standard, noOmp]) fs.accessSync(installer);

  const resolvedConfig = configPath
    ? path.resolve(configPath)
    : path.join(__dirname, "../electron-builder.yml");
  const config = resolvedConfig.endsWith(".cjs")
    ? require(resolvedConfig)
    : require("js-yaml").load(fs.readFileSync(resolvedConfig, "utf8"));
  const executableName = config.executableName || config.productName;
  const guid = UUID.v5(config.appId, UUID.parse("50e065bc-3134-11e6-9bab-38c9862bdaf3"));
  for (const hive of ["HKCU", "HKLM"]) {
    const existing = spawnSync("reg.exe", ["query", `${hive}\\Software\\${guid}`, "/reg:64"], {
      encoding: "utf8",
      windowsHide: true,
    });
    if (existing.error) throw existing.error;
    if (existing.status === 0) {
      throw new Error("An existing Desktop installation is registered; use a clean Windows VM");
    }
    if (existing.status !== 1) throw new Error(`Unable to inspect ${hive}: ${existing.stderr}`);
  }

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omp-installer-switch-"));
  const originalPath = path.join(root, "original", "OMP Desktop 中文");
  const movedPath = path.join(root, "moved", "OMP Desktop 中文");
  let activePath = originalPath;
  const ompPath = (appPath) => path.join(appPath, "resources", "bin", "omp.exe");
  try {
    install(noOmp, activePath, executableName);
    assert.equal(fs.existsSync(ompPath(activePath)), false, "Fresh no-OMP install bundled OMP");
    uninstall(activePath, root, executableName);
    console.log("Installer switch smoke: fresh no-OMP installation has no bundled runtime");

    install(standard, activePath, executableName);
    const packagedChecksum = await checksum(ompPath(activePath));
    const originalVersion = run(ompPath(activePath), ["--version"]);
    if (updatedOmp) {
      run(updatedOmp, ["--version"]);
      fs.copyFileSync(updatedOmp, ompPath(activePath));
    }
    const retainedChecksum = await checksum(ompPath(activePath));
    if (updatedOmp) {
      assert.notEqual(
        retainedChecksum,
        packagedChecksum,
        "Updated runtime must differ from payload",
      );
    }
    const retainedVersion = run(ompPath(activePath), ["--version"]);
    console.log(`Installer switch smoke: standard installer runtime ${originalVersion}`);
    console.log(`Installer switch smoke: preserving installed runtime ${retainedVersion}`);

    install(noOmp, activePath, executableName);
    assert.equal(
      await checksum(ompPath(activePath)),
      retainedChecksum,
      "Switch deleted/changed OMP",
    );
    assert.equal(run(ompPath(activePath), ["--version"]), retainedVersion);
    await smokePackagedDesktopApp({ appPath: activePath, executableName });
    console.log(
      "Installer switch smoke: standard → no-OMP preserves exact runtime and starts Desktop",
    );

    install(noOmp, movedPath, executableName);
    activePath = movedPath;
    assert.equal(await checksum(ompPath(activePath)), retainedChecksum, "Relocation changed OMP");
    assert.equal(fs.existsSync(path.join(originalPath, `${executableName}.exe`)), false);
    assert.equal(run(ompPath(activePath), ["--version"]), retainedVersion);
    await smokePackagedDesktopApp({ appPath: activePath, executableName });
    console.log(
      "Installer switch smoke: repeated no-OMP install preserves runtime across relocation",
    );

    install(standard, activePath, executableName);
    assert.equal(await checksum(ompPath(activePath)), packagedChecksum);
    assert.equal(run(ompPath(activePath), ["--version"]), originalVersion);
    console.log("Installer switch smoke: switching back to the standard installer succeeds");
  } finally {
    for (const appPath of new Set([activePath, originalPath, movedPath])) {
      uninstall(appPath, root, executableName);
      assert.equal(fs.existsSync(ompPath(appPath)), false, "Uninstall retained the OMP runtime");
      assert.equal(
        fs.existsSync(path.join(appPath, `${executableName}.exe`)),
        false,
        "Uninstall retained Desktop",
      );
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
}

module.exports = { smokeWindowsInstallerSwitch };

if (require.main === module) {
  const argument = (name) => {
    const index = process.argv.indexOf(name);
    if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing ${name} installer path`);
    return path.resolve(process.argv[index + 1]);
  };
  Promise.resolve()
    .then(() =>
      smokeWindowsInstallerSwitch({
        standard: argument("--standard"),
        noOmp: argument("--no-omp"),
        configPath: process.argv.includes("--config") ? argument("--config") : undefined,
        updatedOmp: process.argv.includes("--updated-omp") ? argument("--updated-omp") : undefined,
      }),
    )
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

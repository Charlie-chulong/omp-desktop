import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { DEFAULT_DESKTOP_SETTINGS, type DesktopSettings } from "../settings/desktop-settings.js";
import { DEFAULT_PET_ACTIVITY } from "./activity.js";
import type { PetDescriptor } from "./types.js";
import { DesktopPetController } from "./controller.js";

const mock = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, value?: unknown) => unknown>(),
  subscribers: new Set<(settings: DesktopSettings) => void>(),
  windows: [] as {
    destroy: () => void;
    webContents: { send: Mock; mainFrame: object };
    options: Record<string, unknown>;
    showInactive: Mock;
  }[],
  settings: {} as DesktopSettings,
  get: vi.fn(),
  getSelected: vi.fn(),
  report: vi.fn(),
  patch: vi.fn(),
}));

vi.mock("electron-log/main", () => ({ default: { error: vi.fn() } }));
vi.mock("../settings/desktop-settings-electron.js", () => ({
  getDesktopSettingsStore: () => ({ get: mock.get, patch: mock.patch }),
  subscribeDesktopSettingsChanges: (listener: (settings: DesktopSettings) => void) => {
    mock.subscribers.add(listener);
    return () => mock.subscribers.delete(listener);
  },
}));
vi.mock("./library.js", () => ({ getPetLibrary: () => ({ getSelected: mock.getSelected }) }));
vi.mock("../window/main-windows.js", () => ({
  getMainWindows: () => [],
  isMainWindowSender: (sender: { main: boolean }) => sender.main === true,
  onMainWindowRemoved: () => () => undefined,
}));
vi.mock("electron", async () => {
  // This hoisted Electron module-loading mock runs before static imports initialize.
  const { EventEmitter } = await import("node:events");
  class Window extends EventEmitter {
    destroyed = false;
    bounds = { x: 0, y: 0, width: 260, height: 228 };
    webContents = Object.assign(new EventEmitter(), {
      send: vi.fn(),
      mainFrame: {},
      setWindowOpenHandler: vi.fn(),
    });
    showInactive = vi.fn();
    constructor(public options: Record<string, unknown>) {
      super();
      mock.windows.push(this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    destroy() {
      this.destroyed = true;
      this.emit("closed");
    }
    setIgnoreMouseEvents = vi.fn();
    setVisibleOnAllWorkspaces = vi.fn();
    async loadURL() {}
    getBounds() {
      return this.bounds;
    }
    setBounds(bounds: typeof this.bounds) {
      this.bounds = bounds;
    }
  }
  return {
    BrowserWindow: Window,
    dialog: { showErrorBox: mock.report },
    ipcMain: Object.assign(new EventEmitter(), {
      handle: (channel: string, handler: (event: unknown, value?: unknown) => unknown) =>
        mock.handlers.set(channel, handler),
      removeHandler: (channel: string) => mock.handlers.delete(channel),
    }),
    Menu: { buildFromTemplate: vi.fn(() => ({ popup: vi.fn() })) },
    screen: Object.assign(new EventEmitter(), {
      getPrimaryDisplay: () => ({ id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }),
      getAllDisplays: () => [{ id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1040 } }],
      getCursorScreenPoint: () => ({ x: 10, y: 10 }),
    }),
  };
});

const animation = { row: 0, frames: 2, fps: 4 };
const descriptor: PetDescriptor = {
  id: "iris",
  name: "Iris",
  description: "",
  builtIn: true,
  spriteUrl: "omp-desktop://app/pet-sprites/iris.png",
  previewUrl: "omp-desktop://app/pet-preview/iris.png",
  frameWidth: 128,
  frameHeight: 128,
  sheetWidth: 256,
  sheetHeight: 640,
  animations: {
    idle: animation,
    running: animation,
    blocked: animation,
    ready: animation,
    needs_input: animation,
  },
};
const controllers: DesktopPetController[] = [];

beforeEach(() => {
  mock.handlers.clear();
  mock.subscribers.clear();
  mock.windows.length = 0;
  mock.settings = { ...DEFAULT_DESKTOP_SETTINGS, pet: { ...DEFAULT_DESKTOP_SETTINGS.pet } };
  mock.get.mockReset().mockImplementation(async () => mock.settings);
  mock.getSelected.mockReset().mockResolvedValue(descriptor);
  mock.report.mockReset();
  mock.patch.mockReset();
});
afterEach(() => {
  for (const instance of controllers) instance.dispose();
  controllers.length = 0;
});

function controller() {
  const openApp = vi.fn(),
    openTask = vi.fn();
  const instance = new DesktopPetController({ openApp, openTask });
  controllers.push(instance);
  return { instance, openApp, openTask };
}

async function changeSettings(pet: Partial<DesktopSettings["pet"]>) {
  mock.settings = { ...mock.settings, pet: { ...mock.settings.pet, ...pet } };
  for (const listener of mock.subscribers) listener(mock.settings);
  // Let queued selection and loadURL promise continuations finish before observing the native boundary.
  await new Promise<void>((resolve) => setImmediate(resolve));
}

describe("native companion controller", () => {
  it("defers enabled startup and renders the latest preferences once explicitly started", async () => {
    mock.settings.pet.enabled = true;
    const { instance } = controller();
    await instance.initialize();

    expect(mock.getSelected).not.toHaveBeenCalled();
    expect(mock.windows).toHaveLength(0);
    await changeSettings({ selectedId: "latest", size: "large" });
    expect(mock.getSelected).not.toHaveBeenCalled();
    expect(mock.windows).toHaveLength(0);

    const selected = { ...descriptor, id: "latest", name: "Latest" };
    mock.getSelected.mockResolvedValue(selected);
    await instance.start();

    expect(mock.getSelected).toHaveBeenCalledOnce();
    expect(mock.getSelected).toHaveBeenCalledWith("latest");
    expect(mock.windows).toHaveLength(1);
    const window = mock.windows[0];
    expect(window.showInactive).toHaveBeenCalledOnce();
    expect(window.webContents.send).toHaveBeenCalledWith("paseo:pet:state", {
      descriptor: selected,
      size: "large",
      activity: DEFAULT_PET_ACTIVITY,
    });
  });

  it("does not let the initial settings read replace a newer pre-start update", async () => {
    const initial = {
      ...mock.settings,
      pet: { ...mock.settings.pet, enabled: true, selectedId: "initial" },
    };
    let resolveSettings!: (settings: DesktopSettings) => void;
    mock.get.mockReturnValue(
      new Promise<DesktopSettings>((resolve) => (resolveSettings = resolve)),
    );
    const { instance } = controller();
    const initializing = instance.initialize();
    await changeSettings({ enabled: true, selectedId: "latest", size: "large" });
    resolveSettings(initial);
    await initializing;

    expect(mock.getSelected).not.toHaveBeenCalled();
    expect(mock.windows).toHaveLength(0);
    const selected = { ...descriptor, id: "latest", name: "Latest" };
    mock.getSelected.mockResolvedValue(selected);
    await instance.start();

    expect(mock.getSelected).toHaveBeenCalledOnce();
    expect(mock.getSelected).toHaveBeenCalledWith("latest");
    expect(mock.windows[0].webContents.send).toHaveBeenCalledWith(
      "paseo:pet:state",
      expect.objectContaining({ descriptor: selected, size: "large" }),
    );
    expect(mock.windows[0].showInactive).toHaveBeenCalledOnce();
  });

  it("keeps settings disabled before readiness from flashing a companion", async () => {
    mock.settings.pet.enabled = true;
    const { instance } = controller();
    await instance.initialize();
    await changeSettings({ enabled: false });
    await instance.start();

    expect(mock.getSelected).not.toHaveBeenCalled();
    expect(mock.windows).toHaveLength(0);
    await changeSettings({ enabled: true });
    expect(mock.windows).toHaveLength(1);
    expect(mock.windows[0].showInactive).toHaveBeenCalledOnce();
    expect(mock.windows[0].webContents.send).toHaveBeenCalledWith(
      "paseo:pet:state",
      expect.objectContaining({ descriptor }),
    );
  });

  it("shares concurrent starts and never replays startup after settings change", async () => {
    mock.settings.pet.enabled = true;
    let resolveSelection!: (selected: PetDescriptor) => void;
    mock.getSelected.mockReturnValue(
      new Promise<PetDescriptor>((resolve) => (resolveSelection = resolve)),
    );
    const { instance } = controller();
    await instance.initialize();

    const firstStart = instance.start();
    const secondStart = instance.start();
    await Promise.resolve();
    expect(mock.windows).toHaveLength(0);
    resolveSelection(descriptor);
    await Promise.all([firstStart, secondStart]);

    expect(mock.getSelected).toHaveBeenCalledOnce();
    expect(mock.windows).toHaveLength(1);
    const window = mock.windows[0];
    expect(window.showInactive).toHaveBeenCalledOnce();
    await changeSettings({ size: "large" });
    window.webContents.send.mockClear();
    await instance.start();
    expect(mock.windows).toHaveLength(1);
    expect(window.showInactive).toHaveBeenCalledOnce();
    expect(
      window.webContents.send.mock.calls.some(([channel]) => channel === "paseo:pet:state"),
    ).toBe(false);
    expect(
      mock.handlers.get("paseo:pet:ready")!({
        sender: window.webContents,
        senderFrame: window.webContents.mainFrame,
      }),
    ).toMatchObject({ descriptor, size: "large" });
  });

  it.each(["beginShutdown", "dispose"] as const)(
    "keeps startup inert after %s before readiness",
    async (shutdown) => {
      mock.settings.pet.enabled = true;
      const { instance } = controller();
      await instance.initialize();
      instance[shutdown]();
      await instance.start();
      await changeSettings({ enabled: true });
      await instance.start();

      expect(mock.getSelected).not.toHaveBeenCalled();
      expect(mock.windows).toHaveLength(0);
      expect(mock.report).not.toHaveBeenCalled();
      expect(mock.patch).not.toHaveBeenCalled();
    },
  );

  it("creates no disabled window and exactly one enabled non-focusing sandboxed overlay", async () => {
    const { instance } = controller();
    await instance.initialize();
    expect(mock.windows).toHaveLength(0);
    await instance.start();
    await changeSettings({ enabled: true });
    await changeSettings({ size: "large" });
    expect(mock.windows).toHaveLength(1);
    expect(mock.windows[0].options).toMatchObject({
      transparent: true,
      frame: false,
      skipTaskbar: true,
      focusable: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    expect(mock.windows[0].showInactive).toHaveBeenCalledOnce();
    const destroy = vi.spyOn(mock.windows[0], "destroy");
    await changeSettings({ enabled: false });
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("authenticates snapshots and routes clicks to the actual priority task then clears attention", async () => {
    mock.settings.pet.enabled = true;
    const { instance, openApp, openTask } = controller();
    await instance.initialize();
    const publish = mock.handlers.get("paseo:pet:publishActivity")!;
    const mainFrame = {},
      sender = { id: 12, main: true, mainFrame };
    const event = { sender, senderFrame: mainFrame };
    const tasks = [
      { serverId: "local", agentId: "working", title: "Working", status: "running", updatedAt: 20 },
      {
        serverId: "remote",
        agentId: "permission",
        title: "Permission",
        status: "needs_input",
        updatedAt: 10,
      },
    ];
    expect(() =>
      publish({ sender: { ...sender, main: false }, senderFrame: mainFrame }, DEFAULT_PET_ACTIVITY),
    ).toThrow("main application window");
    expect(() => publish({ sender, senderFrame: {} }, DEFAULT_PET_ACTIVITY)).toThrow(
      "main application window",
    );
    publish(event, {
      ...DEFAULT_PET_ACTIVITY,
      connected: true,
      serverIds: ["local", "remote"],
      revisions: { local: { generation: "g1", seq: 1 }, remote: { generation: "g1", seq: 1 } },
      tasks,
    });
    expect(mock.windows).toHaveLength(0);
    await instance.start();
    const window = mock.windows[0];
    const overlayEvent = { sender: window.webContents, senderFrame: window.webContents.mainFrame };
    expect(mock.handlers.get("paseo:pet:ready")!(overlayEvent)).toMatchObject({
      descriptor,
      activity: { connected: true, tasks: expect.arrayContaining(tasks) },
    });
    mock.handlers.get("paseo:pet:open")!(overlayEvent);
    expect(openTask).toHaveBeenCalledWith(tasks[1]);
    publish(event, {
      ...DEFAULT_PET_ACTIVITY,
      connected: true,
      serverIds: ["local", "remote"],
      revisions: { local: { generation: "g1", seq: 2 }, remote: { generation: "g1", seq: 2 } },
      tasks: [],
    });
    mock.handlers.get("paseo:pet:open")!(overlayEvent);
    expect(openApp).toHaveBeenCalledOnce();
  });

  it("surfaces corrupt selected art rather than substituting a descriptor", async () => {
    mock.settings.pet.enabled = true;
    mock.settings.pet.selectedId = "corrupt";
    mock.getSelected.mockRejectedValue(new Error("Invalid selected spritesheet"));
    const { instance } = controller();
    await instance.initialize();
    await instance.start();
    expect(mock.windows).toHaveLength(0);
    expect(mock.report).toHaveBeenCalledWith("Desktop companion", "Invalid selected spritesheet");
  });

  it("keeps activity publication available while the app finishes quitting", async () => {
    mock.settings.pet.enabled = true;
    const { instance } = controller();
    await instance.initialize();
    await instance.start();
    const destroy = vi.spyOn(mock.windows[0], "destroy");

    instance.beginShutdown();

    expect(destroy).toHaveBeenCalledOnce();
    expect([...mock.handlers.keys()]).toEqual(["paseo:pet:publishActivity"]);
    expect(mock.subscribers.size).toBe(0);
    const publish = mock.handlers.get("paseo:pet:publishActivity")!;
    const mainFrame = {};
    expect(
      publish(
        { sender: { id: 12, main: true, mainFrame }, senderFrame: mainFrame },
        DEFAULT_PET_ACTIVITY,
      ),
    ).toEqual({ revalidate: [] });
    expect(mock.patch).not.toHaveBeenCalled();
  });

  it("fully disposes overlay and handlers without requesting a settings write", async () => {
    mock.settings.pet.enabled = true;
    const { instance } = controller();
    await instance.initialize();
    await instance.start();
    const destroy = vi.spyOn(mock.windows[0], "destroy");
    instance.dispose();
    expect(destroy).toHaveBeenCalledOnce();
    expect(mock.handlers.size).toBe(0);
    expect(mock.subscribers.size).toBe(0);
    expect(mock.patch).not.toHaveBeenCalled();
  });
});

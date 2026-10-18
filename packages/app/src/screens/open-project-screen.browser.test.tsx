import React, { act, createElement } from "react";
import type { ComponentType } from "react";
import { createRoot } from "react-dom/client";
import type { Root } from "react-dom/client";
import { View as NativeView } from "react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { userEvent } from "vitest/browser";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { saveAppSettings } from "@/hooks/use-settings";
import {
  APP_SETTINGS_KEY,
  APP_SETTINGS_QUERY_KEY,
  DEFAULT_CLIENT_SETTINGS,
} from "@/hooks/use-settings/storage";
import type { AppSettings } from "@/hooks/use-settings/storage";
import { darkTheme, lightTheme } from "@/styles/theme";
import type { Theme } from "@/styles/theme";
import { OpenProjectScreen } from "./open-project-screen";

const state = vi.hoisted(() => ({
  values: new Map<string, string>(),
  pendingRead: null as Promise<string | null> | null,
  theme: null as Theme | null,
  openPicker: vi.fn(),
  openAgentList: vi.fn(),
  push: vi.fn(),
  initPoster: vi.fn(async () => undefined),
  createStencil: vi.fn(),
  freeStencil: vi.fn(),
}));

// Keep the real settings hook, persistence path, homepage, switch and tiles. Only the
// desktop/runtime boundaries and GPU renderer are replaced for this browser regression.
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => state.pendingRead ?? state.values.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      state.values.set(key, value);
    },
    removeItem: async (key: string) => {
      state.values.delete(key);
    },
  },
}));
vi.mock("@/desktop/host", () => ({
  isElectronRuntime: () => false,
  isElectronRuntimeMac: () => false,
  getDesktopHost: () => null,
}));
vi.mock("@/desktop/settings/desktop-settings", () => ({
  DEFAULT_DESKTOP_SETTINGS: {},
  loadDesktopSettings: vi.fn(),
  migrateLegacyDesktopSettings: vi.fn(),
  useDesktopSettings: vi.fn(),
}));
vi.mock("@/wallpaper/desktop-client", () => ({ importLegacyWallpaper: vi.fn() }));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => (key === "openProject.motion.accessibilityLabel" ? "Home animations" : key),
  }),
}));
vi.mock("expo-router", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("@/hooks/use-open-add-project", () => ({ useOpenAddProject: () => state.openPicker }));
vi.mock("@/hooks/use-is-local-daemon", () => ({ useLocalDaemonServerId: () => "local-test" }));
vi.mock("@/hooks/use-open-project", () => ({ useOpenProject: () => vi.fn() }));
vi.mock("@/runtime/host-runtime", () => ({
  useHosts: () => [],
  useHostRuntimeClient: () => null,
}));
vi.mock("@/stores/panel-store", () => ({
  usePanelStore: (selector: (store: { openDesktopAgentList: () => void }) => unknown) =>
    selector({ openDesktopAgentList: state.openAgentList }),
}));
vi.mock("@/components/headers/menu-header", () => ({ MenuHeader: () => null }));
vi.mock("@/components/desktop/titlebar-drag-region", () => ({ TitlebarDragRegion: () => null }));
vi.mock("@/components/import-session-sheet", () => ({ ImportSessionSheet: () => null }));
vi.mock("react-native-reanimated", () => ({
  default: {
    View: (props: React.ComponentProps<typeof NativeView>) => createElement(NativeView, props),
  },
  Easing: { ease: "ease", inOut: (value: unknown) => value },
  interpolateColor: (value: number, _input: number[], output: string[]) =>
    value >= 1 ? output[1] : output[0],
  useAnimatedStyle: (factory: () => unknown) => factory(),
  useDerivedValue: (factory: () => unknown) => ({ value: factory() }),
  withTiming: (value: unknown) => value,
}));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: {
    create: <T extends object>(styles: T | ((theme: Theme) => T)): T => {
      if (typeof styles !== "function") return styles;
      // Defer theme evaluation until render, after the test selects a real app theme.
      const factory = styles as (theme: Theme) => T;
      return new Proxy({} as T, {
        get: (_target, property) => Reflect.get(factory(state.theme!), property),
      });
    },
  },
  useUnistyles: () => ({ theme: state.theme!, rt: { breakpoint: "md" } }),
  withUnistyles:
    <Props extends object>(
      Component: ComponentType<Props>,
      mapTheme?: (theme: Theme) => Partial<Props>,
    ) =>
    (props: Props) =>
      createElement(Component, { ...mapTheme?.(state.theme!), ...props }),
}));

let container: HTMLDivElement;
let root: Root;
let queryClient: QueryClient;
let gpuDescriptor: PropertyDescriptor | undefined;

beforeEach(() => {
  vi.stubGlobal("React", React);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  state.values.clear();
  state.pendingRead = null;
  state.theme = darkTheme;
  state.createStencil.mockImplementation(() => ({
    free: state.freeStencil,
    render: vi.fn(),
    resize: vi.fn(),
  }));
  window.__OMP_POSTER_MODULE__ = {
    enabled: true,
    init: state.initPoster,
    createStencil: state.createStencil,
  };
  gpuDescriptor = Object.getOwnPropertyDescriptor(navigator, "gpu");
  Object.defineProperty(navigator, "gpu", { configurable: true, value: {} });
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  container = document.createElement("div");
  container.style.cssText = "width: 1000px; height: 800px; display: flex";
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  await queryClient.cancelQueries();
  queryClient.clear();
  container.remove();
  delete window.__OMP_POSTER_MODULE__;
  if (gpuDescriptor) Object.defineProperty(navigator, "gpu", gpuDescriptor);
  else Reflect.deleteProperty(navigator, "gpu");
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function renderHome(settings?: Partial<AppSettings>): Promise<void> {
  if (settings) {
    const initialSettings = { ...DEFAULT_CLIENT_SETTINGS, ...settings };
    state.values.set(APP_SETTINGS_KEY, JSON.stringify(initialSettings));
    queryClient.setQueryData(APP_SETTINGS_QUERY_KEY, initialSettings);
  }
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <OpenProjectScreen />
      </QueryClientProvider>,
    );
  });
}

function homeBackground(): string {
  return getComputedStyle(container.firstElementChild!).backgroundImage;
}

function motionSwitch(): HTMLElement | null {
  return container.querySelector<HTMLElement>('[role="switch"][aria-label="Home animations"]');
}

function hasScanlines(): boolean {
  return [...container.querySelectorAll("div")].some((element) =>
    getComputedStyle(element).backgroundImage.includes("repeating-linear-gradient"),
  );
}

async function setWallpaperEnabled(wallpaperEnabled: boolean): Promise<void> {
  await act(async () => saveAppSettings({ queryClient, updates: { wallpaperEnabled } }));
  await vi.waitFor(() => {
    expect(motionSwitch() !== null).toBe(!wallpaperEnabled);
  });
}

it.each([true, false])(
  "hides wallpaper-conflicting effects and restores the saved animation choice (%s)",
  async (storedPreference) => {
    await renderHome({ wallpaperEnabled: false, homeAnimationsEnabled: storedPreference });
    expect(motionSwitch()?.getAttribute("aria-checked")).toBe(String(storedPreference));
    expect(homeBackground()).toContain("radial-gradient");
    expect(hasScanlines()).toBe(true);
    if (storedPreference)
      await vi.waitFor(() => expect(state.createStencil).toHaveBeenCalledOnce());

    // Exercise the actual switch and save path, not just an injected render prop.
    await act(async () => userEvent.click(motionSwitch()!));
    const chosenPreference = !storedPreference;
    await vi.waitFor(() => {
      expect(motionSwitch()?.getAttribute("aria-checked")).toBe(String(chosenPreference));
      expect(JSON.parse(state.values.get(APP_SETTINGS_KEY)!).homeAnimationsEnabled).toBe(
        chosenPreference,
      );
    });
    if (chosenPreference)
      await vi.waitFor(() => expect(state.createStencil).toHaveBeenCalledOnce());
    expect(container.querySelector("canvas") !== null).toBe(chosenPreference);

    await setWallpaperEnabled(true);
    expect(motionSwitch()).toBeNull();
    expect(container.querySelector('[data-testid="omp-dot-cloud"]')).toBeNull();
    expect(container.querySelector("canvas")).toBeNull();
    expect(hasScanlines()).toBe(false);
    expect(homeBackground()).toBe("none");
    expect(state.freeStencil).toHaveBeenCalledOnce();
    expect(JSON.parse(state.values.get(APP_SETTINGS_KEY)!).homeAnimationsEnabled).toBe(
      chosenPreference,
    );

    const addProject = container.querySelector<HTMLElement>('[data-testid="open-project-submit"]')!;
    const providers = container.querySelector<HTMLElement>(
      '[data-testid="open-project-providers"]',
    )!;
    await act(async () => userEvent.hover(addProject));
    expect(getComputedStyle(addProject).boxShadow).not.toContain("rgba(0, 0, 0, 0)");
    expect(getComputedStyle(addProject).transitionProperty).not.toContain("transform");
    await act(async () => userEvent.click(addProject));
    await act(async () => userEvent.click(providers));
    expect(state.openPicker).toHaveBeenCalledOnce();
    expect(state.push).toHaveBeenCalledOnce();

    await setWallpaperEnabled(false);
    expect(motionSwitch()?.getAttribute("aria-checked")).toBe(String(chosenPreference));
    expect(homeBackground()).toContain("radial-gradient");
    expect(getComputedStyle(addProject).transitionProperty.includes("transform")).toBe(
      chosenPreference,
    );
    expect(hasScanlines()).toBe(true);
    await vi.waitFor(() => {
      expect(container.querySelector("canvas") !== null).toBe(chosenPreference);
      expect(state.createStencil).toHaveBeenCalledTimes(chosenPreference ? 2 : 1);
    });

    await setWallpaperEnabled(true);
    expect(motionSwitch()).toBeNull();
    expect(container.querySelector("canvas")).toBeNull();
    expect(hasScanlines()).toBe(false);
    expect(homeBackground()).toBe("none");
    expect(JSON.parse(state.values.get(APP_SETTINGS_KEY)!).homeAnimationsEnabled).toBe(
      chosenPreference,
    );
  },
);

it("does not flash a switch or initialize the poster before wallpaper settings load", async () => {
  const { promise, resolve: finishRead } = Promise.withResolvers<string | null>();
  state.pendingRead = promise;
  await renderHome();
  expect(motionSwitch()).toBeNull();
  expect(hasScanlines()).toBe(false);
  expect(homeBackground()).toBe("none");
  expect(container.querySelector("canvas")).toBeNull();
  expect(state.initPoster).not.toHaveBeenCalled();

  await act(async () => {
    finishRead(JSON.stringify({ ...DEFAULT_CLIENT_SETTINGS, wallpaperEnabled: true }));
  });
  await vi.waitFor(() => {
    expect(queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY)?.wallpaperEnabled).toBe(
      true,
    );
  });
  expect(motionSwitch()).toBeNull();
  expect(hasScanlines()).toBe(false);
  expect(state.initPoster).not.toHaveBeenCalled();
  state.pendingRead = null;
  await setWallpaperEnabled(false);
  expect(motionSwitch()?.getAttribute("aria-checked")).toBe("true");
});

it("retains light-theme behavior when wallpaper is disabled again", async () => {
  state.theme = lightTheme;
  await renderHome({ wallpaperEnabled: true, homeAnimationsEnabled: true });
  expect(motionSwitch()).toBeNull();
  await setWallpaperEnabled(false);
  expect(motionSwitch()?.getAttribute("aria-checked")).toBe("true");
  expect(container.querySelector('[data-testid="omp-dot-cloud"]')).toBeNull();
  expect(container.querySelector("canvas")).toBeNull();
  expect(hasScanlines()).toBe(false);
  expect(homeBackground()).toBe("none");
  expect(state.initPoster).not.toHaveBeenCalled();
});

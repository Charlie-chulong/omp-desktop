import { contextBridge, ipcRenderer } from "electron";
import type { OmpMonitorScope } from "./types.js";
import type { OmpMonitorExportResult, OmpMonitorViewState } from "./view-types.js";

// Sandboxed preloads must not require any runtime module except Electron.
contextBridge.exposeInMainWorld("ompMonitor", {
  ready: (): Promise<OmpMonitorViewState> => ipcRenderer.invoke("paseo:monitor:ready"),
  refresh: (): Promise<void> => ipcRenderer.invoke("paseo:monitor:refresh"),
  setCompact: (compact: boolean): Promise<void> =>
    ipcRenderer.invoke("paseo:monitor:compact", compact),
  setPinned: (pinned: boolean): Promise<void> => ipcRenderer.invoke("paseo:monitor:pinned", pinned),
  setScope: (scope: OmpMonitorScope): Promise<void> =>
    ipcRenderer.invoke("paseo:monitor:scope", scope),
  newWindow: (): Promise<void> => ipcRenderer.invoke("paseo:monitor:new-window"),
  exportCsv: (): Promise<OmpMonitorExportResult> => ipcRenderer.invoke("paseo:monitor:export-csv"),
  setNetworkEnabled: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke("paseo:monitor:network-enabled", enabled),
  setCurrency: (currency: string): Promise<void> =>
    ipcRenderer.invoke("paseo:monitor:currency", currency),
  refreshPublicData: (): Promise<void> => ipcRenderer.invoke("paseo:monitor:refresh-public-data"),
  close: (): Promise<void> => ipcRenderer.invoke("paseo:monitor:close"),
  onState: (listener: (state: OmpMonitorViewState) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: OmpMonitorViewState) =>
      listener(state);
    ipcRenderer.on("paseo:monitor:state", handler);
    return () => ipcRenderer.removeListener("paseo:monitor:state", handler);
  },
});

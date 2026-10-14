import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("ompPet", {
  ready: () => ipcRenderer.invoke("paseo:pet:ready"),
  open: () => ipcRenderer.invoke("paseo:pet:open"),
  menu: () => ipcRenderer.invoke("paseo:pet:menu"),
  dragStart: () => ipcRenderer.invoke("paseo:pet:drag-start"),
  dragEnd: () => ipcRenderer.invoke("paseo:pet:drag-end"),
  interactive: (interactive: boolean) => ipcRenderer.send("paseo:pet:interactive", interactive),
  reportError: (message: string) => ipcRenderer.invoke("paseo:pet:error", message),
  onState: (listener: (state: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown) => listener(state);
    ipcRenderer.on("paseo:pet:state", handler);
    return () => ipcRenderer.removeListener("paseo:pet:state", handler);
  },
  onPointer: (listener: (point: { x: number; y: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, point: { x: number; y: number }) =>
      listener(point);
    ipcRenderer.on("paseo:pet:pointer", handler);
    return () => ipcRenderer.removeListener("paseo:pet:pointer", handler);
  },
});

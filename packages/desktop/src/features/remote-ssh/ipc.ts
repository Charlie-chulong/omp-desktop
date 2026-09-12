import { app, ipcMain, type IpcMainInvokeEvent } from "electron";
import { parseRelayAddress } from "@omp-desktop/protocol/connection-offer";
import { RemoteSshDeployment } from "./installer.js";
import { createRemoteSshProfileStore } from "./profile-store.js";
import {
  RemoteSshInputSchema,
  RemoteSshOperationInputSchema,
  RemoteSshProfileInputSchema,
  RemoteSshServerIdInputSchema,
  RemoteSshStartInputSchema,
} from "./types.js";

interface OwnedOperation {
  ownerId: number;
  deployment: RemoteSshDeployment;
}

export function registerRemoteSshHandlers(): void {
  const operations = new Map<string, OwnedOperation>();
  const profiles = createRemoteSshProfileStore(app.getPath("userData"));

  ipcMain.handle("paseo:remote-ssh:start", async (event, payload: unknown) => {
    const input = RemoteSshStartInputSchema.parse(payload);
    if (input.relayAddress) parseRelayAddress(input.relayAddress, true);
    if (operations.has(input.operationId)) throw new Error("SSH operation already exists");
    const deployment = new RemoteSshDeployment(input, (remoteEvent) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send("paseo:event:remote-ssh", remoteEvent);
      }
    });
    operations.set(input.operationId, { ownerId: event.sender.id, deployment });
    const handleDestroyed = () => deployment.cancel();
    event.sender.once("destroyed", handleDestroyed);
    try {
      return await deployment.run();
    } finally {
      event.sender.removeListener("destroyed", handleDestroyed);
      operations.delete(input.operationId);
    }
  });

  ipcMain.handle("paseo:remote-ssh:write-input", (event, payload: unknown) => {
    const input = RemoteSshInputSchema.parse(payload);
    getOwnedOperation(operations, input.operationId, event).deployment.writeInput(input.input);
  });

  ipcMain.handle("paseo:remote-ssh:cancel", (event, payload: unknown) => {
    const input = RemoteSshOperationInputSchema.parse(payload);
    getOwnedOperation(operations, input.operationId, event).deployment.cancel();
  });

  ipcMain.handle("paseo:remote-ssh:profile:get", async (_event, payload: unknown) => {
    const input = RemoteSshServerIdInputSchema.parse(payload);
    return profiles.get(input.serverId);
  });

  ipcMain.handle("paseo:remote-ssh:profile:save", async (_event, payload: unknown) => {
    const input = RemoteSshProfileInputSchema.parse(payload);
    await profiles.save(input);
  });

  ipcMain.handle("paseo:remote-ssh:profile:remove", async (_event, payload: unknown) => {
    const input = RemoteSshServerIdInputSchema.parse(payload);
    await profiles.remove(input.serverId);
  });
}

function getOwnedOperation(
  operations: ReadonlyMap<string, OwnedOperation>,
  operationId: string,
  event: IpcMainInvokeEvent,
): OwnedOperation {
  const operation = operations.get(operationId);
  if (!operation || operation.ownerId !== event.sender.id) {
    throw new Error("SSH operation does not belong to this window");
  }
  return operation;
}

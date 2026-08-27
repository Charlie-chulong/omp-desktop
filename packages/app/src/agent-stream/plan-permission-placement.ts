import type { PendingPermission } from "@/types/shared";
import type { StreamItem } from "@/types/stream";

export interface PlanPermissionPlacement {
  permissionByItemId: ReadonlyMap<string, PendingPermission>;
  embeddedPermissionKeys: ReadonlySet<string>;
}

export function placePlanPermissions(
  items: readonly StreamItem[],
  pendingPermissions: readonly PendingPermission[],
): PlanPermissionPlacement {
  const planItems = items.filter(
    (item): item is Extract<StreamItem, { kind: "assistant_message" }> =>
      item.kind === "assistant_message" && item.presentation === "plan",
  );
  const planPermissions = pendingPermissions.filter(
    (permission) => permission.request.kind === "plan",
  );
  const permissionByMessageId = new Map<string, PendingPermission>();
  for (const permission of planPermissions) {
    const planMessageId = permission.request.metadata?.["planMessageId"];
    if (typeof planMessageId === "string") {
      permissionByMessageId.set(planMessageId, permission);
    }
  }

  const permissionByItemId = new Map<string, PendingPermission>();
  const embeddedPermissionKeys = new Set<string>();
  for (const item of planItems) {
    if (!item.messageId) {
      continue;
    }
    const permission = permissionByMessageId.get(item.messageId);
    if (!permission || embeddedPermissionKeys.has(permission.key)) {
      continue;
    }
    permissionByItemId.set(item.id, permission);
    embeddedPermissionKeys.add(permission.key);
  }

  const latestUnmatchedItem = planItems.findLast((item) => !permissionByItemId.has(item.id));
  const latestUnmatchedPermission = planPermissions.findLast(
    (permission) => !embeddedPermissionKeys.has(permission.key),
  );
  if (latestUnmatchedItem && latestUnmatchedPermission) {
    permissionByItemId.set(latestUnmatchedItem.id, latestUnmatchedPermission);
    embeddedPermissionKeys.add(latestUnmatchedPermission.key);
  }

  return { permissionByItemId, embeddedPermissionKeys };
}

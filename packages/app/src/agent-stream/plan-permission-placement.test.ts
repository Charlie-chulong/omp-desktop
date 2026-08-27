import { describe, expect, it } from "vitest";
import type { PendingPermission } from "@/types/shared";
import type { StreamItem } from "@/types/stream";
import { placePlanPermissions } from "./plan-permission-placement";

function planItem(id: string, messageId: string): StreamItem {
  return {
    kind: "assistant_message",
    id,
    messageId,
    presentation: "plan",
    text: "Plan body",
    timestamp: new Date("2026-08-26T08:36:41.000Z"),
  };
}

function planPermission(key: string, planMessageId: string): PendingPermission {
  return {
    key,
    agentId: "agent-1",
    request: {
      id: key,
      provider: "omp",
      name: "OmpPlanApproval",
      kind: "plan",
      metadata: { planMessageId },
    },
  };
}

describe("placePlanPermissions", () => {
  it("embeds a permission into the plan with the same provider message id", () => {
    const item = planItem("plan-item", "message-1");
    const permission = planPermission("permission-1", "message-1");

    const placement = placePlanPermissions([item], [permission]);

    expect(placement.permissionByItemId.get(item.id)).toBe(permission);
    expect(placement.embeddedPermissionKeys).toEqual(new Set([permission.key]));
  });

  it("falls back to the latest plan when terminal and streamed message ids differ", () => {
    const item = planItem("plan-item", "stream-message-id");
    const permission = planPermission("permission-1", "terminal-message-id");

    const placement = placePlanPermissions([item], [permission]);

    expect(placement.permissionByItemId.get(item.id)).toBe(permission);
    expect(placement.embeddedPermissionKeys).toEqual(new Set([permission.key]));
  });

  it("does not hide older unmatched permissions when only the latest plan can host one", () => {
    const item = planItem("plan-item", "stream-message-id");
    const older = planPermission("permission-older", "terminal-older");
    const latest = planPermission("permission-latest", "terminal-latest");

    const placement = placePlanPermissions([item], [older, latest]);

    expect(placement.permissionByItemId.get(item.id)).toBe(latest);
    expect(placement.embeddedPermissionKeys).toEqual(new Set([latest.key]));
  });
});

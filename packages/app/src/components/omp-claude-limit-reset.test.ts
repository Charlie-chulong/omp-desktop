import type {
  OmpClaudeLimitResetConsumeResult,
  OmpClaudeLimitResetGrant,
  OmpClaudeLimitResets,
  OmpProviderManagement,
} from "@omp-desktop/protocol/messages";
import { describe, expect, test, vi } from "vitest";
import {
  ClaudeLimitResetActions,
  claudeGrantState,
  claudeResetCount,
  claudeResetRefreshTimes,
} from "./omp-claude-limit-reset";

const now = Date.now();
const grant: OmpClaudeLimitResetGrant = {
  id: "grant-1",
  label: null,
  resetsTotal: 3,
  resetsLeft: 3,
  startsAt: null,
  endsAt: new Date(now + 86_400_000).toISOString(),
  clears: ["five_hour"],
  paused: false,
  usableNow: true,
  useRequiresLimit: true,
  blocking: [],
  givesBackWeekly: false,
};
function inventory(overrides: Partial<OmpClaudeLimitResets> = {}): OmpClaudeLimitResets {
  return {
    status: "available",
    eligible: true,
    availableCount: 3,
    grants: [grant],
    nextGrantId: grant.id,
    atLimit: true,
    exhausted: ["five_hour"],
    cooldownUntil: null,
    ineligibleReason: null,
    ...overrides,
  };
}
function management(value = inventory(), credentialId = 5): OmpProviderManagement {
  return {
    configPath: "/tmp/models.yml",
    configYaml: "",
    providerModels: [],
    loginProviders: [
      {
        id: "anthropic",
        name: "Claude",
        available: true,
        authenticated: true,
        accounts: [{ credentialId, quota: { status: "available", limitResets: value } }],
      },
    ],
  };
}
function result(
  kind: OmpClaudeLimitResetConsumeResult["result"] = "reset",
): OmpClaudeLimitResetConsumeResult {
  return {
    result: kind,
    reason: null,
    resetsLeft: null,
    cleared: kind === "reset" ? ["five_hour"] : [],
    weeklyResetsAt: null,
    cooldownUntil: null,
  };
}
function action() {
  return {
    serverId: "server",
    credentialId: 5,
    grant,
    isCurrent: vi.fn(() => true),
    confirm: vi.fn(async () => true),
    refresh: vi.fn(async (_afterMutation: boolean) => management()),
    consume: vi.fn(async (_requestId: string) => result()),
  };
}

describe("Claude reset inventory and permission", () => {
  test("refreshes only boundaries not yet reflected in the observed snapshot", () => {
    const before = new Date(now - 1000).toISOString();
    const crossing = new Date(now + 1000).toISOString();
    const stock = inventory({
      cooldownUntil: crossing,
      grants: [
        { ...grant, startsAt: before, endsAt: crossing },
        { ...grant, id: "old", endsAt: before },
      ],
    });
    expect(claudeResetRefreshTimes(stock, now)).not.toContain(before);
    // Keep a newly crossed boundary scheduled until a refreshed snapshot observes it.
    expect(claudeResetRefreshTimes(stock, now)).toContain(crossing);
    expect(claudeResetRefreshTimes(stock, now + 60_000)).toEqual([]);
    expect(claudeResetRefreshTimes(undefined, now)).toEqual([]);
    expect(claudeResetRefreshTimes(stock, Number.NaN)).toEqual([]);
    expect(claudeGrantState(stock, stock.grants[0], now + 1000)).toBe("expired");
  });
  test("counts held uses rather than records or permission, and expires locally", () => {
    const held = inventory({
      eligible: false,
      grants: [{ ...grant, usableNow: false }],
      availableCount: 3,
    });
    expect(claudeResetCount(held, now)).toBe(3);
    expect(claudeGrantState(held, held.grants[0], now)).toBe("ineligible");
    expect(claudeResetCount(held, now + 86_400_000)).toBe(0);
    expect(claudeResetCount(undefined, now)).toBeNull();
    expect(claudeResetCount(inventory({ availableCount: null }), now)).toBeNull();
    expect(claudeResetCount(inventory({ grants: [], availableCount: 0 }), now)).toBe(0);
    expect(
      claudeResetCount(inventory({ status: "unavailable", availableCount: 0 }), now),
    ).toBeNull();
  });
  test.each([
    ["expired", { endsAt: new Date(now).toISOString() }, {}],
    ["notStarted", { startsAt: new Date(now + 1000).toISOString() }, {}],
    ["paused", { paused: true }, {}],
    ["empty", { resetsLeft: 0 }, {}],
    ["unusable", { usableNow: false }, {}],
    ["unusable", { clears: [] }, {}],
    ["cooldown", {}, { cooldownUntil: new Date(now + 1000).toISOString() }],
    ["cooldown", {}, { cooldownUntil: "malformed" }],
    ["unknownEligibility", {}, { eligible: null }],
    ["limitRequired", {}, { atLimit: false, exhausted: ["seven_day"] }],
    ["limitRequired", {}, { atLimit: false, exhausted: ["five_hour"] }],
    ["limitRequired", {}, { atLimit: true, exhausted: ["seven_day"] }],
    ["limitRequired", {}, { atLimit: true, exhausted: [] }],
    ["blocked", { blocking: ["seven_day"] }, {}],
  ] satisfies [string, Partial<OmpClaudeLimitResetGrant>, Partial<OmpClaudeLimitResets>][])(
    "reports %s without granting count-based permission",
    (state, change, stock) => {
      expect(claudeGrantState(inventory(stock), { ...grant, ...change }, now)).toBe(state);
    },
  );
  test("allows exhausted overlap and only blocks scopes the grant does not clear", () => {
    expect(claudeGrantState(inventory(), { ...grant, blocking: ["five_hour"] }, now)).toBe(
      "active",
    );
    expect(
      claudeGrantState(inventory(), { ...grant, blocking: ["five_hour", "seven_day"] }, now),
    ).toBe("blocked");
    const weeklyReturn = { ...grant, givesBackWeekly: true, blocking: ["seven_day"] };
    expect(claudeGrantState(inventory({ exhausted: ["seven_day"] }), weeklyReturn, now)).toBe(
      "active",
    );
    expect(
      claudeGrantState(inventory({ exhausted: ["seven_day_sonnet"] }), weeklyReturn, now),
    ).toBe("limitRequired");
    expect(
      claudeGrantState(inventory(), { ...weeklyReturn, blocking: ["seven_day_opus"] }, now),
    ).toBe("blocked");
    const weeklyOnly = { ...grant, clears: [], givesBackWeekly: true };
    expect(claudeGrantState(inventory({ exhausted: ["seven_day"] }), weeklyOnly, now)).toBe(
      "active",
    );
  });
});

describe("Claude explicit reset actions", () => {
  test("cancellation and account/server switch during confirmation never consume", async () => {
    for (const switched of [false, true]) {
      const controller = new ClaudeLimitResetActions();
      const request = action();
      const dialog = Promise.withResolvers<boolean>();
      request.confirm.mockImplementation(() => dialog.promise);
      const pending = controller.run(request);
      if (switched) request.isCurrent.mockReturnValue(false);
      dialog.resolve(switched);
      expect(await pending).toEqual({});
      expect(request.refresh).not.toHaveBeenCalled();
      expect(request.consume).not.toHaveBeenCalled();
      expect(controller.isBusy("server", 5)).toBe(false);
    }
  });
  test("switch during the fresh lookup prevents the mutation", async () => {
    const controller = new ClaudeLimitResetActions();
    const request = action();
    const fresh = Promise.withResolvers<OmpProviderManagement>();
    request.refresh.mockImplementation(() => fresh.promise);
    const started = Promise.withResolvers<void>();
    request.confirm.mockImplementation(async () => {
      started.resolve();
      return true;
    });
    const pending = controller.run(request);
    await started.promise;
    request.isCurrent.mockReturnValue(false);
    fresh.resolve(management());
    await pending;
    expect(request.consume).not.toHaveBeenCalled();
  });
  test("rapid clicks and separate consumers share the account lock", async () => {
    const controller = new ClaudeLimitResetActions();
    const request = action();
    const dialog = Promise.withResolvers<boolean>();
    request.confirm.mockImplementation(() => dialog.promise);
    const pending = controller.run(request);
    expect(controller.isBusy("server", 5)).toBe(true);
    const duplicate = action();
    await controller.run(duplicate);
    expect(duplicate.confirm).not.toHaveBeenCalled();
    expect(duplicate.consume).not.toHaveBeenCalled();
    expect(request.confirm).toHaveBeenCalledOnce();
    dialog.resolve(true);
    await pending;
    expect(request.consume).toHaveBeenCalledOnce();
    expect(controller.isBusy("server", 5)).toBe(false);
  });
  test.each([
    inventory({ grants: [], availableCount: 0 }),
    inventory({ eligible: false }),
    inventory({ eligible: null }),
    inventory({ grants: [{ ...grant, endsAt: new Date(now - 1).toISOString() }] }),
    inventory({ grants: [{ ...grant, startsAt: new Date(now + 86_400_000).toISOString() }] }),
    inventory({ cooldownUntil: new Date(now + 86_400_000).toISOString() }),
    inventory({ atLimit: false, exhausted: [] }),
    inventory({ grants: [{ ...grant, blocking: ["seven_day"] }] }),
    inventory({ grants: [{ ...grant, clears: ["seven_day"] }] }),
    inventory({ grants: [{ ...grant, givesBackWeekly: true }] }),
  ])("rejects fresh ineligibility or changed confirmation scope", async (fresh) => {
    const request = action();
    request.refresh.mockResolvedValue(management(fresh));
    expect(await new ClaudeLimitResetActions().run(request)).toEqual({ changed: true });
    expect(request.consume).not.toHaveBeenCalled();
  });
  test("account disappearance and failed fresh refresh never send a POST", async () => {
    const missing = action();
    missing.refresh.mockResolvedValue(management(inventory(), 6));
    expect(await new ClaudeLimitResetActions().run(missing)).toEqual({ changed: true });
    expect(missing.consume).not.toHaveBeenCalled();
    const failed = action();
    const error = new Error("refresh offline");
    failed.refresh.mockRejectedValue(error);
    expect(await new ClaudeLimitResetActions().run(failed)).toEqual({ error });
    expect(failed.consume).not.toHaveBeenCalled();
  });
  test("multi-use grants receive a new UUID only after real refreshed consumption", async () => {
    const controller = new ClaudeLimitResetActions();
    const request = action();
    let left = 3;
    request.refresh.mockImplementation(async () =>
      management(inventory({ grants: [{ ...grant, resetsLeft: left }], availableCount: left })),
    );
    request.consume.mockImplementation(async () => {
      left--;
      return { ...result(), resetsLeft: left };
    });
    expect((await controller.run(request)).result?.result).toBe("reset");
    expect(controller.isAwaitingRefresh("server", 5, grant.id)).toBe(false);
    expect((await controller.run(request)).result?.result).toBe("reset");
    expect(left).toBe(1);
    expect(request.consume.mock.calls[0][0]).not.toBe(request.consume.mock.calls[1][0]);
    expect(request.confirm).toHaveBeenCalledTimes(2);
    expect(request.refresh.mock.calls.map(([after]) => after)).toEqual([false, true, false, true]);
  });
  test("uncertain outcome never retries automatically and preserves UUID on explicit retry", async () => {
    const controller = new ClaudeLimitResetActions();
    const request = action();
    const error = new Error("unknown result");
    request.consume.mockRejectedValueOnce(error).mockResolvedValueOnce(result("already_used"));
    expect(await controller.run(request)).toMatchObject({ error });
    expect(request.consume).toHaveBeenCalledOnce();
    expect(request.refresh.mock.calls.map(([after]) => after)).toEqual([false, true]);
    const retry = await controller.run(request);
    expect(retry.result?.result).toBe("already_used");
    expect(request.consume.mock.calls[0][0]).toBe(request.consume.mock.calls[1][0]);
    expect(controller.isAwaitingRefresh("server", 5, grant.id)).toBe(true);
    expect(await controller.run(request)).toEqual({});
    expect(request.consume).toHaveBeenCalledTimes(2);
  });
  test("confirmed mutation with failed reconciliation stays blocked until a fresh lower balance", async () => {
    const controller = new ClaudeLimitResetActions();
    const request = action();
    const error = new Error("post-refresh offline");
    request.refresh.mockImplementation(async (after) => {
      if (after) throw error;
      return management();
    });
    expect(await controller.run(request)).toMatchObject({
      result: { result: "reset" },
      refreshError: error,
    });
    expect(await controller.run(request)).toEqual({});
    controller.reconcile("other-server", 5, inventory({ grants: [] }));
    controller.reconcile("server", 6, inventory({ grants: [] }));
    controller.reconcile("server", 5, inventory({ status: "error", grants: [] }));
    expect(controller.isAwaitingRefresh("server", 5, grant.id)).toBe(true);
    controller.reconcile("server", 5, inventory({ grants: [{ ...grant, resetsLeft: 2 }] }));
    expect(controller.isAwaitingRefresh("server", 5, grant.id)).toBe(false);
  });
  test("a disappeared consumed grant reconciles only its own account", async () => {
    const controller = new ClaudeLimitResetActions();
    await controller.run(action());
    controller.reconcile("server", 5, inventory({ grants: [], availableCount: 0 }));
    expect(controller.isAwaitingRefresh("server", 5, grant.id)).toBe(false);
  });
  test.each(["not_limited", "cooldown", "ineligible", "unavailable"] as const)(
    "%s remains a non-success and does not prevent a later explicitly confirmed action",
    async (kind) => {
      const controller = new ClaudeLimitResetActions();
      const request = action();
      request.consume.mockResolvedValue(result(kind));
      expect((await controller.run(request)).result?.result).toBe(kind);
      expect(controller.isAwaitingRefresh("server", 5, grant.id)).toBe(false);
      await controller.run(request);
      expect(request.consume.mock.calls[0][0]).not.toBe(request.consume.mock.calls[1][0]);
    },
  );
});

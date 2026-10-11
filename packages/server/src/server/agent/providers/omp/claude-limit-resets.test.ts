import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import type { ClaudeAccountQuotaCredential } from "./claude-account-quota.js";
import { consumeClaudeLimitReset, parseClaudeLimitResets } from "./claude-limit-resets.js";
import { CLAUDE_PROFILE_ENDPOINT } from "./claude-oauth-api.js";

const NOW = Date.parse("2026-10-11T00:00:00.000Z");
const ORGANIZATION = "11111111-1111-4111-8111-111111111111";
const OTHER_ORGANIZATION = "22222222-2222-4222-8222-222222222222";
const ACCOUNT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const credential: ClaudeAccountQuotaCredential = {
  accessToken: " selected-secret ",
  accountId: ACCOUNT,
  orgId: ORGANIZATION,
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

function grant(overrides: Record<string, unknown> = {}) {
  return {
    id: "selected_grant",
    label: "  One grant  ",
    resets_total: 3,
    resets_left: 2,
    starts_at: "2026-10-10T00:00:00Z",
    ends_at: "2026-10-12T00:00:00Z",
    clears: ["five_hour"],
    paused: false,
    usable_now: true,
    use_requires_limit: true,
    blocking: [],
    gives_back_weekly: false,
    ...overrides,
  };
}

function usage(overrides: Record<string, unknown> = {}) {
  return {
    cedar_ember: {
      eligible: true,
      at_limit: true,
      exhausted: ["five_hour"],
      grants: [grant()],
      next_grant_id: "selected_grant",
      cooldown_until: null,
      ...overrides,
    },
  };
}

function consume(
  fetchApi: typeof fetch,
  options: {
    credential?: ClaudeAccountQuotaCredential;
    grantId?: string;
    redeemRequestId?: string;
    now?: () => number;
    timeoutMs?: number;
  } = {},
) {
  return consumeClaudeLimitReset({
    credential,
    grantId: "selected_grant",
    redeemRequestId: "stable-request",
    fetch: fetchApi,
    now: () => NOW,
    ...options,
  });
}

const resetResult = {
  result: "reset",
  reason: null,
  resetsLeft: 1,
  cleared: ["five_hour"],
  weeklyResetsAt: null,
  cooldownUntil: null,
};

function redemptionFetch(
  payload: unknown,
  response: unknown = {
    result: "reset",
    resets_left: 1,
    cleared: ["five_hour"],
  },
) {
  return vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) =>
    json(init?.method === "POST" ? response : payload),
  );
}

function mutationCalls(fetchApi: Mock<typeof fetch>) {
  return fetchApi.mock.calls.filter(([, init]) => init?.method === "POST");
}

describe("parseClaudeLimitResets", () => {
  it("counts active reset quantity independently of eligibility, cooldown and usableNow", () => {
    const inventory = parseClaudeLimitResets(
      usage({
        eligible: false,
        ineligible_reason: "tenure",
        cooldown_until: "2026-10-11T01:00:00Z",
        grants: [
          grant({ id: "held", resets_total: 5, resets_left: 4, usable_now: false }),
          grant({ id: "started", starts_at: "2026-10-11T00:00:00Z" }),
          grant({ id: "future", starts_at: "2026-10-11T00:00:00.001Z" }),
          grant({ id: "paused", paused: true }),
          grant({ id: "expired", ends_at: "2026-10-11T00:00:00Z" }),
          grant({ id: "spent", resets_left: 0 }),
        ],
        next_grant_id: "held",
      }),
      NOW,
    );
    expect(inventory).toMatchObject({
      status: "available",
      eligible: false,
      ineligibleReason: "tenure",
      availableCount: 6,
      nextGrantId: "held",
      cooldownUntil: "2026-10-11T01:00:00.000Z",
    });
    expect(inventory.grants).toHaveLength(6);
    expect(inventory.grants[0]).toMatchObject({
      label: "One grant",
      usableNow: false,
      resetsLeft: 4,
    });
    expect(
      parseClaudeLimitResets(usage({ grants: [grant()] }), NOW + 86_400_000).availableCount,
    ).toBe(0);
  });

  it.each([undefined, null, {}, { cedar_ember: undefined }, { cedar_ember: null }])(
    "never turns missing inventory into zero: %j",
    (payload) => {
      expect(parseClaudeLimitResets(payload, NOW)).toMatchObject({
        status: "unavailable",
        availableCount: null,
        eligible: null,
        grants: [],
      });
    },
  );

  it.each([false, [], { eligible: "true" }, { eligible: true, cooldown_until: "2026-10-11" }])(
    "rejects malformed inventory: %j",
    (cedar_ember) => {
      expect(parseClaudeLimitResets({ cedar_ember }, NOW)).toMatchObject({
        status: "error",
        availableCount: null,
        eligible: null,
      });
    },
  );

  it.each([undefined, null, {}])(
    "keeps known eligibility when grants are absent or malformed: %j",
    (grants) => {
      expect(
        parseClaudeLimitResets(
          usage({ eligible: false, ineligible_reason: "tenure", grants }),
          NOW,
        ),
      ).toMatchObject({
        status: grants === undefined || grants === null ? "unavailable" : "error",
        eligible: false,
        ineligibleReason: "tenure",
        availableCount: null,
        grants: [],
      });
    },
  );

  it.each([true, false])(
    "treats only explicit empty grants as known zero, eligible=%s",
    (eligible) => {
      expect(
        parseClaudeLimitResets(usage({ eligible, ineligible_reason: "tenure", grants: [] }), NOW),
      ).toMatchObject({
        status: "available",
        eligible,
        ineligibleReason: "tenure",
        availableCount: 0,
        nextGrantId: null,
      });
    },
  );

  it.each([
    { resets_total: 0, resets_left: 0 },
    { resets_total: -1 },
    { resets_total: 1.5 },
    { resets_total: Number.MAX_SAFE_INTEGER + 1 },
    { resets_left: -1 },
    { resets_left: 4 },
    { resets_left: 1.5 },
    { resets_left: "2" },
    { id: "path/escape" },
    { id: "A" },
    { ends_at: "2026-10-12T00:00:00" },
    { starts_at: "not-a-date" },
    { blocking: [false] },
    { usable_now: "true" },
  ])("rejects invalid grant data instead of reporting zero: %j", (overrides) => {
    expect(parseClaudeLimitResets(usage({ grants: [grant(overrides)] }), NOW)).toMatchObject({
      status: "error",
      availableCount: null,
      grants: [],
    });
  });

  it("rejects duplicate grant IDs and unsafe aggregate quantities", () => {
    expect(parseClaudeLimitResets(usage({ grants: [grant(), grant()] }), NOW).status).toBe("error");
    expect(
      parseClaudeLimitResets(
        usage({
          grants: [
            grant({
              id: "large",
              resets_total: Number.MAX_SAFE_INTEGER,
              resets_left: Number.MAX_SAFE_INTEGER,
            }),
            grant({ id: "overflow", resets_total: 1, resets_left: 1 }),
          ],
        }),
        NOW,
      ),
    ).toMatchObject({ status: "error", availableCount: null });
  });

  it("preserves native selection without inventing an unknown next grant", () => {
    const grants = [grant({ id: "second" }), grant({ id: "first" })];
    expect(parseClaudeLimitResets(usage({ grants, next_grant_id: "first" }), NOW).nextGrantId).toBe(
      "first",
    );
    expect(
      parseClaudeLimitResets(usage({ grants, next_grant_id: "missing" }), NOW).nextGrantId,
    ).toBeNull();
  });
});

describe("consumeClaudeLimitReset", () => {
  it("freshly authorizes the chosen grouped grant, not merely nextGrantId, and sends one native mutation intent", async () => {
    const fetchApi = redemptionFetch(
      usage({
        grants: [grant({ id: "native_next" }), grant()],
        next_grant_id: "native_next",
      }),
    );
    await expect(consume(fetchApi)).resolves.toEqual(resetResult);
    expect(fetchApi).toHaveBeenCalledTimes(2);
    const mutation = mutationCalls(fetchApi)[0];
    if (!mutation) throw new Error("Expected one native mutation");
    const [url, init] = mutation;
    expect(String(url)).toContain(`/organizations/${ORGANIZATION}/reset_rate_limits`);
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer selected-secret");
    expect(JSON.parse(String(init?.body))).toEqual({
      program: "cedar_ember",
      grant_id: "selected_grant",
      request_id: "stable-request",
    });
    expect(mutationCalls(fetchApi)).toHaveLength(1);
  });
  it.each([
    { payload: {}, status: "unavailable" },
    { payload: { cedar_ember: null }, status: "unavailable" },
    { payload: { cedar_ember: { eligible: true, grants: [{}] } }, status: "malformed" },
  ])("does not consume unknown fresh inventory: $status", async ({ payload }) => {
    const fetchApi = redemptionFetch(payload);
    await expect(consume(fetchApi)).rejects.toThrow();
    expect(mutationCalls(fetchApi)).toHaveLength(0);
  });

  it.each([
    { name: "not started", grant: { starts_at: "2026-10-11T00:00:00.001Z" } },
    { name: "expired exactly now", grant: { ends_at: "2026-10-11T00:00:00Z" } },
    { name: "paused", grant: { paused: true } },
    { name: "no balance", grant: { resets_left: 0 } },
    { name: "unusable", grant: { usable_now: false } },
    { name: "empty effects", grant: { clears: [] } },
    { name: "blocking outside effects", grant: { blocking: ["seven_day"] } },
    { name: "cooldown active", inventory: { cooldown_until: "2026-10-11T00:00:00.001Z" } },
    { name: "not at limit", inventory: { at_limit: false } },
    { name: "no exhausted limit", inventory: { exhausted: [] } },
    { name: "unrelated exhausted limit", inventory: { exhausted: ["seven_day_opus"] } },
    {
      name: "no implicit weekly model effect",
      grant: { gives_back_weekly: true },
      inventory: { exhausted: ["seven_day_opus"] },
    },
    {
      name: "weekly model still blocks",
      grant: { gives_back_weekly: true, blocking: ["seven_day_sonnet"] },
    },
    {
      name: "weekly overage still blocks",
      grant: { gives_back_weekly: true, blocking: ["seven_day_overage"] },
    },
    { name: "ineligible", inventory: { eligible: false } },
    { name: "missing selected grant", inventory: { grants: [grant({ id: "other" })] } },
    { name: "empty grants", inventory: { grants: [] } },
  ])("does not mutate for $name", async (entry) => {
    const fetchApi = redemptionFetch(usage({ grants: [grant(entry.grant)], ...entry.inventory }));
    await expect(consume(fetchApi)).rejects.toThrow("not usable");
    expect(mutationCalls(fetchApi)).toHaveLength(0);
  });

  it.each([
    { name: "start inclusive", grant: { starts_at: "2026-10-11T00:00:00Z" } },
    { name: "end not yet reached", grant: { ends_at: "2026-10-11T00:00:00.001Z" } },
    { name: "cooldown inclusive", inventory: { cooldown_until: "2026-10-11T00:00:00Z" } },
    { name: "blocking cleared by reset", grant: { blocking: ["five_hour"] } },
    {
      name: "no limit requirement",
      grant: { use_requires_limit: false },
      inventory: { at_limit: false, exhausted: [] },
    },
    {
      name: "explicit weekly return",
      grant: { gives_back_weekly: true },
      inventory: { exhausted: ["seven_day"] },
    },
    {
      name: "explicit weekly blocking cleared",
      grant: { gives_back_weekly: true, blocking: ["seven_day"] },
    },
    {
      name: "weekly-only actual effect",
      grant: { clears: [], gives_back_weekly: true },
      inventory: { exhausted: ["seven_day"] },
    },
  ])("allows $name", async (entry) => {
    const fetchApi = redemptionFetch(usage({ grants: [grant(entry.grant)], ...entry.inventory }));
    await expect(consume(fetchApi)).resolves.toEqual(resetResult);
    expect(mutationCalls(fetchApi)).toHaveLength(1);
  });

  it("does not infer weekly effects without explicit givesBackWeekly", async () => {
    const fetchApi = redemptionFetch(usage({ exhausted: ["seven_day"], grants: [grant()] }));
    await expect(consume(fetchApi)).rejects.toThrow("not usable");
    expect(mutationCalls(fetchApi)).toHaveLength(0);
  });

  it("rechecks expiration at the completion of the fresh inventory request", async () => {
    let now = NOW;
    const fetchApi = redemptionFetch(
      usage({ grants: [grant({ ends_at: "2026-10-11T00:00:01Z" })] }),
    );
    fetchApi.mockImplementationOnce(async () => {
      now += 1000;
      return json(usage({ grants: [grant({ ends_at: "2026-10-11T00:00:01Z" })] }));
    });
    await expect(consume(fetchApi, { now: () => now })).rejects.toThrow("expired");
    expect(mutationCalls(fetchApi)).toHaveLength(0);
  });

  it.each([
    { credential: { accessToken: " " }, grantId: "selected_grant", redeemRequestId: "valid" },
    { credential, grantId: "../grant", redeemRequestId: "valid" },
    { credential, grantId: "selected_grant", redeemRequestId: "invalid request" },
  ])("rejects invalid local authorization without a request: %j", async (options) => {
    const fetchApi = redemptionFetch(usage());
    await expect(consume(fetchApi, options)).rejects.toThrow();
    expect(fetchApi).not.toHaveBeenCalled();
  });

  it("resolves a missing organization from only the selected token profile", async () => {
    const profileFetch = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer selected-secret");
      if (String(url) === CLAUDE_PROFILE_ENDPOINT)
        return json({
          account: { uuid: ACCOUNT },
          organization: { uuid: OTHER_ORGANIZATION },
        });
      if (init?.method === "POST") return json({ result: "reset" });
      return json(usage());
    });
    await expect(
      consume(profileFetch, {
        credential: { accessToken: "selected-secret", accountId: ACCOUNT, orgId: "invalid" },
      }),
    ).resolves.toMatchObject({ result: "reset" });
    expect(profileFetch.mock.calls.find(([, init]) => init?.method === "POST")?.[0]).toContain(
      `/organizations/${OTHER_ORGANIZATION}/`,
    );
  });

  it.each([{}, { organization: null }, { organization: { uuid: "bad-org" } }])(
    "does not mutate when the selected organization is unresolved: %j",
    async (profile) => {
      const fetchApi = redemptionFetch(profile);
      await expect(
        consume(fetchApi, { credential: { accessToken: "selected-secret" } }),
      ).rejects.toThrow("organization is unavailable");
      expect(fetchApi).toHaveBeenCalledTimes(1);
      expect(mutationCalls(fetchApi)).toHaveLength(0);
    },
  );

  it.each(["reset", "already_used", "not_limited", "cooldown", "ineligible", "unavailable"])(
    "preserves native outcome %s rather than reporting every HTTP 200 as a reset",
    async (result) => {
      const fetchApi = redemptionFetch(usage(), {
        result,
        reason: "native-reason",
        resets_left: 0,
        cleared: ["five_hour", "seven_day"],
        weekly_resets_at: "2026-10-18T02:00:00+02:00",
        cooldown_until: "2026-10-11T01:00:00Z",
      });
      await expect(consume(fetchApi)).resolves.toEqual({
        result,
        reason: "native-reason",
        resetsLeft: 0,
        cleared: ["five_hour", "seven_day"],
        weeklyResetsAt: "2026-10-18T00:00:00.000Z",
        cooldownUntil: "2026-10-11T01:00:00.000Z",
      });
      expect(mutationCalls(fetchApi)).toHaveLength(1);
    },
  );

  it.each([
    null,
    {},
    { result: "unknown" },
    { result: "reset", resets_left: -1 },
    { result: "reset", resets_left: Number.MAX_SAFE_INTEGER + 1 },
    { result: "reset", cleared: [false] },
    { result: "reset", weekly_resets_at: "tomorrow" },
    { result: "reset", cooldown_until: "2026-10-11T01:00:00" },
  ])("leaves malformed mutation outcomes unconfirmed without retry: %j", async (response) => {
    const fetchApi = redemptionFetch(usage(), response);
    await expect(consume(fetchApi)).rejects.toThrow("unconfirmed");
    expect(mutationCalls(fetchApi)).toHaveLength(1);
    expect(fetchApi).toHaveBeenCalledTimes(2);
  });

  it.each([401, 403, 404, 405, 429, 500, 501])(
    "does not retry HTTP %i or expose its body",
    async (status) => {
      const fetchApi = redemptionFetch(usage());
      fetchApi.mockImplementation(async (_url, init) =>
        init?.method === "POST"
          ? new Response("selected-secret private details", { status })
          : json(usage()),
      );
      const outcome = consume(fetchApi);
      await expect(outcome).rejects.toThrow(
        status === 401 || status === 403 ? "authentication expired" : "request failed",
      );
      await expect(outcome).rejects.not.toThrow("selected-secret");
      expect(mutationCalls(fetchApi)).toHaveLength(1);
      expect(fetchApi).toHaveBeenCalledTimes(2);
    },
  );

  it.each(["json", "network", "body"])(
    "does not retry or leak a failed %s mutation response",
    async (mode) => {
      const fetchApi = redemptionFetch(usage());
      fetchApi.mockImplementation(async (_url, init) => {
        if (init?.method !== "POST") return json(usage());
        if (mode === "network") throw new Error("selected-secret");
        const response = new Response("selected-secret");
        if (mode === "body")
          vi.spyOn(response, "text").mockRejectedValue(new Error("selected-secret"));
        return response;
      });
      const outcome = consume(fetchApi);
      await expect(outcome).rejects.toThrow(mode === "json" ? "not valid JSON" : "request failed");
      await expect(outcome).rejects.not.toThrow("selected-secret");
      expect(mutationCalls(fetchApi)).toHaveLength(1);
    },
  );

  it.each(["request", "body"])(
    "keeps the native 25s mutation deadline through %s consumption",
    async (stage) => {
      vi.useFakeTimers();
      const posted = Promise.withResolvers<void>();
      const release = Promise.withResolvers<Response>();
      const body = Promise.withResolvers<string>();
      let signal: AbortSignal | null | undefined;
      const fetchApi = redemptionFetch(usage());
      fetchApi.mockImplementation(async (_url, init) => {
        if (init?.method !== "POST") return json(usage());
        signal = init.signal;
        posted.resolve();
        if (stage === "request") return release.promise;
        const response = json({ result: "reset" });
        vi.spyOn(response, "text").mockReturnValue(body.promise);
        return response;
      });
      try {
        const pending = consume(fetchApi);
        const outcome = pending.then(
          () => null,
          (error: unknown) => error,
        );
        await posted.promise;
        await vi.advanceTimersByTimeAsync(24_999);
        expect(signal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(await outcome).toMatchObject({ message: "Claude limit reset request timed out" });
        expect(signal?.aborted).toBe(true);
        expect(mutationCalls(fetchApi)).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(0);
      } finally {
        release.resolve(json({ result: "reset" }));
        body.resolve(JSON.stringify({ result: "reset" }));
        vi.useRealTimers();
      }
    },
  );

  it("joins duplicate credentials for one account and blocks a different simultaneous redemption", async () => {
    const posted = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const fetchApi = redemptionFetch(usage());
    fetchApi.mockImplementation(async (_url, init) => {
      if (init?.method !== "POST") return json(usage());
      posted.resolve();
      await release.promise;
      return json({ result: "reset", resets_left: 1, cleared: ["five_hour"] });
    });
    const first = consume(fetchApi);
    await posted.promise;
    const duplicate = consume(fetchApi, {
      credential: {
        ...credential,
        accountId: ACCOUNT.toUpperCase(),
        accessToken: "refreshed-secret",
      },
    });
    await expect(consume(fetchApi, { redeemRequestId: "different-request" })).rejects.toThrow(
      "already being consumed",
    );
    await expect(consume(fetchApi, { grantId: "other_grant" })).rejects.toThrow(
      "already being consumed",
    );
    await expect(
      consume(fetchApi, { credential: { ...credential, accessToken: " " } }),
    ).rejects.toThrow("credential is unavailable");
    release.resolve();
    await Promise.all([first, duplicate]);
    expect(mutationCalls(fetchApi)).toHaveLength(1);
    expect(new Headers(mutationCalls(fetchApi)[0]?.[1]?.headers).get("Authorization")).toBe(
      "Bearer selected-secret",
    );
    await expect(consume(fetchApi, { redeemRequestId: "later-request" })).resolves.toEqual(
      resetResult,
    );
    expect(mutationCalls(fetchApi)).toHaveLength(2);
  });

  it.each([
    {
      name: "different accounts sharing an organization",
      other: {
        ...credential,
        accountId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        accessToken: "other-secret",
      },
    },
    {
      name: "one account in different organizations",
      other: { ...credential, orgId: OTHER_ORGANIZATION, accessToken: "other-secret" },
    },
  ])("isolates same opaque grant/request IDs for $name", async ({ other }) => {
    const posted = Promise.withResolvers<void>();
    const release = Promise.withResolvers<Response>();
    const fetchApi = redemptionFetch(usage());
    fetchApi.mockImplementation(async (_url, init) => {
      if (init?.method !== "POST") return json(usage());
      if (new Headers(init.headers).get("Authorization") === "Bearer other-secret")
        return json({ result: "not_limited" });
      posted.resolve();
      return release.promise;
    });
    const first = consume(fetchApi);
    await posted.promise;
    await expect(consume(fetchApi, { credential: other })).resolves.toMatchObject({
      result: "not_limited",
    });
    release.resolve(json({ result: "reset", resets_left: 1, cleared: ["five_hour"] }));
    await expect(first).resolves.toEqual(resetResult);
    expect(mutationCalls(fetchApi)).toHaveLength(2);
    expect(
      mutationCalls(fetchApi).map(([, init]) => new Headers(init?.headers).get("Authorization")),
    ).toEqual(["Bearer selected-secret", "Bearer other-secret"]);
  });

  it("joins canonical selected profile identities across duplicate credentials without global auth", async () => {
    const posted = Promise.withResolvers<void>();
    const release = Promise.withResolvers<Response>();
    const fetchApi = redemptionFetch(usage());
    fetchApi.mockImplementation(async (url, init) => {
      if (String(url) === CLAUDE_PROFILE_ENDPOINT)
        return json({ account: { uuid: ACCOUNT }, organization: { uuid: ORGANIZATION } });
      if (init?.method !== "POST") return json(usage());
      posted.resolve();
      return release.promise;
    });
    const first = consume(fetchApi, { credential: { accessToken: "selected-secret" } });
    await posted.promise;
    const duplicate = consume(fetchApi, { credential: { accessToken: "refreshed-secret" } });
    await expect(
      consume(fetchApi, {
        credential: { accessToken: "third-secret" },
        redeemRequestId: "other-request",
      }),
    ).rejects.toThrow("already being consumed");
    release.resolve(json({ result: "reset", resets_left: 1, cleared: ["five_hour"] }));
    await expect(Promise.all([first, duplicate])).resolves.toEqual([resetResult, resetResult]);
    expect(mutationCalls(fetchApi)).toHaveLength(1);
  });
  it("does not join distinct selected profile accounts merely because stored organization and request IDs match", async () => {
    const posted = Promise.withResolvers<void>();
    const release = Promise.withResolvers<Response>();
    const fetchApi = redemptionFetch(usage());
    fetchApi.mockImplementation(async (url, init) => {
      const other = new Headers(init?.headers).get("Authorization") === "Bearer other-secret";
      if (String(url) === CLAUDE_PROFILE_ENDPOINT)
        return json({
          account: { uuid: other ? "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" : ACCOUNT },
          organization: { uuid: ORGANIZATION },
        });
      if (init?.method !== "POST") return json(usage());
      if (other) return json({ result: "not_limited" });
      posted.resolve();
      return release.promise;
    });
    const first = consume(fetchApi, {
      credential: { accessToken: "selected-secret", orgId: ORGANIZATION },
    });
    await posted.promise;
    await expect(
      consume(fetchApi, { credential: { accessToken: "other-secret", orgId: ORGANIZATION } }),
    ).resolves.toMatchObject({ result: "not_limited" });
    release.resolve(json({ result: "reset", resets_left: 1, cleared: ["five_hour"] }));
    await expect(first).resolves.toEqual(resetResult);
    expect(mutationCalls(fetchApi)).toHaveLength(2);
  });

  it("clears the pending reservation after an uncertain response, keeping later explicit request intent", async () => {
    const fetchApi = redemptionFetch(usage(), { result: "unknown" });
    await expect(consume(fetchApi)).rejects.toThrow("unconfirmed");
    fetchApi.mockImplementation(async (_url, init) =>
      init?.method === "POST" ? json({ result: "already_used" }) : json(usage()),
    );
    await expect(consume(fetchApi)).resolves.toMatchObject({ result: "already_used" });
    expect(mutationCalls(fetchApi)).toHaveLength(2);
    expect(
      mutationCalls(fetchApi).map(([, init]) => JSON.parse(String(init?.body)).request_id),
    ).toEqual(["stable-request", "stable-request"]);
  });
});

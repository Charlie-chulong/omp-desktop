import { describe, expect, it, vi } from "vitest";
import type { Dispatcher } from "undici";
import { createQuotaProxyFetch } from "./proxy-fetch.js";

describe("createQuotaProxyFetch", () => {
  it("uses a proxy dispatcher only while PI_PROXY is configured", async () => {
    let proxyUrl = "";
    const directResponse = new Response(null, { status: 204 });
    const fetchApi = vi.fn(async () => directResponse) as typeof fetch;
    const dispatcher = {} as Dispatcher;
    const createDispatcher = vi.fn(() => dispatcher);
    const proxyFetch = createQuotaProxyFetch({
      getProxyUrl: () => proxyUrl,
      fetch: fetchApi,
      createDispatcher,
    });

    await proxyFetch("https://example.com/usage", { headers: { Accept: "application/json" } });
    expect(fetchApi).toHaveBeenLastCalledWith("https://example.com/usage", {
      headers: { Accept: "application/json" },
    });
    expect(createDispatcher).not.toHaveBeenCalled();

    proxyUrl = "  http://127.0.0.1:7890  ";
    await proxyFetch("https://example.com/usage", { headers: { Accept: "application/json" } });
    expect(createDispatcher).toHaveBeenCalledWith("http://127.0.0.1:7890");
    expect(fetchApi).toHaveBeenLastCalledWith("https://example.com/usage", {
      headers: { Accept: "application/json" },
      dispatcher,
    });
  });

  it("reuses a dispatcher for repeated requests to the same proxy", async () => {
    const fetchApi = vi.fn(async () => new Response(null, { status: 204 })) as typeof fetch;
    const createDispatcher = vi.fn(() => ({}) as Dispatcher);
    const proxyFetch = createQuotaProxyFetch({
      getProxyUrl: () => "http://127.0.0.1:7890",
      fetch: fetchApi,
      createDispatcher,
    });

    await proxyFetch("https://example.com/first");
    await proxyFetch("https://example.com/second");

    expect(createDispatcher).toHaveBeenCalledTimes(1);
  });
});

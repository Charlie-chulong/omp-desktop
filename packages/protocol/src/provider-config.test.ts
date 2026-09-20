import { describe, expect, test } from "vitest";
import { applyOmpProxyEnabled, resolveOmpProxyUrl } from "./provider-config.js";

describe("OMP proxy configuration", () => {
  test("keeps a configured proxy enabled by default for existing configs", () => {
    expect(resolveOmpProxyUrl({ env: { PI_PROXY: "  http://127.0.0.1:7890  " } })).toBe(
      "http://127.0.0.1:7890",
    );
  });

  test("disables the proxy without deleting its configured URL", () => {
    const config = {
      env: { PI_PROXY: "http://127.0.0.1:7890", OTHER: "value" },
      params: { proxyEnabled: false },
    };

    expect(resolveOmpProxyUrl(config)).toBeUndefined();
    expect(applyOmpProxyEnabled({ env: config.env }, config)).toEqual({
      env: { PI_PROXY: "", OTHER: "value" },
    });
    expect(config.env.PI_PROXY).toBe("http://127.0.0.1:7890");
  });

  test("restores the saved proxy when enabled again", () => {
    const config = {
      env: { PI_PROXY: "http://127.0.0.1:7890" },
      params: { proxyEnabled: true },
    };

    expect(resolveOmpProxyUrl(config)).toBe("http://127.0.0.1:7890");
    expect(applyOmpProxyEnabled({ env: config.env }, config)).toEqual({ env: config.env });
  });
});

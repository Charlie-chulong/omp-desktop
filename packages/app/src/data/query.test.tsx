/** @vitest-environment jsdom */
import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import React, { type PropsWithChildren } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { useReplicaQuery } from "@/data/query";

function createWrapper(queryClient: QueryClient) {
  return function QueryWrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function useCheckoutDiffReplica(queryKey: QueryKey, enabled = true) {
  return useReplicaQuery<string>({
    queryKey,
    pushEvent: "checkout_diff_update",
    enabled,
  });
}

function waitForGcTurn(): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  setTimeout(resolve, 0);
  return promise;
}

afterEach(() => {
  cleanup();
});

describe("checkout diff replica cache lifecycle", () => {
  it("keeps a populated snapshot until the last real hook observer unmounts and accepts a fresh snapshot on remount", async () => {
    const queryClient = new QueryClient();
    const wrapper = createWrapper(queryClient);
    const queryKey = ["checkoutDiff", "server-1", "/repo", "uncommitted"] as const;
    const first = renderHook(() => useCheckoutDiffReplica(queryKey), { wrapper });
    const second = renderHook(() => useCheckoutDiffReplica(queryKey, false), { wrapper });

    act(() => {
      queryClient.setQueryData(queryKey, "first snapshot");
    });
    await waitFor(() => {
      expect(first.result.current.data).toBe("first snapshot");
      expect(second.result.current.data).toBe("first snapshot");
    });

    first.unmount();
    await waitForGcTurn();
    expect(queryClient.getQueryData(queryKey)).toBe("first snapshot");
    second.unmount();
    await waitFor(() => {
      expect(queryClient.getQueryData(queryKey)).toBeUndefined();
    });

    const remounted = renderHook(() => useCheckoutDiffReplica(queryKey), { wrapper });
    expect(remounted.result.current.data).toBeUndefined();
    act(() => {
      queryClient.setQueryData(queryKey, "fresh snapshot");
    });
    await waitFor(() => {
      expect(remounted.result.current.data).toBe("fresh snapshot");
    });
    remounted.unmount();
    queryClient.clear();
  });

  it("evicts old snapshots as a mounted hook navigates through unique query keys", async () => {
    const queryClient = new QueryClient();
    const wrapper = createWrapper(queryClient);
    const firstKey = ["checkoutDiff", "server-1", "/repo", "base", "main"] as const;
    const secondKey = ["checkoutDiff", "server-1", "/repo", "base", "feature"] as const;
    const hook = renderHook(
      ({ queryKey }: { queryKey: QueryKey }) => useCheckoutDiffReplica(queryKey),
      { initialProps: { queryKey: firstKey as QueryKey }, wrapper },
    );

    act(() => {
      queryClient.setQueryData(firstKey, "main snapshot");
    });
    await waitFor(() => {
      expect(hook.result.current.data).toBe("main snapshot");
    });

    hook.rerender({ queryKey: secondKey });
    act(() => {
      queryClient.setQueryData(secondKey, "feature snapshot");
    });
    await waitFor(() => {
      expect(hook.result.current.data).toBe("feature snapshot");
    });
    await waitFor(() => {
      expect(queryClient.getQueryData(firstKey)).toBeUndefined();
    });
    expect(queryClient.getQueryData(secondKey)).toBe("feature snapshot");

    hook.unmount();
    await waitFor(() => {
      expect(queryClient.getQueryData(secondKey)).toBeUndefined();
    });
    queryClient.clear();
  });

  it("retains orphaned snapshots for other replica event domains", async () => {
    const queryClient = new QueryClient();
    const wrapper = createWrapper(queryClient);
    const queryKey = ["providersSnapshot", "server-1"] as const;
    const hook = renderHook(
      () =>
        useReplicaQuery<string>({
          queryKey,
          pushEvent: "providers_snapshot_update",
        }),
      { wrapper },
    );

    act(() => {
      queryClient.setQueryData(queryKey, "provider snapshot");
    });
    hook.unmount();
    await waitForGcTurn();

    expect(queryClient.getQueryData(queryKey)).toBe("provider snapshot");
    queryClient.clear();
  });
});

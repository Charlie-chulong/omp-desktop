/** @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GitHubAuthCallout } from "./github-auth-callout";

const mocks = vi.hoisted(() => ({
  client: {
    startForgeLogin: vi.fn(),
    finishForgeLogin: vi.fn(),
    cancelForgeLogin: vi.fn(),
  },
  openExternalUrl: vi.fn(),
  setClipboard: vi.fn(),
  toast: {
    show: vi.fn(),
    copied: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/stores/session-store", () => ({
  useSessionStore: (selector: (state: unknown) => unknown) =>
    selector({ sessions: { server: { client: mocks.client } } }),
}));

vi.mock("@/contexts/toast-context", () => ({
  useToast: () => mocks.toast,
}));

vi.mock("@/utils/open-external-url", () => ({
  openExternalUrl: mocks.openExternalUrl,
}));

vi.mock("expo-clipboard", () => ({
  setStringAsync: mocks.setClipboard,
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string, values?: { login?: string }) => {
      const textByKey: Record<string, string> = {
        "workspace.git.forgeSetup.signInButton": "Sign in to GitHub",
        "workspace.git.forgeSetup.deviceInstructions": "Enter this one-time code.",
        "workspace.git.forgeSetup.copyCode": "Copy code",
        "workspace.git.forgeSetup.openAuthorization": "Open authorization page",
        "workspace.git.forgeSetup.codeCopied": "Authorization code copied",
        "common.cancel": "Cancel",
      };
      if (key === "workspace.git.forgeSetup.signedIn") {
        return `Signed in as ${values?.login ?? ""}`;
      }
      return textByKey[key] ?? key;
    },
  }),
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("GitHubAuthCallout", () => {
  it("shows the device code while the daemon waits for authorization", async () => {
    const finish = Promise.withResolvers<{
      host: string;
      userId: number;
      login: string;
      scopes: string[];
      requestId: string;
      forge: string;
    }>();
    mocks.client.startForgeLogin.mockResolvedValue({
      requestId: "start",
      flowId: "flow-1",
      forge: "github",
      host: "github.com",
      verificationUri: "https://github.com/login/device",
      userCode: "ABCD-EFGH",
      expiresAt: "2026-08-27T00:15:00.000Z",
    });
    mocks.client.finishForgeLogin.mockReturnValue(finish.promise);
    mocks.openExternalUrl.mockResolvedValue(undefined);
    const authenticated = vi.fn();

    render(
      <GitHubAuthCallout
        serverId="server"
        cwd="/repo"
        message="Sign in to GitHub to continue."
        onAuthenticated={authenticated}
      />,
    );
    fireEvent.click(screen.getByText("Sign in to GitHub"));

    expect(await screen.findByText("ABCD-EFGH")).toBeTruthy();
    expect(mocks.client.startForgeLogin).toHaveBeenCalledWith({
      forge: "github",
      cwd: "/repo",
      host: undefined,
    });
    expect(mocks.openExternalUrl).toHaveBeenCalledWith("https://github.com/login/device");

    finish.resolve({
      requestId: "finish",
      forge: "github",
      host: "github.com",
      userId: 42,
      login: "octocat",
      scopes: ["repo"],
    });
    await waitFor(() => expect(authenticated).toHaveBeenCalledTimes(1));
    expect(mocks.toast.show).toHaveBeenCalledWith("Signed in as octocat", {
      variant: "success",
    });
  });

  it("cancels the active daemon login flow", async () => {
    mocks.client.startForgeLogin.mockResolvedValue({
      requestId: "start",
      flowId: "flow-2",
      forge: "github",
      host: "github.com",
      verificationUri: "https://github.com/login/device",
      userCode: "WXYZ-1234",
      expiresAt: "2026-08-27T00:15:00.000Z",
    });
    mocks.client.finishForgeLogin.mockReturnValue(Promise.withResolvers<never>().promise);
    mocks.client.cancelForgeLogin.mockResolvedValue({ requestId: "cancel", cancelled: true });
    mocks.openExternalUrl.mockResolvedValue(undefined);

    render(<GitHubAuthCallout serverId="server" message="Sign in" />);
    fireEvent.click(screen.getByText("Sign in to GitHub"));
    await screen.findByText("WXYZ-1234");
    fireEvent.click(screen.getByText("Cancel"));

    await waitFor(() => expect(mocks.client.cancelForgeLogin).toHaveBeenCalledWith("flow-2"));
  });
});

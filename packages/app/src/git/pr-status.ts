import type { CheckoutPrStatusResponse, ForgeAuthState } from "@omp-desktop/protocol/messages";
import { parseForgeAuthState } from "@/git/forge";

type WireCheckoutPrStatusPayload = CheckoutPrStatusResponse["payload"];

export type CheckoutPrStatusPayload = Omit<WireCheckoutPrStatusPayload, "authState"> & {
  authState: ForgeAuthState;
};

export function normalizeCheckoutPrStatusPayload(
  payload: WireCheckoutPrStatusPayload,
): CheckoutPrStatusPayload {
  return {
    ...payload,
    // COMPAT(forgeAuthState): added in v0.1.106, remove after 2026-12-27 once
    // all supported daemons send authState.
    authState:
      parseForgeAuthState(payload.authState) ??
      (payload.githubFeaturesEnabled ? "authenticated" : "unauthenticated"),
  };
}

export function resolvePrStatusErrorMessage(input: {
  featuresEnabled: boolean;
  error: { message?: string } | null | undefined;
  repositoryAccessMessage: string;
}): string | null {
  if (!input.featuresEnabled) {
    return null;
  }
  const message = input.error?.message?.trim();
  if (!message) {
    return null;
  }
  return /^not found$/i.test(message) ? input.repositoryAccessMessage : message;
}

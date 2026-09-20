import type { ProviderUsage, ProviderUsageView } from "./types";

const CODEX_LOGIN_PROVIDER_ID = "openai-codex";

export function resolveLoginProviderUsage(
  view: ProviderUsageView,
  providerId: string,
): ProviderUsage | null {
  if (view.kind !== "ready") return null;
  if (providerId === CODEX_LOGIN_PROVIDER_ID) return null;
  const usage =
    view.payload.providers.find(
      (candidate) => candidate.providerId.toLowerCase() === providerId.toLowerCase(),
    ) ?? null;
  if (!usage || usage.status !== "available") return null;
  const balances = usage.balances ?? [];
  if (usage.windows.length === 0 && balances.length === 0) return null;
  return usage;
}

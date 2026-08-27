import type {
  ProviderUsageFetcher,
  ProviderUsageFetcherFactoryOptions,
  ProviderUsageFetcherManifestEntry,
} from "./provider.js";

export const PROVIDER_USAGE_FETCHERS: readonly ProviderUsageFetcherManifestEntry[] = [];

export function createProviderUsageFetchers(
  _options: ProviderUsageFetcherFactoryOptions,
): ProviderUsageFetcher[] {
  return [];
}

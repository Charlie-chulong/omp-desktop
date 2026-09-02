import { ProxyAgent, type Dispatcher } from "undici";

interface QuotaProxyFetchOptions {
  getProxyUrl(): string | null | undefined;
  fetch?: typeof fetch;
  createDispatcher?: (proxyUrl: string) => Dispatcher;
}

/** Routes provider quota requests through the currently configured PI_PROXY. */
export function createQuotaProxyFetch(options: QuotaProxyFetchOptions): typeof fetch {
  const fetchApi = options.fetch ?? fetch;
  const createDispatcher = options.createDispatcher ?? ((proxyUrl) => new ProxyAgent(proxyUrl));
  const dispatchers = new Map<string, Dispatcher>();

  return (input, init) => {
    const proxyUrl = options.getProxyUrl()?.trim();
    if (!proxyUrl) return fetchApi(input, init);

    let dispatcher = dispatchers.get(proxyUrl);
    if (!dispatcher) {
      dispatcher = createDispatcher(proxyUrl);
      dispatchers.set(proxyUrl, dispatcher);
    }

    return fetchApi(input, { ...init, dispatcher } as RequestInit);
  };
}

import { ProxyAgent, type Dispatcher } from "undici";

interface ProxyFetchOptions {
  getProxyUrl(): string | null | undefined;
  fetch?: typeof fetch;
  createDispatcher?: (proxyUrl: string) => Dispatcher;
}

/** Routes provider requests through the currently configured proxy. */
export function createProxyFetch(options: ProxyFetchOptions): typeof fetch {
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

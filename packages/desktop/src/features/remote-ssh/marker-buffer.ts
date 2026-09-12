const MAX_BUFFER_LENGTH = 2 * 1024 * 1024;

interface MarkerWaiter {
  marker: string;
  resolve: (suffix: string) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

export class MarkerBuffer {
  private buffer = "";
  private readonly waiters = new Set<MarkerWaiter>();

  push(chunk: string): void {
    this.buffer += chunk.replace(/\r/g, "");
    if (this.buffer.length > MAX_BUFFER_LENGTH) {
      this.buffer = this.buffer.slice(-MAX_BUFFER_LENGTH);
    }
    this.flush();
  }

  waitForLine(marker: string, timeoutMs = 30_000): Promise<string> {
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    const waiter: MarkerWaiter = {
      marker,
      resolve,
      reject,
      timeout: setTimeout(() => {
        this.waiters.delete(waiter);
        reject(new Error(`Timed out waiting for remote marker ${marker}`));
      }, timeoutMs),
    };
    this.waiters.add(waiter);
    this.flush();
    return promise;
  }

  rejectAll(error: Error): void {
    for (const waiter of this.waiters) {
      clearTimeout(waiter.timeout);
      waiter.reject(error);
    }
    this.waiters.clear();
  }

  private flush(): void {
    for (const waiter of this.waiters) {
      const markerIndex = this.buffer.indexOf(waiter.marker);
      if (markerIndex < 0) continue;
      const lineEnd = this.buffer.indexOf("\n", markerIndex + waiter.marker.length);
      if (lineEnd < 0) continue;
      const suffix = this.buffer.slice(markerIndex + waiter.marker.length, lineEnd);
      this.buffer = this.buffer.slice(lineEnd + 1);
      clearTimeout(waiter.timeout);
      this.waiters.delete(waiter);
      waiter.resolve(suffix);
    }
  }
}

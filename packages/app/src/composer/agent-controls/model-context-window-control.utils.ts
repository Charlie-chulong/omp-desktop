const TOKENS_PER_K = 1_000;

export function formatContextWindowInput(tokens: number | null | undefined): string {
  return tokens == null ? "" : (tokens / TOKENS_PER_K).toString();
}

export function parseContextWindowInput(value: string): number | null {
  const normalized = value.trim();
  if (!/^(?:\d+|\d*\.\d+)$/.test(normalized)) return null;

  const tokens = Number(normalized) * TOKENS_PER_K;
  return Number.isSafeInteger(tokens) && tokens > 0 ? tokens : null;
}

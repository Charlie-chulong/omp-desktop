import type { StreamItem } from "@/types/stream";
import { startsNewTurn } from "./turn-membership";

/** Retain the first completed preview without hiding tool activity or later-turn images. */
export function collectDuplicateToolImagePreviewIds(
  items: readonly StreamItem[],
): ReadonlySet<string> {
  const duplicates = new Set<string>();
  const sources = new Set<string>();
  let previous: StreamItem | null = null;

  for (const item of items) {
    if (startsNewTurn(item, previous)) sources.clear();
    previous = item;
    if (item.kind !== "tool_call" || item.payload.source !== "agent") continue;
    const { data } = item.payload;
    if (data.status !== "completed" || data.detail.type !== "plain_text") continue;
    const preview = data.detail.preview;
    if (preview?.type !== "image") continue;
    if (sources.has(preview.source)) {
      duplicates.add(item.id);
    } else {
      sources.add(preview.source);
    }
  }

  return duplicates;
}

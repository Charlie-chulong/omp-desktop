import { describe, expect, test } from "vitest";
import {
  SYNCED_LOADER_DOT_COUNT,
  getSyncedLoaderDotOpacity,
  getSyncedLoaderStep,
  getSyncedLoaderStepDelayMs,
} from "./synced-loader-state";

describe("synced loader state", () => {
  test("advances through six wall-clock-aligned steps every 950 milliseconds", () => {
    const sampleTimes = [0, 158, 159, 316, 317, 474, 475, 633, 634, 791, 792, 949, 950];

    const steps = sampleTimes.map(getSyncedLoaderStep);

    expect(steps).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 0]);
  });

  test("waits until the next visible step across boundaries and clock rollover", () => {
    for (const now of [0, 158, 159, 633, 949, 950, Date.UTC(2026, 9, 22) + 51]) {
      const step = getSyncedLoaderStep(now);
      const delay = getSyncedLoaderStepDelayMs(now);
      expect(getSyncedLoaderStep(now + delay - 1)).toBe(step);
      expect(getSyncedLoaderStep(now + delay)).toBe((step + 1) % SYNCED_LOADER_DOT_COUNT);
    }
  });

  test("preserves the six visible snake states", () => {
    const states: number[][] = [];
    for (let step = 0; step < 6; step += 1) {
      const dotOpacities: number[] = [];
      for (let dot = 0; dot < 6; dot += 1) {
        dotOpacities.push(getSyncedLoaderDotOpacity(step, dot));
      }
      states.push(dotOpacities);
    }

    expect(states).toEqual([
      [1, 0, 0.78, 0, 0.56, 0.34],
      [0.78, 1, 0.56, 0, 0.34, 0],
      [0.56, 0.78, 0.34, 1, 0, 0],
      [0.34, 0.56, 0, 0.78, 0, 1],
      [0, 0.34, 0, 0.56, 1, 0.78],
      [0, 0, 1, 0.34, 0.78, 0.56],
    ]);
  });
});

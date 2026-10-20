import React, { act } from "react";
import { createRoot } from "react-dom/client";
import type { ParsedDiffFile } from "@omp-desktop/protocol/messages";
import { expect, it, vi } from "vitest";
import { lightTheme } from "@/styles/theme";
import { createDiffPalette } from "./palette";
import { DiffSurface } from "./surface.web";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock("./document-file-header", () => ({ DocumentFileHeader: () => null }));
vi.mock("@/review", () => ({
  InlineReviewAddButton: () => null,
  InlineReviewThread: () => null,
}));

const file: ParsedDiffFile = {
  path: "Cargo.lock",
  isNew: false,
  isDeleted: false,
  additions: 160,
  deletions: 160,
  hunks: [
    {
      oldStart: 1,
      oldCount: 160,
      newStart: 1,
      newCount: 160,
      lines: [
        { type: "header", content: "@@ -1,160 +1,160 @@" },
        ...Array.from({ length: 160 }, (_, index) => ({
          type: "remove" as const,
          content: `old checksum ${index}`,
        })),
        ...Array.from({ length: 160 }, (_, index) => ({
          type: "add" as const,
          content: `new checksum ${index}`,
        })),
      ],
    },
  ],
};

it.each(["transparent", "#fcfcfc"])(
  "preserves diff text and background pixels after scrolling with a %s surface",
  async (surface) => {
    vi.stubGlobal("React", React);
    const container = document.createElement("div");
    Object.assign(container.style, { display: "flex", width: "420px", height: "200px" });
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      const palette = { ...createDiffPalette(lightTheme), surface, headerSurface: surface };
      await act(async () =>
        root.render(
          React.createElement(DiffSurface, {
            files: [file],
            palette,
            displayPreferences: {
              layout: "split",
              wrapLines: true,
              codeFontSize: 12,
              monoFontFamily: "monospace",
            },
            mode: { kind: "commit" },
            collapsedFilePaths: new Set<string>(),
            selectedPath: null,
            onToggleFile: () => {},
            onSelectPath: () => {},
          }),
        ),
      );
      const canvas = container.querySelector<HTMLCanvasElement>('[data-testid="git-diff-canvas"]')!;
      const scroll = container.querySelector<HTMLDivElement>('[data-testid="git-diff-scroll"]')!;
      await expect.poll(() => canvas.height).toBe(Math.ceil(600 * window.devicePixelRatio));
      const context = canvas.getContext("2d")!;
      const pixelHeight = Math.round(scroll.clientHeight * window.devicePixelRatio);
      const before = context.getImageData(0, 0, canvas.width, pixelHeight).data;

      for (let cycle = 0; cycle < 2; cycle += 1) {
        for (const top of [400, 800, 1200, 800, 400, 250, 0]) {
          scroll.scrollTop = top;
          await expect.poll(() => canvas.style.top).toBe(`${Math.max(0, top - 200)}px`);
        }
      }

      const after = context.getImageData(0, 0, canvas.width, pixelHeight).data;
      let changedPixels = 0;
      for (let index = 0; index < before.length; index += 4) {
        if (
          before[index] !== after[index] ||
          before[index + 1] !== after[index + 1] ||
          before[index + 2] !== after[index + 2] ||
          before[index + 3] !== after[index + 3]
        ) {
          changedPixels += 1;
        }
      }
      expect(changedPixels).toBe(0);
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  },
);

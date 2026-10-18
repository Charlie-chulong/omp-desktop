import React, { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { MarkdownBlockImage } from "@/components/markdown/block-image";
import { MarkdownBlockImageLink } from "@/components/markdown/block-image-link";
import { View } from "react-native";

interface MountedPreview {
  root: Root;
  container: HTMLDivElement;
}

const mountedPreviews: MountedPreview[] = [];
const STATUS_BADGE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="142" height="20"></svg>',
)}`;
const UE_BADGE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="75" height="20"></svg>',
)}`;
const EMPTY_IMAGE_STYLE = {};
const BADGE_ROW_STYLE = { flexDirection: "row" } as const;

function mountPreview(node: ReactNode): HTMLDivElement {
  const container = document.createElement("div");
  container.style.width = "900px";
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => root.render(node));
  mountedPreviews.push({ root, container });
  return container;
}

afterEach(() => {
  for (const mounted of mountedPreviews.splice(0)) {
    act(() => mounted.root.unmount());
    mounted.container.remove();
  }
});

describe("Markdown preview images", () => {
  it("renders linked badges at their intrinsic dimensions", async () => {
    const preview = mountPreview(
      <MarkdownBlockImage src={STATUS_BADGE} alt="Status" style={EMPTY_IMAGE_STYLE} />,
    );
    const image = preview.querySelector("img");
    if (!(image instanceof HTMLImageElement)) {
      throw new Error("Markdown preview did not render the badge image");
    }

    await expect.poll(() => image.getBoundingClientRect().width).toBe(142);
    expect(image.getBoundingClientRect().height).toBe(20);
  });

  it("keeps consecutive linked badges next to each other", async () => {
    const preview = mountPreview(
      <View style={BADGE_ROW_STYLE}>
        <MarkdownBlockImageLink href="">
          <MarkdownBlockImage src={UE_BADGE} alt="UE Version" style={EMPTY_IMAGE_STYLE} />
        </MarkdownBlockImageLink>
        <MarkdownBlockImageLink href="">
          <MarkdownBlockImage src={STATUS_BADGE} alt="Status" style={EMPTY_IMAGE_STYLE} />
        </MarkdownBlockImageLink>
      </View>,
    );
    const images = [...preview.querySelectorAll("img")];
    if (images.length !== 2) {
      throw new Error("Markdown preview did not render both badge images");
    }

    await expect.poll(() => images[1]?.getBoundingClientRect().width).toBe(142);
    const first = images[0]?.getBoundingClientRect();
    const second = images[1]?.getBoundingClientRect();
    expect(second.left - first.right).toBe(4);
  });
});

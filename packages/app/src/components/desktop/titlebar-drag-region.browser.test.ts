import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type * as LayoutModule from "@/constants/layout";
import { TitlebarDragRegion } from "./titlebar-drag-region";

vi.mock("@/constants/layout", async (importOriginal) => {
  const original = await importOriginal<typeof LayoutModule>();
  return { ...original, getIsElectronRuntime: () => true };
});

const mountedFrames: HTMLIFrameElement[] = [];

async function mountAppShell(): Promise<Document> {
  const response = await fetch("/index.html");
  if (!response.ok) throw new Error(`App shell request failed: ${response.status}`);
  const frame = document.createElement("iframe");
  const loaded = new Promise<void>((resolve) => {
    frame.addEventListener("load", () => resolve(), { once: true });
  });
  frame.srcdoc = await response.text();
  document.body.appendChild(frame);
  mountedFrames.push(frame);
  await loaded;

  const frameDocument = frame.contentDocument;
  if (!frameDocument) throw new Error("App shell iframe did not create a document");
  return frameDocument;
}

function readAppRegion(element: Element): string {
  const view = element.ownerDocument.defaultView;
  if (!view) throw new Error("App shell document has no window");
  return view.getComputedStyle(element).getPropertyValue("-webkit-app-region");
}

afterEach(() => {
  for (const frame of mountedFrames.splice(0)) frame.remove();
});

describe("window drag region CSS", () => {
  it("keeps a padded titlebar inside its viewport and leaves both top corners resizable", async () => {
    const frameDocument = await mountAppShell();
    const viewport = frameDocument.createElement("div");
    viewport.style.cssText =
      "position:absolute;left:0;top:0;width:240px;height:80px;overflow:hidden";
    const titlebar = frameDocument.createElement("div");
    titlebar.style.cssText =
      "box-sizing:border-box;position:relative;display:flex;align-items:center;width:100%;height:36px;padding:0 12px";
    titlebar.innerHTML = renderToStaticMarkup(createElement(TitlebarDragRegion));
    viewport.appendChild(titlebar);
    frameDocument.body.appendChild(viewport);

    expect(viewport.scrollWidth).toBe(viewport.clientWidth);
    viewport.scrollLeft = 1000;
    const bounds = titlebar.getBoundingClientRect();
    expect(bounds.left).toBe(viewport.getBoundingClientRect().left);
    const leftCorner = frameDocument.elementFromPoint(bounds.left + 1, bounds.top + 1);
    const rightCorner = frameDocument.elementFromPoint(bounds.right - 1, bounds.top + 1);
    const dragSurface = frameDocument.elementFromPoint(bounds.left + 1, bounds.top + 10);
    if (!leftCorner || !rightCorner || !dragSurface) {
      throw new Error("Titlebar hit regions were not rendered");
    }
    expect(readAppRegion(leftCorner)).toBe("no-drag");
    expect(readAppRegion(rightCorner)).toBe("no-drag");
    expect(readAppRegion(dragSurface)).toBe("drag");
  });

  it("leaves an overflow-clipped chat control out of the native no-drag map", async () => {
    const frameDocument = await mountAppShell();
    frameDocument.body.innerHTML = `
      <div
        id="chat-scroll"
        style="position:absolute;top:72px;left:100px;width:820px;height:100px;overflow:auto"
      >
        <div style="box-sizing:border-box;height:1000px;padding-top:200px">
          <button id="hidden-activity" style="display:block;width:820px;height:32px">Activity</button>
        </div>
      </div>
    `;

    const scroll = frameDocument.getElementById("chat-scroll");
    const activity = frameDocument.getElementById("hidden-activity");
    if (!scroll || !activity) {
      throw new Error("Failed to create clipped activity fixture");
    }

    scroll.scrollTop = 272;
    const scrollBounds = scroll.getBoundingClientRect();
    const activityBounds = activity.getBoundingClientRect();

    expect(activityBounds.top).toBe(0);
    expect(activityBounds.bottom).toBeLessThan(scrollBounds.top);
    expect(readAppRegion(activity)).toBe("none");
  });

  it("keeps controls inside window chrome and global overlays interactive", async () => {
    const frameDocument = await mountAppShell();
    frameDocument.body.innerHTML = `
      <div id="native-region" data-window-drag-region="native">
        <button id="native-control">Native control</button>
      </div>
      <div>
        <div data-window-drag-scope="true"></div>
        <section><button id="static-control">Static control</button></section>
      </div>
      <div id="window-chrome-interactive" data-window-chrome-interactive="true">
        <button id="window-control">Window control</button>
      </div>
      <div id="overlay-root"><button id="overlay-control">Overlay control</button></div>
    `;

    const nativeRegion = frameDocument.getElementById("native-region");
    const nativeControl = frameDocument.getElementById("native-control");
    const staticControl = frameDocument.getElementById("static-control");
    const windowChromeInteractive = frameDocument.getElementById("window-chrome-interactive");
    const windowControl = frameDocument.getElementById("window-control");
    const overlayControl = frameDocument.getElementById("overlay-control");
    if (
      !nativeRegion ||
      !nativeControl ||
      !staticControl ||
      !windowChromeInteractive ||
      !windowControl ||
      !overlayControl
    ) {
      throw new Error("Failed to create window chrome fixture");
    }

    expect(readAppRegion(nativeRegion)).toBe("drag");
    expect(readAppRegion(nativeControl)).toBe("no-drag");
    expect(readAppRegion(staticControl)).toBe("no-drag");
    expect(readAppRegion(windowChromeInteractive)).toBe("no-drag");
    expect(readAppRegion(windowControl)).toBe("no-drag");
    expect(readAppRegion(overlayControl)).toBe("no-drag");
  });
});

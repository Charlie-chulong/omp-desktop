import {
  WEB_SCROLLBAR_ACTIVE_OPACITY,
  WEB_SCROLLBAR_HOVER_OPACITY,
  WEB_SCROLLBAR_SIZE_PX,
  webScrollbarColor,
  webScrollbarThumbColor,
  WEB_SCROLLBAR_WIDTH,
} from "@/styles/web-scrollbar";

const STYLE_ID = "paseo-web-scrollbar-styles";

export function installWebScrollbarStyles(): () => void {
  const existingStyle = document.getElementById(STYLE_ID);
  if (existingStyle) return () => {};

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
* {
  scrollbar-color: ${webScrollbarColor("var(--colors-foreground)")};
  scrollbar-width: ${WEB_SCROLLBAR_WIDTH};
}

[data-composer-input] {
  scrollbar-gutter: stable;
}

*::-webkit-scrollbar {
  width: ${WEB_SCROLLBAR_SIZE_PX}px;
  height: ${WEB_SCROLLBAR_SIZE_PX}px;
  background: transparent;
}

*::-webkit-scrollbar-track,
*::-webkit-scrollbar-corner {
  background: transparent;
}

*::-webkit-scrollbar-thumb {
  background: ${webScrollbarThumbColor("var(--colors-foreground)")};
}

*::-webkit-scrollbar-thumb:hover {
  background: ${webScrollbarThumbColor("var(--colors-foreground)", WEB_SCROLLBAR_HOVER_OPACITY)};
}

*::-webkit-scrollbar-thumb:active {
  background: ${webScrollbarThumbColor("var(--colors-foreground)", WEB_SCROLLBAR_ACTIVE_OPACITY)};
}

[data-overlay-scrollbar="true"]::-webkit-scrollbar {
  display: none;
}
`;
  document.head.append(style);

  return () => style.remove();
}

import katex from "katex";

export function renderMathToHtml(tex: string, displayMode: boolean): string {
  return katex.renderToString(tex, {
    displayMode,
    throwOnError: false,
    trust: false,
    strict: "warn",
  });
}

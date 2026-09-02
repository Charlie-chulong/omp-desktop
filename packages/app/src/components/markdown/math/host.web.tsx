import React, { useMemo, type CSSProperties } from "react";
import "katex/dist/katex.min.css";
import "./styles.css";
import { MARKDOWN_COPY_MATH_SOURCE_ATTRIBUTE } from "@/assistant-selection-copy/markup";
import { renderMathToHtml } from "./render";
import type { MarkdownMathProps } from "./types";

function cssTextStyle({
  inheritedStyles,
  textStyle,
}: Pick<MarkdownMathProps, "inheritedStyles" | "textStyle">): CSSProperties {
  const color = inheritedStyles.color ?? textStyle.color;
  const fontSize = inheritedStyles.fontSize ?? textStyle.fontSize;
  const lineHeight = inheritedStyles.lineHeight ?? textStyle.lineHeight;
  return {
    ...(typeof color === "string" ? { color } : {}),
    ...(typeof fontSize === "number" ? { fontSize } : {}),
    ...(typeof lineHeight === "number" ? { lineHeight: `${lineHeight}px` } : {}),
  };
}

export function MarkdownMath({ tex, displayMode, inheritedStyles, textStyle }: MarkdownMathProps) {
  const html = useMemo(() => renderMathToHtml(tex, displayMode), [displayMode, tex]);
  const style = useMemo(
    () => cssTextStyle({ inheritedStyles, textStyle }),
    [inheritedStyles, textStyle],
  );
  const source = displayMode ? `\\[\n${tex}\n\\]` : `\\(${tex}\\)`;
  const commonProps = {
    "aria-label": tex,
    [MARKDOWN_COPY_MATH_SOURCE_ATTRIBUTE]: source,
    dangerouslySetInnerHTML: { __html: html },
    role: "math",
    style,
  } as const;

  return displayMode ? (
    <div className="omp-math-block" {...commonProps} />
  ) : (
    <span className="omp-math-inline" {...commonProps} />
  );
}

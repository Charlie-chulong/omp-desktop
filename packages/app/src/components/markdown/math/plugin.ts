import type MarkdownIt from "markdown-it";
type InlineRule = Parameters<MarkdownIt["inline"]["ruler"]["before"]>[2];
type InlineState = Parameters<InlineRule>[0];
type BlockRule = Parameters<MarkdownIt["block"]["ruler"]["before"]>[2];
type BlockState = Parameters<BlockRule>[0];

export const MATH_INLINE_TOKEN = "math_inline";
export const MATH_BLOCK_TOKEN = "math_block";

function isEscaped(source: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function findUnescaped(source: string, delimiter: string, from: number, to: number): number {
  let cursor = source.indexOf(delimiter, from);
  while (cursor >= 0 && cursor < to) {
    if (!isEscaped(source, cursor)) {
      return cursor;
    }
    cursor = source.indexOf(delimiter, cursor + delimiter.length);
  }
  return -1;
}

function bracketInlineRule(state: InlineState, silent: boolean): boolean {
  const start = state.pos;
  if (!state.src.startsWith("\\(", start) || isEscaped(state.src, start)) {
    return false;
  }

  const end = findUnescaped(state.src, "\\)", start + 2, state.posMax);
  if (end < 0 || state.src.slice(start + 2, end).includes("\n")) {
    return false;
  }

  if (!silent) {
    const token = state.push(MATH_INLINE_TOKEN, "math", 0);
    token.content = state.src.slice(start + 2, end).trim();
    token.markup = "\\(";
  }
  state.pos = end + 2;
  return true;
}

function dollarInlineRule(state: InlineState, silent: boolean): boolean {
  const start = state.pos;
  const source = state.src;
  if (
    source[start] !== "$" ||
    source[start + 1] === "$" ||
    isEscaped(source, start) ||
    (start > 0 && /\d/.test(source[start - 1] ?? ""))
  ) {
    return false;
  }

  let end = findUnescaped(source, "$", start + 1, state.posMax);
  while (end >= 0) {
    const content = source.slice(start + 1, end);
    const next = source[end + 1] ?? "";
    if (
      content.length > 0 &&
      !content.includes("\n") &&
      !/^\s|\s$/.test(content) &&
      !/\d/.test(next)
    ) {
      if (!silent) {
        const token = state.push(MATH_INLINE_TOKEN, "math", 0);
        token.content = content;
        token.markup = "$";
      }
      state.pos = end + 1;
      return true;
    }
    end = findUnescaped(source, "$", end + 1, state.posMax);
  }

  return false;
}

interface BlockDelimiter {
  open: string;
  close: string;
  contentStart: number;
}

function blockDelimiterAt(source: string, start: number): BlockDelimiter | null {
  if (source.startsWith("\\[", start)) {
    return { open: "\\[", close: "\\]", contentStart: start + 2 };
  }
  if (source.startsWith("$$", start) && !source.startsWith("$$$", start)) {
    return { open: "$$", close: "$$", contentStart: start + 2 };
  }
  return null;
}

function findClosingEnvironment(source: string, name: string, from: number, to: number): number {
  const opening = `\\begin{${name}}`;
  const closing = `\\end{${name}}`;
  let depth = 1;
  let cursor = from;

  while (cursor < to) {
    const nextOpening = findUnescaped(source, opening, cursor, to);
    const nextClosing = findUnescaped(source, closing, cursor, to);
    if (nextClosing < 0) {
      return -1;
    }
    if (nextOpening >= 0 && nextOpening < nextClosing) {
      depth += 1;
      cursor = nextOpening + opening.length;
      continue;
    }
    depth -= 1;
    if (depth === 0) {
      return nextClosing + closing.length;
    }
    cursor = nextClosing + closing.length;
  }

  return -1;
}

function lineContaining(
  state: BlockState,
  position: number,
  startLine: number,
  endLine: number,
): number {
  for (let line = startLine; line < endLine; line += 1) {
    if (position <= state.eMarks[line]) {
      return line;
    }
  }
  return -1;
}

function mathBlockRule(
  state: BlockState,
  startLine: number,
  endLine: number,
  silent: boolean,
): boolean {
  if (state.sCount[startLine] - state.blkIndent >= 4) {
    return false;
  }

  const start = state.bMarks[startLine] + state.tShift[startLine];
  const sourceEnd = state.eMarks[endLine - 1];
  const delimiter = blockDelimiterAt(state.src, start);
  let contentStart: number;
  let contentEnd: number;
  let blockEnd: number;
  let markup: string;

  if (delimiter) {
    const closing = findUnescaped(state.src, delimiter.close, delimiter.contentStart, sourceEnd);
    if (closing < 0) {
      return false;
    }
    contentStart = delimiter.contentStart;
    contentEnd = closing;
    blockEnd = closing + delimiter.close.length;
    markup = delimiter.open;
  } else {
    const environment = state.src.slice(start).match(/^\\begin\{([A-Za-z][A-Za-z*]*)\}/);
    if (!environment) {
      return false;
    }
    contentStart = start;
    blockEnd = findClosingEnvironment(
      state.src,
      environment[1],
      start + environment[0].length,
      sourceEnd,
    );
    if (blockEnd < 0) {
      return false;
    }
    contentEnd = blockEnd;
    markup = environment[0];
  }

  const closingLine = lineContaining(state, blockEnd, startLine, endLine);
  if (closingLine < 0 || state.src.slice(blockEnd, state.eMarks[closingLine]).trim().length > 0) {
    return false;
  }

  if (silent) {
    return true;
  }

  const token = state.push(MATH_BLOCK_TOKEN, "math", 0);
  token.block = true;
  token.content = state.src.slice(contentStart, contentEnd).trim();
  token.markup = markup;
  token.map = [startLine, closingLine + 1];
  state.line = closingLine + 1;
  return true;
}

export function markdownMathPlugin(markdown: MarkdownIt): void {
  markdown.inline.ruler.before("escape", "math_inline_brackets", bracketInlineRule);
  markdown.inline.ruler.before("escape", "math_inline_dollars", dollarInlineRule);
  markdown.block.ruler.before("fence", MATH_BLOCK_TOKEN, mathBlockRule, {
    alt: ["paragraph", "reference", "blockquote", "list"],
  });
}

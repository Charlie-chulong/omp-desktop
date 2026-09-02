import { describe, expect, it } from "vitest";
import { renderMathToHtml } from "./render";

describe("renderMathToHtml", () => {
  it("renders comparison commands as math symbols", () => {
    const html = renderMathToHtml(String.raw`x \le 8`, true);
    expect(html).toContain('class="katex-display"');
    expect(html).toContain("≤");
  });

  it("renders aligned rows", () => {
    const html = renderMathToHtml(
      String.raw`\begin{aligned}
A &= 2143, \\
B &= 2341
\end{aligned}`,
      true,
    );
    expect(html).toContain("2143");
    expect(html).toContain("2341");
    expect(html).toContain('class="mtable"');
  });

  it("renders arrays with alignment and separators", () => {
    const html = renderMathToHtml(
      String.raw`\begin{array}{c|cc}
T & A & B \\
\hline
m(T) & 1 & 0
\end{array}`,
      true,
    );
    expect(html).toContain('class="mtable"');
    expect(html).toContain("vertical-separator");
    expect(html).toContain("m(T)");
  });
});

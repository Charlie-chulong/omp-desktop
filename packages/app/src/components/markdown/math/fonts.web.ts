import ams from "katex/dist/fonts/KaTeX_AMS-Regular.woff2";
import caligraphicBold from "katex/dist/fonts/KaTeX_Caligraphic-Bold.woff2";
import caligraphic from "katex/dist/fonts/KaTeX_Caligraphic-Regular.woff2";
import frakturBold from "katex/dist/fonts/KaTeX_Fraktur-Bold.woff2";
import fraktur from "katex/dist/fonts/KaTeX_Fraktur-Regular.woff2";
import mainBold from "katex/dist/fonts/KaTeX_Main-Bold.woff2";
import mainBoldItalic from "katex/dist/fonts/KaTeX_Main-BoldItalic.woff2";
import mainItalic from "katex/dist/fonts/KaTeX_Main-Italic.woff2";
import main from "katex/dist/fonts/KaTeX_Main-Regular.woff2";
import mathBoldItalic from "katex/dist/fonts/KaTeX_Math-BoldItalic.woff2";
import mathItalic from "katex/dist/fonts/KaTeX_Math-Italic.woff2";
import sansSerifBold from "katex/dist/fonts/KaTeX_SansSerif-Bold.woff2";
import sansSerifItalic from "katex/dist/fonts/KaTeX_SansSerif-Italic.woff2";
import sansSerif from "katex/dist/fonts/KaTeX_SansSerif-Regular.woff2";
import script from "katex/dist/fonts/KaTeX_Script-Regular.woff2";
import size1 from "katex/dist/fonts/KaTeX_Size1-Regular.woff2";
import size2 from "katex/dist/fonts/KaTeX_Size2-Regular.woff2";
import size3 from "katex/dist/fonts/KaTeX_Size3-Regular.woff2";
import size4 from "katex/dist/fonts/KaTeX_Size4-Regular.woff2";
import typewriter from "katex/dist/fonts/KaTeX_Typewriter-Regular.woff2";

// Metro does not resolve CSS-relative font URLs. Static imports put every KaTeX
// face in the offline app bundle; Metro and Vite both expose web font asset URLs.
const fonts: Array<[family: string, source: string, weight?: string, style?: string]> = [
  ["KaTeX_AMS", ams],
  ["KaTeX_Caligraphic", caligraphicBold, "bold"],
  ["KaTeX_Caligraphic", caligraphic],
  ["KaTeX_Fraktur", frakturBold, "bold"],
  ["KaTeX_Fraktur", fraktur],
  ["KaTeX_Main", mainBold, "bold"],
  ["KaTeX_Main", mainBoldItalic, "bold", "italic"],
  ["KaTeX_Main", mainItalic, "normal", "italic"],
  ["KaTeX_Main", main],
  ["KaTeX_Math", mathBoldItalic, "bold", "italic"],
  ["KaTeX_Math", mathItalic, "normal", "italic"],
  ["KaTeX_SansSerif", sansSerifBold, "bold"],
  ["KaTeX_SansSerif", sansSerifItalic, "normal", "italic"],
  ["KaTeX_SansSerif", sansSerif],
  ["KaTeX_Script", script],
  ["KaTeX_Size1", size1],
  ["KaTeX_Size2", size2],
  ["KaTeX_Size3", size3],
  ["KaTeX_Size4", size4],
  ["KaTeX_Typewriter", typewriter],
];

export function installMathFonts(): void {
  if (typeof document === "undefined" || document.getElementById("omp-math-fonts")) {
    return;
  }
  const stylesheet = document.createElement("style");
  stylesheet.id = "omp-math-fonts";
  stylesheet.textContent = fonts
    .map(
      ([family, source, weight = "normal", style = "normal"]) =>
        `@font-face{font-family:${family};src:url(${JSON.stringify(source)}) format("woff2");font-weight:${weight};font-style:${style};font-display:block;}`,
    )
    .join("\n");
  document.head.appendChild(stylesheet);
}

import type { ASTNode } from "react-native-markdown-display";
import { describe, expect, it } from "vitest";
import { markdownTableCellStyle } from "./table-cell-style";

const RULED_CELL = { borderRightWidth: 1, borderBottomWidth: 1 };

function astNode(type: string, key: string, index: number, children: ASTNode[] = []): ASTNode {
  return {
    type,
    sourceType: type,
    key,
    content: "",
    markup: "",
    tokenIndex: 0,
    index,
    attributes: {},
    children,
  };
}

// Shaped like react-native-markdown-display's AST: a header section, then any body section,
// with every node's `index` giving its position among its siblings.
function tableAst(columns: number, bodyRows: number): ASTNode {
  const columnIndexes = Array.from({ length: columns }, (_, column) => column);
  const sections = [
    { type: "thead", rowCount: 1 },
    { type: "tbody", rowCount: bodyRows },
  ] as const;
  return astNode(
    "table",
    "table",
    0,
    sections
      .filter(({ rowCount }) => rowCount > 0)
      .map(({ type, rowCount }, sectionIndex) =>
        astNode(
          type,
          type,
          sectionIndex,
          Array.from({ length: rowCount }, (_, row) =>
            astNode(
              "tr",
              `${type}.${row}`,
              row,
              columnIndexes.map((column) =>
                astNode(type === "thead" ? "th" : "td", `${type}.${row}.${column}`, column),
              ),
            ),
          ),
        ),
      ),
  );
}

// Resolve each cell the way the render rules see it: with its row, section and table as parents.
function resolveCellRules(table: ASTNode) {
  return table.children.flatMap((section) =>
    section.children.map((row) =>
      row.children.map((cell) => {
        const style = Object.assign(
          {},
          ...markdownTableCellStyle(RULED_CELL, cell, [row, section, table]),
        );
        return { right: style.borderRightWidth, bottom: style.borderBottomWidth };
      }),
    ),
  );
}

describe("markdownTableCellStyle", () => {
  it("keeps rules between cells and drops them along the right and bottom edges", () => {
    expect(resolveCellRules(tableAst(2, 2))).toEqual([
      [
        { right: 1, bottom: 1 },
        { right: 0, bottom: 1 },
      ],
      [
        { right: 1, bottom: 1 },
        { right: 0, bottom: 1 },
      ],
      [
        { right: 1, bottom: 0 },
        { right: 0, bottom: 0 },
      ],
    ]);
  });

  it("treats the header row as the bottom edge of a table without body rows", () => {
    expect(resolveCellRules(tableAst(2, 0))).toEqual([
      [
        { right: 1, bottom: 0 },
        { right: 0, bottom: 0 },
      ],
    ]);
  });
});

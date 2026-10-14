import type { ViewStyle } from "react-native";
import type { ASTNode } from "react-native-markdown-display";

const TABLE_CELL_LAST_COLUMN: ViewStyle = { borderRightWidth: 0 };
const TABLE_CELL_LAST_ROW: ViewStyle = { borderBottomWidth: 0 };

/**
 * The table draws its own outline, so cells along its right and bottom edges drop the rule that
 * would double it. `parents` is the render rule's ancestor list: row, then section, then table.
 */
export function markdownTableCellStyle(
  base: ViewStyle,
  cell: ASTNode,
  parents: readonly ASTNode[],
): ViewStyle[] {
  const [row, section, table] = parents;
  const style = [base];
  if (row && cell.index === row.children.length - 1) {
    style.push(TABLE_CELL_LAST_COLUMN);
  }
  const lastSection = table?.children[table.children.length - 1];
  const isLastSection = section !== undefined && section.key === lastSection?.key;
  if (row && isLastSection && row.index === section.children.length - 1) {
    style.push(TABLE_CELL_LAST_ROW);
  }
  return style;
}

import type { ReactNode } from "react";
import type { ASTNode, RenderRules } from "react-native-markdown-display";
import type { MarkdownStyles } from "../renderer";
import { MarkdownMath } from "./host";

export function createMarkdownMathRules(): RenderRules {
  return {
    math_inline: (
      node: ASTNode,
      _children: ReactNode[],
      _parent: ASTNode[],
      styles: MarkdownStyles,
      inheritedStyles = {},
    ) => (
      <MarkdownMath
        key={node.key}
        tex={String(node.content ?? "")}
        displayMode={false}
        inheritedStyles={inheritedStyles}
        textStyle={styles.text}
      />
    ),
    math_block: (
      node: ASTNode,
      _children: ReactNode[],
      _parent: ASTNode[],
      styles: MarkdownStyles,
      inheritedStyles = {},
    ) => (
      <MarkdownMath
        key={node.key}
        tex={String(node.content ?? "")}
        displayMode
        inheritedStyles={inheritedStyles}
        textStyle={styles.text}
      />
    ),
  };
}

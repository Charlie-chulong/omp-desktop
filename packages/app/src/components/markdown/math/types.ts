import type { TextStyle } from "react-native";

export interface MarkdownMathProps {
  tex: string;
  displayMode: boolean;
  inheritedStyles: TextStyle;
  textStyle: TextStyle;
}

import { Text, View } from "react-native";
import type { MarkdownMathProps } from "./types";

export function MarkdownMath({ tex, displayMode, inheritedStyles, textStyle }: MarkdownMathProps) {
  const source = displayMode ? `\\[\n${tex}\n\\]` : `\\(${tex}\\)`;
  const rendered = (
    <Text selectable style={[inheritedStyles, textStyle]}>
      {source}
    </Text>
  );
  return displayMode ? <View>{rendered}</View> : rendered;
}

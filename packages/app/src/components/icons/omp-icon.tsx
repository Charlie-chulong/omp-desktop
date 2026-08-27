import { useId } from "react";
import Svg, { Defs, LinearGradient as SvgLinearGradient, Path, Stop } from "react-native-svg";

interface OmpIconProps {
  size?: number;
  color?: string;
  gradientColors?: readonly [start: string, end: string];
}

export function OmpIcon({ size = 16, color = "currentColor", gradientColors }: OmpIconProps) {
  const gradientId = `omp-icon-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const fill = gradientColors ? `url(#${gradientId})` : color;

  return (
    <Svg width={size} height={size} viewBox="4 4 56 56" fill={fill}>
      {gradientColors ? (
        <Defs>
          <SvgLinearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <Stop offset="0%" stopColor={gradientColors[0]} />
            <Stop offset="100%" stopColor={gradientColors[1]} />
          </SvgLinearGradient>
        </Defs>
      ) : null}
      <Path d="M10 14h44v9H43v33h-9V23h-9v22h-9V23H10z" />
    </Svg>
  );
}

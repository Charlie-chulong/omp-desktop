import { ThemeProvider, useTheme } from "@react-navigation/native";
import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { Stack } from "expo-router";
import { type ReactNode, useMemo } from "react";
import { withUnistyles } from "react-native-unistyles";

interface ThemedStackBaseProps {
  backgroundColor: string;
  children?: ReactNode;
  screenOptions?: NativeStackNavigationOptions;
}

function ThemedStackBase({ backgroundColor, children, screenOptions }: ThemedStackBaseProps) {
  const navigationTheme = useTheme();
  const themedNavigationTheme = useMemo(
    () => ({
      ...navigationTheme,
      colors: { ...navigationTheme.colors, background: backgroundColor },
    }),
    [navigationTheme, backgroundColor],
  );
  const themedScreenOptions = useMemo<NativeStackNavigationOptions>(
    () => ({
      ...screenOptions,
      contentStyle: [{ backgroundColor }, screenOptions?.contentStyle],
    }),
    [backgroundColor, screenOptions],
  );

  return (
    <ThemeProvider value={themedNavigationTheme}>
      <Stack screenOptions={themedScreenOptions}>{children}</Stack>
    </ThemeProvider>
  );
}

export const ThemedStack = withUnistyles(ThemedStackBase, (theme) => ({
  backgroundColor: theme.colors.surface0,
}));

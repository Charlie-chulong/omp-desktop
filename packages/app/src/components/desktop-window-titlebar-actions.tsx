import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type Dispatch,
  type ReactElement,
  type ReactNode,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import invariant from "tiny-invariant";
import { isWeb } from "@/constants/platform";

type PortalContainer = Parameters<typeof createPortal>[1];
interface TitlebarActionsContextValue {
  host: PortalContainer | null;
  setHost: Dispatch<SetStateAction<PortalContainer | null>>;
}

const TitlebarActionsContext = createContext<TitlebarActionsContextValue | null>(null);

function useTitlebarActionsContext(): TitlebarActionsContextValue {
  const value = useContext(TitlebarActionsContext);
  invariant(value, "DesktopWindowTitlebarActionsProvider is required");
  return value;
}

export function DesktopWindowTitlebarActionsProvider({
  children,
}: {
  children: ReactNode;
}): ReactElement {
  const [host, setHost] = useState<PortalContainer | null>(null);
  const value = useMemo(() => ({ host, setHost }), [host]);
  return (
    <TitlebarActionsContext.Provider value={value}>{children}</TitlebarActionsContext.Provider>
  );
}

export function DesktopWindowTitlebarActionsHost(): ReactElement {
  const { setHost } = useTitlebarActionsContext();
  const handleHostRef = useCallback(
    (node: View | null) => {
      setHost(node as unknown as PortalContainer | null);
    },
    [setHost],
  );

  return (
    <View
      ref={handleHostRef}
      pointerEvents="box-none"
      style={styles.host}
      testID="desktop-window-titlebar-actions"
    />
  );
}

export function DesktopWindowTitlebarActions({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}): ReactElement | null {
  const { host } = useTitlebarActionsContext();

  if (!active || !isWeb || !host) return null;
  return createPortal(children, host);
}

const styles = StyleSheet.create((theme) => ({
  host: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));

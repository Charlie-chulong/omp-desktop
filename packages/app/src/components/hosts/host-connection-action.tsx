import { useCallback, useMemo, useRef, useState, type ReactElement } from "react";
import {
  Pressable,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import { Power, PowerOff } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useToast } from "@/contexts/toast-context";
import { useLocalDaemonServerIdState } from "@/hooks/use-is-local-daemon";
import { useHostMutations, useHosts } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";

const ThemedPower = withUnistyles(Power);
const ThemedPowerOff = withUnistyles(PowerOff);
const ThemedLoadingSpinner = withUnistyles(LoadingSpinner);
const mutedIconMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
  size: theme.iconSize.sm,
});

export interface HostConnectionActionProps {
  serverId: string;
  compact?: boolean;
}

export function HostConnectionAction({
  serverId,
  compact = false,
}: HostConnectionActionProps): ReactElement | null {
  const { t } = useTranslation();
  const toast = useToast();
  const hosts = useHosts();
  const { setHostConnectionEnabled } = useHostMutations();
  const localDaemon = useLocalDaemonServerIdState();
  const pendingRef = useRef(false);
  const [pending, setPending] = useState(false);
  const host = hosts.find((candidate) => candidate.serverId === serverId);

  const enabled = host?.lifecycle.autoConnect !== false;
  const action = enabled ? "disconnect" : "reconnect";
  const label = t(`hostConnection.${action}`);
  const accessibilityLabel = t(`hostConnection.${action}Accessibility`, {
    host: host?.label ?? serverId,
  });
  const hint = t(`hostConnection.${action}Hint`);

  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      if (!host || pendingRef.current) return;

      pendingRef.current = true;
      setPending(true);
      void setHostConnectionEnabled(serverId, !enabled)
        .catch((error: unknown) => {
          const reason = error instanceof Error ? error.message : String(error);
          toast.error(
            t(`hostConnection.${action}Failed`, {
              host: host.label,
              reason,
            }),
          );
        })
        .finally(() => {
          pendingRef.current = false;
          setPending(false);
        });
    },
    [action, enabled, host, serverId, setHostConnectionEnabled, t, toast],
  );
  const accessibilityState = useMemo(() => ({ disabled: pending, busy: pending }), [pending]);
  const compactStyle = useCallback(
    ({ hovered, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.compactButton,
      (Boolean(hovered) || pressed) && styles.compactButtonActive,
      pending && styles.compactButtonDisabled,
    ],
    [pending],
  );

  if (!host || localDaemon.status !== "resolved" || localDaemon.serverId === serverId) {
    return null;
  }

  const testID = `host-${action}-${serverId}`;

  if (!compact) {
    return (
      <Button
        variant={enabled ? "outline" : "secondary"}
        size="sm"
        leftIcon={enabled ? PowerOff : Power}
        loading={pending}
        disabled={pending}
        onPress={handlePress}
        accessibilityLabel={accessibilityLabel}
        accessibilityHint={hint}
        testID={testID}
      >
        {label}
      </Button>
    );
  }
  const Icon = enabled ? ThemedPowerOff : ThemedPower;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={hint}
      accessibilityState={accessibilityState}
      disabled={pending}
      hitSlop={8}
      onPress={handlePress}
      style={compactStyle}
      testID={testID}
    >
      {pending ? (
        <ThemedLoadingSpinner uniProps={mutedIconMapping} />
      ) : (
        <Icon uniProps={mutedIconMapping} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  compactButton: {
    alignItems: "center",
    justifyContent: "center",
    width: theme.iconSize.lg,
    height: theme.iconSize.lg,
    borderRadius: theme.borderRadius.md,
  },
  compactButtonActive: {
    backgroundColor: theme.colors.surface3,
  },
  compactButtonDisabled: {
    opacity: theme.opacity[50],
  },
}));

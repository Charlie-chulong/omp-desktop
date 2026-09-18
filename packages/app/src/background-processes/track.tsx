import { Square, Terminal } from "lucide-react-native";
import { Fragment, useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { BackgroundProcess } from "@omp-desktop/protocol/background-processes";
import { ComposerTrackPill, ComposerTrackRow } from "@/composer/tracks";
import type { Theme } from "@/styles/theme";
import type { BackgroundProcessesState } from "./query";

const ThemedSquare = withUnistyles(Square);
const ThemedTerminal = withUnistyles(Terminal);
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const destructiveColorMapping = (theme: Theme) => ({
  color: theme.colors.destructive,
});
const trackIcon = <ThemedTerminal size={14} uniProps={foregroundMutedColorMapping} />;
const processScopes = ["agent", "workspace"] as const;
const RUNNING_STATUSES: Partial<Record<BackgroundProcess["status"], true>> = {
  starting: true,
  running: true,
  ready: true,
  restarting: true,
  stopping: true,
};
const idleStopAccessibilityState = { busy: false, disabled: false };
const stoppingAccessibilityState = { busy: true, disabled: true };

function BackgroundProcessRow({
  process,
  unavailable,
  stopping,
  onOpen,
  onStop,
}: {
  process: BackgroundProcess;
  unavailable: boolean;
  stopping: boolean;
  onOpen: (process: BackgroundProcess) => void;
  onStop: (process: BackgroundProcess) => void;
}) {
  const { t } = useTranslation();
  const handlePress = useCallback(() => onOpen(process), [onOpen, process]);
  const handleStop = useCallback(() => onStop(process), [onStop, process]);
  const status = unavailable ? "unknown" : process.status;
  const isRunning = RUNNING_STATUSES[process.status] === true;
  const canStop = !unavailable && isRunning;
  const stopAccessibilityState = stopping ? stoppingAccessibilityState : idleStopAccessibilityState;
  return (
    <ComposerTrackRow
      testID={`background-process-${process.id}`}
      accessibilityLabel={`${process.name}: ${t(`backgroundProcesses.status.${process.status}`)}`}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("backgroundProcesses.openOutput", { name: process.name })}
        onPress={handlePress}
        style={styles.processLink}
      >
        <ThemedTerminal size={14} uniProps={foregroundMutedColorMapping} />
        <View style={styles.body}>
          <View style={styles.heading}>
            <Text style={styles.name} numberOfLines={1}>
              {process.name}
            </Text>
            <Text style={styles.detail}>{t(`backgroundProcesses.status.${status}`)}</Text>
          </View>
          <Text style={styles.detail} numberOfLines={1}>
            {process.command}
          </Text>
          <Text style={styles.detail} numberOfLines={1}>
            {process.cwd}
          </Text>
          {process.exitCode !== null ? (
            <Text style={styles.detail}>
              {t("backgroundProcesses.exitCode", { code: process.exitCode })}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {canStop ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("backgroundProcesses.stopProcess", { name: process.name })}
          accessibilityState={stopAccessibilityState}
          disabled={stopping}
          onPress={handleStop}
          style={styles.stopButton}
          testID={`background-process-stop-${process.id}`}
        >
          <ThemedSquare size={12} uniProps={destructiveColorMapping} />
          <Text style={styles.stopLabel}>{t("backgroundProcesses.stop")}</Text>
        </Pressable>
      ) : null}
    </ComposerTrackRow>
  );
}

export function BackgroundProcessesTrack({
  state,
  onOpen,
}: {
  state: BackgroundProcessesState;
  onOpen: (process: BackgroundProcess) => void;
}) {
  const { t } = useTranslation();
  const handleStop = useCallback(
    (process: BackgroundProcess) => {
      void state.stopProcess(process.id).catch(() => undefined);
    },
    [state],
  );
  const running = state.processes.filter(
    (process) => RUNNING_STATUSES[process.status] === true,
  ).length;
  const bucket = !state.error && running > 0 ? ("running" as const) : null;
  let segmentText = t("backgroundProcesses.running", { count: running });
  if (state.error) {
    segmentText = t(
      state.isConnected
        ? "backgroundProcesses.unavailable"
        : "backgroundProcesses.disconnectedShort",
    );
  }
  const segments = [{ bucket, text: segmentText }];
  return (
    <ComposerTrackPill
      testID="background-processes-track"
      panelTitle={t("backgroundProcesses.title")}
      accessibilityLabel={state.error ?? t("backgroundProcesses.running", { count: running })}
      icon={trackIcon}
      segments={segments}
    >
      {state.error ? (
        <ComposerTrackRow>
          <Text style={styles.error}>{state.error}</Text>
        </ComposerTrackRow>
      ) : null}
      {state.stopError ? (
        <ComposerTrackRow>
          <Text style={styles.error}>{state.stopError}</Text>
        </ComposerTrackRow>
      ) : null}
      {processScopes.map((scope) => {
        const rows = state.processes.filter((process) => process.scope === scope);
        if (rows.length === 0) return null;
        return (
          <Fragment key={scope}>
            <ComposerTrackRow>
              <Text style={styles.group}>{t(`backgroundProcesses.scope.${scope}`)}</Text>
            </ComposerTrackRow>
            {rows.map((process) => (
              <BackgroundProcessRow
                key={process.id}
                process={process}
                unavailable={Boolean(state.error)}
                onOpen={onOpen}
                stopping={state.stoppingProcessIds.has(process.id)}
                onStop={handleStop}
              />
            ))}
          </Fragment>
        );
      })}
    </ComposerTrackPill>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: { flex: 1, minWidth: 0, gap: 3 },
  processLink: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 8 },
  stopButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.destructive,
  },
  stopLabel: { color: theme.colors.destructive, fontSize: 11, fontWeight: "600" },
  heading: { flexDirection: "row", alignItems: "center", gap: 8 },
  name: { flex: 1, color: theme.colors.foreground, fontSize: 12 },
  detail: { color: theme.colors.foregroundMuted, fontSize: 11 },
  group: { color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "600" },
  error: { color: theme.colors.destructive, fontSize: 12, flexShrink: 1 },
}));

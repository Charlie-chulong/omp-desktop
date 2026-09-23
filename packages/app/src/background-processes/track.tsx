import {
  CircleAlert,
  CircleCheck,
  CircleDot,
  CircleHelp,
  CircleMinus,
  CircleX,
  Square,
  Terminal,
} from "lucide-react-native";
import { Fragment, useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { BackgroundProcess } from "@omp-desktop/protocol/background-processes";
import { ComposerTrackPill, ComposerTrackRow } from "@/composer/tracks";
import type { Theme } from "@/styles/theme";
import type { BackgroundProcessesState } from "./query";

const ThemedSquare = withUnistyles(Square);
const ThemedCircleAlert = withUnistyles(CircleAlert);
const ThemedCircleCheck = withUnistyles(CircleCheck);
const ThemedCircleDot = withUnistyles(CircleDot);
const ThemedCircleHelp = withUnistyles(CircleHelp);
const ThemedCircleMinus = withUnistyles(CircleMinus);
const ThemedCircleX = withUnistyles(CircleX);
const ThemedTerminal = withUnistyles(Terminal);
const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});
const destructiveColorMapping = (theme: Theme) => ({
  color: theme.colors.destructive,
});
const runningColorMapping = (theme: Theme) => ({ color: theme.colors.statusDotRunning });
const successColorMapping = (theme: Theme) => ({ color: theme.colors.statusSuccess });
const warningColorMapping = (theme: Theme) => ({ color: theme.colors.statusWarning });
const dangerColorMapping = (theme: Theme) => ({ color: theme.colors.statusDanger });
function ProcessStatusIcon({
  status,
  exitCode,
}: {
  status: BackgroundProcess["status"];
  exitCode: number | null;
}) {
  switch (status) {
    case "running":
      return <ThemedCircleDot size={16} uniProps={runningColorMapping} />;
    case "ready":
      return <ThemedCircleCheck size={16} uniProps={successColorMapping} />;
    case "starting":
    case "restarting":
    case "stopping":
      return <ThemedCircleAlert size={16} uniProps={warningColorMapping} />;
    case "failed":
      return <ThemedCircleX size={16} uniProps={dangerColorMapping} />;
    case "exited":
      return exitCode === 0 ? (
        <ThemedCircleCheck size={16} uniProps={successColorMapping} />
      ) : exitCode === null ? (
        <ThemedCircleMinus size={16} uniProps={foregroundMutedColorMapping} />
      ) : (
        <ThemedCircleX size={16} uniProps={dangerColorMapping} />
      );
    case "cancelled":
      return <ThemedCircleMinus size={16} uniProps={foregroundMutedColorMapping} />;
    case "unknown":
      return <ThemedCircleHelp size={16} uniProps={foregroundMutedColorMapping} />;
  }
}
const trackIcon = <ThemedTerminal size={14} uniProps={foregroundMutedColorMapping} />;
const processScopes = ["agent", "workspace"] as const;
const RUNNING_STATUSES: Partial<Record<BackgroundProcess["status"], true>> = {
  starting: true,
  running: true,
  ready: true,
  restarting: true,
  stopping: true,
};
export function hasVisibleBackgroundProcessState(state: BackgroundProcessesState): boolean {
  return (
    state.error !== null || state.processes.some((process) => RUNNING_STATUSES[process.status])
  );
}

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
      accessibilityLabel={`${process.name}: ${t(`backgroundProcesses.status.${status}`)}`}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t("backgroundProcesses.openOutput", { name: process.name })}
        onPress={handlePress}
        style={styles.processLink}
      >
        <ThemedTerminal size={14} uniProps={foregroundMutedColorMapping} />
        <View style={styles.body}>
          <Text style={styles.name} numberOfLines={1}>
            {process.name}
          </Text>
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
      <View style={styles.actions}>
        <View
          accessibilityLabel={t(`backgroundProcesses.status.${status}`)}
          accessibilityRole="text"
          style={styles.status}
        >
          <ProcessStatusIcon status={status} exitCode={process.exitCode} />
        </View>
        <View style={styles.stopSlot}>
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
              <ThemedSquare size={14} uniProps={destructiveColorMapping} />
            </Pressable>
          ) : null}
        </View>
      </View>
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
  const running = state.processes.reduce(
    (count, process) => count + Number(RUNNING_STATUSES[process.status] === true),
    0,
  );
  if (running === 0 && !state.error) return null;
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
        const rows = state.processes
          .filter((process) => process.scope === scope)
          .sort(
            (a, b) =>
              Number(RUNNING_STATUSES[b.status] === true) -
              Number(RUNNING_STATUSES[a.status] === true),
          );
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
  processLink: { flex: 1, minWidth: 0, flexDirection: "row", alignItems: "flex-start", gap: 8 },
  actions: { flexDirection: "row", alignItems: "center", gap: 8, alignSelf: "flex-start" },
  status: { width: 20, alignItems: "center" },
  stopSlot: { width: 30, alignItems: "center" },
  stopButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.destructive,
  },
  name: { color: theme.colors.foreground, fontSize: 12 },
  detail: { color: theme.colors.foregroundMuted, fontSize: 11 },
  group: { color: theme.colors.foregroundMuted, fontSize: 11, fontWeight: "600" },
  error: { color: theme.colors.destructive, fontSize: 12, flexShrink: 1 },
}));

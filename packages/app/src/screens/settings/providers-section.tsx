import { useMemo } from "react";
import type { TFunction } from "i18next";
import type { ProviderSnapshotEntry } from "@omp-desktop/protocol/agent-types";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { getProviderIcon } from "@/components/provider-icons";
import { ProviderDiagnosticSheet } from "@/components/provider-diagnostic-sheet";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { filterSelectableModels } from "@/provider-selection/model-catalog";
import { useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { SettingsSection } from "@/screens/settings/settings-section";
import { ImageGenerationSettingsSection } from "./image-generation-card";
import type { Theme } from "@/styles/theme";
import { settingsStyles } from "@/styles/settings";

interface ProviderStatus {
  tone: "success" | "warning" | "danger" | "loading";
  label: string;
  modelCount: number | null;
}

function getProviderStatus(status: string, modelCount: number, t: TFunction): ProviderStatus {
  if (status === "loading") {
    return { tone: "loading", label: t("settings.providers.statuses.loading"), modelCount: null };
  }
  if (status === "error") {
    return { tone: "danger", label: t("settings.providers.statuses.error"), modelCount: null };
  }
  if (status === "ready") {
    return {
      tone: "success",
      label: t("settings.providers.statuses.available"),
      modelCount: modelCount > 0 ? modelCount : null,
    };
  }
  return {
    tone: "warning",
    label: t("settings.providers.statuses.notInstalled"),
    modelCount: null,
  };
}

function getDotColor(tone: ProviderStatus["tone"], theme: Theme): string {
  switch (tone) {
    case "success":
      return theme.colors.statusSuccess;
    case "warning":
      return theme.colors.statusWarning;
    case "danger":
      return theme.colors.statusDanger;
    default:
      return theme.colors.foregroundMuted;
  }
}

function StatusIndicator({ status, compact }: { status: ProviderStatus; compact: boolean }) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const dotStyle = useMemo(
    () => [styles.statusDot, { backgroundColor: getDotColor(status.tone, theme) }],
    [status.tone, theme],
  );

  return (
    <View style={styles.statusRow}>
      {status.tone === "loading" ? (
        <LoadingSpinner size={10} color={theme.colors.foregroundMuted} />
      ) : (
        <View style={dotStyle} />
      )}
      {!compact ? (
        <>
          <Text style={styles.statusLabel}>{status.label}</Text>
          {status.modelCount !== null ? (
            <>
              <Text style={styles.separator}>·</Text>
              <Text style={styles.statusLabel}>
                {status.modelCount === 1
                  ? t("settings.providers.models.one")
                  : t("settings.providers.models.many", { count: status.modelCount })}
              </Text>
            </>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

function OmpProviderRow({ entry }: { entry: ProviderSnapshotEntry }) {
  const { t } = useTranslation();
  const { theme } = useUnistyles();
  const isCompact = useIsCompactFormFactor();
  const OmpIcon = getProviderIcon("omp");
  const modelCount = filterSelectableModels(entry.models ?? null)?.length ?? 0;
  const providerStatus = getProviderStatus(entry.status, modelCount, t);
  const providerError =
    entry.status === "error" && typeof entry.error === "string" && entry.error.trim().length > 0
      ? entry.error.trim()
      : null;

  return (
    <View style={[settingsStyles.row, styles.row]} testID="omp-runtime-settings">
      <View style={styles.rowContent}>
        <OmpIcon size={theme.iconSize.md} color={theme.colors.foreground} />
        <View style={styles.textColumn}>
          <View style={styles.titleRow}>
            <Text style={settingsStyles.rowTitle} numberOfLines={1}>
              Oh My Pi
            </Text>
            {!isCompact ? <Text style={styles.separator}>·</Text> : null}
            <StatusIndicator status={providerStatus} compact={isCompact} />
          </View>
          {providerError && !isCompact ? (
            <Text style={styles.errorText} numberOfLines={3}>
              {providerError}
            </Text>
          ) : null}
        </View>
      </View>
    </View>
  );
}

export interface ProvidersSectionProps {
  serverId: string;
}

export function ProvidersSection({ serverId }: ProvidersSectionProps) {
  const { t } = useTranslation();
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { entries, isLoading } = useProvidersSnapshot(serverId);
  const ompEntry = entries?.find((entry) => entry.provider === "omp") ?? null;

  return (
    <>
      <SettingsSection
        title={t("settings.providers.title")}
        testID="host-page-providers-card"
        style={styles.sectionSpacing}
      >
        {!serverId || !isConnected ? (
          <View style={[settingsStyles.card, styles.emptyCard]}>
            <Text style={styles.emptyText}>{t("settings.providers.unavailable")}</Text>
          </View>
        ) : null}
        {serverId && isConnected && isLoading ? (
          <View style={[settingsStyles.card, styles.emptyCard]}>
            <Text style={styles.emptyText}>{t("settings.providers.loading")}</Text>
          </View>
        ) : null}
        {serverId && isConnected && !isLoading && ompEntry ? (
          <>
            <View style={settingsStyles.card}>
              <OmpProviderRow entry={ompEntry} />
            </View>
            <ProviderDiagnosticSheet provider="omp" serverId={serverId} visible inline />
          </>
        ) : null}
      </SettingsSection>
      <ImageGenerationSettingsSection serverId={serverId} />
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  sectionSpacing: {
    marginBottom: theme.spacing[4],
  },
  emptyCard: {
    padding: theme.spacing[4],
    alignItems: "center",
  },
  emptyText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
  row: {
    gap: theme.spacing[3],
    minHeight: 56,
  },
  rowHovered: {
    backgroundColor: theme.colors.surface2,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface3,
  },
  rowContent: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  textColumn: {
    flex: 1,
    gap: theme.spacing[1],
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  statusLabel: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  separator: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  errorText: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
}));

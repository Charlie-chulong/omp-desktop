import { useCallback, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type {
  OmpStatsMetrics,
  OmpStatsRange,
  OmpStatsSnapshot,
} from "@omp-desktop/protocol/omp-stats";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { useOmpStats, type OmpStatsView } from "./use-omp-stats";

const RANGES: readonly OmpStatsRange[] = ["1h", "24h", "7d", "30d", "90d", "all"];

export function OmpStatsSettingsSection({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const [range, setRange] = useState<OmpStatsRange>("24h");
  const { view, refresh } = useOmpStats(serverId, range);
  const busy = view.kind === "loading" || (view.kind === "ready" && view.isRefreshing);
  const onRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);
  const refreshButton = useMemo(
    () => (
      <Button
        testID="omp-native-stats-refresh"
        variant="ghost"
        size="sm"
        leftIcon={RefreshCw}
        loading={busy}
        onPress={onRefresh}
        accessibilityLabel={t("providerUsage.nativeStats.refresh")}
      >
        {t(busy ? "providerUsage.nativeStats.refreshing" : "providerUsage.nativeStats.refresh")}
      </Button>
    ),
    [busy, onRefresh, t],
  );
  return (
    <SettingsSection
      title={t("providerUsage.nativeStats.title")}
      testID="omp-native-stats-section"
      trailing={refreshButton}
    >
      <View style={styles.ranges}>
        {RANGES.map((value) => (
          <OmpStatsRangeButton
            key={value}
            value={value}
            selected={value === range}
            onSelect={setRange}
          />
        ))}
      </View>
      <Text style={styles.note}>{t("providerUsage.nativeStats.indexNotice")}</Text>
      <OmpStatsBody view={view} onRefresh={onRefresh} />
    </SettingsSection>
  );
}

function OmpStatsRangeButton({
  value,
  selected,
  onSelect,
}: {
  value: OmpStatsRange;
  selected: boolean;
  onSelect: (range: OmpStatsRange) => void;
}) {
  const { t } = useTranslation();
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  const onPress = useCallback(() => onSelect(value), [onSelect, value]);
  return (
    <Button
      testID={`omp-native-stats-range-${value}`}
      size="sm"
      variant={selected ? "secondary" : "ghost"}
      accessibilityState={accessibilityState}
      onPress={onPress}
    >
      {t(`providerUsage.nativeStats.ranges.${value}`)}
    </Button>
  );
}

function OmpStatsBody({ view, onRefresh }: { view: OmpStatsView; onRefresh: () => void }) {
  const { t } = useTranslation();
  if (view.kind === "loading")
    return (
      <View style={[settingsStyles.card, styles.card]}>
        <Text style={styles.note}>{t("providerUsage.nativeStats.loading")}</Text>
      </View>
    );
  if (view.kind === "error") {
    return (
      <Alert
        variant="error"
        title={t("providerUsage.nativeStats.errorTitle")}
        description={t(`providerUsage.nativeStats.${view.reason}`)}
      >
        <Button variant="outline" size="sm" onPress={onRefresh}>
          {t("providerUsage.nativeStats.retry")}
        </Button>
      </Alert>
    );
  }
  if (view.stats.status !== "available") {
    return (
      <Alert
        variant="error"
        title={t("providerUsage.nativeStats.errorTitle")}
        description={t(`providerUsage.nativeStats.reasons.${view.stats.reason}`)}
      >
        <Button variant="outline" size="sm" onPress={onRefresh}>
          {t("providerUsage.nativeStats.retry")}
        </Button>
      </Alert>
    );
  }
  return (
    <>
      {view.refreshFailed ? (
        <Alert variant="error" description={t("providerUsage.nativeStats.refreshFailed")} />
      ) : null}
      <OmpStatsSnapshotCards snapshot={view.stats} />
    </>
  );
}

function OmpStatsSnapshotCards({ snapshot }: { snapshot: OmpStatsSnapshot }) {
  const { t, i18n } = useTranslation();
  const number = new Intl.NumberFormat(i18n.language);
  const currency = new Intl.NumberFormat(i18n.language, {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  });
  const overall = snapshot.overall;
  const metrics = [
    ["requests", number.format(overall.totalRequests)],
    ["failed", number.format(overall.failedRequests)],
    ["transcripts", number.format(overall.transcriptCount)],
    ["totalTokens", number.format(overall.totalTokens)],
    ["input", number.format(overall.totalInputTokens)],
    ["output", number.format(overall.totalOutputTokens)],
    ["cacheRead", number.format(overall.totalCacheReadTokens)],
    ["cacheWrite", number.format(overall.totalCacheWriteTokens)],
    [
      "cost",
      overall.unpricedRequests > 0 && overall.unpricedRequests === overall.totalRequests
        ? t("providerUsage.nativeStats.unpricedCost")
        : currency.format(overall.totalCostUsd),
    ],
  ] as const;
  const groups: Array<{
    key: "byProvider" | "byModel" | "byAgentType";
    rows: Array<{ id: string; label: string; metrics: OmpStatsMetrics }>;
  }> = [
    {
      key: "byProvider",
      rows: snapshot.byProvider.map((row) => ({
        id: row.provider,
        label: row.provider,
        metrics: row,
      })),
    },
    {
      key: "byModel",
      rows: snapshot.byModel.map((row) => ({
        id: JSON.stringify([row.provider, row.model]),
        label: `${row.provider} / ${row.model}`,
        metrics: row,
      })),
    },
    {
      key: "byAgentType",
      rows: snapshot.byAgentType.map((row) => ({
        id: row.agentType,
        label: t(`providerUsage.nativeStats.agentTypes.${row.agentType}`),
        metrics: row,
      })),
    },
  ];
  return (
    <>
      <View style={[settingsStyles.card, styles.card]} testID="omp-native-stats-summary">
        <Text style={styles.note}>
          {t("providerUsage.nativeStats.scope", {
            profile:
              snapshot.scope.profile === "default"
                ? t("providerUsage.nativeStats.defaultProfile")
                : snapshot.scope.profile,
          })}
        </Text>
        {overall.totalRequests === 0 ? (
          <Text style={styles.note}>{t("providerUsage.nativeStats.empty")}</Text>
        ) : null}
        {metrics.map(([key, value]) => (
          <View key={key} style={styles.row}>
            <Text style={styles.label}>{t(`providerUsage.nativeStats.metrics.${key}`)}</Text>
            <Text style={styles.value} testID={`omp-native-stats-${key}`}>
              {value}
            </Text>
          </View>
        ))}
        <Text style={styles.note}>{t("providerUsage.nativeStats.tokenNotice")}</Text>
        <Text style={styles.note}>{t("providerUsage.nativeStats.transcriptNotice")}</Text>
        <Text style={styles.note}>{t("providerUsage.nativeStats.costNotice")}</Text>
        {overall.unpricedRequests > 0 ? (
          <Text style={styles.note}>
            {t("providerUsage.nativeStats.unpriced", { count: overall.unpricedRequests })}
          </Text>
        ) : null}
        <Text style={styles.note} testID="omp-native-stats-indexedThrough">
          {snapshot.indexedThrough === null
            ? t("providerUsage.nativeStats.noIndexedRequests")
            : t("providerUsage.nativeStats.indexedThrough", {
                time: new Date(snapshot.indexedThrough).toLocaleString(i18n.language),
              })}
        </Text>
        <Text style={styles.note} testID="omp-native-stats-fetchedAt">
          {t("providerUsage.nativeStats.fetchedAt", {
            time: new Date(snapshot.fetchedAt).toLocaleString(i18n.language),
          })}
        </Text>
      </View>
      {groups
        .filter((group) => group.rows.length > 0)
        .map((group) => (
          <View
            key={group.key}
            style={[settingsStyles.card, styles.card]}
            testID={`omp-native-stats-${group.key}`}
          >
            <Text style={styles.heading}>{t(`providerUsage.nativeStats.${group.key}`)}</Text>
            {group.rows.map(({ id, label, metrics: row }) => (
              <View
                key={id}
                style={styles.breakdownRow}
                testID={`omp-native-stats-${group.key}-row`}
              >
                <Text style={styles.label} testID="omp-native-stats-breakdown-label">
                  {label}
                </Text>
                <Text style={styles.note} testID="omp-native-stats-breakdown-metrics">
                  {t("providerUsage.nativeStats.breakdown", {
                    requests: number.format(row.totalRequests),
                    tokens: number.format(row.totalTokens),
                    cost:
                      row.unpricedRequests > 0 && row.unpricedRequests === row.totalRequests
                        ? t("providerUsage.nativeStats.unpricedCost")
                        : currency.format(row.totalCostUsd),
                  })}
                </Text>
                {row.unpricedRequests > 0 ? (
                  <Text style={styles.note}>
                    {t("providerUsage.nativeStats.unpriced", { count: row.unpricedRequests })}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
        ))}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  ranges: { flexDirection: "row", flexWrap: "wrap", gap: theme.spacing[1] },
  card: { padding: theme.spacing[4], gap: theme.spacing[3] },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing[3],
  },
  label: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, flexShrink: 1 },
  value: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    textAlign: "right",
    flexShrink: 1,
  },
  heading: { color: theme.colors.foreground, fontSize: theme.fontSize.base },
  note: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  breakdownRow: { gap: theme.spacing[1] },
}));

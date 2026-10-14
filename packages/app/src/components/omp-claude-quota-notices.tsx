import type { OmpProviderAccountQuota } from "@omp-desktop/protocol/messages";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import { useOmpQuotaClock } from "@/hooks/use-omp-account-quota";
import { formatOmpQuotaCountdown, formatOmpQuotaResetTime } from "./omp-provider-quota";

const MODEL_LIMIT_LABELS = {
  five_hour: "providerUsage.modelFiveHourLimited",
  seven_day: "providerUsage.modelWeeklyLimited",
  unknown: "providerUsage.modelLimited",
} as const;

/** Query retry and model retry are independent; neither confirms quota recovery. */
export function OmpClaudeQuotaNotices({ quota }: { quota?: OmpProviderAccountQuota }) {
  const { t, i18n } = useTranslation();
  const model = quota?.modelRateLimit;
  const now = useOmpQuotaClock(Boolean(model?.resetsAt));
  if (!quota) return null;
  const query = quota.queryError;
  const queryRetry = formatOmpQuotaResetTime(query?.retryAt, i18n.language);
  const modelRetry = formatOmpQuotaResetTime(model?.resetsAt, i18n.language);
  const countdown = formatOmpQuotaCountdown(model?.resetsAt, now, {
    day: t("settings.providers.omp.codexQuota.day"),
    hour: t("settings.providers.omp.codexQuota.hour"),
    minute: t("settings.providers.omp.codexQuota.minute"),
  });
  const hasPreviousUsage = [
    quota.fiveHourUsedPct,
    quota.weeklyUsedPct,
    ...(quota.modelWindows ?? []).map((window) => window.usedPct),
  ].some((value) => typeof value === "number" && Number.isFinite(value));
  let queryMessage: string | null = null;
  if (query) {
    queryMessage = t(`providerUsage.queryFailure.${query.kind}`, {
      status: query.httpStatus ?? "—",
    });
  } else if (quota.status !== "available") {
    queryMessage = quota.error || t("providerUsage.usageUnknown");
  }
  return (
    <View style={styles.notices}>
      {queryMessage ? <Text style={styles.error}>{queryMessage}</Text> : null}
      {queryRetry ? (
        <Text style={styles.detail}>{t("providerUsage.queryRetryAt", { time: queryRetry })}</Text>
      ) : null}
      {quota.status !== "available" && hasPreviousUsage ? (
        <Text style={styles.detail}>{t("providerUsage.previousObservation")}</Text>
      ) : null}
      {model ? (
        <>
          <Text style={styles.warning}>{t(MODEL_LIMIT_LABELS[model.scope])}</Text>
          {modelRetry ? (
            <Text style={styles.detail}>
              {t("providerUsage.modelRetryAt", { time: modelRetry })}
            </Text>
          ) : null}
          {countdown !== null ? (
            <Text style={styles.detail}>
              {countdown === ""
                ? t("providerUsage.awaitingVerification")
                : t("providerUsage.modelRetryIn", { time: countdown })}
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  notices: { gap: theme.spacing[1] },
  error: { color: theme.colors.destructive, fontSize: theme.fontSize.sm },
  warning: { color: theme.colors.palette.amber[500], fontSize: theme.fontSize.sm },
  detail: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));

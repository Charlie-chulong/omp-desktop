import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type {
  OmpClaudeLimitResetGrant,
  OmpClaudeLimitResets,
  OmpProviderManagement,
} from "@omp-desktop/protocol/messages";
import { Button } from "@/components/ui/button";
import {
  refreshOmpAccountQuotaManagement,
  useOmpQuotaClock,
  useOmpQuotaReachedRefresh,
} from "@/hooks/use-omp-account-quota";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { formatOmpModelQuotaLabel } from "@/provider-usage/omp-account";
import { useSessionStore } from "@/stores/session-store";
import { confirmDialog } from "@/utils/confirm-dialog";
import { OmpQuotaServerContext } from "./omp-codex-quota-details";
import { formatOmpQuotaCountdown, formatOmpQuotaResetTime } from "./omp-provider-quota";
import {
  claudeGrantClearsScope,
  claudeGrantScopes,
  claudeGrantState,
  claudeLimitResetActions,
  claudeResetCount,
  claudeResetRefreshTimes,
} from "./omp-claude-limit-reset";

type Account = NonNullable<OmpProviderManagement["loginProviders"][number]["accounts"]>[number];
const PREFIX = "settings.providers.omp.claudeLimitResets.";
const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

function ClaudeResetInventorySummary({
  inventory,
  count,
  date,
}: {
  inventory: OmpClaudeLimitResets | undefined;
  count: number | null;
  date(value: string | null): string;
}) {
  const { t } = useTranslation();
  let countLabel = "count";
  if (inventory?.status === "error") countLabel = "error";
  else if (inventory?.status !== "available") countLabel = "unavailable";
  else if (count === null) countLabel = "countUnknown";
  let eligibilityLabel = "unknownEligibility";
  if (inventory?.eligible === true) eligibilityLabel = "eligible";
  else if (inventory?.eligible === false) eligibilityLabel = "ineligible";
  return (
    <>
      <Text style={styles.title}>{t(`${PREFIX}title`)}</Text>
      <Text style={styles.muted}>{t(`${PREFIX}${countLabel}`, { count })}</Text>
      {inventory?.status === "available" ? (
        <>
          <Text style={styles.muted}>{t(`${PREFIX}${eligibilityLabel}`)}</Text>
          {inventory.ineligibleReason ? (
            <Text style={styles.muted}>
              {t(`${PREFIX}reason`, { reason: inventory.ineligibleReason })}
            </Text>
          ) : null}
          {inventory.grants.length === 0 ? (
            <Text style={styles.muted}>{t(`${PREFIX}empty`)}</Text>
          ) : null}
          {inventory.cooldownUntil ? (
            <Text style={styles.muted}>
              {t(`${PREFIX}cooldownUntil`, { time: date(inventory.cooldownUntil) })}
            </Text>
          ) : null}
        </>
      ) : null}
      {inventory?.error ? (
        <Text accessibilityRole="alert" style={styles.muted}>
          {inventory.error}
        </Text>
      ) : null}
    </>
  );
}

export function OmpClaudeLimitResetDetails({
  account,
  accountLabel,
}: {
  account: Account;
  accountLabel: string;
}) {
  const { t, i18n } = useTranslation();
  const serverId = useContext(OmpQuotaServerContext);
  const client = useHostRuntimeClient(serverId ?? "");
  const supported = useSessionStore(
    (state) => state.sessions[serverId ?? ""]?.serverInfo?.features?.ompClaudeLimitResets === true,
  );
  const queryClient = useQueryClient();
  const now = useOmpQuotaClock(Boolean(serverId));
  const inventory = account.quota?.limitResets;
  useSyncExternalStore(
    claudeLimitResetActions.subscribe,
    claudeLimitResetActions.getSnapshot,
    claudeLimitResetActions.getSnapshot,
  );
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const current = useRef({
    serverId,
    credentialId: account.credentialId,
    client,
    supported,
    revision: 0,
  });
  const mounted = useRef(true);
  const previous = current.current;
  const switched =
    previous.serverId !== serverId ||
    previous.credentialId !== account.credentialId ||
    previous.client !== client ||
    previous.supported !== supported;
  current.current = {
    serverId,
    credentialId: account.credentialId,
    client,
    supported,
    revision: previous.revision + Number(switched),
  };
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  useEffect(() => {
    setFeedback(null);
  }, [serverId, account.credentialId]);
  useEffect(() => {
    if (serverId) claudeLimitResetActions.reconcile(serverId, account.credentialId, inventory);
  }, [serverId, account.credentialId, inventory]);
  const observedAt = useMemo(() => {
    const fetchedAt = Date.parse(account.quota?.fetchedAt ?? "");
    return Number.isFinite(fetchedAt) ? fetchedAt : Date.now();
  }, [account.quota]);
  useOmpQuotaReachedRefresh(
    serverId,
    claudeResetRefreshTimes(inventory, observedAt),
    now,
    supported,
  );
  const count = claudeResetCount(inventory, now);
  const accountBusy = Boolean(
    serverId && claudeLimitResetActions.isBusy(serverId, account.credentialId),
  );
  const scopes = useCallback(
    (values: string[]) =>
      values
        .map((scope) => {
          if (scope === "five_hour") return t("settings.providers.omp.multiAccount.quotaFiveHour");
          if (scope === "seven_day") return t("agentControls.quota.weekly");
          if (scope === "seven_day_sonnet") return formatOmpModelQuotaLabel("sonnet", t);
          if (scope === "seven_day_opus") return formatOmpModelQuotaLabel("opus", t);
          return scope;
        })
        .join(", ") || t(`${PREFIX}unknown`),
    [t],
  );
  const date = useCallback(
    (value: string | null) =>
      formatOmpQuotaResetTime(value, i18n.language) ?? t(`${PREFIX}unknown`),
    [i18n.language, t],
  );
  const consume = useCallback(
    async (grant: OmpClaudeLimitResetGrant) => {
      if (
        !client ||
        !serverId ||
        !supported ||
        busy ||
        claudeGrantState(inventory, grant, Date.now()) !== "active"
      )
        return;
      const revision = current.current.revision;
      const isCurrent = () =>
        mounted.current && current.current.revision === revision && current.current.supported;
      if (claudeLimitResetActions.isBusy(serverId, account.credentialId)) return;
      setBusy(true);
      setFeedback(null);
      try {
        const outcome = await claudeLimitResetActions.run({
          serverId,
          credentialId: account.credentialId,
          grant,
          isCurrent,
          confirm: () =>
            confirmDialog({
              title: t(`${PREFIX}confirmTitle`),
              message: t(`${PREFIX}confirmMessage`, {
                account: accountLabel,
                grant: grant.label || grant.id,
                id: grant.id,
                scopes: scopes(claudeGrantScopes(grant)),
                weekly: t(
                  `${PREFIX}${grant.givesBackWeekly ? "weeklyReturned" : "weeklyUnchanged"}`,
                ),
              }),
              confirmLabel: t(`${PREFIX}use`),
              cancelLabel: t("common.actions.cancel"),
              destructive: true,
            }),
          refresh: (afterMutation) =>
            refreshOmpAccountQuotaManagement(queryClient, client, serverId, afterMutation),
          consume: (requestId) =>
            client.consumeOmpClaudeLimitReset(account.credentialId, grant.id, requestId),
        });
        if (!isCurrent()) return;
        const messages: string[] = [];
        if (outcome.changed) messages.push(t(`${PREFIX}changed`));
        if (outcome.result) {
          messages.push(t(`${PREFIX}result_${outcome.result.result}`));
          if (outcome.result.reason)
            messages.push(t(`${PREFIX}reason`, { reason: outcome.result.reason }));
          if (outcome.result.cleared.length)
            messages.push(t(`${PREFIX}cleared`, { scopes: scopes(outcome.result.cleared) }));
          if (outcome.result.weeklyResetsAt)
            messages.push(t(`${PREFIX}weeklyReset`, { time: date(outcome.result.weeklyResetsAt) }));
          if (outcome.result.cooldownUntil)
            messages.push(
              t(`${PREFIX}cooldownUntil`, { time: date(outcome.result.cooldownUntil) }),
            );
        }
        if (outcome.error)
          messages.push(t(`${PREFIX}uncertain`, { error: errorText(outcome.error) }));
        if (outcome.refreshError)
          messages.push(t(`${PREFIX}refreshFailed`, { error: errorText(outcome.refreshError) }));
        setFeedback(messages.length ? messages.join("\n") : null);
      } finally {
        if (mounted.current) setBusy(false);
      }
    },
    [
      client,
      serverId,
      supported,
      busy,
      inventory,
      account.credentialId,
      accountLabel,
      queryClient,
      t,
      scopes,
      date,
    ],
  );
  const refresh = useCallback(async () => {
    if (
      !client ||
      !serverId ||
      busy ||
      claudeLimitResetActions.isBusy(serverId, account.credentialId)
    )
      return;
    const revision = current.current.revision;
    setBusy(true);
    try {
      const management = await refreshOmpAccountQuotaManagement(
        queryClient,
        client,
        serverId,
        true,
      );
      const fresh = management.loginProviders
        .find((provider) => provider.id === "anthropic")
        ?.accounts?.find((item) => item.credentialId === account.credentialId);
      claudeLimitResetActions.reconcile(serverId, account.credentialId, fresh?.quota?.limitResets);
      if (mounted.current && revision === current.current.revision) setFeedback(null);
    } catch (error) {
      if (mounted.current && revision === current.current.revision)
        setFeedback(t(`${PREFIX}refreshFailed`, { error: errorText(error) }));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [client, serverId, busy, account.credentialId, queryClient, t]);
  const handleRefresh = useCallback(() => void refresh(), [refresh]);
  const consumeHandlers = useMemo(
    () =>
      Object.fromEntries<() => void>(
        (inventory?.grants ?? []).map((grant) => [grant.id, () => void consume(grant)]),
      ),
    [inventory?.grants, consume],
  );
  return (
    <View style={styles.details} testID={`omp-claude-limit-resets-${account.credentialId}`}>
      <ClaudeResetInventorySummary inventory={inventory} count={count} date={date} />
      {!supported ? <Text style={styles.muted}>{t(`${PREFIX}unsupported`)}</Text> : null}
      {inventory?.grants.map((grant) => {
        const state = claudeGrantState(inventory, grant, now);
        const awaiting = Boolean(
          serverId &&
          claudeLimitResetActions.isAwaitingRefresh(serverId, account.credentialId, grant.id),
        );
        const remaining = formatOmpQuotaCountdown(grant.endsAt, now, {
          day: t("settings.providers.omp.codexQuota.day"),
          hour: t("settings.providers.omp.codexQuota.hour"),
          minute: t("settings.providers.omp.codexQuota.minute"),
        });
        return (
          <View key={grant.id} style={styles.grant}>
            <Text style={styles.title}>{grant.label || grant.id}</Text>
            <Text style={styles.muted}>
              {t(`${PREFIX}quantity`, { left: grant.resetsLeft, total: grant.resetsTotal })}
            </Text>
            <Text style={styles.muted}>{t(`${PREFIX}${state}`)}</Text>
            <Text style={styles.muted}>
              {t(`${PREFIX}scopes`, { scopes: scopes(claudeGrantScopes(grant)) })}
            </Text>
            <Text style={styles.muted}>
              {t(`${PREFIX}starts`, {
                time: grant.startsAt ? date(grant.startsAt) : t(`${PREFIX}immediate`),
              })}
            </Text>
            <Text style={styles.muted}>{t(`${PREFIX}expires`, { time: date(grant.endsAt) })}</Text>
            {remaining ? (
              <Text style={styles.muted}>{t(`${PREFIX}remaining`, { time: remaining })}</Text>
            ) : null}
            {grant.useRequiresLimit ? (
              <Text style={styles.muted}>{t(`${PREFIX}requiresLimit`)}</Text>
            ) : null}
            {grant.blocking.some((scope) => !claudeGrantClearsScope(grant, scope)) ? (
              <Text style={styles.muted}>
                {t(`${PREFIX}blocking`, {
                  scopes: scopes(
                    grant.blocking.filter((scope) => !claudeGrantClearsScope(grant, scope)),
                  ),
                })}
              </Text>
            ) : null}
            <Text style={styles.muted}>
              {t(`${PREFIX}${grant.givesBackWeekly ? "weeklyReturned" : "weeklyUnchanged"}`)}
            </Text>
            {awaiting ? <Text style={styles.muted}>{t(`${PREFIX}awaitingRefresh`)}</Text> : null}
            <View style={styles.actions}>
              <Button
                variant="secondary"
                size="sm"
                disabled={
                  !supported ||
                  !serverId ||
                  !client ||
                  busy ||
                  accountBusy ||
                  state !== "active" ||
                  awaiting
                }
                onPress={consumeHandlers[grant.id]}
                testID={`omp-claude-reset-use-${account.credentialId}-${grant.id}`}
              >
                {t(`${PREFIX}${busy ? "busy" : "use"}`)}
              </Button>
            </View>
          </View>
        );
      })}
      {supported && serverId && client ? (
        <View style={styles.actions}>
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || accountBusy}
            onPress={handleRefresh}
          >
            {t(`${PREFIX}refresh`)}
          </Button>
        </View>
      ) : null}
      {feedback ? (
        <Text
          accessibilityRole="alert"
          style={styles.muted}
          testID={`omp-claude-reset-feedback-${account.credentialId}`}
        >
          {feedback}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  details: { gap: theme.spacing[2], marginTop: theme.spacing[3] },
  grant: {
    gap: theme.spacing[2],
    padding: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: 6,
  },
  actions: { alignSelf: "flex-start" },
  title: { color: theme.colors.foreground, fontSize: theme.fontSize.sm, fontWeight: "600" },
  muted: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));

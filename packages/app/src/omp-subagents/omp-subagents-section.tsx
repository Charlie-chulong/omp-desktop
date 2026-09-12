import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet } from "react-native-unistyles";
import type { OmpSubagentSettings } from "@omp-desktop/protocol/messages";

import { SelectField, type SelectFieldOption } from "@/components/ui/select-field";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";

const INHERIT_MODEL = "__inherit_parent_agent__";
type SubagentEntry = OmpSubagentSettings["agents"][number];

interface OmpSubagentRowProps {
  agent: SubagentEntry;
  index: number;
  modelOptions: SelectFieldOption<string>[];
  catalogLoading: boolean;
  disabled: boolean;
  onChange: (agentName: string, model: string) => void;
}

function OmpSubagentRow({
  agent,
  index,
  modelOptions,
  catalogLoading,
  disabled,
  onChange,
}: OmpSubagentRowProps): ReactElement {
  const { t } = useTranslation();
  const value = agent.model ?? INHERIT_MODEL;
  const selectedDisplay = useMemo(() => {
    const selected = modelOptions.find((option) => option.value === value);
    if (!selected) return { label: value };
    return {
      label: selected.label,
      ...(selected.description ? { description: selected.description } : {}),
    };
  }, [modelOptions, value]);
  const handleChange = useCallback(
    (next: string) => onChange(agent.name, next),
    [agent.name, onChange],
  );

  return (
    <View
      style={[settingsStyles.row, index > 0 && settingsStyles.rowBorder, styles.agentRow]}
      testID={`omp-subagent-row-${agent.name}`}
    >
      <View style={styles.agentIdentity}>
        <Text style={styles.agentName}>{agent.name}</Text>
        <Text style={styles.mutedText}>
          {t(`settings.host.ompSubagents.descriptions.${agent.name}`, {
            defaultValue: agent.description,
          })}
        </Text>
      </View>
      <View style={styles.modelField}>
        <SelectField
          field={false}
          label={t("settings.host.ompSubagents.modelLabel")}
          value={value}
          selectedDisplay={selectedDisplay}
          options={modelOptions}
          onChange={handleChange}
          placeholder={t("settings.host.ompSubagents.modelLabel")}
          emptyText={t("settings.host.ompSubagents.noModels")}
          loading={catalogLoading}
          disabled={disabled}
          searchable={modelOptions.length > 7}
          title={t("settings.host.ompSubagents.selectModelTitle", { name: agent.name })}
          size="sm"
          testID={`omp-subagent-model-${agent.name}`}
        />
      </View>
    </View>
  );
}

export function OmpSubagentsSection({ serverId }: { serverId: string }): ReactElement {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const { entries, isLoading: catalogLoading } = useProvidersSnapshot(serverId, { cwd: null });
  const isSupported = useSessionStore(
    (state) => state.sessions[serverId]?.serverInfo?.features?.ompSubagentSettings === true,
  );
  const [settings, setSettings] = useState<OmpSubagentSettings | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingAgent, setSavingAgent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!client || !isConnected || !isSupported) {
      setSettings(null);
      return;
    }
    let active = true;
    setLoading(true);
    setError(null);
    void client
      .getOmpSubagentSettings()
      .then((value) => {
        if (active) setSettings(value);
        return undefined;
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, isConnected, isSupported]);

  const modelOptions = useMemo<SelectFieldOption<string>[]>(() => {
    const omp = entries?.find((entry) => entry.provider === "omp");
    const models = (omp?.models ?? [])
      .filter((model) => model.isSelectable !== false)
      .map((model) => {
        const option: SelectFieldOption<string> = {
          id: model.id,
          value: model.id,
          label: model.label,
        };
        if (model.description) option.description = model.description;
        return option;
      });
    return [
      {
        id: INHERIT_MODEL,
        value: INHERIT_MODEL,
        label: t("settings.host.ompSubagents.inherit"),
        description: t("settings.host.ompSubagents.inheritHint"),
      },
      ...models,
    ];
  }, [entries, t]);

  const updateModel = useCallback(
    async (agentName: string, value: string) => {
      if (!client) return;
      setSavingAgent(agentName);
      setError(null);
      try {
        setSettings(
          await client.updateOmpSubagentModel(agentName, value === INHERIT_MODEL ? null : value),
        );
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        setSavingAgent(null);
      }
    },
    [client],
  );

  let content: ReactNode;
  if (!isConnected) {
    content = (
      <View style={styles.messageRow}>
        <Text style={styles.mutedText}>{t("settings.host.ompSubagents.unavailable")}</Text>
      </View>
    );
  } else if (!isSupported) {
    content = (
      <View style={styles.messageRow}>
        <Text style={styles.mutedText}>{t("settings.host.ompSubagents.unsupported")}</Text>
      </View>
    );
  } else if (error && !settings) {
    content = (
      <View style={styles.messageRow}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  } else if (loading && !settings) {
    content = (
      <View style={styles.messageRow}>
        <Text style={styles.mutedText}>{t("settings.host.ompSubagents.loading")}</Text>
      </View>
    );
  } else {
    content = settings?.agents.map((agent, index) => (
      <OmpSubagentRow
        key={agent.name}
        agent={agent}
        index={index}
        modelOptions={modelOptions}
        catalogLoading={catalogLoading}
        disabled={savingAgent !== null}
        onChange={updateModel}
      />
    ));
  }

  return (
    <SettingsSection
      title={t("settings.host.ompSubagents.sectionTitle")}
      testID="omp-subagents-section"
    >
      <View style={settingsStyles.card} testID="omp-subagents-card">
        {content}
        {settings ? (
          <View style={styles.footer}>
            <Text style={styles.mutedText} selectable>
              {t("settings.host.ompSubagents.configPath", { path: settings.configPath })}
            </Text>
            {error ? <Text style={styles.errorText}>{error}</Text> : null}
          </View>
        ) : null}
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  agentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[4],
    paddingVertical: theme.spacing[3],
  },
  agentIdentity: {
    flex: 1,
    gap: theme.spacing[1],
  },
  agentName: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.semibold,
  },
  modelField: {
    width: 280,
    maxWidth: "50%",
  },
  messageRow: {
    padding: theme.spacing[4],
  },
  mutedText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  footer: {
    gap: theme.spacing[1],
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    paddingHorizontal: theme.spacing[4],
    paddingVertical: theme.spacing[2],
  },
  errorText: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.sm,
  },
}));

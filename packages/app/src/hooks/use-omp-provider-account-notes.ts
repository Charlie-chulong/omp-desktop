import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";
import {
  OmpProviderAccountNotesSchema,
  type MutableDaemonConfig,
} from "@omp-desktop/protocol/messages";
import {
  loadLegacyOmpProviderAccountNotes,
  removeLegacyOmpProviderAccountNotes,
} from "@/components/omp-provider-account-notes";
import { useDaemonConfig } from "@/hooks/use-daemon-config";

const migrations = new Map<string, Promise<void>>();

type PatchDaemonConfig = (
  patch: Pick<MutableDaemonConfig, "ompProviderAccountNotes">,
) => Promise<MutableDaemonConfig | undefined>;

function migrateLegacyNotes(serverId: string, patchConfig: PatchDaemonConfig): Promise<void> {
  const active = migrations.get(serverId);
  if (active) return active;

  const migration = (async () => {
    const legacy = await loadLegacyOmpProviderAccountNotes(AsyncStorage, serverId);
    const result = await patchConfig({ ompProviderAccountNotes: legacy?.notes ?? {} });
    if (result?.ompProviderAccountNotes === undefined) {
      throw new Error("The connected daemon does not support synchronized account notes");
    }
    if (legacy) {
      await removeLegacyOmpProviderAccountNotes(AsyncStorage, legacy.key);
    }
  })();
  const clearMigration = () => {
    if (migrations.get(serverId) === migration) migrations.delete(serverId);
  };
  void migration.then(clearMigration, clearMigration);
  return migration;
}

export interface UseOmpProviderAccountNotesResult {
  notes: Record<string, string>;
  loading: boolean;
  migrationError: Error | null;
  save: (notes: Record<string, string>) => Promise<void>;
}

export function useOmpProviderAccountNotes(
  serverId: string | null | undefined,
): UseOmpProviderAccountNotesResult {
  const { config, isLoading, patchConfig } = useDaemonConfig(serverId ?? null);
  const [migrationError, setMigrationError] = useState<Error | null>(null);

  useEffect(() => {
    if (!serverId || !config || config.ompProviderAccountNotes !== undefined) return;
    let active = true;
    setMigrationError(null);
    void migrateLegacyNotes(serverId, patchConfig).catch((error: unknown) => {
      if (active) setMigrationError(error instanceof Error ? error : new Error(String(error)));
    });
    return () => {
      active = false;
    };
  }, [config, patchConfig, serverId]);

  const save = useCallback(
    async (notes: Record<string, string>) => {
      const parsed = OmpProviderAccountNotesSchema.parse(notes);
      const result = await patchConfig({ ompProviderAccountNotes: parsed });
      if (result?.ompProviderAccountNotes === undefined) {
        throw new Error("The connected daemon does not support synchronized account notes");
      }
    },
    [patchConfig],
  );

  return {
    notes: config?.ompProviderAccountNotes ?? {},
    loading:
      isLoading ||
      (config !== null && config.ompProviderAccountNotes === undefined && migrationError === null),
    migrationError,
    save,
  };
}

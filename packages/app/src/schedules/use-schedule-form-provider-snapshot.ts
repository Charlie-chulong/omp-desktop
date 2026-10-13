import { useEffect } from "react";
import { useProvidersSnapshot } from "@/hooks/use-providers-snapshot";
import type { ScheduleFormModel, ScheduleFormState } from "./schedule-form-model";

export function useScheduleFormProviderSnapshot(
  model: ScheduleFormModel,
  state: ScheduleFormState,
) {
  const serverId = state.providerSnapshotRequest?.serverId ?? state.selectedServerId;
  const enabled = state.targetKind === "new-agent" && Boolean(serverId);
  const snapshot = useProvidersSnapshot(serverId ?? null, {
    enabled,
  });

  useEffect(() => {
    if (!enabled || !serverId || !snapshot.entries) {
      return;
    }
    model.applyProviderSnapshot(serverId, { entries: snapshot.entries });
  }, [enabled, model, serverId, snapshot.entries]);

  return snapshot;
}

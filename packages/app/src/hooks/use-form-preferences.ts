import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  DEFAULT_FORM_PREFERENCES,
  mergeProviderPreferences,
  parseFormPreferences,
  type FormPreferences,
  type ProviderPreferences,
} from "@/create-agent-preferences/preferences";
import {
  createAgentPreferencesService,
  type FormPreferenceUpdate,
} from "@/create-agent-preferences/service";

const FORM_PREFERENCES_QUERY_KEY = ["form-preferences"];

export type { FormPreferences, ProviderPreferences };

export { mergeProviderPreferences };

let latestOptimisticUpdate = 0;

function applyFormPreferenceUpdate(
  current: FormPreferences,
  update: FormPreferenceUpdate,
): FormPreferences {
  return parseFormPreferences(
    typeof update === "function" ? update(current) : { ...current, ...update },
  );
}

async function loadFormPreferences(): Promise<FormPreferences> {
  return createAgentPreferencesService.load();
}

export interface UseFormPreferencesReturn {
  preferences: FormPreferences;
  isLoading: boolean;
  updatePreferences: (updates: FormPreferenceUpdate) => Promise<FormPreferences>;
}

export function useFormPreferences(): UseFormPreferencesReturn {
  const queryClient = useQueryClient();
  const { data, isPending } = useQuery({
    queryKey: FORM_PREFERENCES_QUERY_KEY,
    queryFn: loadFormPreferences,
    staleTime: Infinity,
    gcTime: Infinity,
  });

  const preferences = data ?? DEFAULT_FORM_PREFERENCES;

  const updatePreferences = useCallback(
    async (updates: FormPreferenceUpdate) => {
      latestOptimisticUpdate += 1;
      const updateId = latestOptimisticUpdate;
      const current =
        queryClient.getQueryData<FormPreferences>(FORM_PREFERENCES_QUERY_KEY) ??
        DEFAULT_FORM_PREFERENCES;
      queryClient.setQueryData<FormPreferences>(
        FORM_PREFERENCES_QUERY_KEY,
        applyFormPreferenceUpdate(current, updates),
      );

      try {
        const persisted = await createAgentPreferencesService.update(updates);
        if (updateId === latestOptimisticUpdate) {
          queryClient.setQueryData<FormPreferences>(FORM_PREFERENCES_QUERY_KEY, persisted);
        }
        return persisted;
      } catch (error) {
        if (updateId === latestOptimisticUpdate) {
          queryClient.setQueryData<FormPreferences>(
            FORM_PREFERENCES_QUERY_KEY,
            await createAgentPreferencesService.load(),
          );
        }
        throw error;
      }
    },
    [queryClient],
  );

  return {
    preferences,
    isLoading: isPending,
    updatePreferences,
  };
}

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

export interface SidebarConversationDraft {
  id: string;
  serverId: string;
  projectViewKey: string;
  sourceDirectory: string;
  displayName: string;
  projectId: string;
  createdAt: number;
  hasContent: boolean;
}

interface SidebarConversationDraftState {
  drafts: Record<string, SidebarConversationDraft>;
  addDraft: (draft: Omit<SidebarConversationDraft, "hasContent">) => void;
  setDraftHasContent: (draftId: string, hasContent: boolean) => void;
  removeDraft: (draftId: string) => void;
  removeEmptyDrafts: (exceptDraftId?: string) => void;
}

const SidebarConversationDraftSchema = z.strictObject({
  id: z.string(),
  serverId: z.string(),
  projectViewKey: z.string(),
  sourceDirectory: z.string(),
  displayName: z.string(),
  projectId: z.string(),
  createdAt: z.number(),
  hasContent: z.boolean(),
});

const SidebarConversationDraftPersistedStateSchema = z.strictObject({
  drafts: z.record(z.string(), SidebarConversationDraftSchema),
});

export const useSidebarConversationDraftStore = create<SidebarConversationDraftState>()(
  persist(
    (set) => ({
      drafts: {},
      addDraft: (draft) =>
        set((state) => ({
          drafts: {
            ...state.drafts,
            [draft.id]: { ...draft, hasContent: false },
          },
        })),
      setDraftHasContent: (draftId, hasContent) =>
        set((state) => {
          const draft = state.drafts[draftId];
          if (!draft || draft.hasContent === hasContent) {
            return state;
          }
          return {
            drafts: {
              ...state.drafts,
              [draftId]: { ...draft, hasContent },
            },
          };
        }),
      removeDraft: (draftId) =>
        set((state) => {
          if (!state.drafts[draftId]) {
            return state;
          }
          const nextDrafts = { ...state.drafts };
          delete nextDrafts[draftId];
          return { drafts: nextDrafts };
        }),
      removeEmptyDrafts: (exceptDraftId) =>
        set((state) => {
          let nextDrafts = state.drafts;
          for (const draftId in state.drafts) {
            const draft = state.drafts[draftId];
            if (!draft || draft.hasContent || draftId === exceptDraftId) {
              continue;
            }
            if (nextDrafts === state.drafts) {
              nextDrafts = { ...state.drafts };
            }
            delete nextDrafts[draftId];
          }
          return nextDrafts === state.drafts ? state : { drafts: nextDrafts };
        }),
    }),
    {
      name: "sidebar-conversation-drafts",
      version: 1,
      storage: createValidatedPersistStorage(
        AsyncStorage,
        SidebarConversationDraftPersistedStateSchema,
      ),
      partialize: (state) => ({
        drafts: Object.fromEntries(
          Object.entries(state.drafts).filter(([, draft]) => draft.hasContent),
        ),
      }),
    },
  ),
);

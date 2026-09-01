import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import {
  useSidebarConversationDraftStore,
  type SidebarConversationDraft,
} from "./sidebar-conversation-draft-store";

function draft(id: string): Omit<SidebarConversationDraft, "hasContent"> {
  return {
    id,
    serverId: "server-1",
    projectViewKey: "project-1",
    sourceDirectory: "/repo",
    displayName: "repo",
    projectId: "project-1",
    createdAt: 1,
  };
}

describe("sidebar conversation draft store", () => {
  beforeEach(() => {
    useSidebarConversationDraftStore.setState({ drafts: {} });
  });

  it("keeps a newly opened empty draft until navigation leaves it", () => {
    const store = useSidebarConversationDraftStore.getState();
    store.addDraft(draft("draft-1"));

    store.removeEmptyDrafts("draft-1");

    expect(useSidebarConversationDraftStore.getState().drafts["draft-1"]).toMatchObject({
      id: "draft-1",
      hasContent: false,
    });
  });

  it("removes empty drafts when another conversation becomes active", () => {
    const store = useSidebarConversationDraftStore.getState();
    store.addDraft(draft("empty"));
    store.addDraft(draft("saved"));
    store.setDraftHasContent("saved", true);

    store.removeEmptyDrafts();

    expect(Object.keys(useSidebarConversationDraftStore.getState().drafts)).toEqual(["saved"]);
  });

  it("removes a saved draft after its composer becomes empty", () => {
    const store = useSidebarConversationDraftStore.getState();
    store.addDraft(draft("draft-1"));
    store.setDraftHasContent("draft-1", true);
    store.setDraftHasContent("draft-1", false);

    store.removeEmptyDrafts();

    expect(useSidebarConversationDraftStore.getState().drafts).toEqual({});
  });
});

import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Brain } from "lucide-react-native";
import { describe, expect, it, vi } from "vitest";

const captured = vi.hoisted(() => ({ icon: null as unknown }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("react-native", () => ({
  ScrollView: ({ children }: { children?: React.ReactNode }) => children,
}));
vi.mock("react-native-unistyles", () => ({
  StyleSheet: { create: () => ({ scroll: {}, content: {} }) },
}));
vi.mock("@/components/message", () => ({
  ExpandableBadge: ({ icon }: { icon: unknown }) => {
    captured.icon = icon;
    return null;
  },
}));

import { AgentActivityGroupView } from "./activity-group-view";
const group = { id: "activity-1", items: [], isLoading: false };
const handleExpandedChange = () => undefined;

describe("AgentActivityGroupView", () => {
  it("uses the compact brain glyph instead of the overlapping circuit glyph", () => {
    renderToStaticMarkup(
      <AgentActivityGroupView
        group={group}
        expanded={false}
        isLastInSequence={false}
        onExpandedChange={handleExpandedChange}
      >
        {null}
      </AgentActivityGroupView>,
    );

    expect(captured.icon).toBe(Brain);
  });
});

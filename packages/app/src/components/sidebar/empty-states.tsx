import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";

/**
 * The message shown when sidebar filters hide every workspace row.
 *
 * This is a list body, not a screen: it renders inside the list's scroll area below the section
 * header, which keeps the display menu available so the filters can be cleared.
 */
export function SidebarFilterEmptyState() {
  const { t } = useTranslation();
  const clearLabelFilter = useSidebarViewStore((state) => state.clearLabelFilter);
  const clearProjectFilters = useSidebarViewStore((state) => state.clearProjectFilters);
  // Clears every filter that can empty the list, not just the one that did. The card names no
  // filter, so a Clear that undid only one of two active filters would leave it on screen looking
  // like it had failed.
  const clearFilters = useCallback(() => {
    clearLabelFilter();
    clearProjectFilters();
  }, [clearLabelFilter, clearProjectFilters]);

  return (
    <View style={styles.container} testID="sidebar-filter-empty-state">
      <Text style={styles.title}>{t("sidebar.filterEmpty.title")}</Text>
      <Text style={styles.description}>{t("sidebar.filterEmpty.description")}</Text>
      <Button variant="ghost" size="sm" onPress={clearFilters}>
        {t("sidebar.filterEmpty.clear")}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    marginHorizontal: theme.spacing[2],
    marginTop: theme.spacing[4],
    paddingTop: theme.spacing[6],
    paddingBottom: theme.spacing[4],
    paddingHorizontal: theme.spacing[4],
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface0,
    alignItems: "center",
    gap: theme.spacing[3],
  },
  title: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    textAlign: "center",
  },
  description: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    textAlign: "center",
  },
}));

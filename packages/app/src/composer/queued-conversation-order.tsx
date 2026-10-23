import { useCallback, useMemo, useRef } from "react";
import { Pressable, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { GripVertical } from "lucide-react-native";
import { useShallow } from "zustand/shallow";
import { DraggableList, type DraggableRenderItemInfo } from "@/components/draggable-list";
import { isWeb } from "@/constants/platform";
import { getHostRuntimeStore } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { ICON_SIZE, type Theme } from "@/styles/theme";

interface QueuedConversation {
  agentId: string;
  title: string;
  messageCount: number;
}

const QUEUE_ROW_MIN_HEIGHT = 56;
const MAX_VISIBLE_QUEUE_ROWS = 4;
const DRAG_HANDLE_WEB_STYLE = { touchAction: "none", cursor: "grab", userSelect: "none" } as object;
const ROW_WEB_STYLE = { touchAction: "pan-y" } as object;

function queuedConversationKey(item: QueuedConversation): string {
  return item.agentId;
}

function shortQueuedAgentId(agentId: string, activeAgentIds: readonly string[]): string {
  let length = Math.min(8, agentId.length);
  let prefix = agentId.slice(0, length);
  while (
    length < agentId.length &&
    activeAgentIds.some((otherId) => otherId !== agentId && otherId.startsWith(prefix))
  ) {
    length += 1;
    prefix = agentId.slice(0, length);
  }
  return length < agentId.length ? `${prefix}…` : prefix;
}

export function QueuedConversationOrder({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const { queuedAgentOrder, queuedMessages, agents, agentDetails } = useSessionStore(
    useShallow((state) => {
      const session = state.sessions[serverId];
      return {
        queuedAgentOrder: session?.queuedAgentOrder,
        queuedMessages: session?.queuedMessages,
        agents: session?.agents,
        agentDetails: session?.agentDetails,
      };
    }),
  );
  const conversations = useMemo(() => {
    const activeAgentIds = (queuedAgentOrder ?? []).filter(
      (agentId) => (queuedMessages?.get(agentId)?.length ?? 0) > 0,
    );
    return activeAgentIds.map((agentId) => ({
      agentId,
      title:
        agents?.get(agentId)?.title?.trim() ||
        agentDetails?.get(agentId)?.title?.trim() ||
        t("composer.queueOrder.untitledConversation", {
          id: shortQueuedAgentId(agentId, activeAgentIds),
        }),
      messageCount: queuedMessages?.get(agentId)?.length ?? 0,
    }));
  }, [agentDetails, agents, queuedAgentOrder, queuedMessages, t]);
  const dragStartOrderRef = useRef<{ serverId: string; agentIds: string[] } | null>(null);
  const handleDragBegin = useCallback(() => {
    const session = useSessionStore.getState().sessions[serverId];
    dragStartOrderRef.current = {
      serverId,
      agentIds: (session?.queuedAgentOrder ?? []).filter(
        (agentId) => (session?.queuedMessages.get(agentId)?.length ?? 0) > 0,
      ),
    };
  }, [serverId]);

  const handleDragEnd = useCallback(
    (orderedConversations: QueuedConversation[]) => {
      const dragStartOrder = dragStartOrderRef.current;
      dragStartOrderRef.current = null;
      if (!dragStartOrder || dragStartOrder.serverId !== serverId) return;
      const store = useSessionStore.getState();
      const session = store.sessions[serverId];
      const currentOrder = (session?.queuedAgentOrder ?? []).filter(
        (agentId) => (session?.queuedMessages.get(agentId)?.length ?? 0) > 0,
      );
      // Another composer may have moved the same conversations while this drag was active.
      if (
        currentOrder.length !== dragStartOrder.agentIds.length ||
        currentOrder.some((agentId, index) => agentId !== dragStartOrder.agentIds[index])
      ) {
        return;
      }
      // The store also rejects missing, drained, added, or duplicated IDs in this snapshot.
      store.reorderQueuedAgents(
        serverId,
        orderedConversations.map((conversation) => conversation.agentId),
      );
      getHostRuntimeStore().reevaluateQueuedAgentMessages(serverId);
    },
    [serverId],
  );
  const renderConversation = useCallback(
    (info: DraggableRenderItemInfo<QueuedConversation>) => (
      <QueuedConversationRow {...info} conversationCount={conversations.length} />
    ),
    [conversations.length],
  );

  if (conversations.length <= 1) return null;

  return (
    <View style={styles.board} testID="queued-conversation-order">
      <View style={styles.heading}>
        <Text style={styles.headingText} accessibilityRole="header">
          {t("composer.queueOrder.title")}
        </Text>
        <Text style={styles.hint}>{t("composer.queueOrder.hint")}</Text>
      </View>
      <View style={styles.listViewport(conversations.length)}>
        <DraggableList
          key={serverId}
          testID="queued-conversation-order-list"
          data={conversations}
          keyExtractor={queuedConversationKey}
          renderItem={renderConversation}
          onDragBegin={handleDragBegin}
          onDragEnd={handleDragEnd}
          useDragHandle
          showsVerticalScrollIndicator
          extraData={conversations.length}
        />
      </View>
    </View>
  );
}

function QueuedConversationRow({
  item,
  index,
  drag,
  isActive,
  dragHandleProps,
  conversationCount,
}: DraggableRenderItemInfo<QueuedConversation> & { conversationCount: number }) {
  const { t } = useTranslation();
  const dragLabel = t("composer.queueOrder.dragConversation", { title: item.title });
  const handleIcon = (
    <ThemedGripVertical size={ICON_SIZE.md} uniProps={iconForegroundMutedMapping} />
  );

  return (
    <View
      style={[styles.row, isActive && styles.rowActive, isWeb && ROW_WEB_STYLE]}
      testID={`queued-conversation-${item.agentId}`}
    >
      {isWeb ? (
        <View
          {...dragHandleProps?.attributes}
          {...dragHandleProps?.listeners}
          ref={dragHandleProps?.setActivatorNodeRef}
          style={[styles.dragHandle, DRAG_HANDLE_WEB_STYLE]}
          accessibilityRole="button"
          accessibilityLabel={dragLabel}
          testID={`queued-conversation-drag-${item.agentId}`}
        >
          {handleIcon}
        </View>
      ) : (
        <Pressable
          onLongPress={drag}
          delayLongPress={180}
          style={styles.dragHandle}
          accessibilityRole="button"
          accessibilityLabel={dragLabel}
          testID={`queued-conversation-drag-${item.agentId}`}
        >
          {handleIcon}
        </Pressable>
      )}
      <Text
        style={styles.position}
        accessibilityLabel={t("composer.attachments.queuedConversationPosition", {
          position: index + 1,
          count: conversationCount,
        })}
      >
        {index + 1}
      </Text>
      <View style={styles.conversation}>
        <Text style={styles.title} numberOfLines={1}>
          {item.title}
        </Text>
        <Text style={styles.messageCount} numberOfLines={1}>
          {t("composer.queueOrder.messageCount", { count: item.messageCount })}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  board: {
    width: "100%",
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.lg,
    overflow: "hidden",
  },
  heading: {
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    gap: theme.spacing[1],
  },
  headingText: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.sm,
  },
  listViewport: (conversationCount: number) => ({
    height: Math.min(conversationCount, MAX_VISIBLE_QUEUE_ROWS) * QUEUE_ROW_MIN_HEIGHT,
  }),
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: QUEUE_ROW_MIN_HEIGHT,
    paddingRight: theme.spacing[2],
    borderTopWidth: theme.borderWidth[1],
    borderTopColor: theme.colors.border,
    gap: theme.spacing[2],
  },
  rowActive: {
    backgroundColor: theme.colors.surface2,
  },
  dragHandle: {
    width: 36,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  position: {
    minWidth: 16,
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
    textAlign: "right",
  },
  conversation: {
    flex: 1,
    minWidth: 0,
    paddingVertical: theme.spacing[2],
    gap: theme.spacing[0.5],
  },
  title: {
    color: theme.colors.foreground,
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.base,
  },
  messageCount: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.ui,
    fontSize: theme.fontSize.sm,
  },
}));

const ThemedGripVertical = withUnistyles(GripVertical);
const iconForegroundMutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

import { useCallback, type Ref } from "react";
import { Pressable, Text, View } from "react-native";
import { ChevronDown, ChevronUp, GripVertical, Pencil, ArrowUp } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { DraggableList, type DraggableRenderItemInfo } from "@/components/draggable-list";
import type { DraggableListDragHandleProps } from "@/components/draggable-list.types";
import { isWeb } from "@/constants/platform";
import { ICON_SIZE, type Theme } from "@/styles/theme";
import type { QueuedComposerMessage } from "./actions";

interface QueuedMessageListProps {
  queuedMessages: QueuedComposerMessage[];
  queuePosition: number;
  queueCount: number;
  onEdit: (id: string) => void;
  onSendNow: (id: string) => void;
  onMove: (id: string, offset: -1 | 1) => void;
  onReorder: (id: string, targetId: string) => void;
  onMoveConversationEarlier: () => void;
  onMoveConversationLater: () => void;
}

const keyExtractor = (item: QueuedComposerMessage) => item.id;
const DRAG_HANDLE_WEB_STYLE = { cursor: "grab", touchAction: "none" } as object;

export function QueuedMessageList({
  queuedMessages,
  queuePosition,
  queueCount,
  onEdit,
  onSendNow,
  onMove,
  onReorder,
  onMoveConversationEarlier,
  onMoveConversationLater,
}: QueuedMessageListProps) {
  const { t } = useTranslation();
  const renderItem = useCallback(
    ({
      item,
      index,
      isActive,
      dragHandleProps,
    }: DraggableRenderItemInfo<QueuedComposerMessage>) => (
      <QueuedMessageRow
        item={item}
        onEdit={onEdit}
        onSendNow={onSendNow}
        onMove={onMove}
        canMoveEarlier={index > 0}
        canMoveLater={index < queuedMessages.length - 1}
        isDragging={isActive}
        dragHandleProps={dragHandleProps}
      />
    ),
    [onEdit, onSendNow, onMove, queuedMessages.length],
  );
  if (queuedMessages.length === 0) return null;
  return (
    <View style={styles.queueTrack} testID="composer-queued-message-list">
      {queueCount > 1 ? (
        <View style={styles.queueOrder}>
          <Text style={styles.queueOrderText}>
            {t("composer.attachments.queuedConversationPosition", {
              position: queuePosition,
              count: queueCount,
            })}
          </Text>
          <View style={styles.queueActions}>
            <Pressable
              onPress={onMoveConversationEarlier}
              disabled={queuePosition <= 1}
              style={[styles.queueOrderButton, queuePosition <= 1 && styles.buttonDisabled]}
              accessibilityLabel={t("composer.attachments.moveQueuedConversationEarlier")}
              accessibilityRole="button"
            >
              <ThemedChevronUp size={ICON_SIZE.sm} uniProps={iconForegroundMapping} />
            </Pressable>
            <Pressable
              onPress={onMoveConversationLater}
              disabled={queuePosition >= queueCount}
              style={[
                styles.queueOrderButton,
                queuePosition >= queueCount && styles.buttonDisabled,
              ]}
              accessibilityLabel={t("composer.attachments.moveQueuedConversationLater")}
              accessibilityRole="button"
            >
              <ThemedChevronDown size={ICON_SIZE.sm} uniProps={iconForegroundMapping} />
            </Pressable>
          </View>
        </View>
      ) : null}
      {isWeb ? (
        <DraggableList
          data={queuedMessages}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          onReorder={onReorder}
          useDragHandle
          scrollEnabled={false}
        />
      ) : (
        queuedMessages.map((item, index) => (
          <QueuedMessageRow
            key={item.id}
            item={item}
            onEdit={onEdit}
            onSendNow={onSendNow}
            onMove={onMove}
            canMoveEarlier={index > 0}
            canMoveLater={index < queuedMessages.length - 1}
          />
        ))
      )}
    </View>
  );
}

interface QueuedMessageRowProps {
  item: QueuedComposerMessage;
  onEdit: (id: string) => void;
  onSendNow: (id: string) => void;
  onMove: (id: string, offset: -1 | 1) => void;
  canMoveEarlier: boolean;
  canMoveLater: boolean;
  isDragging?: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
}

function QueuedMessageRow({
  item,
  onEdit,
  onSendNow,
  onMove,
  canMoveEarlier,
  canMoveLater,
  isDragging,
  dragHandleProps,
}: QueuedMessageRowProps) {
  const { t } = useTranslation();
  const handleEdit = useCallback(() => onEdit(item.id), [onEdit, item.id]);
  const handleSendNow = useCallback(() => onSendNow(item.id), [onSendNow, item.id]);
  const handleMoveEarlier = useCallback(() => onMove(item.id, -1), [onMove, item.id]);
  const handleMoveLater = useCallback(() => onMove(item.id, 1), [onMove, item.id]);
  const canReorder = canMoveEarlier || canMoveLater;
  return (
    <View
      style={[styles.queueItem, isDragging && styles.queueItemDragging]}
      testID={`composer-queued-message-${item.id}`}
    >
      {isWeb && canReorder ? (
        <View
          {...dragHandleProps?.attributes}
          {...dragHandleProps?.listeners}
          ref={dragHandleProps?.setActivatorNodeRef as Ref<View> | undefined}
          accessibilityRole="button"
          accessibilityLabel={t("composer.attachments.dragQueuedMessage")}
          accessibilityHint={t("composer.attachments.dragQueuedMessageHint")}
          style={[styles.queueDragHandle, DRAG_HANDLE_WEB_STYLE]}
          testID={`composer-queued-message-drag-${item.id}`}
        >
          <ThemedGripVertical size={ICON_SIZE.sm} uniProps={iconForegroundMapping} />
        </View>
      ) : null}
      <Text style={styles.queueText} numberOfLines={2} ellipsizeMode="tail">
        {item.text}
      </Text>
      <View style={styles.queueActions}>
        {!isWeb && canReorder ? (
          <>
            <Pressable
              onPress={handleMoveEarlier}
              disabled={!canMoveEarlier}
              style={[styles.queueActionButton, !canMoveEarlier && styles.buttonDisabled]}
              accessibilityLabel={t("composer.attachments.moveQueuedMessageEarlier")}
              accessibilityRole="button"
            >
              <ThemedChevronUp size={ICON_SIZE.sm} uniProps={iconForegroundMapping} />
            </Pressable>
            <Pressable
              onPress={handleMoveLater}
              disabled={!canMoveLater}
              style={[styles.queueActionButton, !canMoveLater && styles.buttonDisabled]}
              accessibilityLabel={t("composer.attachments.moveQueuedMessageLater")}
              accessibilityRole="button"
            >
              <ThemedChevronDown size={ICON_SIZE.sm} uniProps={iconForegroundMapping} />
            </Pressable>
          </>
        ) : null}
        <Pressable
          onPress={handleEdit}
          style={styles.queueActionButton}
          accessibilityLabel={t("composer.attachments.editQueuedMessage")}
          accessibilityRole="button"
        >
          <ThemedPencil size={ICON_SIZE.sm} uniProps={iconForegroundMapping} />
        </Pressable>
        <Pressable
          onPress={handleSendNow}
          style={[styles.queueActionButton, styles.queueSendButton]}
          accessibilityLabel={t("composer.attachments.sendQueuedMessageNow")}
          accessibilityRole="button"
        >
          <ThemedArrowUp size={ICON_SIZE.sm} uniProps={iconAccentForegroundMapping} />
        </Pressable>
      </View>
    </View>
  );
}

const iconForegroundMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const iconAccentForegroundMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });
const ThemedChevronUp = withUnistyles(ChevronUp);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedGripVertical = withUnistyles(GripVertical);
const ThemedPencil = withUnistyles(Pencil);
const ThemedArrowUp = withUnistyles(ArrowUp);

const styles = StyleSheet.create((theme: Theme) => ({
  buttonDisabled: { opacity: 0.5 },
  queueTrack: { gap: theme.spacing[2] },
  queueOrder: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[1],
  },
  queueOrderText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  queueOrderButton: {
    width: 28,
    height: 28,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface2,
  },
  queueItem: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
    marginBottom: theme.spacing[2],
    backgroundColor: theme.colors.surface1,
    borderRadius: theme.borderRadius.lg,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    gap: theme.spacing[2],
  },
  queueItemDragging: {
    borderColor: theme.colors.accent,
    backgroundColor: theme.colors.surface2,
  },
  queueDragHandle: {
    width: 28,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  queueText: { flex: 1, color: theme.colors.foreground, fontSize: theme.fontSize.base },
  queueActions: { flexDirection: "row", alignItems: "center", gap: theme.spacing[2] },
  queueActionButton: {
    width: 32,
    height: 32,
    borderRadius: theme.borderRadius.full,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.surface2,
  },
  queueSendButton: { backgroundColor: theme.colors.accent },
}));

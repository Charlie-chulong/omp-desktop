import type { OmpAgentMessage } from "./rpc-types.js";
import type { AgentTimelineItem } from "../../agent-sdk-types.js";

type OmpCustomMessage = Extract<OmpAgentMessage, { role: "custom" }>;

export function shouldDisplayOmpCustomMessage(message: OmpCustomMessage): boolean {
  return (
    Reflect.get(message, "display") !== false &&
    Reflect.get(message, "customType") !== "skill-prompt"
  );
}

export function mapOmpCustomAssistantMessage(
  message: OmpCustomMessage,
  text: string,
): Extract<AgentTimelineItem, { type: "assistant_message" }> {
  let nativeId: string | undefined;
  if (typeof message.entryId === "string") {
    nativeId = message.entryId;
  } else if (typeof message.id === "string") {
    nativeId = message.id;
  }
  return {
    type: "assistant_message",
    text,
    ...(nativeId ? { messageId: nativeId } : {}),
    ...(typeof message.customType === "string"
      ? {
          customMessage: {
            customType: message.customType,
            ...(message.details === undefined ? {} : { details: message.details }),
          },
        }
      : {}),
  };
}

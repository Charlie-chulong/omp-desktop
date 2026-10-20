import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ChatProDetailsSchema } from "@omp-desktop/protocol/messages";
import type { AgentPromptInput } from "../../agent-sdk-types.js";

export const CHATPRO_CUSTOM_TYPE = "omp-bridge-chatpro";
const OriginSchema = z
  .object({
    turnId: z.string().min(1),
    clientMessageId: z.string().min(1).optional(),
  })
  .strict();
const AskSchema = z
  .object({
    text: z.string(),
    requestId: z.string().uuid().optional(),
    files: z
      .array(z.object({ path: z.string().min(1), mimeType: z.string().min(1).optional() }).strict())
      .optional(),
    bindingRef: z.string().min(1).optional(),
    conversationRef: z.string().min(1).optional(),
    deadlineMs: z.number().int().positive().optional(),
    origin: OriginSchema.optional(),
  })
  .strict();
export type ChatProDetails = z.infer<typeof ChatProDetailsSchema>;
type Origin = z.infer<typeof OriginSchema>;

/** Recognize before any attachment rendering or workflow envelope can hide the command. */
export function readChatProCommand(prompt: AgentPromptInput): string | null {
  if (typeof prompt === "string")
    return /^\/chatpro(?:\s|$)/.test(prompt.trimStart()) ? prompt.trimStart() : null;
  const command = prompt.find(
    (block) =>
      block.type === "text" &&
      !("contextKind" in block) &&
      /^\/chatpro(?:\s|$)/.test(block.text.trimStart()),
  );
  if (!command || command.type !== "text") return null;
  if (prompt.length !== 1 || "contextKind" in command) {
    throw new Error(
      "/chatpro does not support composer media or context attachments. Use ask --json with explicit host files instead.",
    );
  }
  return command.text.trimStart();
}

export interface PreparedChatProCommand {
  text: string;
  requestId?: string;
}

export function prepareChatProCommand(command: string, origin: Origin): PreparedChatProCommand {
  const args = command.slice("/chatpro".length).trimStart();
  if (!/^ask(?:\s|$)/.test(args)) return { text: command };
  const input = args.slice(3).trimStart();
  let data: z.infer<typeof AskSchema>;
  if (/^--json(?:\s|$)/.test(input)) {
    try {
      data = AskSchema.parse(JSON.parse(input.slice(6).trimStart()));
    } catch {
      throw new Error(
        "Invalid /chatpro ask --json input. Supply the documented structured ask object with no unknown fields.",
      );
    }
  } else {
    data = { text: input };
  }
  const requestId = data.requestId?.toLowerCase() ?? randomUUID();
  return {
    text: `/chatpro ask --json ${JSON.stringify({ ...data, requestId, origin })}`,
    requestId,
  };
}

/** One instance per native client. Metadata never grants authority over an arbitrary foreground turn. */
export class ChatProDeliveries {
  private readonly requests = new Map<string, { origin: Origin; owner?: string }>();
  private readonly seen = new Map<string, Set<string>>();

  register(requestId: string, origin: Origin): void {
    const previous = this.requests.get(requestId);
    if (previous && previous.origin.turnId !== origin.turnId) {
      throw new Error(
        "This /chatpro requestId already belongs to another turn. Use /chatpro status or result to read it.",
      );
    }
    this.requests.set(requestId, { origin });
  }

  remember(details: unknown, sessionId: string | undefined, text: string): void {
    const parsed = ChatProDetailsSchema.safeParse(details);
    if (parsed.success && parsed.data.sessionId === sessionId) {
      this.rememberOriginal(JSON.stringify(parsed.data), text);
    }
  }

  private rememberOriginal(key: string, text: string): boolean {
    const originals = this.seen.get(key);
    if (originals?.has(text)) return false;
    if (originals) originals.add(text);
    else this.seen.set(key, new Set([text]));
    return true;
  }

  accept(
    details: unknown,
    sessionId: string | undefined,
    text: string,
  ): { turnId?: string } | null {
    const parsed = ChatProDetailsSchema.safeParse(details);
    // Invalid metadata remains visible, but is detached and cannot de-duplicate another delivery.
    if (!parsed.success || parsed.data.sessionId !== sessionId) return {};
    const data = parsed.data;
    // Only exact original records are replays; a reused ID cannot hide changed public metadata or text.
    if (!this.rememberOriginal(JSON.stringify(data), text)) return null;
    const request = data.requestId ? this.requests.get(data.requestId) : undefined;
    if (
      !request ||
      !data.origin ||
      data.origin.turnId !== request.origin.turnId ||
      data.origin.clientMessageId !== request.origin.clientMessageId
    )
      return {};
    const owner = JSON.stringify([data.sessionId, data.runtimeId, data.agentId, data.nativeJobId]);
    // Only the native receipt for a locally minted origin establishes the runtime/job association.
    if (!request.owner && data.event === "receipt" && data.nativeJobId) request.owner = owner;
    return request.owner === owner ? { turnId: request.origin.turnId } : {};
  }
}

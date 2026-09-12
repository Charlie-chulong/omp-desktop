import { z } from "zod";

const SafeSshTokenSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine((value) => !value.startsWith("-"), "SSH values cannot begin with '-'")
  .refine(
    (value) => !/[\s\u0000-\u001f\u007f]/u.test(value),
    "SSH values cannot contain whitespace or control characters",
  );

export const RemoteSshTargetSchema = z.object({
  host: SafeSshTokenSchema,
  username: SafeSshTokenSchema.optional(),
  port: z.number().int().min(1).max(65535).optional(),
  identityFile: z
    .string()
    .trim()
    .min(1)
    .max(4096)
    .refine((value) => !/[\u0000\r\n]/u.test(value), "Identity path contains invalid characters")
    .optional(),
});

export const RemoteSshStartInputSchema = z.object({
  operationId: z.string().uuid(),
  target: RemoteSshTargetSchema,
  relayAddress: z.string().trim().min(1).max(2048).optional(),
  expectedServerId: z.string().trim().min(1).max(255).optional(),
});

export const RemoteSshOperationInputSchema = z.object({
  operationId: z.string().uuid(),
});

export const RemoteSshInputSchema = RemoteSshOperationInputSchema.extend({
  input: z.string().max(4096),
});

export const RemoteSshProfileInputSchema = z.object({
  serverId: z.string().trim().min(1).max(255),
  target: RemoteSshTargetSchema,
  runtimeRoot: z.string().trim().min(1).max(4096),
  deployedVersion: z.string().trim().min(1).max(255),
});

export const RemoteSshServerIdInputSchema = z.object({
  serverId: z.string().trim().min(1).max(255),
});

export type RemoteSshTarget = z.infer<typeof RemoteSshTargetSchema>;
export type RemoteSshStartInput = z.infer<typeof RemoteSshStartInputSchema>;
export type RemoteSshProfileInput = z.infer<typeof RemoteSshProfileInputSchema>;

export type RemoteSshPhase =
  | "connecting"
  | "inspecting"
  | "preparing-runtime"
  | "uploading"
  | "installing"
  | "starting"
  | "pairing"
  | "complete";

export type RemoteSshEvent =
  | { operationId: string; type: "phase"; phase: RemoteSshPhase; message: string }
  | { operationId: string; type: "terminal"; data: string }
  | { operationId: string; type: "interactive"; enabled: boolean }
  | { operationId: string; type: "failed"; message: string };

export interface RemoteSshDeployResult {
  operationId: string;
  offerUrl: string;
  hostname: string;
  platform: "linux" | "darwin";
  arch: "x64" | "arm64";
  runtimeRoot: string;
  deployedVersion: string;
  target: RemoteSshTarget;
}

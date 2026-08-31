import * as Clipboard from "expo-clipboard";
import { Copy, ExternalLink, LogIn, X } from "lucide-react-native";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { useToast } from "@/contexts/toast-context";
import { useSessionStore } from "@/stores/session-store";
import { openExternalUrl } from "@/utils/open-external-url";
import { useTranslation } from "react-i18next";

interface GitHubAuthCalloutProps {
  serverId: string;
  cwd?: string;
  host?: string | null;
  message: string;
  onAuthenticated?: () => void | Promise<void>;
}

interface DeviceFlow {
  flowId: string;
  verificationUri: string;
  userCode: string;
}

export function GitHubAuthCallout({
  serverId,
  cwd,
  host,
  message,
  onAuthenticated,
}: GitHubAuthCalloutProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const client = useSessionStore((state) => state.sessions[serverId]?.client);
  const [starting, setStarting] = useState(false);
  const [flow, setFlow] = useState<DeviceFlow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const flowId = useRef<string | null>(null);

  useEffect(
    () => () => {
      generation.current += 1;
      if (flowId.current && client) {
        void client.cancelForgeLogin(flowId.current).catch(() => undefined);
      }
      flowId.current = null;
    },
    [client],
  );

  const handleSignIn = useCallback(async () => {
    if (!client || starting || flow) return;
    const attempt = generation.current + 1;
    generation.current = attempt;
    setStarting(true);
    setError(null);
    try {
      const started = await client.startForgeLogin({
        forge: "github",
        cwd,
        host: host ?? undefined,
      });
      if (generation.current !== attempt) {
        await client.cancelForgeLogin(started.flowId).catch(() => undefined);
        return;
      }
      const nextFlow = {
        flowId: started.flowId,
        verificationUri: started.verificationUri,
        userCode: started.userCode,
      };
      flowId.current = started.flowId;
      setFlow(nextFlow);
      setStarting(false);
      await openExternalUrl(started.verificationUri);
      const result = await client.finishForgeLogin(started.flowId);
      if (generation.current !== attempt) return;
      flowId.current = null;
      setFlow(null);
      toast.show(t("workspace.git.forgeSetup.signedIn", { login: result.login }), {
        variant: "success",
      });
      await onAuthenticated?.();
    } catch (caught) {
      if (generation.current !== attempt) return;
      const failedFlowId = flowId.current;
      flowId.current = null;
      setFlow(null);
      setStarting(false);
      setError(caught instanceof Error ? caught.message : String(caught));
      if (failedFlowId) void client.cancelForgeLogin(failedFlowId).catch(() => undefined);
    }
  }, [client, cwd, flow, host, onAuthenticated, starting, t, toast]);

  const handleCancel = useCallback(() => {
    generation.current += 1;
    const activeFlowId = flowId.current;
    flowId.current = null;
    setFlow(null);
    setStarting(false);
    setError(null);
    if (activeFlowId && client) {
      void client.cancelForgeLogin(activeFlowId).catch(() => undefined);
    }
  }, [client]);

  const handleCopyCode = useCallback(() => {
    if (!flow) return;
    void Clipboard.setStringAsync(flow.userCode).then(() => {
      toast.copied(t("workspace.git.forgeSetup.codeCopied"));
    });
  }, [flow, t, toast]);

  const handleOpenAuthorization = useCallback(() => {
    if (flow) void openExternalUrl(flow.verificationUri);
  }, [flow]);

  return (
    <View style={styles.container} testID="github-auth-callout">
      <View style={styles.content}>
        <Text style={styles.message}>{message}</Text>
        {flow ? (
          <View style={styles.deviceFlow}>
            <Text style={styles.instructions}>
              {t("workspace.git.forgeSetup.deviceInstructions")}
            </Text>
            <Text selectable style={styles.code} testID="github-device-code">
              {flow.userCode}
            </Text>
          </View>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
      <View style={styles.actions}>
        {flow ? (
          <>
            <Button size="sm" variant="outline" leftIcon={Copy} onPress={handleCopyCode}>
              {t("workspace.git.forgeSetup.copyCode")}
            </Button>
            <Button
              size="sm"
              variant="outline"
              leftIcon={ExternalLink}
              onPress={handleOpenAuthorization}
            >
              {t("workspace.git.forgeSetup.openAuthorization")}
            </Button>
            <Button size="sm" variant="ghost" leftIcon={X} onPress={handleCancel}>
              {t("common.cancel")}
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="default"
            leftIcon={LogIn}
            loading={starting}
            disabled={!client}
            onPress={handleSignIn}
          >
            {t("workspace.git.forgeSetup.signInButton")}
          </Button>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    marginHorizontal: theme.spacing[3],
    marginTop: theme.spacing[2],
    padding: theme.spacing[3],
    gap: theme.spacing[3],
    borderWidth: 1,
    borderColor: theme.colors.borderAccent,
    borderRadius: theme.borderRadius.lg,
    backgroundColor: theme.colors.surface2,
  },
  content: {
    gap: theme.spacing[2],
  },
  message: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  deviceFlow: {
    gap: theme.spacing[1],
  },
  instructions: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  code: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.lg,
    fontFamily: theme.fontFamily.mono,
    fontWeight: theme.fontWeight.semibold,
    letterSpacing: 2,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing[2],
    alignItems: "center",
  },
}));

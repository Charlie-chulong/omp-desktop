import { useEffect, useRef } from "react";
import {
  releaseWorkspaceTerminalSession,
  retainWorkspaceTerminalSession,
} from "@/terminal/runtime/workspace-terminal-session";

export function useWorkspaceTerminalSessionRetention(input: {
  scopeKeys: readonly string[];
}): void {
  const retained = useRef(new Set<string>());
  useEffect(() => {
    const next = new Set(input.scopeKeys);
    for (const scopeKey of retained.current) {
      if (!next.has(scopeKey)) releaseWorkspaceTerminalSession({ scopeKey });
    }
    for (const scopeKey of next) {
      if (!retained.current.has(scopeKey)) retainWorkspaceTerminalSession({ scopeKey });
    }
    retained.current = next;
  }, [input.scopeKeys]);
  useEffect(
    () => () => {
      for (const scopeKey of retained.current) releaseWorkspaceTerminalSession({ scopeKey });
      retained.current.clear();
    },
    [],
  );
}

import { AppDiagnosticSheet } from "@/components/app-diagnostic-sheet";
import { isElectronRuntime } from "@/desktop/host";
import { useAppDiagnosticStore } from "@/diagnostics/store";
import { useCurrentAppVersion } from "@/utils/app-version";

export function AppDiagnosticHost() {
  const visible = useAppDiagnosticStore((state) => state.visible);
  const close = useAppDiagnosticStore((state) => state.close);
  const appVersion = useCurrentAppVersion();

  return (
    <AppDiagnosticSheet
      visible={visible}
      onClose={close}
      appVersion={appVersion}
      isDesktopApp={isElectronRuntime()}
    />
  );
}

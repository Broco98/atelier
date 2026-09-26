import { createFileRoute } from "@tanstack/react-router";
import SettingsView from "./-settings-view";

// 설정 nav 항목 하나(UI개선 결정 22). 그리는 규칙은 설정 nav 항목마다 같아 `-settings-view.tsx`가 든다.
export const Route = createFileRoute("/settings/terminal")({
  component: () => <SettingsView item="terminal" />,
});

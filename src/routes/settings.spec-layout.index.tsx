import { createFileRoute } from "@tanstack/react-router";
import SettingsView from "./-settings-view";

// 설정 nav 항목 하나(UI개선 결정 22). 그리는 규칙은 설정 nav 항목마다 같아 `-settings-view.tsx`가
// 든다. 이 설정 nav 항목만 하위 주소(편집기)가 있어 그 라우트가 index와 `$id`로 갈렸다 — 라우트
// 자신은 `settings.spec-layout.tsx`다.
export const Route = createFileRoute("/settings/spec-layout/")({
  component: () => <SettingsView item="spec-layout" />,
});

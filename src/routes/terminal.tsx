import { createFileRoute } from "@tanstack/react-router";
import TerminalPage from "@/features/terminal/TerminalPage";

// `.index` 파일이 아니라 평평한 파일이다 — 결정 16이 「셸 목록은 주소에 넣지 않는다」이므로
// `/terminal`에는 자식이 영영 없다. search 파라미터도 갖지 않는다.
export const Route = createFileRoute("/terminal")({
  component: TerminalRoute,
});

// 이 화면은 셸 상태에서 넘겨받을 것이 없다 — 머리 줄의 자리(사이드바를 따라 옮겨 가는 것)는 앱 셸이 든다(02 구현 스펙 §3).
// 넘길 것이 없어 별도 `-terminal-view.tsx`를 두지 않는다.
function TerminalRoute() {
  return <TerminalPage />;
}

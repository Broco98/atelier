import { createFileRoute } from "@tanstack/react-router";

// 설정의 레이아웃. 그리는 것이 없다 — 항목 하나 = 페이지 하나 = 주소 하나라(UI개선 결정 22)
// 머리(`Settings / 터미널`)도 본문도 항목 페이지가 통째로 든다(`-settings-view.tsx`).
//
// **초안을 여기로 올리지 않는다**(결정 26). 레이아웃은 항목을 옮겨도 살아 있으므로, 여기서 초안을
// 들면 저장 안 한 터미널 설정이 알림으로 옮겨 가도 남는다 — 「다른 항목으로 가면 버린다」가
// 그 순간 거짓이 된다. 값은 주소가 아니라 `~/.atelier/settings.json`이 들고 있다(결정 53).
export const Route = createFileRoute("/settings")({});

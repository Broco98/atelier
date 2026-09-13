import { createFileRoute, redirect } from "@tanstack/react-router";
import { SETTINGS_ITEMS } from "@/features/settings/pages";

// `/settings`는 **첫 항목으로 치환한다**(UI개선 결정 22). 문 셋(사이드바 바닥 · ⌘, · 팔레트)이 다
// 이 주소로 오고, 어느 항목이 첫째인지는 항목 표(`SETTINGS_ITEMS`)의 순서가 정한다 — 사이드바의
// 설정 nav가 위에서 아래로 읽는 그 순서다.
//
// **동기여야 한다** — `index.tsx`와 같은 관용구다. async로 두면 라우터가 다른 갈래로 커밋해
// REPLACE가 풀리고, ⌘, 한 번에 칸이 둘 쌓여 뒤로가기가 치환 전의 빈 주소에 한 번 선다.
// 이 성질은 라이브러리 내부 규칙이라 `router.test.ts`가 고정한다.
export const Route = createFileRoute("/settings/")({
  beforeLoad: () => {
    throw redirect({ to: SETTINGS_ITEMS[0].to });
  },
});

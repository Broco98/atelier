import type { ReactNode } from "react";

// **검사가 화면의 머리를 제자리에서 읽는 길**(02 구현 스펙 §3 · 티켓 03). 화면의 이름 · 할 일은 앱 셸의 머리 줄로 포털을 탄다(`ScreenHead`)
// — 정적 렌더(`renderToStaticMarkup`)는 포털을 그리지 못해, 셸 밖에서는 머리가 아무 데도 서지 않는다(그것이 앱의 계약이다 —
// `ShellHead.test.tsx`). 화면의 머리를 재는 검사는 이 모듈로 `ScreenHead`를 바꿔 끼워, 머리가 그 화면의 마크업 안 머리 줄(`header` —
// 화면 자리 `data-slot="screen-head"`)에 곧장 서게 한다:
//
//   vi.mock("@/components/shell/ShellHead", async (actual) =>
//     (await import("@/components/shell/screen-head-inline")).inlineScreenHead(actual),
//   );
//
// 앱은 이 모듈을 들이지 않는다 — 검사만 쓴다(`work-fixture.ts`처럼 검사 곁의 도우미다).

/** 머리 줄의 화면 자리를 제자리에 세운다 — 셸의 그 줄(`header`)과 자리(`data-slot="screen-head"`)를 본뜬다. */
export function InlineScreenHead({ children }: { children: ReactNode }) {
  return <header data-slot="screen-head">{children}</header>;
}

/** `vi.mock`의 공장 — 진짜 모듈을 그대로 두고 `ScreenHead`만 제자리에 그리는 것으로 바꾼다. */
export async function inlineScreenHead(actual: () => Promise<typeof import("./ShellHead")>) {
  return { ...(await actual()), ScreenHead: InlineScreenHead };
}

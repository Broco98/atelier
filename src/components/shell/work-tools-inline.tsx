import type { ReactNode } from "react";

// **검사가 작업공간 화면의 spec 패널 · 레일을 제자리에서 읽는 길**(restart 02a-14). 작업공간 화면은 패널의 몸을 앱 셸의 작업공간 도구
// 기둥으로 포털을 태워 보낸다(`WorkTools`) — 정적 렌더(`renderToStaticMarkup`)는 포털도 이펙트도 그리지 못해, 셸 밖에서는 패널도 레일도
// 아무 데도 서지 않는다(그것이 앱의 계약이다 — `WorkTools.test.tsx`). 화면의 패널을 재는 검사는 이 모듈로 `WorkTools`를 바꿔 끼워, 화면이
// 건넨 값(열림 · 바쁨 · 여닫기)과 몸으로 기둥을 그 화면의 마크업 안에 곧장 그린다:
//
//   vi.mock("@/components/shell/WorkTools", async (actual) =>
//     (await import("@/components/shell/work-tools-inline")).inlineWorkTools(actual),
//   );
//
// 기둥의 그림(`WorkToolsBoxes`)은 공장이 받은 진짜 모듈에서 꺼낸다 — 이 파일이 그 모듈을 직접 들이면 바꿔 끼우는 중인 모듈을 다시 기다려
// 검사가 멈춘다. 앱은 이 모듈을 들이지 않는다 — 검사만 쓴다(`screen-head-inline`과 같다).

/** `vi.mock`의 공장 — 진짜 모듈을 그대로 두고, `WorkTools`만 화면이 건넨 값으로 기둥을 제자리에 그리는 것으로 바꾼다. */
export async function inlineWorkTools(actual: () => Promise<typeof import("./WorkTools")>) {
  const real = await actual();
  const { WorkToolsBoxes, useWorkPanelWidth } = real;
  function InlineWorkTools({
    open,
    busy = false,
    onToggle,
    children,
  }: {
    open: boolean;
    busy?: boolean;
    onToggle: () => void;
    children: ReactNode;
  }) {
    return (
      <WorkToolsBoxes tools={{ open, busy, onToggle }} size={useWorkPanelWidth()}>
        {children}
      </WorkToolsBoxes>
    );
  }
  return { ...real, WorkTools: InlineWorkTools };
}

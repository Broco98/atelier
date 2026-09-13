import type { SplitSide, ViewTab } from "@/routes/-work-search";
import { dragStore } from "@/lib/pointer-drag";
import type { DragKind, SplitHalf } from "@/lib/pointer-drag";

/**
 * 탭을 본문 위로 끌어다 놓는 길의 **받는 쪽**(결정 86). 끄는 몸짓(문턱 · 창 포인터 리스너 ·
 * 클릭 삼킴 · 끄는 중 표시)과 드래그 상태는 기능 폴더 밖 `@/lib/pointer-drag`가 쥐고 — 두
 * 화면과 사이드바가 같은 몸짓을 딛는다(ui-improvement 스펙 S4) — 여기 남은 것은 분할 판정
 * (어느 절반 위인가, 떨구면 좌우가 어떻게 서는가)과 그에 딸린 작은 번역(끈 종류 → 본문 탭 ·
 * 반대 탭 · 열 머리 문서 이름)이다.
 *
 * **여기에 DOM 조회가 없다.** 놓일 절반을 정하는 것은 본문이 그리는 겹판이고(그 위를
 * 지나가는 포인터가 스스로 말한다), 이 모듈은 「어느 절반 위인가」만 상태에 적는다. 좌표로
 * 절반을 계산하면 본문 영역의 사각형을 여기서 알아야 한다.
 */

/**
 * 떨군 것이 어느 절반이면 spec이 어느 쪽인가.
 *
 * **규칙이 하나다**: 떨군 것이 그 절반에 선다. 열 조합이 늘 `spec ▏터미널`이라(결정 87)
 * 나머지 하나는 반대쪽으로 밀린다 — 그래서 「이미 있는 종류를 떨구면 좌우가 맞바뀐다」가
 * 따로 적을 규칙이 아니라 이 한 줄에서 저절로 나온다.
 */
export function dropSplit(kind: DragKind, half: SplitHalf): SplitSide {
  const specLeft = kind === "spec" ? half === "left" : half === "right";
  return specLeft ? "lr" : "rl";
}

/**
 * 끈 것이 서는 **본문**. `DragKind`와 `ViewTab`이 「셸 ↔ 터미널」 한 칸에서 어긋나 있어,
 * 이 대응을 부르는 쪽마다 적으면 같은 `? :`가 여러 곳에 산다(리뷰가 셋을 셌다).
 */
export function tabOfDrag(kind: DragKind): ViewTab {
  return kind === "shell" ? "terminal" : "spec";
}

/**
 * 반대쪽 열. 열 조합이 늘 `spec ▏터미널`이라(결정 87) 한쪽을 닫으면 **남는 것이 정해진다** —
 * 열 머리의 `×`가 그 값을 `tab`으로 남긴다(결정 89).
 */
export function otherTab(tab: ViewTab): ViewTab {
  return tab === "spec" ? "terminal" : "spec";
}

/**
 * 포인터가 이 절반 위를 지난다. **바뀔 때만 새 상태를 만든다** — 포인터 이동마다 새
 * 객체를 내면 본문이 그 빈도로 다시 그려지고, 거기엔 마크다운 트리가 통째로 들어 있다.
 *
 * 받침 위로 오면 **탭 줄의 틈을 끈다**(ui-improvement 스펙 S10) — 한 눌림의 두 소비자 값이
 * 동시에 켜지면 떼는 순간 순서도 바뀌고 분할도 켜진다(`DragState.slot`).
 */
export function hoverHalf(half: SplitHalf): void {
  dragStore.setState((state) =>
    state.half === half && state.slot === null ? state : { ...state, half, slot: null },
  );
}

/**
 * 포인터가 겹판 **밖으로** 나갔다. 밝아짐을 끈다.
 *
 * **놓을 수 없는 자리인데 밝아 있으면 안 된다.** 놓기를 받는 것은 겹판 자신의 `pointerup`
 * 이라, 탭 줄로 되돌아가 손을 떼면 분할은 안 켜진다(거기서는 틈이 받는다 — `DragState.slot`).
 * 그때까지 반쪽이 밝은 채면 화면이 「여기 놓인다」고 말해 놓고 다른 일을 하는 셈이다.
 */
export function clearHalf(): void {
  dragStore.setState((state) => (state.half === null ? state : { ...state, half: null }));
}

/**
 * 열 머리의 문서 이름 — `판 폴더 / 파일명`(결정 104).
 *
 * **basename만 쓰면 안 된다.** 이 저장소의 spec은 판마다 파일 이름이 `spec.md`라
 * 열 머리가 늘 같은 글자가 되고, 결정 88이 패널을 접어 두므로 어느 판인지 말할 다른
 * 자리도 없다. 폴더가 없는 문서(`overview.md`)는 이름 하나로 족하다.
 */
export function specHeadLabel(path: string | null): string {
  if (!path) return "";
  return path.split("/").filter(Boolean).slice(-2).join(" / ");
}

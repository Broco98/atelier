import { Store } from "@tanstack/react-store";
import type { SplitSide, ViewTab } from "@/routes/-work-search";

/**
 * 사이드바 행을 본문 위로 끌어다 놓는 길(결정 86). **HTML5 드래그가 아니라 포인터
 * 이벤트다** — WKWebView의 `dragstart`가 텍스트 선택과 섞이고, 끄는 동안 그릴 것(놓일
 * 절반의 밝아짐)을 우리가 쥐고 있어야 한다.
 *
 * 상태가 모듈에 사는 것은 **끄는 쪽과 받는 쪽이 형제가 아니기 때문이다** — 출발점은
 * 사이드바(AppShell)이고 도착점은 본문(WorksPage)이라 공통 조상이 앱 루트뿐이다.
 * 그 루트에 드래그 상태를 얹으면 끄는 동안 앱 전체가 다시 그려진다.
 *
 * **여기에 DOM 조회가 없다.** 놓일 절반을 정하는 것은 본문이 그리는 겹판이고(그 위를
 * 지나가는 포인터가 스스로 말한다), 이 모듈은 「무엇을 끌고 있나 · 어느 절반 위인가」
 * 둘만 든다. 좌표로 절반을 계산하면 본문 영역의 사각형을 여기서 알아야 한다.
 */

/** 본문의 어느 절반인가. 열이 아니라 **화면의 절반**이다 — 아직 분할이 아닐 때도 성립한다. */
export type SplitHalf = "left" | "right";

/** 끌 수 있는 것 둘(결정 90). `terminal` 가지와 work 행은 안 끌린다. */
export type DragKind = "spec" | "shell";

export interface DragSource {
  kind: DragKind;
  /** 이 행이 딸린 work. **남의 work의 셸 행도 끌린다**(결정 101) — 떨구면 그 work로 간다. */
  slug: string;
  /** `kind`가 `shell`일 때만 있다. 떨군 셸이 터미널 열에 서야 해서 필요하다. */
  shellId: number | null;
}

export interface DragState {
  /** `null`이면 아무것도 안 끌고 있다 — 본문의 겹판도 그때는 서지 않는다. */
  source: DragSource | null;
  /** 지금 포인터가 어느 절반 위인가. 놓기 전에는 `null`일 수 있다(본문 밖). */
  half: SplitHalf | null;
}

export const dragStore = new Store<DragState>({ source: null, half: null });

/**
 * 드래그로 인정하는 최소 이동(결정 86). **안 두면 그냥 클릭이 드래그로 읽혀 행을 못
 * 누른다** — 사이드바 행은 누르는 것이 본업이고 끄는 것이 덤이다.
 */
export const DRAG_THRESHOLD = 5;

/** 임계값 판정. 축 하나가 아니라 **거리**다 — 대각선으로 5px씩 움직인 것도 드래그다. */
export function farEnough(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD;
}

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
 * 사이드바 행에서 포인터가 눌렸다. **아직 드래그가 아니다** — 5px을 넘어야 시작한다.
 *
 * `preventDefault`를 부르지 않는다: 임계값 안쪽이면 이 눌림은 그냥 클릭이어야 하고,
 * 포인터 캡처도 잡지 않는다 — 캡처를 잡으면 이동 이벤트가 출발한 버튼에만 가서 본문의
 * 겹판이 「내 위를 지나간다」를 스스로 알 길이 없어진다.
 */
export function armDrag(source: DragSource, from: { clientX: number; clientY: number }): void {
  let started = false;

  const move = (event: PointerEvent) => {
    if (started) return;
    if (!farEnough(event.clientX - from.clientX, event.clientY - from.clientY)) return;
    started = true;
    // 끄는 동안 글이 선택되는 것을 막는다. `body.resizing`과 나누는 것은 커서 하나
    // 때문이다 — 그쪽은 col-resize이고 이쪽은 잡은 것을 옮기는 중이다.
    document.body.classList.add("dragging-row");
    dragStore.setState(() => ({ source, half: null }));
  };

  // **끝나는 길이 셋이다**(놓음·취소·임계값 전에 뗌). 셋이 같은 정리를 하지 않으면
  // 리스너나 `user-select: none`이 남아, 다시는 글을 선택할 수 없는 앱이 된다
  // (`setResizing`이 종료 경로마다 반드시 꺼야 하는 것과 같은 함정이다).
  const end = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    if (!started) return;
    document.body.classList.remove("dragging-row");
    dragStore.setState(() => ({ source: null, half: null }));

    // **끈 것이 눌린 것으로도 읽히면 안 된다.** 5px을 넘긴 뒤 출발한 행 위로 되돌아와
    // 놓으면 pointerdown/up이 같은 버튼이라 브라우저가 `click`을 낸다 — 그러면 한 제스처가
    // 「분할을 안 켰다」와 「행을 눌렀다」 둘을 함께 하게 된다.
    //
    // 한 번만 삼키고 **곧바로 거둔다.** `once: true`로 두면 클릭이 안 오는 경우(본문에서
    // 놓았을 때)에 이 리스너가 남아 다음에 아무 데나 누른 클릭을 먹는다.
    const swallow = (event: MouseEvent) => {
      event.stopPropagation();
      event.preventDefault();
    };
    window.addEventListener("click", swallow, true);
    window.setTimeout(() => window.removeEventListener("click", swallow, true), 0);
  };

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}

/**
 * 포인터가 이 절반 위를 지난다. **바뀔 때만 새 상태를 만든다** — 포인터 이동마다 새
 * 객체를 내면 본문이 그 빈도로 다시 그려지고, 거기엔 마크다운 트리가 통째로 들어 있다.
 */
export function hoverHalf(half: SplitHalf): void {
  dragStore.setState((state) => (state.half === half ? state : { ...state, half }));
}

/**
 * 포인터가 겹판 **밖으로** 나갔다. 밝아짐을 끈다.
 *
 * **놓을 수 없는 자리인데 밝아 있으면 안 된다.** 놓기를 받는 것은 겹판 자신의 `pointerup`
 * 이라, 사이드바로 되돌아가 손을 떼면 아무 일도 안 난다 — 그때까지 반쪽이 밝은 채면
 * 화면이 「여기 놓인다」고 말해 놓고 아무것도 안 하는 셈이다.
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

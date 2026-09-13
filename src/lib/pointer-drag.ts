import { Store } from "@tanstack/react-store";

/**
 * 무엇인가를 눌러 끄는 몸짓 하나(결정 86 · ui-improvement 스펙 S4·S5). **HTML5 드래그가 아니라
 * 포인터 이벤트다** — WKWebView의 `dragstart`가 텍스트 선택과 섞이고, 끄는 동안 그릴 것(놓일
 * 절반의 밝아짐)을 우리가 쥐고 있어야 한다.
 *
 * **기능 폴더 밖에 사는 것은 import 금지 검사 둘 때문이다.** 작업 기능 폴더는 `/terminal`이
 * 못 부르고, 터미널 기능 폴더는 사이드바 목록이 못 부른다 — 탭(두 화면)과 작업 행(사이드바)이
 * 같은 몸짓을 딛으려면 어느 쪽에도 속하지 않아야 한다. 그래서 이 파일은 기능 폴더를
 * **타입으로도** 안 부른다(pointer-drag.test.ts가 리터럴로 센다).
 *
 * 상태가 모듈에 사는 것은 **끄는 쪽과 받는 쪽이 형제가 아니기 때문이다** — 출발점(탭 줄)과
 * 도착점(본문)의 공통 조상이 앱 루트 가까이라, 거기에 드래그 상태를 얹으면 끄는 동안 앱 전체가
 * 다시 그려진다.
 *
 * 놓일 자리의 판정(어느 절반 · 떨군 분할 · 몇 번째 틈)은 여기 없다 — 받는 쪽의 일이다
 * (`split-view.ts` · 탭 줄). 여기 있는 것은 그들이 적는 **칸**뿐이다.
 */

/** 본문의 어느 절반인가. 열이 아니라 **화면의 절반**이다 — 아직 분할이 아닐 때도 성립한다. */
export type SplitHalf = "left" | "right";

/** 끌 수 있는 것 둘(결정 90) — 문서 탭과 셸 탭. */
export type DragKind = "spec" | "shell";

export interface DragSource {
  kind: DragKind;
  /**
   * 끈 것이 딸린 화면의 **소유자**(셸 레지스트리의 소유자 키). slug가 아닌 것은 `/terminal`
   * 셸에 slug가 없어서다 — 그 화면도 같은 몸짓으로 끈다.
   *
   * **`string`으로 싣는다.** 그 키의 타입은 터미널 기능 폴더에 살아 여기서 부를 수 없다(머리말).
   * 좁히기는 받는 쪽이 **값을 보고** 한다(그 레지스트리의 `ownerIn`) — `as`로 좁히면 싣는 자리가
   * 늘어날 때 손으로 이은 문자열이 조용히 틀린 slug가 된다.
   */
  owner: string;
  /** `kind`가 `shell`일 때만 있다. 떨군 셸이 터미널 열에 서야 해서 필요하다. */
  shellId: number | null;
}

export interface DragState {
  /** `null`이면 아무것도 안 끌고 있다 — 받는 쪽의 겹판도 그때는 서지 않는다. */
  source: DragSource | null;
  /** 지금 포인터가 어느 절반 위인가. 놓기 전에는 `null`일 수 있다(본문 밖). */
  half: SplitHalf | null;
  /**
   * 지금 포인터가 탭 줄의 몇 번째 틈 위인가 — **끄는 셸이 딸린 화면 셸들 사이**의 번호(0..n)다
   * (ui-improvement 스펙 §6). 탭 줄 밖이거나 놓아도 제자리인 틈이면 `null`이다.
   *
   * **한 눌림을 두 소비자가 나눠 본다**(S10) — 받침은 `half`를, 탭 줄은 이것을 적고, 떼는
   * 순간 포인터 아래의 소비자가 제 값을 읽는다. 그래서 **`half`와 동시에 켜지지 않는다**:
   * 둘이 함께 켜져 있으면 「놓은 곳이 이긴다」가 아니라 둘 다 이긴다. 적는 자리 둘(`hoverSlot` ·
   * 분할 모듈의 `hoverHalf`)이 서로의 값을 끈다.
   */
  slot: number | null;
}

const IDLE: DragState = { source: null, half: null, slot: null };

export const dragStore = new Store<DragState>(IDLE);

/**
 * 드래그로 인정하는 최소 이동(결정 86). **안 두면 그냥 클릭이 드래그로 읽혀 탭을 못
 * 누른다** — 끌리는 것(탭 · 행)은 누르는 것이 본업이고 끄는 것이 덤이다.
 */
export const DRAG_THRESHOLD = 5;

/** 임계값 판정. 축 하나가 아니라 **거리**다 — 대각선으로 5px씩 움직인 것도 드래그다. */
export function farEnough(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD;
}

/**
 * 포인터가 눌렸다. **아직 드래그가 아니다** — 5px을 넘어야 시작한다.
 *
 * `preventDefault`를 부르지 않는다: 임계값 안쪽이면 이 눌림은 그냥 클릭이어야 하고,
 * 포인터 캡처도 잡지 않는다 — 캡처를 잡으면 이동 이벤트가 출발한 버튼에만 가서 받는 쪽
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
    dragStore.setState(() => ({ ...IDLE, source }));
    window.addEventListener("keydown", cancel, true);
  };

  // **끄는 중 표시를 걷는 자리는 여기 하나다.** 끝나는 길이 넷(놓음 · 취소 · 임계값 전에 뗌 ·
  // Esc)인데 넷이 같은 정리를 하지 않으면 `user-select: none`이 남아, 다시는 글을 선택할 수
  // 없는 앱이 된다(`setResizing`이 종료 경로마다 반드시 꺼야 하는 것과 같은 함정이다).
  // 두 번 불려도 된다 — Esc로 걷은 뒤 손을 떼면 한 번 더 온다.
  const settle = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("keydown", cancel, true);
    document.body.classList.remove("dragging-row");
    dragStore.setState((state) => (state.source === null ? state : IDLE));
  };

  // **Esc는 끌기를 취소하고 아무것도 안 부른다.** 캡처로 듣고 전파를 막는다(선례: AppDialog) —
  // 탭을 눌러 끌어도 포커스는 xterm의 숨은 입력칸에 남을 수 있어(WKWebView는 누른 버튼으로
  // 포커스를 안 옮긴다), 버블에서 기다리면 xterm이 먼저 받아 셸에 `ESC`를 써 버린다.
  // **끄는 동안만** 건다 — 문턱 전에는 드래그가 아니라 그 Esc는 원래 주인의 것이다.
  //
  // 창의 떼기 리스너는 남긴다: 취소해도 손은 아직 눌린 채라, 뗀 순간의 클릭을 아래 `end`가
  // 삼켜야 한다 — 출발한 탭 위에서 떼면 취소한 끌기가 「탭을 눌렀다」로 읽힌다. 겹판은
  // 상태가 비면서 이미 걷혀 떼기를 받을 것이 없다.
  const cancel = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    settle();
  };

  const end = () => {
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    settle();
    if (!started) return;

    // **끈 것이 눌린 것으로도 읽히면 안 된다.** 5px을 넘긴 뒤 출발한 탭 위로 되돌아와
    // 놓으면 pointerdown/up이 같은 버튼이라 브라우저가 `click`을 낸다 — 그러면 한 제스처가
    // 「분할을 안 켰다」와 「탭을 눌렀다」 둘을 함께 하게 된다.
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
 * 포인터가 탭 줄의 이 틈 위를 지난다(`null`이면 틈이 아닌 자리). **바뀔 때만 새 상태를
 * 만든다** — 포인터 이동마다 새 객체를 내면 구독한 화면이 그 빈도로 다시 그려진다.
 *
 * **끄는 중일 때만 적는다.** 탭 줄은 누른 순간부터 이동을 보고하는데(문턱은 여기서만 안다),
 * 문턱 전이나 Esc로 취소한 뒤에 틈이 서면 드래그가 아닌 눌림이 순서를 바꾼다.
 *
 * 틈이 켜지면 절반을 끈다 — 두 소비자의 값이 동시에 켜지지 않는다(`DragState.slot`).
 */
export function hoverSlot(slot: number | null): void {
  dragStore.setState((state) => {
    if (state.source === null) return state;
    if (state.slot === slot && (slot === null || state.half === null)) return state;
    return { ...state, slot, half: slot === null ? state.half : null };
  });
}

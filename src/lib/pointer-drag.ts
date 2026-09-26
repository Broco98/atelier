import { Store } from "@tanstack/react-store";

/**
 * 무엇인가를 눌러 끄는 몸짓 하나(결정 86 · UI개선 스펙 S4·S5). **HTML5 드래그가 아니라
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
 * 놓일 자리의 판정(어느 절반 · 떨군 분할 · 몇 번째 틈)은 여기 없다 — 받는 쪽 모듈의 일이다: 탭은
 * 본문의 절반(`split-view.ts`)과 탭 줄의 틈, 작업 행은 목록의 틈(`features/works/row-drop.ts`).
 * 여기 있는 것은 탭의 두 소비자가 적는 **칸**과 그 칸에 적는 함수 — 두 값이 동시에 안 켜진다는
 * 불변식을 한 곳에서 지키려고 여기 모인다 — 그리고 좌표로 자리를 정하는 쪽에 주는 끄는 동안의
 * 포인터와 「놓았다」·「끝났다」(`DragHandlers`)다.
 */

/** 본문의 어느 절반인가. 열이 아니라 **화면의 절반**이다 — 아직 분할이 아닐 때도 성립한다. */
export type SplitHalf = "left" | "right";

/** 본문 위로 끌어 분할을 세울 수 있는 것 둘(결정 90) — 문서 탭과 셸 탭. */
export type DragKind = "spec" | "shell";

/** 탭 줄에서 끈 것. 놓일 자리는 본문의 절반이다(`split-view.ts`). */
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

/**
 * 사이드바에서 끈 **작업 행**(UI개선 스펙 §4). 놓일 자리는 목록의 틈이고 본문은 받지 않는다 —
 * 그래서 탭의 원천과 종류가 갈린다. 다만 상태(`DragState.source`)에는 둘이 함께 실린다: 한 번에
 * 하나만 끌리고, 탭 줄·사이드바가 「무엇이든 끌리는 중인가」를 한 값으로 읽는다. 탭만 받는 쪽은
 * 아래 `tabDragOf`로 읽는다 — 거르는 자리가 받는 쪽마다 흩어지면 하나가 빠진 날 분할 겹판이 작업 행
 * 끌기에도 선다.
 *
 * owner가 아니라 **slug**를 싣는다. 이 원천을 만드는 사이드바 목록은 터미널을 모르고(그쪽 import
 * 금지 검사), owner는 셸 레지스트리의 말이다 — 작업 행에는 셸이 없어도 slug는 늘 있다.
 */
export interface RowDragSource {
  kind: "work";
  slug: string;
}

export interface DragState {
  /** `null`이면 아무것도 안 끌고 있다 — 받는 쪽의 겹판도 그때는 서지 않는다. */
  source: DragSource | RowDragSource | null;
  /** 지금 포인터가 어느 절반 위인가. 놓기 전에는 `null`일 수 있다(본문 밖). */
  half: SplitHalf | null;
  /**
   * 지금 포인터가 탭 줄의 몇 번째 틈 위인가 — **끄는 셸이 딸린 화면 셸들 사이**의 번호(0..n)다
   * (UI개선 스펙 §6). 탭 줄 밖이거나 놓아도 제자리인 틈이면 `null`이다.
   *
   * **한 눌림을 두 소비자가 나눠 본다**(S10) — 받침은 `half`를, 탭 줄은 이것을 적고, 떼는
   * 순간 포인터 아래의 소비자가 제 값을 읽는다. 그래서 **`half`와 동시에 켜지지 않는다**:
   * 둘이 함께 켜져 있으면 「놓은 곳이 이긴다」가 아니라 둘 다 이긴다. 그 판정은 이 모듈의
   * `hover` 한 곳이 한다.
   */
  slot: number | null;
}

const IDLE: DragState = { source: null, half: null, slot: null };

export const dragStore = new Store<DragState>(IDLE);

/** 끌리는 것이 **탭**일 때만 그 원천 — 본문 절반처럼 탭만 받는 쪽이 읽는 자리다(위 `RowDragSource`). */
export function tabDragOf(state: DragState): DragSource | null {
  return state.source?.kind === "work" ? null : state.source;
}

/**
 * 드래그로 인정하는 최소 이동(결정 86). **안 두면 그냥 클릭이 드래그로 읽혀 탭을 못
 * 누른다** — 끌리는 것(탭 · 행)은 누르는 것이 본업이고 끄는 것이 덤이다.
 */
export const DRAG_THRESHOLD = 5;

/** 임계값 판정. 축 하나가 아니라 **거리**다 — 대각선으로 5px씩 움직인 것도 드래그다. */
export function farEnough(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) >= DRAG_THRESHOLD;
}

export interface DragPoint {
  clientX: number;
  clientY: number;
}

/**
 * **좌표로 놓일 자리를 정하는 쪽**이 거는 손잡이(작업 행 — UI개선 스펙 S6). 탭은 안 건다: 그쪽
 * 받는 자리(본문 절반)는 겹판이 스스로 「내 위다」를 말하지만, 목록의 틈은 행 **사이**라 그 위를
 * 지나가는 요소가 없다.
 *
 * 문턱을 넘은 끌기에만 온다 — 문턱 안쪽의 눌림은 클릭이지 끌기가 아니다.
 */
export interface DragHandlers {
  /** 문턱을 넘었다. 기하를 한 번 재는 자리다. */
  start?: () => void;
  /** 문턱을 넘은 뒤 포인터가 움직였다(넘는 순간의 이동 포함). */
  move?: (point: DragPoint) => void;
  /** 놓았다. **Esc·`pointercancel`·도중 취소로 끝나면 안 온다.** */
  drop?: (point: DragPoint) => void;
  /** 어느 길로든 끝났다 — 놓았을 때는 `drop` 뒤에 온다. */
  end?: () => void;
}

/** 지금 도는 끌기를 거둘 손잡이. 문턱을 넘은 동안만 있다. */
let abortActive: (() => void) | null = null;

/**
 * 도는 끌기를 **취소한다** — Esc와 같은 정리를 하고 아무것도 안 부른다. 끄는 도중 받는 쪽의
 * 기하가 무너졌을 때(목록이 바뀌었다) 받는 쪽이 부른다. 도는 것이 없으면 아무 일도 없다.
 */
export function cancelDrag(): void {
  abortActive?.();
}

/**
 * 지금 걸린 눌림 하나 — **문턱 전이든 뒤든**. 위 `abortActive`와 따로 두는 것은 문턱 전의 눌림도
 * 거둬야 하는 길이 있어서다(아래 `cancelGoneShellDrag`). 사이드바 목록의 취소(`cancelDrag`)는
 * 문턱에서 기하를 재므로 문턱 전을 건드릴 까닭이 없고, 건드리면 목록이 갱신될 때마다 누른 채
 * 천천히 끄는 손이 논다.
 */
let armed: { source: DragSource | RowDragSource; disarm: () => void } | null = null;

/**
 * **끄는 셸이 사라졌으면 끌기를 거둔다**(결정 48 · UI개선 스펙 S8). 원천의 `shellId`는 누른 순간
 * 실려 떼기까지 안 바뀌어서, 그 셸이 끝나도(pty exit · `×` · ⌘W · 아카이빙의 회수) 안 거두면 받침이
 * 선 채 **없는 셸로** 분할이 켜진다. `alive`는 그 셸이 아직 있는지를 아는 쪽(터미널 스토어)이 준다 —
 * 이 모듈은 기능 폴더를 못 부른다(머리말).
 *
 * - **문턱 전의 눌림도 거둔다.** 누른 뒤 5px 전에 셸이 끝나면 남은 리스너가 다음 이동에서 죽은 id로
 *   끌기를 시작한다. 그때는 끌기가 아니었으므로 클릭을 삼킬 것도 없이 리스너만 뗀다.
 * - 문턱 뒤면 Esc와 같은 길(`abort`)이다 — 표시를 걷고, 뗄 때 클릭을 삼키고, `drop`을 안 부른다.
 * - **셸 끌기만 본다.** 문서 칸(`shellId`가 없다)과 작업 행은 셸 목록과 무관하다.
 */
export function cancelGoneShellDrag(alive: (shellId: number) => boolean): void {
  const source = armed?.source;
  if (source?.kind !== "shell" || source.shellId === null || alive(source.shellId)) return;
  armed?.disarm();
}

/**
 * 포인터가 눌렸다. **아직 드래그가 아니다** — 5px을 넘어야 시작한다.
 *
 * `preventDefault`를 부르지 않는다: 임계값 안쪽이면 이 눌림은 그냥 클릭이어야 하고,
 * 포인터 캡처도 잡지 않는다 — 캡처를 잡으면 이동 이벤트가 출발한 버튼에만 가서 받는 쪽
 * 겹판이 「내 위를 지나간다」를 스스로 알 길이 없어진다.
 */
export function armDrag(
  source: DragSource | RowDragSource,
  from: DragPoint,
  handlers: DragHandlers = {},
): void {
  let started = false;
  // 문턱을 넘은 뒤 **놓기 전에** 끝났는가(Esc · 도중 취소). 손을 떼는 순간 `drop`을 안 부르는 근거다.
  let aborted = false;

  const move = (event: PointerEvent) => {
    if (aborted) return;
    if (started) {
      handlers.move?.(event);
      return;
    }
    if (!farEnough(event.clientX - from.clientX, event.clientY - from.clientY)) return;
    started = true;
    // 끄는 동안 글이 선택되는 것을 막는다. `body.resizing`과 나누는 것은 커서 하나
    // 때문이다 — 그쪽은 col-resize이고 이쪽은 잡은 것을 옮기는 중이다.
    document.body.classList.add("dragging-row");
    dragStore.setState(() => ({ ...IDLE, source }));
    window.addEventListener("keydown", cancel, true);
    abortActive = abort;
    handlers.start?.();
    handlers.move?.(event);
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
    if (abortActive === abort) {
      abortActive = null;
      handlers.end?.();
    }
  };

  // Esc와 도중 취소가 함께 딛는 길. **떼기 리스너는 남긴다**(아래 `cancel` 주석) — 그래서 여기서
  // 표시만 걷고, 손을 뗄 때 `end`가 클릭을 삼킨다.
  const abort = () => {
    aborted = true;
    settle();
  };

  // **Esc는 끌기를 취소하고 아무것도 안 부른다.** 캡처로 듣고 전파를 막는다(선례: 첫 프레임
  // 가드, `components/ui/first-frame-guard.ts`) — 탭을 눌러 끌어도 포커스는 xterm의 숨은 입력칸에 남을 수 있어(WKWebView는 누른 버튼으로
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
    abort();
  };

  const end = (event: PointerEvent) => {
    window.removeEventListener("pointerup", end);
    window.removeEventListener("pointercancel", end);
    if (armed === gesture) armed = null;
    // **정리보다 먼저 놓는다** — 받는 쪽이 끄는 동안 쥔 기하를 `end`에서 걷으므로.
    // `pointercancel`은 놓음이 아니다: 시스템이 제스처를 가로챈 것이라 사람이 고른 자리가 없다.
    if (started && !aborted && event.type === "pointerup") handlers.drop?.(event);
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

  // 원천이 사라져 거둘 때의 길(`cancelGoneShellDrag`). 문턱 뒤면 Esc와 같다. 문턱 전이면 이 눌림은
  // 아직 클릭일 뿐이라 **리스너만 뗀다** — 표시도 상태도 선 적이 없고, 삼킬 클릭도 없다.
  const gesture = {
    source,
    disarm: () => {
      if (armed === gesture) armed = null;
      if (started) {
        abort();
        return;
      }
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
    },
  };
  armed = gesture;

  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
}

/**
 * 한 눌림의 두 소비자(받침의 절반 · 탭 줄의 틈)가 값을 적는 **유일한 자리**다(UI개선
 * 스펙 S10). 아래 적는 함수 셋이 모두 이것을 지나고, 이 모듈 밖에서는 `dragStore`를 고치지
 * 않는다(pointer-drag.test.ts가 소스를 훑어 센다).
 *
 * - **한쪽이 켜지면 다른 쪽이 꺼진다.** 둘이 함께 켜져 있으면 떼는 순간 두 소비자가 각자 제 값을
 *   보고 순서도 바꾸고 분할도 켠다 — 「놓은 곳이 이긴다」가 아니라 둘 다 이긴다.
 * - 끄는 것(`null`)은 **제 값만** 끈다 — 틈을 떠났다고 받침의 절반까지 꺼지면 안 된다.
 * - **바뀔 때만 새 상태를 만든다** — 포인터 이동마다 새 객체를 내면 구독한 화면이 그 빈도로
 *   다시 그려지고, 본문에는 마크다운 트리가 통째로 들어 있다.
 */
function hover(next: { half: SplitHalf | null } | { slot: number | null }): void {
  dragStore.setState((state) => {
    const half = "half" in next ? next.half : next.slot === null ? state.half : null;
    const slot = "slot" in next ? next.slot : next.half === null ? state.slot : null;
    return state.half === half && state.slot === slot ? state : { ...state, half, slot };
  });
}

/**
 * 포인터가 탭 줄의 이 틈 위를 지난다(`null`이면 틈이 아닌 자리).
 *
 * **끄는 중일 때만 적는다.** 탭 줄은 누른 순간부터 이동을 보고하는데(문턱은 여기서만 안다),
 * 문턱 전이나 Esc로 취소한 뒤에 틈이 서면 드래그가 아닌 눌림이 순서를 바꾼다.
 */
export function hoverSlot(slot: number | null): void {
  if (dragStore.state.source === null) return;
  hover({ slot });
}

/**
 * 포인터가 본문의 이 절반 위를 지난다. 받침(겹판)은 끄는 중에만 서므로 따로 거르지 않는다.
 * 어느 절반인지를 **정하는 것**은 받는 쪽(`split-view.ts` · 겹판)이다 — 여기는 적기만 한다.
 */
export function hoverHalf(half: SplitHalf): void {
  hover({ half });
}

/**
 * 포인터가 겹판 **밖으로** 나갔다. 밝아짐을 끈다.
 *
 * **놓을 수 없는 자리인데 밝아 있으면 안 된다.** 놓기를 받는 것은 겹판 자신의 `pointerup`
 * 이라, 탭 줄로 되돌아가 손을 떼면 분할은 안 켜진다(거기서는 틈이 받는다 — `DragState.slot`).
 * 그때까지 반쪽이 밝은 채면 화면이 「여기 놓인다」고 말해 놓고 다른 일을 하는 셈이다.
 */
export function clearHalf(): void {
  hover({ half: null });
}

/**
 * 탭 줄에서 손을 뗀 순간 옮길 것 — 끄는 것이 셸이고 틈이 켜져 있을 때만 있다. 받는 쪽(터미널
 * 스토어)이 드래그 상태의 모양(원천 · 틈)을 몰라도 되게 여기서 꺼낸다.
 */
export function shellMoveOf(state: DragState): { shellId: number; slot: number } | null {
  const { source, slot } = state;
  if (source?.kind !== "shell" || source.shellId === null || slot === null) return null;
  return { shellId: source.shellId, slot };
}

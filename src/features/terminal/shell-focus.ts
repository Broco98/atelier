/**
 * 셸로 가는 길이 키보드 포커스를 데려오는 규칙(티켓 16 · 프로세스 결정 18 ② · 프로세스 스펙 S21). 순수 함수 넷이다 —
 * xterm을 부르는 자리는 스토어에 남는다(`terminal-store`의 `focusShell` · `openOrReattach`).
 *
 * **왜 요청이 따로 있나.** 이미 켜진 셸을 다시 고르면 레지스트리가 같은 상태를 돌려줘(`activateShell`) 붙기가 다시 돌지
 * 않는다. 붙기만이 포커스를 주던 때는 그래서 띠에서 보고 있는 셸을 눌러도 키가 아무 데도 안 들어갔다 — WebKit은 누른
 * 버튼으로 포커스를 옮기지 않는 대신 mousedown에서 **비우기** 때문이다(`body`로 간다. macOS WebKit에서 쟀다).
 * 그래서 셸로 가는 길(띠의 줄 · 셸 탭)은 스토어에 포커스를 **요청한다.** 붙어 있으면 그 자리에서 주고, 아니면 여기
 * 「기다리는 포커스」로 적어 그 셸이 붙는 순간 준다.
 *
 * **왜 붙는 순간의 포커스에 조건이 있나.** 한때 셸을 열거나 다시 붙이는 함수 안에 조건 없는 한 줄이 있었다. 그 함수는
 * 셸이 붙을 때와 글꼴이 늦게 와 열 때 불리므로, 요청이 없어도 — 사람이 팔레트나 이름 바꾸기 칸에 가 있어도 — 늦게 열린
 * 셸이 포커스를 가져갔다.
 *
 * 이 모듈은 시간을 모른다. 「언제」는 부르는 자리가 정하고, 여기는 사건의 순서만 본다.
 */

/** 붙음 사건의 종류 — 여는 함수를 부르는 두 자리다. */
export type AttachKind =
  /** 화면이 그 셸의 집을 들였다(`attachShell`). 처음 붙음도, 떼었다 다시 붙음도 이것이다. */
  | "attach"
  /** 글꼴이 늦게 와 이미 붙어 있던 셸을 이제 연다(`loadFont`). */
  | "fontLate";

export interface AttachEvent {
  kind: AttachKind;
  /** 붙는 셸의 레지스트리 id. */
  id: number;
}

/**
 * 기다리는 포커스 — 포커스를 기다리는 셸의 레지스트리 id다. **한 번에 하나다.** 남기는 자리는 둘이다: 사람이 셸로 가는
 * 길을 눌렀다(`focusShell`), 셸이 붙었는데 글꼴이 아직이라 못 열었다(`deferAttach`). **둘은 무게가 같다** — 누가
 * 남겼든 그 셸이 열리는 순간 포커스가 다른 입력칸에 있으면 안 준다(`focusOnAttach`). 그래서 누가 남겼는지는 적지 않는다.
 */
export type PendingFocus = number | null;

/** 지금 포커스가 앉은 자리. */
export type FocusPlace =
  /** 셸(아무 xterm)의 숨은 입력칸. 다른 셸에서 옮겨 오는 것은 빼앗는 것이 아니다. */
  | "shell"
  /** 앱의 다른 입력칸 — 팔레트, 이름 바꾸기, 설정의 글자 칸. */
  | "field"
  /** 그 밖 — 본문, 버튼, 프레임, 아무 데도 없음. */
  | "elsewhere";

/** 기다리는 포커스를 바꾸는 사건. */
export type PendingEvent =
  /** 사람이 그 셸로 가는 길을 눌렀다. `attached`면 스토어가 그 자리에서 포커스를 준다 — 기다릴 것이 없다. */
  | { kind: "request"; id: number; attached: boolean }
  /** 그 셸이 붙어 열렸다. */
  | { kind: "attached"; id: number }
  /** 그 셸의 집이 화면에서 떨어졌다. */
  | { kind: "detached"; id: number }
  /** 그 셸이 닫혔다. */
  | { kind: "closed"; id: number };

/**
 * 기다리는 포커스의 다음 값(프로세스 스펙 S21).
 *
 * - 새 요청이 앞의 것을 **덮는다.** 붙어 있는 셸의 요청은 그 자리에서 채워지므로 기다리는 것이 남지 않는다.
 * - **그 셸이** 붙는 순간 한 번 소비한다. 다른 셸이 붙는 순간에는 소비하지 않는다 — 화면을 옮기는 사이 잠깐 붙는
 *   셸(떠나는 화면의 셸 · StrictMode의 두 번째 마운트)이 요청을 가져가면 정작 부른 셸이 포커스를 못 받는다.
 * - 그 셸이 닫히면 버린다.
 * - **그 셸이 열리지 못한 채 떨어져도 버린다**(스펙에 없던 줄). 글꼴을 기다리던 셸에서 사람이 화면을 옮겼다 — 남겨
 *   두면 다른 셸이 붙을 때마다 「다른 셸을 기다린다」로 포커스를 막는다. 열린 셸은 붙는 순간 이미 소비했다.
 */
export function nextPendingFocus(pending: PendingFocus, event: PendingEvent): PendingFocus {
  if (event.kind === "request") return event.attached ? null : event.id;
  return pending === event.id ? null : pending;
}

/**
 * 셸이 붙었는데 **글꼴이 아직이라 못 열었다** — 지금 열렸으면 포커스를 받았을 자리면 그 셸을 기다리는 포커스로
 * 남긴다. 글꼴 길은 기다리는 것이 이 셸일 때만 주므로(`focusOnAttach`), 이것이 없으면 콜드 스타트의 첫 셸은 포커스를
 * 영영 못 받는다 — 첫 셸은 늘 글꼴보다 먼저 붙는다.
 *
 * 다른 셸의 요청은 덮지 않는다(그 판정이 이미 거짓이다). 이 셸을 이미 기다리고 있으면 입력칸에 있어도 그대로 남는다 —
 * 여는 순간 다시 판정한다.
 */
export function deferAttach(id: number, pending: PendingFocus, place: FocusPlace): PendingFocus {
  return focusOnAttach({ kind: "attach", id }, pending, place) ? id : pending;
}

/**
 * 셸이 붙는 순간 xterm에 포커스를 주나(프로세스 스펙 S21). 위에서부터 처음 걸리는 줄이 답이다.
 *
 * 1. 기다리는 포커스가 **다른 셸**이면 안 준다.
 * 2. **글꼴이 늦게 와 여는 길**은 기다리는 포커스가 이 셸일 때만 준다.
 * 3. 포커스가 앱의 **다른 입력칸**(xterm 말고)에 있으면 안 준다 — **이 셸을 사람이 요청했어도 그렇다**(티켓 16 · S21은
 *    이 조건에 예외를 두지 않는다). 지금 부르는 자리(띠 · 셸 탭)는 버튼이라 부르는 순간 포커스가 비워진다. 그러니 여기
 *    걸리는 것은 부른 **뒤에** 입력칸으로 간 사람이고, 그 입력칸이 지금의 뜻이다. 한때 사람 요청이 이 줄보다 앞서, 요청한
 *    셸이 늦게 열리며 그사이 연 팔레트의 글자를 가져갔다.
 * 4. 그 밖(기다리는 것이 없거나 이 셸이고, 셸이 붙음)은 지금처럼 준다 — 돌아온 사람은 이어 치려고 온 것이다.
 */
export function focusOnAttach(event: AttachEvent, pending: PendingFocus, place: FocusPlace): boolean {
  if (pending !== null && pending !== event.id) return false;
  if (event.kind === "fontLate" && pending === null) return false;
  return place !== "field";
}

/** 포커스 자리를 가르는 데 읽는 것만 — DOM 요소가 그대로 맞는다. */
export interface FocusedElement {
  tagName: string;
  type?: string;
  isContentEditable?: boolean;
  classList?: { contains(token: string): boolean };
}

/** 글자를 치지 않는 `input` — 눌러 고르는 칸이라 포커스가 있어도 빼앗길 글자가 없다. */
const PRESSED_INPUTS = new Set(["button", "submit", "reset", "checkbox", "radio", "range", "color", "file", "image"]);

/**
 * 지금 포커스 자리(`document.activeElement`). xterm이 키를 받는 자리도 `textarea`라 셸을 먼저 가른다 — 안 가르면 셸에서
 * 셸로 옮기는 것(⌘2 · 탭)이 「입력칸에서 빼앗음」이 되어 포커스가 안 따라간다.
 */
export function focusPlaceOf(element: FocusedElement | null): FocusPlace {
  if (element === null) return "elsewhere";
  if (element.classList?.contains("xterm-helper-textarea")) return "shell";
  if (element.isContentEditable) return "field";
  const tag = element.tagName.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return "field";
  if (tag === "INPUT") return PRESSED_INPUTS.has((element.type ?? "text").toLowerCase()) ? "elsewhere" : "field";
  return "elsewhere";
}

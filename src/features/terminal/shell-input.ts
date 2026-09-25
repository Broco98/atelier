import { shellHotkey, shellRewrite } from "./shell-registry";
import type { ShellHotkey } from "./shell-registry";
import { IME_KEYCODE, isModifierKey } from "./terminal-ime";

/**
 * 사람 입력(프로세스 스펙 S16)과 키다운 가르기 — **DOM 사건 하나를 받아 답하는 순수 함수 둘**이다.
 *
 * 둘을 따로 세운 것은 읽는 쪽이 여럿이어서다. 셸의 키 핸들러(`terminal-store.ts`의
 * `attachCustomKeyEventHandler`)가 키다운 하나를 여기서 한 번 가르고, 그 답으로 무엇을 할지 고른다 —
 * 앱이 가져갈지, 바꿔 보낼지, 사람 입력으로 적을지. 뒤 판의 중단 추론(Esc · Ctrl-C)과 승인 추론(확정 키)도
 * 같은 자리에서 같은 답을 더 읽는다. 가르는 자리가 둘이면 한쪽만 키가 늘어, 셸로 간 키가 입력으로 안
 * 세이거나 앱이 가져간 키가 입력으로 세인다.
 *
 * **데이터 모양이 아니라 DOM 사건으로 가른다.** xterm이 셸로 내보내는 데이터(`onData`)는 사람이 친 것과
 * xterm의 응답(장치 속성 DA, 커서 위치 CPR, 포커스 보고)을 가르지 않고, ⇧F3처럼 CPR과 바이트가 같은 키도
 * 있다. p10k는 프롬프트를 그릴 때마다 커서 위치를 묻는다 — 응답을 입력으로 세면 모든 셸이 「입력을 받은」
 * 셸이 되어, 둘러보다 저절로 뜬 셸이 하나도 안 닫힌다(프로세스 결정 7).
 *
 * 이 모듈은 시간을 모른다. 첫 사람 입력의 시각을 찍는 자리는 터미널 스토어다.
 */

/**
 * 가르는 데 보는 키다운의 칸. `KeyboardEvent`를 이름으로 받지 않는 것은 레지스트리의 키 판정과 같은
 * 까닭이다 — 구조로만 받으면 검사가 객체 리터럴 하나로 부른다.
 */
export interface KeyDown {
  type: string;
  code: string;
  key: string;
  keyCode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * 키다운 하나가 가는 곳.
 *
 * - `shell` — xterm이 셸로 보낸다. `rewrite`가 있으면 그 바이트로 바꿔 보낸다(⇧Enter · 결정 91).
 * - `ime` — 입력기가 문 키(keyCode 229). xterm은 이 키로 아무것도 안 보내고, 글자는 입력기가 확정할 때
 *   간다 — 한글이면 IME 다리가, 조합 사건이 오는 입력기(일본어 · 중국어)면 xterm의 조합 도우미가 보낸다.
 *   조합 중의 Esc도 이 키로 온다. 셸 키와 가르는 것은 그 Esc를 「끊었다」로 읽지 않게 하려는 것이다.
 * - `app` — 앱 단축키. `hotkey`가 있으면 셸의 핸들러가 가져가는 키이고(`shellHotkey`), 없으면 그 밖의
 *   ⌘ 화음이다 — 셸로는 안 가지만 핸들러가 막지도 않는다(⌘B는 앱 셸이, ⌘C · ⌘V는 메뉴가, ⌘A는 xterm이 받는다).
 * - `modifier` — 수정키만 누른 것.
 */
export type KeyRoute =
  | { to: "shell"; rewrite: string | null }
  | { to: "ime" }
  | { to: "app"; hotkey: ShellHotkey | null }
  | { to: "modifier" };

/**
 * 키다운 하나를 가른다. **키다운이 아니면 `null`이다** — xterm은 사용자 키 핸들러를 keypress · keyup에도
 * 부른다. 한 번 누른 키를 세 번 가르지 않는다.
 *
 * 순서가 뜻이다. 셸 핸들러가 가져가는 키가 먼저다 — 그 판정(`shellHotkey`)이 정본이고 여기서 다시 적지
 * 않는다. 그다음 수정키, 입력기가 문 키, ⌘ 화음 순이다.
 *
 * **⌘ 화음은 글자 키일 때만 앱 몫이다.** xterm은 ⌘가 붙은 글자 키를 셸로 안 보낸다(`Keyboard.ts`의
 * macOS ⌘ 갈래는 ⌘A 전체 선택 하나다). ⌘Enter · ⌘Backspace 같은 이름 있는 키에는 xterm이 바이트를
 * 만드므로 셸 키로 둔다. `key`가 한 글자인가로 가르는 것도 xterm이 글자 키를 가르는 방식 그대로다
 * (한글 입력기가 켜져 있으면 자모 한 글자로 온다).
 */
export function keyRoute(event: KeyDown): KeyRoute | null {
  if (event.type !== "keydown") return null;
  const hotkey = shellHotkey(event);
  if (hotkey !== null) return { to: "app", hotkey };
  if (isModifierKey(event.key)) return { to: "modifier" };
  if (event.keyCode === IME_KEYCODE) return { to: "ime" };
  if (event.metaKey && event.key.length === 1) return { to: "app", hotkey: null };
  return { to: "shell", rewrite: shellRewrite(event) };
}

/**
 * 셸 쪽에서 일어난 일 하나. 앞의 셋은 DOM 사건이고 마지막 하나는 xterm이 셸로 내보낸 데이터다.
 *
 * - `keydown` — xterm의 사용자 키 핸들러가 받은 키.
 * - `paste` — 붙여넣기. 셸의 집에 선 `paste` 사건이다(xterm이 입력칸과 화면 두 자리에서 받는다).
 * - `ime` — IME 다리가 확정해 셸로 보낸 글자(`terminal-ime.ts`). WKWebView는 한글에 조합 사건
 *   (`compositionstart`)을 안 주고 `insertText` · `insertReplacementText` 입력 사건만 준다 — 조합 사건에
 *   걸면 한글만 친 셸이 「입력 없음」으로 읽혀 떠날 때 친 글자와 함께 닫힌다.
 * - `data` — xterm이 셸로 내보낸 데이터(`onData`). 사람이 친 키의 바이트도, xterm의 응답도 여기로 온다.
 *
 * 끌어 놓기는 지금 앱에 받는 길이 없다. 생기면 여기에 한 갈래로 든다.
 */
export type InputHappening =
  | { kind: "keydown"; event: KeyDown }
  | { kind: "paste" }
  | { kind: "ime"; data: string }
  | { kind: "data"; data: string };

/**
 * 사람 입력인가.
 *
 * **입력기가 문 키다운도 입력이다.** 사람이 그 셸에 글자를 치고 있다 — 글자가 셸에 닿는 것은 입력기가
 * 확정할 때일 뿐이다. 조합 사건이 오는 입력기는 IME 다리를 안 지나므로, 이 줄이 없으면 그 입력기로만
 * 친 셸이 「입력 없음」으로 읽힌다. 한글은 다리가 보내는 순간도 따로 센다(`ime`).
 *
 * **데이터는 늘 입력이 아니다.** 사람이 친 키의 바이트도 여기 오지만, 그 사실은 앞의 키다운이 이미
 * 말했다. 데이터만 오는 것은 xterm이 스스로 답한 것이다 — 모양으로 가르지 않는다(머리말).
 */
export function humanInput(happening: InputHappening): boolean {
  switch (happening.kind) {
    case "keydown": {
      const route = keyRoute(happening.event);
      return route?.to === "shell" || route?.to === "ime";
    }
    case "paste":
    case "ime":
      return true;
    case "data":
      return false;
  }
}

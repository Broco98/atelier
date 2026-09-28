import { describe, expect, it } from "vitest";
import { answerKey, humanInput, isInterruptKey, keyRoute } from "./shell-input";
import type { InputHappening, KeyDown } from "./shell-input";

// 사람 입력과 키다운 가르기(프로세스 스펙 S16). 순수 모듈 하나라 기본 환경(node)에서 돈다.
//
// **재는 것은 「무슨 사건이 왔나」다 — 셸로 나간 바이트의 모양이 아니다.** xterm이 셸로 내보내는
// 데이터는 사람이 친 것과 xterm의 응답(장치 속성 DA · 커서 위치 CPR · 포커스 보고)을 가르지 않는다.
// 그래서 아래 「데이터」 줄에는 사람이 친 키와 **글자까지 같은** 응답을 일부러 넣었다(⇧F3 = CPR).

/** 키다운 하나. 기본은 수식키 없는 `a`다 — 줄마다 다른 칸만 적는다. */
const key = (over: Partial<KeyDown> = {}): KeyDown => ({
  type: "keydown",
  code: "KeyA",
  key: "a",
  keyCode: 65,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});

const keydown = (over: Partial<KeyDown> = {}): InputHappening => ({ kind: "keydown", event: key(over) });

describe("키다운 가르기 — 셸로 보낼 키 · 앱 단축키 · 수정키뿐", () => {
  it.each([
    ["글자", key()],
    ["Enter", key({ code: "Enter", key: "Enter", keyCode: 13 })],
    ["Esc", key({ code: "Escape", key: "Escape", keyCode: 27 })],
    ["Ctrl-C", key({ code: "KeyC", key: "c", keyCode: 67, ctrlKey: true })],
    ["화살표", key({ code: "ArrowUp", key: "ArrowUp", keyCode: 38 })],
    // CPR과 바이트가 같은 키다(`CSI 1;2R`). 키로 오면 사람이 친 것이다.
    ["⇧F3", key({ code: "F3", key: "F3", keyCode: 114, shiftKey: true })],
    // ⌥는 macOS에서 셋째 줄 글자를 낸다(`xterm`의 `_isThirdLevelShift`) — 셸로 간다.
    ["⌥e", key({ code: "KeyE", key: "´", keyCode: 69, altKey: true })],
  ])("%s는 셸로 간다", (_, event) => {
    expect(keyRoute(event)).toEqual({ to: "shell", rewrite: null });
  });

  // 셸에 가되 바이트가 갈리는 키(ux-papercuts 결정 91). 가르는 자리가 한 곳이어야 키 핸들러가 이 답 하나로 돈다.
  it("⇧Enter는 셸로 가되 다른 바이트로 간다", () => {
    expect(keyRoute(key({ code: "Enter", key: "Enter", keyCode: 13, shiftKey: true }))).toEqual({
      to: "shell",
      rewrite: "\x1b\r",
    });
  });

  it.each([
    ["⌘T", key({ code: "KeyT", key: "t", metaKey: true }), "new"],
    ["⌘W", key({ code: "KeyW", key: "w", metaKey: true }), "close"],
    // 본문을 옮기는 키와 팔레트 — 셸이 타이핑하지 않고 위로 흘려보낸다(ux-papercuts 결정 99).
    ["⌘2", key({ code: "Digit2", key: "2", metaKey: true }), "app"],
    ["⌃Tab", key({ code: "Tab", key: "Tab", keyCode: 9, ctrlKey: true }), "app"],
    ["⌘K", key({ code: "KeyK", key: "k", metaKey: true }), "app"],
  ] as const)("%s는 앱 단축키다", (_, event, hotkey) => {
    expect(keyRoute(event)).toEqual({ to: "app", hotkey });
  });

  // 셸 핸들러가 가져가지 않는 ⌘ 화음. xterm은 ⌘가 붙은 글자 키를 셸로 안 보낸다 — 앱(⌘B)이나
  // 메뉴(⌘C · ⌘V)나 xterm 자신(⌘A 전체 선택)이 받는다. 한글 입력기가 켜져 있으면 `key`가 자모로 온다.
  it.each([
    ["⌘B", key({ code: "KeyB", key: "b", metaKey: true })],
    ["⌘C", key({ code: "KeyC", key: "c", metaKey: true })],
    ["⌘A", key({ code: "KeyA", key: "a", metaKey: true })],
    ["한글 입력기의 ⌘C", key({ code: "KeyC", key: "ㅊ", metaKey: true })],
  ])("%s는 앱 몫이다 — 가져가지는 않는다", (_, event) => {
    expect(keyRoute(event)).toEqual({ to: "app", hotkey: null });
  });

  it.each(["Shift", "Control", "Alt", "Meta", "CapsLock"])("%s만 누른 것은 수정키뿐이다", (name) => {
    expect(keyRoute(key({ code: `${name}Left`, key: name, keyCode: 16, shiftKey: name === "Shift" }))).toEqual({
      to: "modifier",
    });
  });

  // 입력기가 문 키(keyCode 229). xterm은 이 키로 아무것도 안 보내고, 글자는 입력기가 확정할 때 간다 —
  // 한글이면 IME 다리가, 조합 사건이 오는 입력기(일본어 · 중국어)면 xterm의 조합 도우미가 보낸다.
  // 셸로 보낼 키와 가르는 것은 중단 추론(Esc · Ctrl-C) 같은 읽기가 조합 중의 키를 셸 키로 읽지 않게 하려는 것이다.
  it("입력기가 문 키는 따로 선다", () => {
    expect(keyRoute(key({ code: "KeyD", key: "ㅇ", keyCode: 229 }))).toEqual({ to: "ime" });
    expect(keyRoute(key({ code: "Escape", key: "Escape", keyCode: 229 }))).toEqual({ to: "ime" });
  });

  // 키 핸들러는 keypress · keyup에도 불린다(xterm의 `_keyPress` · `_keyUp`). 한 번 누른 키를 세 번 세지 않는다.
  it.each(["keyup", "keypress"])("%s는 키다운이 아니다", (type) => {
    expect(keyRoute(key({ type }))).toBeNull();
  });
});

describe("사람 입력 — DOM 사건 → 입력인가", () => {
  it.each([
    ["셸로 보낼 키다운", keydown()],
    ["⇧F3 키다운", keydown({ code: "F3", key: "F3", keyCode: 114, shiftKey: true })],
    ["⇧Enter 키다운", keydown({ code: "Enter", key: "Enter", keyCode: 13, shiftKey: true })],
    ["입력기가 문 키다운", keydown({ code: "KeyG", key: "ㅎ", keyCode: 229 })],
    ["붙여넣기", { kind: "paste" }],
    // WKWebView는 한글에 조합 사건을 안 준다 — 다리가 `input` 사건에서 확정해 보낸다(`terminal-ime.ts`).
    ["IME 다리가 보낸 조합", { kind: "ime", data: "안" }],
  ] as const satisfies ReadonlyArray<readonly [string, InputHappening]>)("%s는 입력이다", (_, happening) => {
    expect(humanInput(happening)).toBe(true);
  });

  it.each([
    ["수정키만 누른 것", keydown({ code: "ShiftLeft", key: "Shift", keyCode: 16, shiftKey: true })],
    ["⌘T", keydown({ code: "KeyT", key: "t", metaKey: true })],
    ["⌘2", keydown({ code: "Digit2", key: "2", metaKey: true })],
    ["⌘B", keydown({ code: "KeyB", key: "b", metaKey: true })],
    ["키업", keydown({ type: "keyup" })],
  ] as const)("%s는 입력이 아니다", (_, happening) => {
    expect(humanInput(happening)).toBe(false);
  });

  // xterm이 셸로 내보내는 데이터. **모양이 사람이 친 것과 같아도** 입력이 아니다 — 사람 입력은 그 앞의
  // DOM 사건이 이미 말했고, 데이터만 오는 것은 xterm이 스스로 답한 것이다. p10k는 프롬프트를 그릴
  // 때마다 커서 위치를 묻는다 — 이것을 세면 모든 셸이 「입력을 받은」 셸이 된다(스토리 29).
  it.each([
    ["장치 속성 응답(DA)", "\x1b[?1;2c"],
    ["커서 위치 응답(CPR)", "\x1b[24;80R"],
    ["⇧F3과 같은 모양의 CPR", "\x1b[1;2R"],
    ["포커스 보고 — 들어옴", "\x1b[I"],
    ["포커스 보고 — 나감", "\x1b[O"],
    ["글자와 같은 모양", "a"],
  ])("xterm이 내보낸 %s는 입력이 아니다", (_, data) => {
    expect(humanInput({ kind: "data", data })).toBe(false);
  });
});

// 중단 키(프로세스 결정 12 · S30) — Esc · Ctrl-C. 셸의 키 핸들러가 이 키를 보면 중단 추론을 건다(`terminal-store.ts`).
// **가르는 기준은 xterm이 셸로 보내는 바이트다** — Esc는 `ESC`, Ctrl-C는 `ETX`(xterm의 `Keyboard.ts`: ⌃ 하나 + keyCode
// 65~90이면 `keyCode - 64`). 그래서 Ctrl-C는 `key`가 아니라 keyCode로 본다: 한글 입력기가 켜져 있으면 `key`가 자모로 오지만
// xterm은 그때도 `ETX`를 보낸다.
describe("중단 키 — Esc · Ctrl-C", () => {
  it.each([
    ["Esc", key({ code: "Escape", key: "Escape", keyCode: 27 })],
    ["Ctrl-C", key({ code: "KeyC", key: "c", keyCode: 67, ctrlKey: true })],
    ["한글 입력기의 Ctrl-C", key({ code: "KeyC", key: "ㅊ", keyCode: 67, ctrlKey: true })],
  ])("%s는 중단 키다", (_, event) => {
    expect(isInterruptKey(event)).toBe(true);
  });

  it.each([
    ["글자 c", key({ code: "KeyC", key: "c", keyCode: 67 })],
    // ⌘C는 복사다 — 셸로 안 간다(위 「앱 몫」).
    ["⌘C", key({ code: "KeyC", key: "c", keyCode: 67, metaKey: true })],
    // ⌃⇧C는 xterm이 `ETX`로 안 보낸다.
    ["⌃⇧C", key({ code: "KeyC", key: "C", keyCode: 67, ctrlKey: true, shiftKey: true })],
    ["Ctrl-D", key({ code: "KeyD", key: "d", keyCode: 68, ctrlKey: true })],
    ["Enter", key({ code: "Enter", key: "Enter", keyCode: 13 })],
    // 한글 조합 중의 Esc는 입력기가 먼저 받는다 — 조합을 거두는 키이지 셸을 끊는 키가 아니다(07이 `ime`로 갈라 둔 까닭).
    ["입력기가 문 Esc", key({ code: "Escape", key: "Escape", keyCode: 229 })],
    ["⌘Esc", key({ code: "Escape", key: "Escape", keyCode: 27, metaKey: true })],
    // 키 핸들러는 keyup에도 불린다 — 한 번 누른 키로 추론을 두 번 걸지 않는다.
    ["키를 뗀 Esc", key({ type: "keyup", code: "Escape", key: "Escape", keyCode: 27 })],
  ])("%s는 중단 키가 아니다", (_, event) => {
    expect(isInterruptKey(event)).toBe(false);
  });
});

// 권한 창의 키(프로세스 결정 13 · P7 (가) — 판 03 선행 시험 「권한 창의 키」, Claude Code 2.1.283 Bash 권한 창 실측). 셸의 키
// 핸들러가 중단 키와 같은 자리에서 이 답을 더 읽고, 승인 추론이 그 키가 창을 어디까지 옮겼나를 접는다(`inferApproval`).
// **여기서 재는 것은 키 하나가 창에서 무엇인가**다 — 그 키가 승인인지는 앞에 누른 키에 달려(↓ 뒤의 Enter) 이 함수가 모른다.
describe("권한 창의 키 — 확정 · 거절 · 고르기", () => {
  it.each([
    // `1`은 Enter 없이 곧바로 첫째 자리를 확정한다(r4 #2) — 권한 창의 첫째는 늘 `Yes`다. 숫자 칸의 키든 숫자 패드든 `key`가 같다.
    ["1", key({ code: "Digit1", key: "1", keyCode: 49 }), "approve"],
    ["숫자 패드 1", key({ code: "Numpad1", key: "1", keyCode: 97 }), "approve"],
    // **그 밖의 숫자는 그 자리를 곧바로 확정하지만, 무엇인지는 창의 선택지에 달렸다**(리뷰 반영). 18의 셋짜리 Bash 창에서는
    // `2`가 승인(r5) · `3`이 거절(r5)이었지만, 허용 규칙 제안이 없는 Bash 창과 WebFetch 창은 「1. Yes · 2. No」 둘이라 `2`가
    // 거절이고, auto 모드 줄이 끼면 `3`이 승인 · `4`가 거절이다(2.1.283 소스).
    ["2", key({ code: "Digit2", key: "2", keyCode: 50 }), "pick"],
    ["3", key({ code: "Digit3", key: "3", keyCode: 51 }), "pick"],
    ["4", key({ code: "Digit4", key: "4", keyCode: 52 }), "pick"],
    ["9", key({ code: "Digit9", key: "9", keyCode: 57 }), "pick"],
    // Esc는 거절이다(r4 #3). 고치기 칸에서는 칸을 닫는다 — 숫자와 뜻이 갈려 따로 든다(칸 안의 숫자는 글자다).
    ["Esc", key({ code: "Escape", key: "Escape", keyCode: 27 }), "cancel"],
    // Enter는 놓인 자리를 확정한다(r6 · r4 #1 · r5).
    ["Enter", key({ code: "Enter", key: "Enter", keyCode: 13 }), "confirm"],
    ["숫자 패드 Enter", key({ code: "NumpadEnter", key: "Enter", keyCode: 13 }), "confirm"],
    // ↑ ↓는 자리만 옮긴다(r4 #1 · r5).
    ["↓", key({ code: "ArrowDown", key: "ArrowDown", keyCode: 40 }), "move"],
    ["↑", key({ code: "ArrowUp", key: "ArrowUp", keyCode: 38 }), "move"],
    // ⌃N · ⌃P도 자리를 옮긴다 — 고치기 칸 안에서도 옮기는 키는 ↑ ↓와 이 둘이다(2.1.283 소스, 리뷰 반영). 한글 입력기가 켜져
    // 있어도 xterm은 keyCode로 보내므로 `key`가 자모여도 같다.
    ["⌃N", key({ code: "KeyN", key: "n", keyCode: 78, ctrlKey: true }), "move"],
    ["⌃P", key({ code: "KeyP", key: "p", keyCode: 80, ctrlKey: true }), "move"],
    ["한글 입력기의 ⌃N", key({ code: "KeyN", key: "ㅜ", keyCode: 78, ctrlKey: true }), "move"],
    // Tab은 놓인 자리를 고치기 칸으로 연다(r6).
    ["Tab", key({ code: "Tab", key: "Tab", keyCode: 9 }), "amend"],
  ] as const)("%s", (_, event, 뜻) => {
    expect(answerKey(event)).toBe(뜻);
  });

  // **그 밖에 셸로 가는 키는 「그 밖」이다.** 창에서 아무 일도 안 한다고 잰 키(글자 · Ctrl-C — r5)도 있지만, 안 잰 키가
  // 자리를 옮길 수 있어(PageDown 같은) 하나로 묶는다 — 창이 그 키를 어떻게 읽는지는 추론이 「모른다」로 받는다.
  it.each([
    ["글자", key()],
    ["Ctrl-C", key({ code: "KeyC", key: "c", keyCode: 67, ctrlKey: true })],
    // ⇧1은 `!`다 — 숫자 지름길이 아니다.
    ["⇧1", key({ code: "Digit1", key: "!", keyCode: 49, shiftKey: true })],
    ["⌃1", key({ code: "Digit1", key: "1", keyCode: 49, ctrlKey: true })],
    ["⌥1", key({ code: "Digit1", key: "¡", keyCode: 49, altKey: true })],
    // `0`은 지름길이 가리키는 자리가 없다.
    ["0", key({ code: "Digit0", key: "0", keyCode: 48 })],
    ["←", key({ code: "ArrowLeft", key: "ArrowLeft", keyCode: 37 })],
    ["⇧Tab", key({ code: "Tab", key: "Tab", keyCode: 9, shiftKey: true })],
    // ⌃⇧N · ⌥N은 ⌃N이 아니다.
    ["⌃⇧N", key({ code: "KeyN", key: "N", keyCode: 78, ctrlKey: true, shiftKey: true })],
    ["⌥N", key({ code: "KeyN", key: "˜", keyCode: 78, altKey: true })],
    // ⇧Enter는 셸에 줄바꿈으로 간다(ux-papercuts 결정 91) — 확정이 아니다.
    ["⇧Enter", key({ code: "Enter", key: "Enter", keyCode: 13, shiftKey: true })],
    ["⌥Enter", key({ code: "Enter", key: "Enter", keyCode: 13, altKey: true })],
    ["⌃Esc", key({ code: "Escape", key: "Escape", keyCode: 27, ctrlKey: true })],
    // 입력기가 문 키 — 무엇이 창에 닿을지 모른다. 조합 중의 Esc(229)도 조합을 거두는 키라 창을 안 닫는다.
    ["입력기가 문 키", key({ code: "KeyA", key: "Process", keyCode: 229 })],
    ["입력기가 문 Esc", key({ code: "Escape", key: "Escape", keyCode: 229 })],
  ])("%s는 그 밖이다", (_, event) => {
    expect(answerKey(event)).toBe("other");
  });

  // 셸로 안 가는 키는 창에 닿지 않는다 — 아무것도 아니다.
  it.each([
    ["⌘1(본문 옮기기)", key({ code: "Digit1", key: "1", keyCode: 49, metaKey: true })],
    ["⌘T", key({ code: "KeyT", key: "t", metaKey: true })],
    ["⌃Tab", key({ code: "Tab", key: "Tab", keyCode: 9, ctrlKey: true })],
    ["⇧만", key({ code: "ShiftLeft", key: "Shift", keyCode: 16, shiftKey: true })],
    // 키 핸들러는 keyup에도 불린다 — 한 번 누른 키를 두 번 접지 않는다.
    ["키를 뗀 1", key({ type: "keyup", code: "Digit1", key: "1", keyCode: 49 })],
  ])("%s는 창에 안 닿는다", (_, event) => {
    expect(answerKey(event)).toBeNull();
  });
});

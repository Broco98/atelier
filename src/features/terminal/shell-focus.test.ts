/// <reference types="node" />
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { deferAttach, focusOnAttach, focusPlaceOf, nextPendingFocus } from "./shell-focus";
import type { AttachKind, FocusPlace, PendingFocus } from "./shell-focus";

// 셸로 가는 길이 포커스를 데려오는 규칙(티켓 16 · 프로세스 결정 18 ② · 프로세스 스펙 S21). 순수 모듈이라 기본
// 환경(node)에서 돈다 — xterm을 부르는 자리는 스토어에 남고, 여기서는 「기다리는 포커스가 어떻게 바뀌나」와
// 「붙는 순간 포커스를 주나」를 값으로 잰다. 화면에서 실제로 포커스가 오는지는 L3(`e2e/shell-focus.spec.ts`)가 본다.

describe("기다리는 포커스", () => {
  it("붙어 있지 않은 셸을 요청하면 그 셸을 기다린다", () => {
    expect(nextPendingFocus(null, { kind: "request", id: 3, attached: false })).toBe(3);
  });

  // 붙어 있으면 스토어가 그 자리에서 포커스를 준다 — 기다릴 것이 없다. 앞 요청도 이 요청에 덮였다.
  it("붙어 있는 셸을 요청하면 그 자리에서 채워 기다리는 것이 없다", () => {
    expect(nextPendingFocus(null, { kind: "request", id: 3, attached: true })).toBeNull();
    expect(nextPendingFocus(5, { kind: "request", id: 3, attached: true })).toBeNull();
  });

  it("새 요청이 앞 요청을 덮는다 — 한 번에 하나다", () => {
    expect(nextPendingFocus(3, { kind: "request", id: 4, attached: false })).toBe(4);
  });

  it("그 셸이 붙으면 한 번 소비한다", () => {
    expect(nextPendingFocus(3, { kind: "attached", id: 3 })).toBeNull();
  });

  // 화면을 옮기는 동안 다른 셸이 잠깐 붙어도 요청은 남는다 — 그 셸이 붙을 때까지.
  it("다른 셸이 붙으면 소비하지 않는다", () => {
    expect(nextPendingFocus(3, { kind: "attached", id: 4 })).toBe(3);
  });

  it("그 셸이 닫히면 버린다", () => {
    expect(nextPendingFocus(3, { kind: "closed", id: 3 })).toBeNull();
    expect(nextPendingFocus(3, { kind: "closed", id: 4 })).toBe(3);
  });

  // 열리지 못한 채 화면에서 떨어진 셸 — 사람이 떠났다. 남겨 두면 다른 셸이 붙을 때마다 포커스를 막는다.
  it("그 셸이 떨어지면 버린다", () => {
    expect(nextPendingFocus(3, { kind: "detached", id: 3 })).toBeNull();
    expect(nextPendingFocus(3, { kind: "detached", id: 4 })).toBe(3);
  });

  it("기다리는 것이 없으면 붙음 · 떨어짐 · 닫힘이 아무것도 안 만든다", () => {
    for (const kind of ["attached", "detached", "closed"] as const) {
      expect(nextPendingFocus(null, { kind, id: 3 })).toBeNull();
    }
  });
});

describe("글꼴을 기다리는 붙음", () => {
  // 셸이 붙었는데 글꼴이 아직이라 못 열었다 — 그 붙음이 줄 포커스를 여는 순간(글꼴이 늦게 온 길)까지 들고 간다.
  // 이것이 없으면 콜드 스타트의 첫 셸은 늘 글꼴 길로 열리고, 그 길은 기다리는 것이 이 셸일 때만 주므로 포커스가
  // 영영 안 온다.
  it("지금 붙었으면 포커스를 줄 자리면 그 셸을 기다린다", () => {
    expect(deferAttach(1, null, "elsewhere")).toBe(1);
    expect(deferAttach(1, null, "shell")).toBe(1);
  });

  it("다른 입력칸에 포커스가 있으면 남기지 않는다", () => {
    expect(deferAttach(1, null, "field")).toBeNull();
  });

  it("다른 셸의 요청을 덮지 않는다", () => {
    expect(deferAttach(1, 2, "elsewhere")).toBe(2);
  });

  // 이미 이 셸을 기다린다(사람이 불렀다) — 입력칸에 있어도 버리지 않는다. 줄지는 여는 순간 그때 자리로 다시 가른다.
  it("그 셸을 기다리고 있으면 그대로 둔다", () => {
    expect(deferAttach(1, 1, "elsewhere")).toBe(1);
    expect(deferAttach(1, 1, "field")).toBe(1);
  });
});

describe("붙는 순간 포커스를 주나", () => {
  type Row = [string, AttachKind, PendingFocus, FocusPlace, boolean];
  // 붙는 셸은 늘 1이다.
  it.each<Row>([
    // 기다리는 것이 없고 셸이 붙음 — 지금처럼 준다. 돌아온 사람은 이어 치려고 온 것이다.
    ["기다리는 것이 없고 붙음", "attach", null, "elsewhere", true],
    ["기다리는 것이 없고 다른 셸에서 옮겨 옴(⌘2)", "attach", null, "shell", true],
    // 사람이 팔레트나 이름 바꾸기 칸에 가 있다 — 요청하지 않은 셸이 빼앗지 않는다.
    ["다른 입력칸에 포커스가 있음", "attach", null, "field", false],
    // 기다리는 포커스가 다른 셸이다 — 화면을 옮기는 사이 잠깐 붙은 셸이 가로채지 않는다.
    ["다른 셸을 기다림", "attach", 2, "elsewhere", false],
    ["다른 셸을 기다림(글꼴 길)", "fontLate", 2, "elsewhere", false],
    ["이 셸을 기다림", "attach", 1, "elsewhere", true],
    // 사람이 이 셸을 부른 **뒤에** 입력칸으로 갔다 — 요청했어도 빼앗지 않는다(입력칸 조건에는 예외가 없다).
    ["이 셸을 기다림 · 입력칸", "attach", 1, "field", false],
    // 글꼴이 늦게 와 여는 길은 기다리는 포커스가 이 셸일 때만 준다 — 요청이든 글꼴을 기다린 붙음이든 같다.
    ["글꼴 길 · 기다리는 것 없음", "fontLate", null, "elsewhere", false],
    ["글꼴 길 · 이 셸을 기다림", "fontLate", 1, "elsewhere", true],
    // 그사이 사람이 입력칸으로 갔으면 빼앗지 않는다.
    ["글꼴 길 · 이 셸을 기다림 · 입력칸", "fontLate", 1, "field", false],
  ])("%s", (_name, kind, pending, place, give) => {
    expect(focusOnAttach({ kind, id: 1 }, pending, place)).toBe(give);
  });
});

describe("지금 포커스 자리", () => {
  const element = (tagName: string, extra: { type?: string; isContentEditable?: boolean; classes?: string[] } = {}) => ({
    tagName,
    type: extra.type,
    isContentEditable: extra.isContentEditable ?? false,
    classList: { contains: (token: string) => (extra.classes ?? []).includes(token) },
  });

  it("xterm의 숨은 입력칸은 셸이다 — 입력칸이 아니다", () => {
    expect(focusPlaceOf(element("TEXTAREA", { classes: ["xterm-helper-textarea"] }))).toBe("shell");
  });

  it.each([
    ["글자 칸", element("INPUT")],
    ["검색 칸", element("INPUT", { type: "search" })],
    ["글 상자", element("TEXTAREA")],
    ["고르는 칸", element("SELECT")],
    ["편집되는 요소", element("DIV", { isContentEditable: true })],
  ])("%s은 다른 입력칸이다", (_name, one) => {
    expect(focusPlaceOf(one)).toBe("field");
  });

  it.each([
    ["없음", null],
    ["본문", element("BODY")],
    ["버튼", element("BUTTON")],
    ["체크 상자", element("INPUT", { type: "checkbox" })],
    ["프레임", element("IFRAME")],
  ])("%s은 입력칸이 아니다", (_name, one) => {
    expect(focusPlaceOf(one)).toBe("elsewhere");
  });
});

// 배선은 소스로도 못박는다(`shell-registry.test.ts`의 「판정 셋이 실제로 배선돼 있다」와 같은 까닭). 이름이 있는지가 아니라
// **표현식을 통째로** 본다. 스토어를 그대로 돌려 붙음 · 요청 · 닫힘의 순서를 재는 것은 `terminal-store.test.ts`의 「셸로 가는
// 길의 포커스」다 — 줄 하나가 **다른 자리에** 남아 있으면 소스 핀은 초록이다(열다 터진 셸의 닫힘 줄이 그랬다).
describe("포커스를 주는 자리가 배선돼 있다", () => {
  const store = readFileSync(fileURLToPath(new URL("./terminal-store.ts", import.meta.url)), "utf8");
  const countOf = (text: string, literal: string) => text.split(literal).length - 1;
  /** 그 함수의 몸통 — 머리부터 다음 최상위 닫는 괄호까지. 한 줄이 **그 함수 안에** 있는지 본다. */
  const bodyOf = (text: string, head: string) => {
    const start = text.indexOf(head);
    expect(start, `${head}가 스토어에 없다`).toBeGreaterThan(-1);
    return text.slice(start, text.indexOf("\n}\n", start));
  };

  // 둘뿐이다: 붙는 순간의 한 줄(판정을 지난다)과 요청한 셸이 이미 붙어 있을 때의 한 줄.
  it("xterm에 포커스를 주는 자리가 둘이고, 붙는 순간의 줄은 판정 뒤에 선다", () => {
    expect(countOf(store, ".term.focus()")).toBe(2);
    expect(store).toContain("if (give) instance.term.focus();");
    expect(store).toContain("const give = focusOnAttach({ kind, id: instance.id }, pendingFocus, focusPlaceNow());");
  });

  it("요청 · 붙음 · 떨어짐 · 닫힘이 기다리는 포커스를 고친다", () => {
    // 붙지 않은 셸의 요청을 적는 줄(코드 리뷰 스펙 6) — 빠지면 사이에 붙는 셸이 포커스를 가로챈다.
    expect(bodyOf(store, "export function focusShell(")).toContain(
      'pendingFocus = nextPendingFocus(pendingFocus, { kind: "request", id, attached });',
    );
    expect(bodyOf(store, "function openOrReattach(")).toContain(
      'pendingFocus = nextPendingFocus(pendingFocus, { kind: "attached", id: instance.id });',
    );
    expect(bodyOf(store, "export function detachShell(")).toContain(
      'pendingFocus = nextPendingFocus(pendingFocus, { kind: "detached", id });',
    );
    // 닫힘은 **두 자리**다 — 닫기의 유일한 정리 길과 열다 터진 셸. 한 자리에서 빠져도 다른 자리가 같은 글자를 들어, 파일 전체에서
    // 찾으면 초록이었다(구현 기록 16의 남은 것).
    const closed = 'pendingFocus = nextPendingFocus(pendingFocus, { kind: "closed", id: instance.id });';
    expect(bodyOf(store, "function disposeInstance(")).toContain(closed);
    expect(bodyOf(store, "function failOpen(")).toContain(closed);
  });

  it("여는 두 자리가 사건의 종류를 말한다", () => {
    expect(store).toContain('openOrReattach(instance, "attach");');
    expect(store).toContain('openOrReattach(instance, "fontLate");');
  });
});

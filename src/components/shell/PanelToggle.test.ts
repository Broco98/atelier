import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { togglesPanel } from "./PanelToggle";

// ⌘Enter가 패널 토글 몫인가 — 작업 화면(작업 패널)과 Archive(spec 목록 패널)가 같은 판정을 지난다(codex-ds 결정 32).
// in-app-terminal-v2 결정 43으로 ⌘Enter는 **탭이 아니라 포커스로** 갈린다.
//
// 판단을 순수 함수로 꺼내 둔 덕에 **이건 소스 훑기가 아니라 진짜로 도는 검사다.**
// (`shellHotkey`와 같은 방식이다.) 화면에 그 판정이 배선돼 있는지는 각 화면 쪽이 본다 — 작업 화면은
// `WorksPage.test.tsx`의 「듣는 자리가 탭을 안 본다」, Archive는 `e2e/archive-docs.spec.ts`의 ⌘Enter.
describe("⌘Enter가 패널 토글 몫인가", () => {
  // 노드 환경에는 DOM 생성자가 없다. `instanceof`가 보는 것은 그 자리의 전역이므로
  // 세워 두면 그대로 갈린다. 셸의 입력 자리가 숨은 <textarea>라는 것이 이 검사의 전제다.
  class FakeTextArea extends EventTarget {}
  class FakeInput extends EventTarget {}
  class FakeEditable extends EventTarget {
    isContentEditable = true;
  }

  beforeEach(() => {
    vi.stubGlobal("HTMLTextAreaElement", FakeTextArea);
    vi.stubGlobal("HTMLInputElement", FakeInput);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  type Hotkey = Parameters<typeof togglesPanel>[0];
  // 트리·패널의 평범한 요소 — 입력도 편집 가능도 아니다
  const key = (over: Partial<Hotkey> = {}): Hotkey => ({
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    code: "Enter",
    target: new EventTarget(),
    ...over,
  });

  it("포커스가 트리·패널에 있으면 패널 몫이다", () => {
    expect(togglesPanel(key())).toBe(true);
  });

  it("숫자 패드 Enter(맥북의 fn+Return)도 같은 키다", () => {
    // `code`만 `NumpadEnter`로 갈리고 `key`는 같은 Enter다 — 한때 이 판정이 `key`를 볼 때도 받았다.
    expect(togglesPanel(key({ code: "NumpadEnter" }))).toBe(true);
  });

  it("셸(xterm의 숨은 <textarea>)에 포커스가 있으면 셸 몫이다", () => {
    // in-app-terminal 결정 29 그대로다. 작업 화면의 탭 가드를 지워도 이 경우는 안 바뀐다는 것이 결정 43의 전제고,
    // 그 전제가 깨지면 터미널에서 ⌘Enter를 칠 때마다 패널이 여닫힌다.
    expect(togglesPanel(key({ target: new FakeTextArea() }))).toBe(false);
  });

  it("입력·편집 가능 요소도 그대로 비켜간다", () => {
    // Archive의 찾기 칸이 이 갈래다 — 거기서 친 ⌘Enter는 spec 목록 패널을 여닫지 않는다.
    expect(togglesPanel(key({ target: new FakeInput() }))).toBe(false);
    expect(togglesPanel(key({ target: new FakeEditable() }))).toBe(false);
  });

  it("수식키가 하나라도 더 붙거나 다른 키면 아니다", () => {
    for (const extra of ["ctrlKey", "altKey", "shiftKey"] as const) {
      expect(togglesPanel(key({ [extra]: true })), extra).toBe(false);
    }
    expect(togglesPanel(key({ metaKey: false }))).toBe(false);
    expect(togglesPanel(key({ code: "KeyT" }))).toBe(false);
  });
});

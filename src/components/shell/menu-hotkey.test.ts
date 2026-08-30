import { describe, expect, it } from "vitest";
import { framePreemptsHotkeys, keyOfCode, menuHotkeyInit } from "./menu-hotkey";

// #153 — 프레임이 삼킨 단축키를 네이티브 메뉴가 대신 받아 창에 되돌린다.
//
// **여기서 세는 것은 순수 함수 셋이다.** 배선(`listen` → `dispatchEvent`)은 AppShell에 있고
// 진짜 메뉴가 있어야 도는 것이라 이 층이 못 본다. 대신 **되돌린 이벤트가 지금 리스너들이
// 읽는 모양인지**는 여기서 완전히 갈린다.

describe("code에서 key를 되찾는다", () => {
  // **둘 다 실어야 하는 이유가 이 표다.** 리스너가 보는 값이 갈려 있다 — ⌘B·⌘T·⌘1~9는
  // `code`를, ⌘↩은 `key`를 본다. 한쪽만 채우면 그 절반이 조용히 안 먹는다.
  it.each([
    ["Digit1", "1"],
    ["Digit9", "9"],
    ["KeyB", "b"],
    ["KeyT", "t"],
    ["Enter", "Enter"],
  ])("%s → %s", (code, key) => {
    expect(keyOfCode(code)).toBe(key);
  });
});

describe("프레임이 쥐고 있을 때만 흘린다", () => {
  // 앱 포커스일 때는 웹뷰가 그 키를 이미 받았다. 여기서 또 흘리면 한 번 눌러 두 번 돈다.
  it.each([
    ["iframe", "IFRAME", true],
    ["본문 버튼", "BUTTON", false],
    ["입력칸", "INPUT", false],
    ["body", "BODY", false],
  ])("%s에 포커스가 있으면 %s", (_name, tagName, expected) => {
    expect(framePreemptsHotkeys({ tagName } as Element)).toBe(expected);
  });

  // 포커스가 아무 데도 없는 순간이 있다 — 그때 터지면 안 된다.
  it("activeElement가 없어도 안 터진다", () => {
    expect(framePreemptsHotkeys(null)).toBe(false);
  });
});

describe("되돌린 keydown이 리스너가 읽는 모양이다", () => {
  // **수식키가 ⌘ 하나여야 한다.** 리스너들이 전부 `!e.shiftKey && !e.altKey && !e.ctrlKey`를
  // 함께 보므로, 하나라도 켜져 나가면 그 자리에서 통째로 안 먹는다.
  it("⌘만 켜고 나머지 수식키는 끈다", () => {
    expect(menuHotkeyInit("KeyB")).toMatchObject({
      metaKey: true,
      shiftKey: false,
      altKey: false,
      ctrlKey: false,
    });
  });

  it("code와 key를 함께 싣는다", () => {
    expect(menuHotkeyInit("Digit3")).toMatchObject({ code: "Digit3", key: "3" });
  });

  // 리스너들은 `window`에 붙어 있고 더러는 `preventDefault`를 부른다 — 둘 다 서야 한다.
  it("버블링하고 취소할 수 있다", () => {
    expect(menuHotkeyInit("Enter")).toMatchObject({ bubbles: true, cancelable: true });
  });
});

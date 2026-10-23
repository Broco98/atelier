import { describe, expect, it } from "vitest";
import { HOTKEYS, pressed, type HotkeyId } from "@/lib/hotkeys";
import { keyOfCode, menuHotkeyInit } from "./menu-hotkey";

// #153 — 프레임이 삼킨 단축키를 네이티브 메뉴가 대신 받아 창에 되돌린다.
//
// **여기서 세는 것은 순수 함수 셋이다.** 배선(`listen` → `dispatchEvent`)은 AppShell에 있고
// 진짜 메뉴가 있어야 도는 것이라 이 층이 못 본다. 대신 **되돌린 이벤트가 지금 리스너들이
// 읽는 모양인지**는 여기서 완전히 갈린다.

describe("code에서 key를 되찾는다", () => {
  // 앱의 판정은 모두 `code`를 보지만(단축키 표의 `pressed`), 되돌린 키는 진짜 키와 같은 모양이어야 한다 — `key`를 보는 리스너가
  // 서는 날 한쪽만 채운 되돌림은 그 자리에서 조용히 안 먹는다(한때 ⌘↩이 그랬다).
  it.each([
    ["Digit1", "1"],
    ["Digit9", "9"],
    ["KeyB", "b"],
    ["KeyT", "t"],
    ["KeyJ", "j"],
    ["Enter", "Enter"],
  ])("%s → %s", (code, key) => {
    expect(keyOfCode(code)).toBe(key);
  });
});

describe("되돌린 keydown이 리스너가 읽는 모양이다", () => {
  // **수식키가 표의 그 항목의 것이어야 한다.** 판정은 수식키 넷이 꼭 맞을 때만 그 키라(`pressed`), 하나라도 어긋나 나가면 그 자리에서
  // 통째로 안 먹는다. 지금 메뉴 바 항목은 다 ⌘ 하나다.
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

  // **표의 메뉴 바 항목마다** 되돌린 키가 그 항목의 판정을 지난다 — 메뉴 바와 판정이 같은 표를 읽는다는 것이 이것이다.
  const menuIds = (Object.keys(HOTKEYS) as HotkeyId[]).filter((id) => HOTKEYS[id].menu !== null);
  it("메뉴 바 항목이 있다", () => {
    expect(menuIds.length).toBeGreaterThan(0);
  });
  it.each(menuIds)("%s — 되돌린 keydown이 그 항목이다", (id) => {
    const init = menuHotkeyInit(HOTKEYS[id].code);
    if (init === null) throw new Error(`${id}를 못 되돌린다`);
    const { code = "", ctrlKey = false, altKey = false, shiftKey = false, metaKey = false } = init;
    expect(pressed({ code, ctrlKey, altKey, shiftKey, metaKey }, id)).toBe(true);
  });

  // 메뉴 바에 서지 않는 키(⌘W · F2 …)는 메뉴가 쏘지 않는다 — 그 code가 와도 흘릴 것이 없다.
  it.each(["KeyW", "F2", "Tab"])("메뉴 바 항목이 아닌 %s는 되돌리지 않는다", (code) => {
    expect(menuHotkeyInit(code)).toBeNull();
  });
});

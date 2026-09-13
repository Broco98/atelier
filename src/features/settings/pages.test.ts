import { describe, expect, it } from "vitest";
import { SETTINGS_PAGES, inSettings, settingsPageOf } from "./pages";

// 설정 항목 셋(UI개선 결정 21·22). 사이드바의 켜진 항목과 본문 머리가 **이 표 하나**에서
// 나온다 — 주소를 읽어 항목을 고르는 자리가 둘이면 켜진 항목과 머리가 갈린다.
describe("설정 항목", () => {
  it("터미널 · 알림 · 에이전트 훅 순서이고 라벨이 한국어다", () => {
    expect(SETTINGS_PAGES.map((page) => page.label)).toEqual(["터미널", "알림", "에이전트 훅"]);
    expect(SETTINGS_PAGES.map((page) => page.to)).toEqual([
      "/settings/terminal",
      "/settings/notifications",
      "/settings/hooks",
    ]);
  });

  it.each([
    ["/settings/terminal", "terminal"],
    ["/settings/notifications", "notifications"],
    ["/settings/hooks", "hooks"],
  ] as const)("%s는 %s 항목이다", (pathname, key) => {
    expect(settingsPageOf(pathname)).toBe(key);
  });

  // 치환 전의 `/settings`는 항목이 아니다 — 거기서 첫 항목을 켜 두면 치환이 풀린 날에도
  // 사이드바가 멀쩡해 보여 그 회귀가 안 보인다.
  it.each(["/settings", "/settings/", "/settings/일반", "/settingsx/terminal", "/terminal", "/"])(
    "%s는 항목이 아니다",
    (pathname) => {
      expect(settingsPageOf(pathname)).toBeNull();
    },
  );

  // 가드가 묻는 것은 「설정 안인가」다 — 치환 전의 `/settings`도 안이다.
  it.each([
    ["/settings", true],
    ["/settings/hooks", true],
    ["/settingsx", false],
    ["/terminal", false],
  ] as const)("%s는 설정 안인가: %s", (pathname, inside) => {
    expect(inSettings(pathname)).toBe(inside);
  });
});

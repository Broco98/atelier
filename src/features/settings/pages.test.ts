import { describe, expect, it } from "vitest";
import { SETTINGS_ITEMS, inSettings, settingsItemOf } from "./pages";

// 설정 nav 항목 넷(UI개선 결정 21·22 · spec 레이아웃 티켓 08). 사이드바의 켜진 항목과 본문 머리가
// **이 표 하나**에서 나온다 — 주소를 읽어 항목을 고르는 자리가 둘이면 켜진 항목과 머리가 갈린다.
describe("설정 항목", () => {
  // `spec 레이아웃`은 **맨 뒤**다 — `/settings`는 첫 항목으로 넘기므로, 앞에 서면 설정을 여는
  // 기존 시나리오가 모두 다른 페이지에 선다.
  it("터미널 · 알림 · 에이전트 훅 · spec 레이아웃 순서이고 라벨이 한국어다", () => {
    expect(SETTINGS_ITEMS.map((item) => item.label)).toEqual([
      "터미널",
      "알림",
      "에이전트 훅",
      "spec 레이아웃",
    ]);
    expect(SETTINGS_ITEMS.map((item) => item.to)).toEqual([
      "/settings/terminal",
      "/settings/notifications",
      "/settings/hooks",
      "/settings/spec-layout",
    ]);
  });

  it.each([
    ["/settings/terminal", "terminal"],
    ["/settings/notifications", "notifications"],
    ["/settings/hooks", "hooks"],
    ["/settings/spec-layout", "spec-layout"],
  ] as const)("%s는 %s 항목이다", (pathname, key) => {
    expect(settingsItemOf(pathname)).toBe(key);
  });

  // **항목 아래의 하위 주소도 그 항목이다**(spec 레이아웃 티켓 11) — 편집기는 설정 한 열 밖의 별도
  // 화면이지만 설정 nav는 「spec 레이아웃」을 켠 채로 두고, 머리의 위치도 그 항목에서 이어진다.
  it.each([
    ["/settings/spec-layout/atelier", "spec-layout"],
    ["/settings/spec-layout/maison", "spec-layout"],
  ] as const)("하위 주소 %s는 %s 항목이다", (pathname, key) => {
    expect(settingsItemOf(pathname)).toBe(key);
  });

  // 치환 전의 `/settings`는 항목이 아니다 — 거기서 첫 항목을 켜 두면 치환이 풀린 날에도
  // 사이드바가 멀쩡해 보여 그 회귀가 안 보인다.
  it.each([
    "/settings",
    "/settings/",
    "/settings/일반",
    "/settingsx/terminal",
    "/settings/spec-layoutx/atelier",
    "/terminal",
    "/",
  ])(
    "%s는 항목이 아니다",
    (pathname) => {
      expect(settingsItemOf(pathname)).toBeNull();
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

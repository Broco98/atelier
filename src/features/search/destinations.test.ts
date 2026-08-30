import { describe, expect, it } from "vitest";
import { navItems } from "@/components/shell/nav-items";
import { destinationLabel, destinationTo, destinations } from "./destinations";

// **한 배열이 두 물음에 답하고 있었다.** 「사이드바 nav 줄에 서는가」와 「팔레트가 갈 수
// 있는가」는 다른 물음인데 `navItems` 하나가 둘 다 답했고, 설정에서 그 답이 실제로 갈린다 —
// 결정 51이 설정을 그 배열 안에서 기각하고 사이드바 **바닥에 고정**된 자리를 줬지만, 갈 수
// 있는 화면인 것은 그대로다.
//
// 여기서 세우는 것이 그 갈림이다. **양쪽을 함께 못 박아야 뜻이 있다**: 「목적지에 있다」만
// 세우면 다음 사람이 `navItems`에 한 줄 넣어 초록을 만들 수 있고(그 순간 결정 51이 죽는다),
// 「nav에 없다」만 세우면 설정이 목적지에서 통째로 빠져도 초록이다.
//
// **실제로 그 화면에 가는가**는 여기 없다 — `hit-target.test.ts`가 주소를 들고, 셋을 이어
// 「치면 뜨고 Enter로 간다」를 잰 층은 L3다(`e2e/search-palette.spec.ts`).
describe("설정은 nav 줄에 없고 팔레트에는 있다", () => {
  it("nav 줄은 설정을 모른다 — 결정 51", () => {
    expect(navItems.map((item) => item.key)).not.toContain("settings");
  });

  // 순서까지 못 박는다. 코어는 건넨 순서로 「가는 곳」 줄을 세우므로(`search.rs`의
  // `destination_hits`), 이 순서가 곧 팔레트에 서는 순서다 — 설정이 맨 뒤인 것은 사이드바
  // 바닥에 있는 그 자리 그대로다.
  it("목적지는 nav 줄 **뒤에** 설정 한 줄을 얹은 것이다", () => {
    expect(destinations).toEqual([
      ...navItems.map(({ key, label }) => ({ key, label })),
      { key: "settings", label: "Settings" },
    ]);
  });

  // 코어에 건네는 재료가 라벨이라(결정 21) **이 말이 곧 맞추는 재료다** — `Set`을 치면 이
  // 줄이 서는 이유가 여기 있다. 라우트는 그 줄을 골랐을 때 갈 곳이고, `navItems`만 훑던
  // 시절에는 이 값이 `null`이라 목록에는 뜨는데 Enter가 아무 일도 안 했다.
  it("설정의 라벨과 주소가 풀린다", () => {
    expect(destinationLabel("settings")).toBe("Settings");
    expect(destinationTo("settings")).toBe("/settings");
  });
});

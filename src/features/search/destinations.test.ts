import { describe, expect, it } from "vitest";
import { ALL_MODES, navItemsOf } from "@/mode";
import { destinationLabel, destinationTo, destinationsFor } from "./destinations";

// **한 배열이 두 물음에 답하고 있었다.** 「사이드바 nav 줄에 서는가」와 「팔레트가 갈 수
// 있는가」는 다른 물음인데 `navItems` 하나가 둘 다 답했고, 설정에서 그 답이 실제로 갈린다 —
// 결정 51이 설정을 그 배열 안에서 기각하고 사이드바 **바닥에 고정**된 자리를 줬지만, 갈 수
// 있는 화면인 것은 그대로다.
//
// 여기서 세우는 것이 그 갈림이고, **이제 세계까지 함께 갈린다**: 같은 물음의 답이 Atelier와
// Maison에서 다르다. 그래서 두 검사 다 `it.each(ALL_MODES)`다 — 한쪽만 세우면 팔레트가 모드를
// 통째로 무시해도 그 모드에서는 초록이다.
//
// **실제로 그 화면에 가는가**는 여기 없다 — `hit-target.test.ts`가 주소를 들고, 셋을 이어
// 「치면 뜨고 Enter로 간다」를 잰 층은 L3다(`e2e/search-palette.spec.ts`).
describe("설정은 nav 줄에 없고 팔레트에는 있다", () => {
  it.each(ALL_MODES)("%s의 nav 줄은 설정을 모른다 — 결정 51", (mode) => {
    expect(navItemsOf(mode).map((item) => item.key)).not.toContain("settings");
  });

  // 순서까지 못 박는다. 코어는 건넨 순서로 「가는 곳」 줄을 세우므로(`search.rs`의
  // `destination_hits`), 이 순서가 곧 팔레트에 서는 순서다 — 설정이 맨 뒤인 것은 사이드바
  // 바닥에 있는 그 자리 그대로다.
  //
  // **양쪽을 함께 못 박아야 뜻이 있다**: 「목적지에 있다」만 세우면 다음 사람이 `navItems`에
  // 한 줄 넣어 초록을 만들 수 있고(그 순간 결정 51이 죽는다), 「nav에 없다」만 세우면 설정이
  // 목적지에서 통째로 빠져도 초록이다.
  it.each(ALL_MODES)("%s에서 코어에 묻는 것은 nav 뒤에 설정 한 줄이다", (mode) => {
    expect(destinationsFor(mode)).toEqual([
      ...navItemsOf(mode).map(({ key, label }) => ({ key, label })),
      { key: "settings", label: "Settings" },
    ]);
  });

  // 코어에 건네는 재료가 라벨이라(결정 21) **이 말이 곧 맞추는 재료다** — `Set`을 치면 이
  // 줄이 서는 이유가 여기 있다. 라우트는 그 줄을 골랐을 때 갈 곳이고, `navItems`만 훑던
  // 시절에는 이 값이 `null`이라 목록에는 뜨는데 Enter가 아무 일도 안 했다.
  //
  // 설정은 **세계 밖이라 두 모드에서 같은 값이다**(공용 `settings.json` — 결정 20).
  it.each(ALL_MODES)("%s에서 설정의 라벨과 주소가 풀린다", (mode) => {
    expect(destinationLabel(mode, "settings")).toBe("Settings");
    expect(destinationTo(mode, "settings")).toBe("/settings");
  });
});

describe("목적지는 그 세계의 것뿐이다", () => {
  // 결정 17. **Maison에 프로젝트는 없다** — 그 세계에서 `Projects`가 목록에 서면 뜨는데 갈
  // 곳이 없는 줄이 되고, 갈 곳을 지어내면 ⌘K 한 번에 세계를 떠난다. 양쪽을 함께 못 박는다:
  // 「Maison에 없다」만 세우면 목적지 표가 통째로 비어도 초록이다.
  it("Projects는 Atelier에만 있다", () => {
    expect(destinationsFor("maison").map(({ key }) => key)).not.toContain("projects");
    expect(destinationTo("maison", "projects")).toBeNull();
    expect(destinationsFor("atelier").map(({ key }) => key)).toContain("projects");
    expect(destinationTo("atelier", "projects")).toBe("/projects");
  });

  // **key가 같아도 가는 곳이 다르다.** 세계를 안 보는 표 하나로 되돌리는 변형이 여기서
  // 빨개진다 — 그 변형은 목록을 안 바꾸므로 위 검사들만으로는 안 잡힌다.
  it("Terminal·Archive는 세계마다 다른 곳으로 간다", () => {
    expect(destinationTo("atelier", "terminal")).toBe("/terminal");
    expect(destinationTo("atelier", "archive")).toBe("/archive");
    expect(destinationTo("maison", "terminal")).toBe("/maison/terminal");
    expect(destinationTo("maison", "archive")).toBe("/maison/archive");
  });

  // 코어는 여기서 건넨 key만 돌려주므로(결정 21) 모르는 key는 계약이 깨진 것이다.
  // **말도 갈 곳도 지어내지 않는다** — 지어낸 말은 그럴듯해서 어디가 어긋났는지 안 보인다.
  it.each(ALL_MODES)("%s에서 모르는 key는 지어내지 않는다", (mode) => {
    expect(destinationLabel(mode, "없는목적지")).toBe("없는목적지");
    expect(destinationTo(mode, "없는목적지")).toBeNull();
  });
});

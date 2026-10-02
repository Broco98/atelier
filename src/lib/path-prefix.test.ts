import { describe, expect, it } from "vitest";
import { isAtOrUnder, workSlugOf } from "./path-prefix";

describe("isAtOrUnder", () => {
  it("그 자리와 그 아래는 안이다", () => {
    expect(isAtOrUnder("/settings", "/settings")).toBe(true);
    expect(isAtOrUnder("/settings/hooks", "/settings")).toBe(true);
  });

  // **경계가 이 함수의 전부다.** 이름이 같은 앞머리로 시작하는 이웃 주소는 밖이다.
  it("앞머리만 같은 이웃 주소는 밖이다", () => {
    expect(isAtOrUnder("/settingsx", "/settings")).toBe(false);
    expect(isAtOrUnder("/worksx", "/works")).toBe(false);
  });
});

describe("workSlugOf — 주소에서 slug를 읽는다", () => {
  // 한글은 디코드돼야 한다 — 읽는 자리가 여럿이다(사이드바 강조 · 떠남 · 셸로 가는 길 · 설정에서 돌아갈 씨앗).
  it("항목 주소를 읽는다", () => {
    expect(workSlugOf("/works/spec-search")).toBe("spec-search");
    expect(workSlugOf(`/works/${encodeURIComponent("생활 모드")}`)).toBe("생활 모드");
  });

  // 목록 주소는 **아직 아무것도 안 고른 상태**다(정규화가 붙는 자리). 빈 문자열을 돌려주면
  // 부르는 쪽이 「고른 것이 있다」로 읽어 없는 항목을 찾는다.
  it.each(["/works", "/works/"])("목록 주소 %s에는 고른 것이 없다", (pathname) => {
    expect(workSlugOf(pathname)).toBeNull();
  });

  // 「목록 주소만 본다」 — 앞머리를 목록과 무관하게 잡으면 아카이브 항목이 작업으로 읽힌다.
  it.each(["/terminal", "/archive/shipped", "/"])("%s는 항목 주소가 아니다", (pathname) => {
    expect(workSlugOf(pathname)).toBeNull();
  });

  // slug는 경로의 **한 칸**이다. 뒤가 더 붙은 주소는 그 항목의 하위 화면이지 다른 slug가 아니다.
  it("첫 칸만 slug다", () => {
    expect(workSlugOf("/works/finance/spec")).toBe("finance");
  });
});

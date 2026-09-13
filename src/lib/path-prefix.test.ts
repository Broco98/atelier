import { describe, expect, it } from "vitest";
import { isAtOrUnder } from "./path-prefix";

describe("isAtOrUnder", () => {
  it("그 자리와 그 아래는 안이다", () => {
    expect(isAtOrUnder("/settings", "/settings")).toBe(true);
    expect(isAtOrUnder("/settings/hooks", "/settings")).toBe(true);
  });

  // **경계가 이 함수의 전부다.** 이름이 같은 앞머리로 시작하는 이웃 주소는 밖이다.
  it("앞머리만 같은 이웃 주소는 밖이다", () => {
    expect(isAtOrUnder("/settingsx", "/settings")).toBe(false);
    expect(isAtOrUnder("/maisonette", "/maison")).toBe(false);
  });
});

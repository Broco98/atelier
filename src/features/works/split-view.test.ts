import { describe, expect, it } from "vitest";
import { DRAG_THRESHOLD, dropSplit, farEnough, specHeadLabel } from "./split-view";

// 분할 뷰의 순수 판정. 화면 seam(정적 마크업)에서는 **이것들이 안 보인다** — 포인터도
// 이펙트도 돌지 않아, 떨군 자리가 어느 쪽을 spec으로 만드는지가 마크업에 드러나지 않는다.

describe("떨군 절반이 정하는 좌우", () => {
  // 규칙 하나: 떨군 것이 그 절반에 선다(결정 87).
  it("spec을 왼쪽에 떨구면 spec이 왼쪽이다", () => {
    expect(dropSplit("spec", "left")).toBe("lr");
  });

  it("spec을 오른쪽에 떨구면 spec이 오른쪽이다", () => {
    expect(dropSplit("spec", "right")).toBe("rl");
  });

  // 셸은 터미널 열이므로 spec이 **반대쪽**으로 밀린다. 이 뒤집힘이 없으면 셸을 왼쪽에
  // 떨궈도 터미널이 오른쪽에 서서, 「떨군 자리에 선다」가 종류에 따라 갈린다.
  it("셸을 왼쪽에 떨구면 spec이 오른쪽이다", () => {
    expect(dropSplit("shell", "left")).toBe("rl");
  });

  it("셸을 오른쪽에 떨구면 spec이 왼쪽이다", () => {
    expect(dropSplit("shell", "right")).toBe("lr");
  });

  // 「이미 있는 종류를 떨구면 좌우가 맞바뀐다」(결정 87)는 따로 적은 규칙이 아니라 위
  // 넷에서 나온다 — spec이 왼쪽인 상태에서 spec을 오른쪽에 떨구면 `rl`이 되고, 그것이
  // 곧 맞바뀜이다.
  it("맞바뀜이 같은 규칙에서 나온다", () => {
    expect(dropSplit("spec", "right")).not.toBe(dropSplit("spec", "left"));
  });
});

describe("드래그 임계값", () => {
  // 안 두면 그냥 클릭이 드래그로 읽혀 사이드바 행을 못 누른다(결정 86).
  it("작은 흔들림은 클릭이다", () => {
    expect(farEnough(0, 0)).toBe(false);
    expect(farEnough(4, 0)).toBe(false);
    expect(farEnough(0, -4)).toBe(false);
    expect(farEnough(3, 3)).toBe(false);
  });

  // **축 하나가 아니라 거리다** — 대각선으로 4px씩 움직인 것은 5.66px이라 드래그다.
  it("거리로 잰다", () => {
    expect(farEnough(DRAG_THRESHOLD, 0)).toBe(true);
    expect(farEnough(-DRAG_THRESHOLD, 0)).toBe(true);
    expect(farEnough(0, DRAG_THRESHOLD)).toBe(true);
    expect(farEnough(4, 4)).toBe(true);
  });
});

describe("열 머리의 문서 이름", () => {
  // basename만 쓰면 판마다 `spec.md`라 열 머리가 늘 같은 글자가 된다(결정 104).
  it("판 폴더와 파일명을 함께 쓴다", () => {
    expect(specHeadLabel("05-분할-뷰/spec.md")).toBe("05-분할-뷰 / spec.md");
  });

  it("폴더가 없으면 이름 하나다", () => {
    expect(specHeadLabel("overview.md")).toBe("overview.md");
  });

  // 더 깊어도 **두 조각**이다 — 열 머리는 한 줄이라 전체 경로가 들어갈 자리가 없다.
  it("깊어도 두 조각이다", () => {
    expect(specHeadLabel("a/b/c/d.md")).toBe("c / d.md");
  });

  it("문서가 없으면 빈 글자다", () => {
    expect(specHeadLabel(null)).toBe("");
  });
});

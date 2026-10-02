import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { foldingInnerClass, PANEL_MOTION } from "./panel-layout";

// 접히는 패널의 바깥 폭 트랜지션 길이와 안쪽 열 `max-width`의 지연이 **같은 수**인가(`panel-layout.ts`).
// 두 수가 네 리터럴로 두 파일에 흩어져 있던 때는 서로를 가리키는 주석만이 그 같음을 들었다.
describe("접히는 패널의 박자", () => {
  it("안쪽 열의 max-width 지연이 바깥 폭 트랜지션 길이와 같다", () => {
    const outer = /duration-\[(\d+)ms\]/.exec(PANEL_MOTION);
    const inner = /delay-\[0s,(\d+)ms\]/.exec(foldingInnerClass(true));
    // 못 읽으면 실패한다 — 모양이 바뀌어 둘 다 못 읽는 날 「같다」로 통과하지 않게.
    if (!outer || !inner) throw new Error(`박자를 못 읽었다: ${PANEL_MOTION} / ${foldingInnerClass(true)}`);
    expect(inner[1]).toBe(outer[1]);
    // 펴진 뒤의 상한은 바깥 폭 그대로이고, 접히는 동안에는 걷힌다.
    expect(foldingInnerClass(true).split(" ")).toContain("max-w-full");
    expect(foldingInnerClass(false)).not.toContain("max-w-full");
  });

  // 작업 패널의 접히는 상자는 공용 틀의 패널 칸이 든다(ui-refresh 결정 27) — 목록 칸과 함께 `Frame.tsx`에 산다.
  // 공용 틀의 여백(바탕 줄 · 카드 줄)과 분할 열도 패널과 함께 움직여 같은 박자를 읽는다.
  it("사이드바와 공용 틀의 칸(목록 · 작업 패널)이 이 규격을 쓴다 — 제 리터럴로 박자를 다시 적지 않는다", () => {
    for (const path of ["src/components/shell/Sidebar.tsx", "src/components/shell/Frame.tsx"]) {
      const source = readFileSync(path, "utf8");
      expect(source, path).toContain("foldingInnerClass(open");
      expect(source, path).toContain("PANEL_MOTION");
      expect(source, path).not.toMatch(/delay-\[0s,\d+ms\]/);
      // 긴 클래스 문자열 **안**에 묻힌 사본도 잡는다 — 따옴표로 감싼 그 문자열만 보던 때 두 사본이 지나갔다.
      expect(source, path).not.toMatch(/duration-\[220ms\]/);
    }
    const split = readFileSync("src/features/works/WorksPage.tsx", "utf8");
    expect(split).toContain("PANEL_MOTION");
    expect(split).not.toMatch(/duration-\[220ms\]/);
  });
});

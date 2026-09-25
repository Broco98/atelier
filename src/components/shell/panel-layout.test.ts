import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { foldingInnerClass, PANEL_MOTION } from "./panel-layout";

// 접히는 패널의 바깥 폭 트랜지션 길이와 안쪽 열 `max-width`의 지연이 **같은 수**인가(`panel-layout.ts`).
// 두 수가 네 리터럴로 두 파일에 흩어져 있던 때는 서로를 가리키는 주석만이 그 같음을 들었다.
describe("접히는 패널의 박자", () => {
  it("안쪽 열의 max-width 지연이 바깥 폭 트랜지션 길이와 같다", () => {
    const outer = /duration-\[(\d+)ms\]/.exec(PANEL_MOTION);
    const inner = /delay-\[0s,(\d+)ms\]/.exec(foldingInnerClass(true, "max-w-full"));
    // 못 읽으면 실패한다 — 모양이 바뀌어 둘 다 못 읽는 날 「같다」로 통과하지 않게.
    if (!outer || !inner) throw new Error(`박자를 못 읽었다: ${PANEL_MOTION} / ${foldingInnerClass(true, "")}`);
    expect(inner[1]).toBe(outer[1]);
    // 상한은 부르는 쪽 것이 그대로 붙는다.
    expect(foldingInnerClass(true, "max-w-full").split(" ")).toContain("max-w-full");
    expect(foldingInnerClass(false, "max-w-full")).not.toContain("max-w-full");
  });

  it("사이드바와 작업 패널이 둘 다 이 규격을 쓴다 — 제 리터럴로 박자를 다시 적지 않는다", () => {
    for (const path of ["src/components/shell/Sidebar.tsx", "src/features/works/WorkPanel.tsx"]) {
      const source = readFileSync(path, "utf8");
      expect(source, path).toContain("foldingInnerClass(open");
      expect(source, path).toContain("PANEL_MOTION");
      expect(source, path).not.toMatch(/delay-\[0s,\d+ms\]/);
      expect(source, path).not.toMatch(/"duration-\[220ms\] ease-panel"/);
    }
  });
});

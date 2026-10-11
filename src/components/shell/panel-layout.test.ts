import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cssBlocks } from "@/css-tokens";
import { foldingInnerClass, PANEL_MOTION } from "./panel-layout";

// 접히는 패널의 바깥 폭 트랜지션 길이와 안쪽 열 `max-width`의 지연이 **같은 값**인가(`panel-layout.ts`).
// 두 수가 네 리터럴로 두 파일에 흩어져 있던 때는 서로를 가리키는 주석만이 그 같음을 들었다. 이제 둘 다 Atelier 토큰
// `--duration-panel`을 읽고(codex-ds 결정 27), 그 값은 `index.css` 한 곳에 있다.
describe("접히는 패널의 박자", () => {
  it("패널 여닫기가 duration-panel(220ms) · ease-panel이다", () => {
    expect(PANEL_MOTION.split(" ")).toEqual(["duration-panel", "ease-panel"]);
    // 토큰의 값 — 스펙이 지키는 불변조건이다(패널 여닫기 220ms). 블록을 못 찾으면 `undefined`라 실패한다.
    const css = readFileSync("src/index.css", "utf8");
    const declared = cssBlocks(css).find((block) => block.decls.has("--duration-panel"))?.decls.get("--duration-panel");
    expect(declared).toBe("220ms");
  });

  it("안쪽 열의 max-width 지연이 바깥 폭 트랜지션 길이와 같은 토큰이다", () => {
    // 지연 = 바깥 길이 · 길이 0 — 두 자리 모두 `--duration-panel`을 읽어야 같다(`foldingInnerClass` 주석).
    const inner = foldingInnerClass(true).split(" ");
    expect(inner).toContain("delay-[0s,var(--duration-panel)]");
    expect(inner).toContain("duration-[var(--duration-panel),0s]");
    // 펴진 뒤의 상한은 바깥 폭 그대로이고, 접히는 동안에는 걷힌다.
    expect(inner).toContain("max-w-full");
    expect(foldingInnerClass(false)).not.toContain("max-w-full");
  });

  // 작업 패널의 접히는 상자는 공용 틀의 패널 칸이 든다(ui-refresh 결정 27) — 목록 칸과 함께 `Frame.tsx`에 산다.
  // 공용 틀의 여백(머리 줄 · 카드 줄)과 분할 열(한때 `WorksPage.tsx`가 그렸다 — 이제 공용 틀의 `split`)도 패널과 함께 움직여
  // 같은 박자를 읽는다.
  it("사이드바와 공용 틀의 칸(목록 · 작업 패널 · 분할)이 이 규격을 쓴다", () => {
    for (const path of ["src/components/shell/Sidebar.tsx", "src/components/shell/Frame.tsx"]) {
      const source = readFileSync(path, "utf8");
      expect(source, path).toContain("foldingInnerClass(open");
      expect(source, path).toContain("PANEL_MOTION");
    }
  });

  // 패널과 함께 움직이는 자리 넷 — 사이드바 · 공용 틀(목록 · 작업 패널 · 분할 · 머리 줄 여백), 전체화면에 들고 날 때 옮겨 가는
  // 셸 컨트롤 줄, 분할의 되돌림을 끝내는 타이머. 박자를 제 리터럴로 다시 적지 않는다 — 셸 컨트롤의 `duration-[220ms]`가 한때
  // 이 검사 밖이라 지나갔다.
  it("패널과 함께 움직이는 자리가 박자를 제 리터럴로 다시 적지 않는다", () => {
    for (const path of [
      "src/components/shell/Sidebar.tsx",
      "src/components/shell/Frame.tsx",
      "src/components/shell/ShellControls.tsx",
      "src/components/shell/useSplitRatio.tsx",
    ]) {
      const source = readFileSync(path, "utf8");
      // 긴 클래스 문자열 **안**에 묻힌 사본도 잡는다 — 따옴표로 감싼 그 문자열만 보던 때 두 사본이 지나갔다. 타이머의 수(`= 220`)도 같다.
      expect(source, path).not.toMatch(/\b220(?:ms)?\b/);
      expect(source, path).not.toMatch(/delay-\[0s,\d+m?s\]/);
    }
    expect(readFileSync("src/components/shell/ShellControls.tsx", "utf8")).toContain("PANEL_MOTION");
    expect(readFileSync("src/components/shell/useSplitRatio.tsx", "utf8")).toContain("panelMotionMs()");
  });
});

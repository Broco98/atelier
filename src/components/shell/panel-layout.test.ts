import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cssBlocks } from "@/css-tokens";
import { foldingInnerClass, PANEL_MOTION, SIDEBAR_MOTION } from "./panel-layout";

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

  // 작업 패널의 접히는 상자는 공용 틀의 패널 칸이 든다(ui-refresh 결정 27) — `Frame.tsx`에 산다.
  // 공용 틀의 여백(머리 줄 · 카드 줄)과 분할 열(한때 `WorksPage.tsx`가 그렸다 — 이제 공용 틀의 `split`)도 패널과 함께 움직여
  // 같은 박자를 읽는다. 사이드바는 접는 장치(안쪽 고정 폭 · 펴진 뒤의 상한)는 같고 박자만 제 것이다(아래 「사이드바 열고 닫기」).
  it("사이드바와 공용 틀의 칸(목록 · 작업 패널 · 분할)이 이 규격을 쓴다", () => {
    const frame = readFileSync("src/components/shell/Frame.tsx", "utf8");
    expect(frame).toContain("foldingInnerClass(open)");
    expect(frame).toContain("PANEL_MOTION");
    const sidebar = readFileSync("src/components/shell/Sidebar.tsx", "utf8");
    expect(sidebar).toContain('foldingInnerClass(open, "sidebar")');
    expect(sidebar).toContain("SIDEBAR_MOTION");
    expect(sidebar).not.toContain("PANEL_MOTION");
  });

  // 패널과 함께 움직이는 자리 넷 — 사이드바 · 공용 틀(목록 · 작업 패널 · 분할 · 머리 줄 여백), 사이드바 끝을 따르고 전체화면에 들고
  // 날 때 옮겨 가는 머리 줄의 왼쪽 칸(셸 컨트롤 · 이름 자리의 시작 — `ShellHead`), 분할의 되돌림을 끝내는 타이머. 박자를 제 리터럴로
  // 다시 적지 않는다 — 셸 컨트롤의 `duration-[220ms]`가 한때 이 검사 밖이라 지나갔다.
  it("패널과 함께 움직이는 자리가 박자를 제 리터럴로 다시 적지 않는다", () => {
    for (const path of [
      "src/components/shell/Sidebar.tsx",
      "src/components/shell/Frame.tsx",
      "src/components/shell/ShellHead.tsx",
      "src/components/shell/useSplitRatio.tsx",
    ]) {
      const source = readFileSync(path, "utf8");
      // 긴 클래스 문자열 **안**에 묻힌 사본도 잡는다 — 따옴표로 감싼 그 문자열만 보던 때 두 사본이 지나갔다. 타이머의 수(`= 220`)도 같다.
      expect(source, path).not.toMatch(/\b220(?:ms)?\b/);
      expect(source, path).not.toMatch(/delay-\[0s,\d+m?s\]/);
    }
    expect(readFileSync("src/components/shell/ShellHead.tsx", "utf8")).toContain("SIDEBAR_MOTION");
    expect(readFileSync("src/components/shell/useSplitRatio.tsx", "utf8")).toContain("panelMotionMs()");
  });
});

// **사이드바 열고 닫기는 Codex spring이다**(02 구현 스펙 §12 · 스토리 100 · Diff-Tokens 「사이드바 열고 닫기」 · Motion 보드). spring
// {duration .3, bounce .1}을 CSS `linear()`로 옮긴 곡선(`ease-spring` — Motion 보드 `--cx-spring`)과 .3s(`duration-sidebar`)다. 오른쪽 · 아래
// 패널의 spring은 이번 판 밖이라 작업 패널은 `PANEL_MOTION` 그대로다. 내용은 그대로 둔 채(안쪽 열 고정 폭) 잘리며 옅어진다 — 안쪽 열의
// 옅음이 같은 박자로 움직이고, 펴진 뒤의 상한은 그 길이만큼 늦는다. 동작 줄이기면 곧바로 바뀐다(Codex 「reduced motion — duration 0」).
describe("사이드바 열고 닫기", () => {
  it("박자가 duration-sidebar(.3s) · ease-spring이고 동작 줄이기면 곧바로다", () => {
    expect(SIDEBAR_MOTION.split(" ")).toEqual(["duration-sidebar", "ease-spring", "motion-reduce:transition-none"]);
    const css = readFileSync("src/index.css", "utf8");
    const declared = (name: string) => cssBlocks(css).find((block) => block.decls.has(name))?.decls.get(name);
    expect(declared("--duration-sidebar")).toBe("300ms");
    expect(declared("--ease-spring")).toMatch(/^linear\(0, /);
  });

  it("안쪽 열이 같은 박자로 옅어지고, 펴진 뒤의 상한은 그 길이만큼 늦는다", () => {
    const open = foldingInnerClass(true, "sidebar").split(" ");
    expect(open).toEqual(expect.arrayContaining(["opacity-100", "max-w-full", "transition-[opacity,max-width]", "ease-spring"]));
    expect(open).toContain("delay-[0s,var(--duration-sidebar)]");
    expect(open).toContain("duration-[var(--duration-sidebar),0s]");
    expect(open).toContain("motion-reduce:transition-none");
    const closed = foldingInnerClass(false, "sidebar").split(" ");
    expect(closed).toEqual(expect.arrayContaining(["opacity-0", "transition-opacity", "duration-sidebar", "ease-spring"]));
    expect(closed).toContain("motion-reduce:transition-none");
    expect(closed).not.toContain("max-w-full");
  });
});

// 접는 장치는 하나이고 박자만 둘이다(02 코드 리뷰 냄새 — 한때 사이드바 갈래가 패널 갈래를 토큰만 바꿔 다시 적었다). 박자 표 하나로 짓는 지금도
// 네 갈래가 내는 클래스가 그대로인지 **글자 그대로** 잰다 — 클래스 하나가 빠지거나 더해지면 접고 펴는 움직임이 조용히 바뀐다. 빈 칸이 끼면
// 위 검사들의 `split(" ")`이 빈 글자를 센다.
describe("접는 장치 하나, 박자 둘", () => {
  const classes = (open: boolean, beat?: "panel" | "sidebar") => foldingInnerClass(open, beat).split(" ").sort();
  it("패널 — 펴면 지연된 상한 · 접으면 기본 전환으로 걷힌다", () => {
    expect(classes(true)).toEqual(
      ["max-w-full", "transition-[opacity,max-width]", "opacity-100", "delay-[0s,var(--duration-panel)]", "duration-[var(--duration-panel),0s]"].sort(),
    );
    expect(classes(false)).toEqual(["max-w-[100vw]", "opacity-0", "transition-opacity", "duration-basic"].sort());
  });
  it("사이드바 — 같은 장치에 spring 박자, 동작 줄이기면 곧바로다", () => {
    expect(classes(true, "sidebar")).toEqual(
      [
        "max-w-full",
        "transition-[opacity,max-width]",
        "opacity-100",
        "delay-[0s,var(--duration-sidebar)]",
        "duration-[var(--duration-sidebar),0s]",
        "ease-spring",
        "motion-reduce:transition-none",
      ].sort(),
    );
    expect(classes(false, "sidebar")).toEqual(
      ["max-w-[100vw]", "opacity-0", "transition-opacity", "duration-sidebar", "ease-spring", "motion-reduce:transition-none"].sort(),
    );
  });
});

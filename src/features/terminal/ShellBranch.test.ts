/// <reference types="node" />
// 소스 스캔이라 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

// 사이드바 가지가 지는 **배선**을 본다. 클릭은 이 seam에서 못 건다(이 저장소의 컴포넌트
// 검사는 정적 마크업이다). 배선의 **짝**을 소스에서 보되, 붙어 있는 줄을 리터럴로 집는다 —
// 정규식으로 블록을 잘라내는 판정은 다른 곳에서 출발해 남의 코드를 읽고도 초록이었다
// (판 02·03 리뷰가 잡은 것). 리터럴은 파서가 샐 자리가 없다.
const read = (file: string) =>
  readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), "utf8");
const countOf = (text: string, literal: string) => text.split(literal).length - 1;

describe("사이드바 가지의 배선", () => {
  const branch = read("ShellBranch.tsx");

  it("행을 누르면 그 셸이 켜지고 본문이 그 셸로 간다", () => {
    // 결정 50·101. 한쪽만 남으면 화면에 아무 일도 안 일어나거나(본문이 안 바뀐다)
    // 엉뚱한 칸이 켜진다. 남의 work의 행이면 `go`가 그 work로 함께 옮겨 간다.
    expect(branch).toContain("          selectShell(id);\n          go();");
  });

  it("`+ 새 셸`도 같은 짝이다", () => {
    // 결정 101의 마지막 줄 — 안 고른 work의 가지에서 열면 그 work로 가서 열린다.
    expect(branch).toContain("          openNewShell(origin);\n          go();");
  });

  it("본문으로 옮기는 자리가 하나다", () => {
    // `tab=terminal`을 짓는 자리가 둘이 되면 한쪽만 늙는다 — 그 순간 어떤 행은 본문을
    // 옮기고 어떤 행은 안 옮긴다.
    expect(countOf(branch, 'tab: "terminal" as const')).toBe(1);
  });
});

describe("사이드바 목록은 터미널을 모른다", () => {
  // 이 계약이 깨지면 `@xterm/*`와 그 CSS가 SidebarWorkList로 따라 들어와 그 파일의 정적
  // 마크업 검사(SidebarWorkList.test.tsx)가 통째로 서지 못한다. 개수도 가지의 속도
  // 위(Sidebar)에서 슬롯으로 내려오는 이유가 그것이다.
  it("SidebarWorkList가 terminal feature를 import하지 않는다", () => {
    const list = read("../works/SidebarWorkList.tsx");
    expect(countOf(list, "@/features/terminal")).toBe(0);
    expect(countOf(list, "./terminal-store")).toBe(0);
  });

  // 결정 78. ⌘1~9가 **한 화면 안에서 본문을 옮기는** 키가 됐다. 사이드바가 계속 듣고
  // 있으면 한 번 눌러 둘이 일어나고, 본문을 옮기려던 사람이 다른 work으로 끌려간다.
  // 지운 자리라 「없다」를 세는 것 말고 볼 방법이 없다.
  it("사이드바 목록이 window에서 키를 듣지 않는다", () => {
    const list = read("../works/SidebarWorkList.tsx");
    expect(countOf(list, 'window.addEventListener("keydown"')).toBe(0);
  });
});

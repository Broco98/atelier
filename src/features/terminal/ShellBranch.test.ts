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

  // **본문으로 옮기는 길이 둘로 갈려 있다** — 그리고 갈려 있어야 한다.
  //
  // 결정 15. 이 라우터는 `search`에 **객체**를 주면 기존 search를 통째로 버린다 — 문서를
  // 읽다 이 work의 셸 행을 누르면 `file`이 조용히 떨어지고, `spec` 잎으로 돌아왔을 때
  // 읽던 문서가 아니라 기본 문서가 열린다. 남의 work으로 가는 길은 반대로 **비워야**
  // 한다(그 문서 경로는 새 work에 없다). 둘을 하나로 합치면 어느 쪽이든 한 사고가 난다.
  it("같은 work 안에서는 보던 문서를 지킨다", () => {
    expect(branch).toContain('? (prev) => tabSearch(prev, "terminal")');
  });

  // 결정 97. 기억은 **work을 옮길 때 새 주소를 짓는 씨앗**이고, 남의 work의 셸 행을
  // 누르는 것이 그 옮김 중 하나다(결정 101). 여기서 씨앗을 안 쓰면 분할로 두고 떠난
  // work이 **이 길로 돌아올 때만** 단일로 서서, 화면으로는 「가끔 그런다」로만 보인다.
  it("남의 work으로 갈 때 그 work의 분할 기억을 지고 간다", () => {
    expect(branch).toContain(
      ': viewSearch({}, { tab: "terminal", split: recallView(owner).split }),',
    );
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

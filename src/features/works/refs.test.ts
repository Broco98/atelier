import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { archiveRef, layoutDirRef, specDirRef, specRef, workDirRef, worktreeDirRef } from "./refs";

// 참조는 **앱 밖으로 나가는 값**이다 — 클립보드를 거쳐 에이전트가 그 경로를 실제로 연다.
// 그래서 아래 기대값은 `refs.ts`의 뿌리 상수를 다시 부르지 않고 **완성된 글자를 그대로 적는다.**
// 그 상수에서 뽑아 조립하면 이 파일은 구현을 베껴 적은 꼴이 되어, 앞머리가 통째로 뒤바뀌어도
// 초록으로 남는다.

/** 앱이 내는 참조의 뿌리 둘. 아래 기대값과 맨 아래 소스 검사가 함께 읽는다. */
const WORK_ROOT = "~/.atelier/works/";
const ARCHIVE_ROOT = "~/.atelier/archive/";

describe("참조 생성기", () => {
  it("작업·spec 폴더는 `~/.atelier/works/` 아래다", () => {
    expect(workDirRef("spec-search")).toBe(`${WORK_ROOT}spec-search/`);
    expect(specDirRef("spec-search")).toBe(`${WORK_ROOT}spec-search/spec/`);
  });

  it("spec 참조는 줄범위를 꼬리로 단다", () => {
    expect(specRef("spec-search", "overview.md")).toBe(`${WORK_ROOT}spec-search/spec/overview.md`);
    expect(specRef("spec-search", "overview.md", 19, 27)).toBe(
      `${WORK_ROOT}spec-search/spec/overview.md:L19-27`,
    );
    expect(specRef("spec-search", "overview.md", 19)).toBe(
      `${WORK_ROOT}spec-search/spec/overview.md:L19`,
    );
  });

  it("아카이브 참조는 `~/.atelier/archive/` 아래다", () => {
    expect(archiveRef("shipped-work", "record.md")).toBe(`${ARCHIVE_ROOT}shipped-work/record.md`);
    expect(archiveRef("shipped-work", "spec/overview.md", 19, 27)).toBe(
      `${ARCHIVE_ROOT}shipped-work/spec/overview.md:L19-27`,
    );
  });

  it("참조가 `~/.atelier/`로 시작한다", () => {
    expect(workDirRef("s")).toMatch(/^~\/\.atelier\//);
    expect(archiveRef("s", "record.md")).toMatch(/^~\/\.atelier\//);
  });

  // 워크트리는 코어가 완성해 내려준 경로다 — 앞머리를 여기서 다시 지으면
  // `ATELIER_HOME`을 옮긴 설치에서 앱이 지은 경로와 실물이 갈린다.
  it("워크트리 참조는 받은 경로에 `/`만 보장한다", () => {
    expect(worktreeDirRef("~/.atelier/works/w/trees/atelier")).toBe(
      "~/.atelier/works/w/trees/atelier/",
    );
    expect(worktreeDirRef("~/.atelier/works/w/trees/atelier/")).toBe(
      "~/.atelier/works/w/trees/atelier/",
    );
  });
});

// 레이아웃 참조(spec 레이아웃 결정 23)는 설정의 [부탁]이 복사하는 한 줄이다. 워크트리처럼 **코어가 준
// 경로**(상태의 `folder`)로 짓는다 — 여기서 뿌리를 다시 지으면 `ATELIER_HOME`을 옮긴 설치에서 붙인
// 참조가 실물과 갈린다. 그 참조가 에이전트가 배우는 모양과 같은지는 Rust 쪽
// (`the_layout_reference_the_settings_page_copies_is_the_one_the_tools_teach`)이 엔진 안에서 잰다.
describe("레이아웃 참조", () => {
  it("받은 폴더 경로에 `/`만 보장한다", () => {
    expect(layoutDirRef("~/.atelier/layouts/atelier")).toBe("~/.atelier/layouts/atelier/");
    expect(layoutDirRef("~/.atelier/layouts/atelier/")).toBe("~/.atelier/layouts/atelier/");
  });

  it("홈 밖의 데이터 루트도 받은 그대로다", () => {
    expect(layoutDirRef("/tmp/atelier-home/layouts/atelier")).toBe(
      "/tmp/atelier-home/layouts/atelier/",
    );
  });
});

// **뿌리는 이 파일의 상수 하나씩이다.** MCP 지침의 뿌리 검사(`instructions.rs`)는 `refs.ts`에서 그 상수 선언을 글자로
// 찾는다 — 생성기가 뿌리를 글자로 따로 들면 상수는 죽은 값이 되고, 앱이 내보내는 참조와 지침이 갈린 채 L0~L3가
// 전부 초록이다: 누군가 생성기 하나에 새 뿌리를 인라인으로 적은 뒤 위 기대 문자열만 고치면 Rust 검사는 옛 값을
// 상수에서 찾아 통과한다. 그래서 뿌리 글자가 파일에 **한 번씩만** 서는지 센다(쓰지 않는 상수는 L0가 문다).
//
// **fail-closed다**: 파일이 옮겨지면 readFileSync가 던진다. 「못 찾았으니 깨끗하다」로
// 떨어지는 길이 없어야 검사다(SpecViewer.test.tsx의 같은 관용구).
describe("뿌리는 이 파일의 상수 하나씩이다", () => {
  const src = readFileSync(fileURLToPath(new URL("./refs.ts", import.meta.url)), "utf8");
  const countOf = (literal: string) => src.split(literal).length - 1;

  it("뿌리 글자가 상수 선언에만 선다", () => {
    expect(countOf(WORK_ROOT), "work 뿌리").toBe(1);
    expect(countOf(ARCHIVE_ROOT), "archive 뿌리").toBe(1);
  });

  // 레이아웃 뿌리는 여기 없다 — 코어가 준 경로를 받는다(위 「레이아웃 참조」). 여기 글자로 서면
  // 그 경로를 안 읽고 지은 것이다.
  it("레이아웃 뿌리가 글자로 없다", () => {
    expect(src).not.toContain("layouts/");
  });
});

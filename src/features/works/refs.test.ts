import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { archiveRef, specDirRef, specRef, workDirRef, worktreeDirRef } from "./refs";
import { ALL_MODES, refPrefixesOf } from "@/mode";

// 참조는 **앱 밖으로 나가는 값**이다 — 클립보드를 거쳐 에이전트가 그 경로를 실제로 연다.
// 그래서 아래 기대값은 `refPrefixesOf`를 다시 부르지 않고 **완성된 글자를 그대로 적는다.**
// 표에서 뽑아 조립하면 이 파일은 구현을 베껴 적은 꼴이 되어, 앞머리가 통째로 뒤바뀌어도
// 초록으로 남는다(`mode.test.ts`가 표 자체의 값을 따로 재는 것과 층이 다르다).
//
// **맨 아래 소스 검사만 예외다** — 거기서는 표를 부르는 것이 기대값을 짓기 위해서가 아니라
// 「그 값이 `refs.ts`에 글자로 없다」를 세계 수와 무관하게 재기 위해서다.

describe("참조 생성기 — Atelier", () => {
  it("작업·spec 폴더는 `~/.atelier/works/` 아래다", () => {
    expect(workDirRef("atelier", "spec-search")).toBe("~/.atelier/works/spec-search/");
    expect(specDirRef("atelier", "spec-search")).toBe("~/.atelier/works/spec-search/spec/");
  });

  it("spec 참조는 줄범위를 꼬리로 단다", () => {
    expect(specRef("atelier", "spec-search", "overview.md")).toBe(
      "~/.atelier/works/spec-search/spec/overview.md",
    );
    expect(specRef("atelier", "spec-search", "overview.md", 19, 27)).toBe(
      "~/.atelier/works/spec-search/spec/overview.md:L19-27",
    );
    expect(specRef("atelier", "spec-search", "overview.md", 19)).toBe(
      "~/.atelier/works/spec-search/spec/overview.md:L19",
    );
  });

  it("아카이브 참조는 `~/.atelier/archive/` 아래다", () => {
    expect(archiveRef("atelier", "shipped-work", "record.md")).toBe(
      "~/.atelier/archive/shipped-work/record.md",
    );
    expect(archiveRef("atelier", "shipped-work", "spec/overview.md", 19, 27)).toBe(
      "~/.atelier/archive/shipped-work/spec/overview.md:L19-27",
    );
  });
});

describe("참조 생성기 — Maison", () => {
  // Maison의 참조가 Atelier 루트를 가리키면 에이전트는 **있지도 않은 폴더**를 열거나, 더
  // 나쁘게는 같은 slug를 가진 저쪽 세계의 문서를 연다(결정 10: 이름은 세계마다 따로 산다).
  it("Room 폴더는 `~/.atelier/maison/rooms/` 아래다", () => {
    expect(workDirRef("maison", "kitchen")).toBe("~/.atelier/maison/rooms/kitchen/");
    expect(specDirRef("maison", "kitchen")).toBe("~/.atelier/maison/rooms/kitchen/spec/");
  });

  it("spec 참조는 같은 꼬리표를 Room 루트 위에 단다", () => {
    expect(specRef("maison", "kitchen", "overview.md")).toBe(
      "~/.atelier/maison/rooms/kitchen/spec/overview.md",
    );
    expect(specRef("maison", "kitchen", "overview.md", 19, 27)).toBe(
      "~/.atelier/maison/rooms/kitchen/spec/overview.md:L19-27",
    );
  });

  it("아카이브 참조는 `~/.atelier/maison/archive/` 아래다", () => {
    expect(archiveRef("maison", "kitchen", "record.md")).toBe(
      "~/.atelier/maison/archive/kitchen/record.md",
    );
    expect(archiveRef("maison", "kitchen", "spec/overview.md", 19)).toBe(
      "~/.atelier/maison/archive/kitchen/spec/overview.md:L19",
    );
  });
});

describe("참조 생성기 — 세계 사이", () => {
  // 「모드를 받는다」만으로는 부족하다. 인자를 받아 놓고 안 쓰면(또는 한 자리만 갈아 끼우면)
  // 두 세계가 같은 글자를 내는데, 화면에서는 복사된 한 줄이 그럴듯해 아무도 못 알아본다.
  it("같은 slug라도 두 세계의 참조가 절대 같지 않다", () => {
    expect(workDirRef("atelier", "같은-이름")).not.toBe(workDirRef("maison", "같은-이름"));
    expect(specRef("atelier", "같은-이름", "overview.md")).not.toBe(
      specRef("maison", "같은-이름", "overview.md"),
    );
    expect(archiveRef("atelier", "같은-이름", "record.md")).not.toBe(
      archiveRef("maison", "같은-이름", "record.md"),
    );
  });

  // 모드가 하나 더 서는 날 이 셋이 함께 갱신돼야 한다 — 새 세계가 Atelier 루트를 물려받아도
  // 위 두 describe는 그 세계를 아예 안 보므로 조용히 통과한다.
  it("모든 세계의 참조가 `~/.atelier/`로 시작한다", () => {
    for (const mode of ALL_MODES) {
      expect(workDirRef(mode, "s")).toMatch(/^~\/\.atelier\//);
      expect(archiveRef(mode, "s", "record.md")).toMatch(/^~\/\.atelier\//);
    }
  });

  // 워크트리는 코어가 완성해 내려준 경로다 — 세계별 앞머리를 여기서 다시 지으면
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

// **뿌리가 표에서 온다는 것 자체를 잰다.** #186 전까지 MCP 지침의 뿌리 검사
// (`instructions.rs`)는 참조를 **실제로 내보내는 이 파일**을 읽었는데, 뿌리가 `mode.ts`로
// 모이면서 그쪽이 표만 읽게 됐다 — 이 파일이 그 표를 읽는다는 사실은 이제 파일 머리
// 주석만 말한다. `refPrefixesOf`의 프로덕션 소비자가 여기 하나뿐이라, 그 연결이 끊기면
// 표는 죽은 값이 되고 앱이 내보내는 참조와 지침이 갈린 채 L0~L3가 전부 초록이다:
// 누군가 뿌리를 여기 인라인으로 되돌린 뒤 Atelier 뿌리를 옮기면 위 기대 문자열만 고치면
// 되고, `mode.test.ts`는 표 값만 보고, Rust 검사는 옛 값을 표에서 찾아 통과한다.
//
// **fail-closed다**: 파일이 옮겨지면 readFileSync가 던진다. 「못 찾았으니 깨끗하다」로
// 떨어지는 길이 없어야 검사다(SpecViewer.test.tsx의 같은 관용구).
describe("뿌리는 이 파일에 없다", () => {
  const src = readFileSync(fileURLToPath(new URL("./refs.ts", import.meta.url)), "utf8");

  it("네 생성기의 앞머리가 모드 표에서 온다", () => {
    // 뿌리는 둘이고 둘 다 표에서 꺼낸다 — 한쪽만 표를 보면 그 세계의 아카이브 참조만
    // 조용히 낡는다.
    expect(src).toMatch(/refPrefixesOf\(mode\)\.work/);
    expect(src).toMatch(/refPrefixesOf\(mode\)\.archive/);
  });

  it("표가 드는 뿌리가 글자로 하나도 없다", () => {
    // 세계가 하나 더 서는 날 이 검사가 함께 넓어진다 — 리터럴 넷을 손으로 적어 두면
    // 셋째 세계는 조용히 빠진다.
    for (const mode of ALL_MODES) {
      const refs = refPrefixesOf(mode);
      expect(src, `${mode} work 뿌리`).not.toContain(refs.work);
      expect(src, `${mode} archive 뿌리`).not.toContain(refs.archive);
    }
  });
});

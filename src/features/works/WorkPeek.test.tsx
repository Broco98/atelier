import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ProjectView } from "@/features/projects/types";
import { projectLines, WorkPeek } from "./WorkPeek";
import type { WorkView } from "./types";
import { specDocs, workFixture } from "./work-fixture";

// 사이드바 행의 hover 카드. **화면에서는 hover로만 마운트돼서** 목록을 그려서는 닿을 수
// 없다 — 조각을 직접 그리는 이 자리가 카드의 칸들을 재는 그물이다. 카드가 열릴 때 프로젝트
// 목록을 읽어 프로젝트 줄이 서는 흐름은 L3(`works-sidebar`)가 마우스를 올려 잰다.
//
// 프로바이더를 안 세운다: 이 조각이 스스로 조회하면 여기서 바로 터진다(WorkPanel.test.tsx와
// 같은 계약).

const work: WorkView = workFixture({
  // **값이 실려 있는 채로 잰다.** 값이 비면 칸을 통째로 지워도 초록이다.
  branch: "feat/some-work",
  projects: ["atelier", "notes"],
  worktrees: [
    { project: "atelier", path: "~/.atelier/works/some-work/trees/atelier", exists: true, dirty: true },
    { project: "notes", path: "~/.atelier/works/some-work/trees/notes", exists: true, dirty: false },
  ],
  ...specDocs(["overview.md", "01-계획/plan.md"]),
});

// 셸의 말 칸(결정 14)은 이 파일이 재는 것과 무관하다 — 칸이 서는지는 L3가 잰다. 프로젝트 줄은
// 아직 안 읽은 판(`null`)이 기본이다.
const card = (counts: { threads?: number; shells?: number } = {}) =>
  renderToStaticMarkup(
    <WorkPeek work={work} note={null} projects={null} threads={counts.threads ?? 0} shells={counts.shells ?? 0} />,
  );
/** 태그를 걷은 보이는 글. */
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

const project = (slug: string, baseBranch: string): ProjectView => ({
  slug,
  name: slug,
  path: `~/dev/${slug}`,
  baseBranch,
  createdAt: "2026-01-02T03:04:05Z",
  description: "",
  git: null,
  missing: false,
});

describe("hover 카드", () => {
  it("브랜치·프로젝트·spec 셋이 선다", () => {
    const markup = card();
    expect(markup).toContain("브랜치");
    expect(markup).toContain("feat/some-work");
    expect(markup).toContain("프로젝트");
    expect(markup).toContain("atelier, notes");
    expect(markup).toContain("spec");
  });

  // 프로젝트 줄의 그리기 규칙 둘(codex-ds 결정 25 · DS `HoverCard`). L3의 픽스처는 두 줄 모두 base가 있고 이름 칸을 안 재서,
  // 이 둘은 여기서만 잡힌다.
  it("「프로젝트」 이름은 첫 줄에만 서고, base가 없는 줄에는 화살표가 없다", () => {
    const markup = renderToStaticMarkup(
      <WorkPeek
        work={work}
        note={null}
        threads={0}
        shells={0}
        projects={[
          { project: "atelier", base: "develop", dirty: true },
          { project: "notes", base: null, dirty: false },
        ]}
      />,
    );
    // 줄이 둘 다 섰다 — 이것이 없으면 아래 「한 번」이 줄이 하나라서 초록일 수 있다.
    expect(markup).toContain('data-project-line="atelier"');
    expect(markup).toContain('data-project-line="notes"');
    expect(markup.split("프로젝트").length - 1).toBe(1);
    expect(markup.split("←").length - 1).toBe(1);
    expect(markup).toContain("← develop");
  });
});

// **사이드바 줄을 떠난 수가 카드에 선다**(02 구현 스펙 S9 · 티켓 05) — Work 줄 오른쪽 끝은 상태 표시 하나의 자리라, 그 Work에 이은 Thread
// 수와 열린 셸 수(한때 줄 오른쪽의 `⌨ N`)가 이 카드로 왔다.
describe("hover 카드의 Thread 수 · 셸 수", () => {
  it("그 Work에 이은 Thread 수와 열린 셸 수가 선다", () => {
    const text = textOf(card({ threads: 3, shells: 2 }));
    expect(text).toContain("Thread 3개");
    expect(text).toContain("셸 2개");
  });

  it("Thread가 없으면 「아직 없어요」이고, 셸이 없으면 셸 칸이 없다 — 「없음」을 숫자로 말하지 않는다", () => {
    const text = textOf(card());
    expect(text).toContain("Thread 아직 없어요");
    expect(text).not.toContain("셸");
  });
});

// 프로젝트 줄의 값(codex-ds 결정 25). 줄이 서고 「변경 있음」이 제 줄에만 서는 것은 L3가 잰다 — 여기서는 줄마다 제 base ·
// 변경을 갖는 보통의 짝짓기와, 화면에서 만들기 어려운 두 경우(등록이 없는 프로젝트 · 빈 base)를 잰다.
describe("projectLines", () => {
  it("워크트리마다 한 줄이고, base는 그 프로젝트의 것 · 변경은 그 워크트리의 것이다", () => {
    expect(projectLines(work, [project("notes", "main"), project("atelier", "develop")])).toEqual([
      { project: "atelier", base: "develop", dirty: true },
      { project: "notes", base: "main", dirty: false },
    ]);
  });

  it("등록이 없거나 base가 빈 프로젝트는 base가 없다", () => {
    expect(projectLines(work, [project("atelier", "")])).toEqual([
      { project: "atelier", base: null, dirty: true },
      { project: "notes", base: null, dirty: false },
    ]);
  });
});

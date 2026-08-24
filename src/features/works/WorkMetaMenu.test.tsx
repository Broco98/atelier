import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkMetaRows, sharedBase } from "./WorkMetaMenu";
import type { ProjectView } from "@/features/projects/types";
import type { WorkView } from "./types";

// **쿼리 프로바이더를 세우지 않는다.** 줄들은 순수 표현이고 조회는 감싸는 메뉴가 한다 —
// WorkInfo와 같은 계약이고, 그것이 이 자리를 정적 마크업으로 볼 수 있게 하는 유일한 이유다.

const work: WorkView = {
  slug: "some-work",
  title: "어떤 작업",
  status: "active",
  branch: "feat/some-work",
  createdAt: "2026-08-16",
  projects: ["atelier"],
  pinned: false,
  worktrees: [
    { project: "atelier", path: "~/.atelier/works/some-work/trees/atelier", exists: true, dirty: false },
  ],
  specDir: "~/.atelier/works/some-work/spec",
  specFiles: [],
};

function render(overrides: Partial<WorkView> = {}, base: string | null = "develop"): string {
  return renderToStaticMarkup(
    <WorkMetaRows work={{ ...work, ...overrides }} base={base} onCopy={() => {}} />,
  );
}

// 줄 하나의 **보이는 값**만 뽑는다. 마크업 어딘가에 있다로 검사하면 이 팝오버에서는
// 특히 약하다 — slug가 세 줄 모두에 들어 있어 어느 줄을 지워도 초록이 된다.
function rowValues(markup: string): string[] {
  return [...markup.matchAll(/<span class="min-w-0 flex-1 truncate[^"]*">([^<]*)<\/span>/g)].map(
    (m) => m[1],
  );
}

const project = (slug: string, baseBranch: string): ProjectView => ({
  slug,
  name: slug,
  path: `~/MyProjects/${slug}`,
  baseBranch,
  createdAt: "2026-08-16",
  description: "",
  git: null,
  missing: false,
});

describe("WorkMetaRows", () => {
  it("브랜치 · 작업 폴더 · 워크트리 세 줄이 이 순서로 나온다", () => {
    // 디자인의 ⓘ 팝오버가 말하는 것과 같은 셋이다 — 에이전트에게 넘길 때 가장 자주
    // 집는 값들이라 한 클릭 거리에 둔다. 전체 메타는 계속 정보 탭에 있다.
    expect(rowValues(render())).toEqual([
      "feat/some-work",
      "~/.atelier/works/some-work/",
      "trees/atelier/",
    ]);
  });

  it("워크트리는 작업 폴더 기준으로 접힌다 — 접지 않으면 두 줄이 같아 보인다", () => {
    // 팝오버는 288px이고 두 경로는 `~/.atelier/works/<slug>/`를 통째로 공유한다.
    // 꼬리를 자르는 평범한 말줄임으로는 **그 줄을 구분해 주는 유일한 부분만** 잘려 나가
    // 두 줄의 보이는 글자가 완전히 같아진다 (실물에서 실제로 그랬다).
    // 기준 행(작업 폴더)이 바로 위에 있으므로 아래를 그것에 상대로 적을 수 있다.
    const markup = render();
    expect(markup.match(/~\/\.atelier\/works\/some-work\//g)).toHaveLength(1);
  });

  it("브랜치 줄에 base가 꼬리로 붙는다", () => {
    expect(render()).toContain(">develop<");
  });

  it("base를 한 줄로 말할 수 없으면 꼬리가 빠진다", () => {
    // 프로젝트마다 base가 다른 작업이다. 아무 값이나 골라 말하지 않는다 — 그 자리는 정보 탭이다.
    const markup = render({}, null);
    expect(markup).toContain("feat/some-work");
    expect(markup).not.toContain(">develop<");
  });

  it("브랜치가 미정이면 브랜치 줄 자체가 없다", () => {
    // 프로젝트가 붙기 전에는 보여줄 이름이 없다. 빈 줄을 남기면 누를 수 있는데 아무것도
    // 복사되지 않는 줄이 된다.
    expect(rowValues(render({ branch: null, projects: [], worktrees: [] }))).toEqual([
      "~/.atelier/works/some-work/",
    ]);
  });

  it("워크트리가 둘이면 줄도 둘이다", () => {
    expect(
      rowValues(
        render({
          projects: ["atelier", "notes"],
          worktrees: [
            { project: "atelier", path: "~/.atelier/works/some-work/trees/atelier", exists: true, dirty: false },
            { project: "notes", path: "~/.atelier/works/some-work/trees/notes", exists: true, dirty: false },
          ],
        }),
      ),
    ).toEqual([
      "feat/some-work",
      "~/.atelier/works/some-work/",
      "trees/atelier/",
      "trees/notes/",
    ]);
  });

  it("모든 줄이 복사되는 진짜 버튼이다", () => {
    const markup = render();
    expect(markup.match(/<button[^>]*title="복사"/g)).toHaveLength(3);
  });
});

describe("sharedBase", () => {
  it("프로젝트들이 한 base를 공유하면 그 이름이다", () => {
    expect(sharedBase([project("atelier", "develop")], ["atelier"])).toBe("develop");
    expect(
      sharedBase([project("atelier", "develop"), project("notes", "develop")], ["atelier", "notes"]),
    ).toBe("develop");
  });

  it("서로 다르면 null이다", () => {
    expect(
      sharedBase([project("atelier", "develop"), project("notes", "main")], ["atelier", "notes"]),
    ).toBeNull();
  });

  it("목록이 아직 안 왔으면 null이다", () => {
    // "아직 모른다"와 "한 줄로 말할 수 없다"가 같은 값이어도 된다 — 둘 다 꼬리를 안 그린다.
    expect(sharedBase(undefined, ["atelier"])).toBeNull();
  });

  it("등록이 사라진 프로젝트가 섞이면 null이다", () => {
    // 그 프로젝트의 base를 모르는데 나머지 하나의 base를 전체의 것처럼 말하면 거짓이 된다.
    expect(sharedBase([project("atelier", "develop")], ["atelier", "notes"])).toBeNull();
  });

  it("프로젝트가 없으면 null이다", () => {
    expect(sharedBase([], [])).toBeNull();
  });
});

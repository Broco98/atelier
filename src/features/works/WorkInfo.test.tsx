import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import WorkInfo, { relativeToWorkDir, type ProjectBase } from "./WorkInfo";
import { workDirRef, worktreeDirRef } from "./refs";
import type { WorkView } from "./types";

// **쿼리 프로바이더를 세우지 않는다.** 이 컴포넌트가 스스로 조회하면 여기서 바로 터진다 —
// 그것이 "정보 탭 본문은 순수 표현이다"를 지키는 유일한 검사다. 프로젝트별 base는
// 조회한 쪽(WorkPanel)이 값으로 내려준다.

const work: WorkView = {
  slug: "some-work",
  title: "어떤 작업",
  status: "active",
  branch: "feat/some-work",
  // 코어가 내려주는 값 그대로다 — chrono의 %Y-%m-%d
  createdAt: "2026-08-16",
  projects: ["atelier"],
  worktrees: [
    {
      project: "atelier",
      path: "~/.atelier/works/some-work/trees/atelier",
      exists: true,
      dirty: false,
    },
  ],
  specDir: "~/.atelier/works/some-work/spec",
  specFiles: ["overview.md", "01-계획/plan.md", "01-계획/notes.md", "02-구현/impl.md"],
};

const registered: Record<string, ProjectBase> = {
  atelier: { base: "develop", unregistered: false },
};

function render(
  overrides: Partial<WorkView> = {},
  bases: Record<string, ProjectBase> = registered,
): string {
  return renderToStaticMarkup(
    <WorkInfo
      work={{ ...work, ...overrides }}
      bases={bases}
      onCopy={() => {}}
      onOpenProject={() => {}}
    />,
  );
}

// 라벨–값 한 줄에서 **값만** 뽑는다. "값이 마크업 어딘가에 있다"로 검사하면 이 화면에서는
// 특히 약하다 — slug는 작업 폴더 경로와 브랜치 이름 **안에** 들어 있어서, slug 줄을 통째로
// 지워도 그런 검사는 초록이다. 결정 9가 slug를 따로 읽을 수 있어야 한다고 못박은 이유가
// 바로 "경로 안에 들어 있긴 하다"는 것이었다.
function rowValue(markup: string, label: string): string | null {
  return markup.match(new RegExp(`>${label}</span><span[^>]*>([^<]*)<`))?.[1] ?? null;
}

const twoProjects = {
  projects: ["atelier", "notes"],
  worktrees: [
    { project: "atelier", path: "~/.atelier/works/some-work/trees/atelier", exists: true, dirty: false },
    { project: "notes", path: "~/.atelier/works/some-work/trees/notes", exists: true, dirty: false },
  ],
};

describe("WorkInfo 프로젝트 구획", () => {
  it("프로젝트가 둘이면 덩어리도 둘이고, 각 덩어리에 그 프로젝트의 base가 붙는다", () => {
    const markup = render(twoProjects, {
      atelier: { base: "develop", unregistered: false },
      notes: { base: "main", unregistered: false },
    });
    // 한 줄로 뭉개면(`feat/… → develop, main`) 어느 base가 어느 프로젝트 것인지 사라진다
    expect(markup).toContain("develop");
    expect(markup).toContain("main");
    expect(markup).not.toContain("develop, main");
    expect(markup.match(/trees\/atelier/g)).toHaveLength(1);
    expect(markup.match(/trees\/notes/g)).toHaveLength(1);
  });

  it("커밋 안 된 변경이 있는 워크트리에 그 사실이 표시된다", () => {
    // 지금은 아카이빙 거부 대화상자를 보고서야 알게 되는 사실이다
    expect(render()).not.toContain("변경 있음");
    expect(
      render({
        worktrees: [{ ...work.worktrees[0], dirty: true }],
      }),
    ).toContain("변경 있음");
  });

  it("워크트리가 없는 프로젝트에 없음이 표시된다", () => {
    expect(
      render({ worktrees: [{ ...work.worktrees[0], exists: false, dirty: false }] }),
    ).toContain("없음");
  });

  it("프로젝트 이름을 누르면 상세로 가고, 경로 자리는 진짜 button이다", () => {
    const markup = render();
    expect(markup).toMatch(/<button[^>]*aria-label="atelier 프로젝트 상세로 이동"/);
    // 작업 폴더 · worktree · spec 셋 다 눌러서 복사한다
    expect(markup.match(/<button[^>]*title="경로 복사"/g)).toHaveLength(3);
  });
});

describe("WorkInfo base를 못 찾는 두 경우", () => {
  it("등록이 사라진 프로젝트는 base 자리에 알 수 없다가 나온다", () => {
    // 프로젝트를 지워도 그 프로젝트를 쓰는 작업은 남는다. 아카이브 기록이 쓰는 말과 같은
    // 말이라 어휘를 새로 만들지 않는다.
    expect(render({}, { atelier: { base: null, unregistered: true } })).toContain(
      "알 수 없다 — 프로젝트가 등록돼 있지 않다",
    );
  });

  it("base도 미등록 표시도 없이 내려오면 base 줄 자체가 없다", () => {
    // 목록이 아직 안 온 상태다. 오늘은 base들을 한 줄로 합치며 조용히 사라져 티가 안
    // 났지만, 덩어리마다 자리가 생기면 그 자리가 빈 채 남는다.
    const markup = render({}, { atelier: { base: null, unregistered: false } });
    expect(markup).not.toContain("알 수 없다");
    expect(markup).not.toMatch(/lucide-arrow-right/);
    // 덩어리 자체는 그대로 있다
    expect(markup).toContain("trees/atelier");
  });
});

describe("WorkInfo 프로젝트가 0개인 작업", () => {
  const none = { projects: [], worktrees: [] };

  it("안내 문구가 나오고 작업·문서 구획은 그대로 남는다", () => {
    const markup = render({ ...none, branch: null }, {});
    expect(markup).toContain("아직 프로젝트가 없어요.");
    expect(rowValue(markup, "slug")).toBe("some-work");
    expect(rowValue(markup, "생성일")).toBe("2026-08-16");
    expect(markup).toContain("판 2 · 문서 4(전체)");
  });

  it("브랜치가 있으면 안내 문구와 브랜치 줄이 함께 나오고 뒷문장이 빠진다", () => {
    // 코어는 프로젝트 없이도 브랜치를 확정해 저장한다 — 그 조합에서 "프로젝트를 붙이면
    // 브랜치가 정해져요"는 거짓이 된다.
    const markup = render(none, {});
    expect(markup).toContain("아직 프로젝트가 없어요.");
    expect(markup).toContain("feat/some-work");
    expect(markup).not.toContain("브랜치가 정해져요");
  });

  it("브랜치가 미정이면 뒷문장이 나온다", () => {
    expect(render({ ...none, branch: null }, {})).toContain("프로젝트를 붙이면 브랜치가 정해져요");
  });
});

describe("WorkInfo 작업 · 문서 구획", () => {
  it("slug와 생성일이 나오고, 생성일에 연도가 있다", () => {
    // 저장소의 formatCreated는 "8월 16일"을 내며 연도를 버린다 — 이 탭의 쓰임 하나인
    // "오래된 작업을 정리할지 판단한다"에 답하지 못한다.
    const markup = render();
    expect(rowValue(markup, "slug")).toBe("some-work");
    expect(rowValue(markup, "생성일")).toBe("2026-08-16");
    expect(markup).not.toContain("8월 16일");
  });

  it("slug 줄이 복사되는 진짜 버튼이다", () => {
    // 스토리 10은 slug를 "읽고 **복사하고**" 싶다고 적었다. 읽기만 되면 절반이다 —
    // 제목이 바뀌어도 같은 작업을 가리키려면 그 이름이 클립보드로 나가야 한다.
    const markup = render();
    // 값은 그대로 읽힌다 (사람 말로 다듬지 않는다)
    expect(rowValue(markup, "slug")).toBe("some-work");
    // 경로 셋과 같은 어포던스다 — 행 전체가 버튼이고 hover에 복사 아이콘이 뜬다
    expect(markup).toMatch(/<button[^>]*title="slug 복사"/);
  });

  it("브랜치가 미정이면 브랜치 줄만 빠진다", () => {
    const markup = render({ branch: null });
    expect(rowValue(markup, "브랜치")).toBeNull();
    expect(markup).not.toContain("feat/some-work");
    // 나머지 작업 구획은 그대로다
    expect(rowValue(markup, "slug")).toBe("some-work");
    expect(rowValue(markup, "생성일")).toBe("2026-08-16");
    expect(rowValue(markup, "작업 폴더")).toBe("~/.atelier/works/some-work/");
  });

  it("판 개수와 문서 개수가 spec 파일 목록에서 나온다", () => {
    // 두 수는 단위가 달라 더할 수 없고, 문서 개수는 판 안 문서를 **포함한다**.
    // spec 탭의 Documents 구획(판 밖 문서만)과 다른 집합이라 (전체)를 붙인다.
    expect(render()).toContain("판 2 · 문서 4(전체)");
    expect(render({ specFiles: ["overview.md"] })).toContain("판 0 · 문서 1(전체)");
  });

  it("경로는 공통 접두어를 한 번만 쓴다", () => {
    const markup = render();
    // 기준이 되는 작업 폴더만 전체 경로다 — 상대 경로는 기준이 먼저 나와야 읽힌다
    expect(rowValue(markup, "작업 폴더")).toBe("~/.atelier/works/some-work/");
    expect(rowValue(markup, "worktree")).toBe("trees/atelier/");
    expect(rowValue(markup, "spec")).toBe("spec/");
    // 좁은 패널에서 꼬리를 자르면 세 줄의 보이는 글자가 전부 같아지고, 그 줄을 구분해
    // 주는 유일한 부분만 잘려 나간다. 접두어가 세 번 나오면 그 상태다.
    expect(markup.match(/~\/\.atelier\/works\/some-work\//g)).toHaveLength(1);
  });
});

describe("relativeToWorkDir", () => {
  it("화면에 보이는 값은 복사되는 값의 꼬리다", () => {
    // 표기만 줄이는 것이고 클립보드로 나가는 것은 전체 경로다. 둘이 갈리면 화면을 믿고
    // 붙여 넣은 경로가 다른 곳을 가리킨다.
    const full = worktreeDirRef(work.worktrees[0].path);
    expect(full.endsWith(relativeToWorkDir(full, workDirRef(work.slug)))).toBe(true);
    expect(relativeToWorkDir(full, workDirRef(work.slug))).toBe("trees/atelier/");
  });

  it("접두어가 맞지 않으면 전체를 그대로 보인다", () => {
    // 데이터 루트를 옮긴 설치에서는 워크트리 경로가 작업 폴더 아래가 아니다
    expect(relativeToWorkDir("/elsewhere/trees/atelier/", "~/.atelier/works/some-work/")).toBe(
      "/elsewhere/trees/atelier/",
    );
  });
});

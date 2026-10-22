import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import WorkInfo, { relativeToWorkDir, sharedBase, type ProjectBase } from "./WorkInfo";
import type { ProjectView } from "@/features/projects/types";
import { workDirRef, worktreeDirRef } from "./refs";
import type { WorkView } from "./types";
import { specDocs, workFixture } from "./work-fixture";

// **쿼리 프로바이더를 세우지 않는다.** 이 컴포넌트가 스스로 조회하면 여기서 바로 터진다 —
// 그것이 "info 몸은 순수 표현이다"를 지키는 유일한 검사다. 프로젝트별 base와 브랜치 줄 꼬리의
// base는 조회한 쪽(WorkPanel)이 값으로 내려준다.

const work: WorkView = workFixture({
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
  ...specDocs(["overview.md", "01-계획/plan.md", "01-계획/notes.md", "02-구현/impl.md"]),
});

const registered: Record<string, ProjectBase> = {
  atelier: { base: "develop", unregistered: false },
};

function render(
  overrides: Partial<WorkView> = {},
  bases: Record<string, ProjectBase> = registered,
  // 맨 위 브랜치 줄의 꼬리 — 프로젝트들이 한 base를 공유할 때만 온다(아래 sharedBase).
  branchBase: string | null = "develop",
): string {
  return renderToStaticMarkup(
    <WorkInfo
      work={{ ...work, ...overrides }}
      bases={bases}
      branchBase={branchBase}
      onCopy={() => {}}
      onOpenProject={() => {}}
    />,
  );
}

// 맨 위 복사 묶음과 그 아래 구획들을 가른다. 경계는 첫 구획(「작업」)의 제목이다 — 묶음이 그 **위**에 서야 하므로,
// 경계를 못 찾으면 묶음을 빈 문자열로 돌려 아래 단언이 빨갛게 된다.
const FIRST_SECTION = ">작업</span>";
function top(markup: string): string {
  const end = markup.indexOf(FIRST_SECTION);
  return end === -1 ? "" : markup.slice(0, end);
}
function sections(markup: string): string {
  return markup.slice(markup.indexOf(FIRST_SECTION));
}

// 맨 위 묶음에서 줄마다 **보이는 값**만 뽑는다. 마크업 어딘가에 있다로 검사하면 이 묶음에서는 특히
// 약하다 — slug가 세 줄 모두에 들어 있어 어느 줄을 지워도 초록이 된다.
function copyRowValues(markup: string): string[] {
  return [...top(markup).matchAll(/<span class="min-w-0 flex-1 truncate[^"]*">([^<]*)<\/span>/g)].map(
    (m) => m[1],
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
    // 맨 위 복사 묶음에도 워크트리 줄이 서므로 프로젝트 덩어리는 구획 안에서 센다
    expect(sections(markup).match(/trees\/atelier/g)).toHaveLength(1);
    expect(sections(markup).match(/trees\/notes/g)).toHaveLength(1);
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
    // 도움말 「경로 복사」는 툴팁이라 정적 마크업에 없다 — 이름(라벨과 값)보다 더 말하는 그 말은 설명으로 남는다(S28).
    expect(markup.match(/<button[^>]*aria-description="경로 복사"/g)).toHaveLength(3);
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
    expect(rowValue(markup, "문서")).toBe("4");
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
    expect(markup).toMatch(/<button[^>]*aria-description="slug 복사"/);
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

  it("개수는 「문서」 줄 하나다", () => {
    // 판을 세던 것이 사라졌다(spec 레이아웃 결정 24) — 폴더가 곧 개념이라 판이라는 세는 말을 화면이
    // 따로 갖지 않는다. `(전체)`는 spec 탭의 `Documents` 구획(판 밖 문서만)과 가르려고 붙였던 꼬리라,
    // 구획이 없어지면서 가를 상대가 없다. 문서 개수는 판 안 문서를 **포함한** spec 파일 전부다.
    // 「이름 | 값」 두 칸의 한 줄이다(프로토타입 Works-info의 `문서 | 16`).
    const markup = render();
    expect(rowValue(markup, "문서")).toBe("4");
    expect(markup).not.toMatch(/판 \d/);
    expect(markup).not.toContain("(전체)");
    expect(rowValue(render({ specFiles: ["overview.md"] }), "문서")).toBe("1");
  });

  it("경로는 공통 접두어를 한 번만 쓴다", () => {
    const markup = render();
    // 기준이 되는 작업 폴더만 전체 경로다 — 상대 경로는 기준이 먼저 나와야 읽힌다
    expect(rowValue(markup, "작업 폴더")).toBe("~/.atelier/works/some-work/");
    expect(rowValue(markup, "worktree")).toBe("trees/atelier/");
    expect(rowValue(markup, "spec")).toBe("spec/");
    // 좁은 패널에서 꼬리를 자르면 세 줄의 보이는 글자가 전부 같아지고, 그 줄을 구분해
    // 주는 유일한 부분만 잘려 나간다. 접두어가 세 번 나오면 그 상태다. 맨 위 복사 묶음은 제 기준 행을 따로 들어
    // (아래 「맨 위 복사 묶음」) 구획 안에서 센다.
    expect(sections(markup).match(/~\/\.atelier\/works\/some-work\//g)).toHaveLength(1);
  });
});

// 맨 위 묶음 아래 구획 셋의 모양(프로토타입 Works-info — DS `.at-subhead` · `.at-props.narrow`). 판 04가 「info 패널 아래 구획들의
// 모양(속성 표 · 소제목)」을 판 06에 넘겼고(04 티켓 05 「하지 않는 것」), PR 2 최종 리뷰(P06-1)가 그 몫을 메웠다.
describe("WorkInfo 구획의 모양", () => {
  it("구획 제목은 본문 색 13px · 600이다 — 옅은 소제목이 아니다", () => {
    // 제목 바로 뒤에 그 구획의 줄 묶음이 선다 — 같은 글자의 이름 칸(「문서」 줄)과 가르는 고리다.
    const titles = [...render().matchAll(/<span class="([^"]*)">(작업|프로젝트|문서)<\/span><div/g)];
    expect(titles.map((m) => m[2])).toEqual(["작업", "프로젝트", "문서"]);
    for (const [, cls] of titles) {
      expect(cls).toMatch(/\btext-chat-meta\b/);
      expect(cls).toMatch(/\bfont-semibold\b/);
      expect(cls).not.toMatch(/\btext-(fg-tertiary|fg-secondary|xs)\b/);
    }
  });

  it("프로젝트 이름은 첫 줄의 이름 칸이고, base는 그 줄의 값 칸이다 — 상세로 가는 버튼 밖이다", () => {
    // 버튼은 이름(`aria-label`)을 따로 들어 그 안의 글자를 읽지 않는다 — base가 버튼 안이면 스크린리더에 안 읽힌다.
    const markup = render();
    const button = markup.match(/<button[^>]*aria-label="atelier 프로젝트 상세로 이동"[^>]*>([\s\S]*?)<\/button>/)?.[1];
    expect(button, "프로젝트 버튼을 찾지 못했다").toBeDefined();
    expect(button).toContain(">atelier<");
    expect(button).not.toContain("develop");
    expect(markup).toMatch(/aria-label="atelier 프로젝트 상세로 이동"[\s\S]*?<\/button><span[^>]*>[\s\S]*?lucide-arrow-right[\s\S]*?>develop</);
  });

  it("변경이 있으면 「변경 | 변경 있음」 줄이 선다", () => {
    expect(rowValue(render(), "변경")).toBeNull();
    expect(rowValue(render({ worktrees: [{ ...work.worktrees[0], dirty: true }] }), "변경")).toBe("변경 있음");
  });
});

// 프로젝트가 0개인 작업에도 브랜치가 실려 올 수 있다 — 코어의 nothing_to_decide는 세 조건을
// **모두** 요구하므로(works.rs) 이름을 주고 만든 작업에는 프로젝트가 없어도 브랜치가 있다.
describe("프로젝트가 없는 작업의 정보 탭", () => {
  const bare: Partial<WorkView> = { projects: [], worktrees: [], branch: "feat/some-bare" };

  it("브랜치 줄과 빈 프로젝트 구획이 선다", () => {
    const markup = render(bare, {});
    expect(rowValue(markup, "브랜치")).toBe("feat/some-bare");
    expect(markup).toContain("아직 프로젝트가 없어요.");
  });

  it("폴더 줄은 작업 폴더다", () => {
    const markup = render(bare, {});
    expect(rowValue(markup, "작업 폴더")).toBe("~/.atelier/works/some-work/");
  });
});

// 맨 위 복사 묶음(ui-refresh 결정 14) — 에이전트에게 작업을 넘길 때 가장 자주 집는 값 셋이다. 바탕 줄의 ⓘ 팝오버에 살던
// 줄들이 info 맨 위로 올라왔다. 아래 구획(작업 · 프로젝트)에도 작업 폴더 · 워크트리 복사가 있어 값이 겹친다 — ui-refresh 결정 14가
// 「한 클릭에 복사하고 싶은 것」을 맨 위에 모으기로 했다.
describe("WorkInfo 맨 위 복사 묶음", () => {
  it("첫 구획 위에 브랜치 · 작업 폴더 · 워크트리 세 줄이 이 순서로 선다", () => {
    expect(copyRowValues(render())).toEqual([
      "feat/some-work",
      "~/.atelier/works/some-work/",
      "trees/atelier/",
    ]);
  });

  it("워크트리는 작업 폴더 기준으로 접힌다 — 접지 않으면 두 줄이 같아 보인다", () => {
    // 두 경로는 `~/.atelier/works/<slug>/`를 통째로 공유한다. 꼬리를 자르는 평범한 말줄임으로는 **그 줄을
    // 구분해 주는 유일한 부분만** 잘려 나가 두 줄의 보이는 글자가 완전히 같아진다 (실물에서 실제로 그랬다).
    // 기준 행(작업 폴더)이 바로 위에 있으므로 아래를 그것에 상대로 적을 수 있다.
    expect(top(render()).match(/~\/\.atelier\/works\/some-work\//g)).toHaveLength(1);
  });

  it("브랜치 줄에 base가 꼬리로 붙는다", () => {
    expect(top(render())).toContain(">develop<");
  });

  it("base를 한 줄로 말할 수 없으면 꼬리가 빠진다", () => {
    // 프로젝트마다 base가 다른 작업이다. 아무 값이나 골라 말하지 않는다 — 프로젝트별 base는 아래 「프로젝트」 구획이 말한다.
    const head = top(render({}, registered, null));
    expect(head).toContain("feat/some-work");
    expect(head).not.toContain(">develop<");
  });

  it("브랜치가 미정이면 브랜치 줄 자체가 없다", () => {
    // 프로젝트가 붙기 전에는 보여줄 이름이 없다. 빈 줄을 남기면 누를 수 있는데 아무것도
    // 복사되지 않는 줄이 된다.
    expect(copyRowValues(render({ branch: null, projects: [], worktrees: [] }, {}, null))).toEqual([
      "~/.atelier/works/some-work/",
    ]);
  });

  it("워크트리가 둘이면 줄도 둘이다", () => {
    expect(
      copyRowValues(
        render(twoProjects, {
          atelier: { base: "develop", unregistered: false },
          notes: { base: "develop", unregistered: false },
        }),
      ),
    ).toEqual(["feat/some-work", "~/.atelier/works/some-work/", "trees/atelier/", "trees/notes/"]);
  });

  it("모든 줄이 복사되는 진짜 버튼이다", () => {
    // 도움말 「복사」는 툴팁이라 정적 마크업에 없다 — 이름(값)보다 더 말하는 그 말은 설명으로 남는다(S28).
    expect(top(render()).match(/<button[^>]*aria-description="복사"/g)).toHaveLength(3);
  });
});

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

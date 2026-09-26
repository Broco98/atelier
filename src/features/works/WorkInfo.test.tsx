import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import WorkInfo, { relativeToWorkDir, type ProjectBase } from "./WorkInfo";
import type { Mode } from "@/mode";
import { workDirRef, worktreeDirRef } from "./refs";
import type { WorkView } from "./types";
import { specDocs, workFixture } from "./work-fixture";

// **쿼리 프로바이더를 세우지 않는다.** 이 컴포넌트가 스스로 조회하면 여기서 바로 터진다 —
// 그것이 "정보 탭 본문은 순수 표현이다"를 지키는 유일한 검사다. 프로젝트별 base는
// 조회한 쪽(WorkPanel)이 값으로 내려준다.

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

// **세계는 맨 뒤 인자다** — 기본값이 Atelier라 아래 기존 검사들은 그대로다. 그 뜻은
// 이것들이 전부 「Atelier 정보 탭은 한 글자도 안 바뀐다」의 증거이기도 하다는 것이다.
function render(
  overrides: Partial<WorkView> = {},
  bases: Record<string, ProjectBase> = registered,
  mode: Mode = "atelier",
): string {
  return renderToStaticMarkup(
    <WorkInfo
      mode={mode}
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
    expect(markup).toContain(">문서 4<");
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

  it("개수는 「문서 M」 하나다", () => {
    // 판을 세던 것이 사라졌다(spec 레이아웃 결정 24) — 폴더가 곧 개념이라 판이라는 세는 말을 화면이
    // 따로 갖지 않는다. `(전체)`는 spec 탭의 `Documents` 구획(판 밖 문서만)과 가르려고 붙였던 꼬리라,
    // 구획이 없어지면서 가를 상대가 없다. 문서 개수는 판 안 문서를 **포함한** spec 파일 전부다.
    const markup = render();
    expect(markup).toContain(">문서 4<");
    expect(markup).not.toMatch(/판 \d/);
    expect(markup).not.toContain("(전체)");
    expect(render({ specFiles: ["overview.md"] })).toContain(">문서 1<");
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

// **두 세계를 함께 잰다.** 한쪽만 재면 조건이 어느 쪽으로 누워도 초록인 검사가 된다 —
// Maison만 보면 구획을 통째로 지워도(그래서 Atelier에서도 안 나와도) 통과하고, Atelier만
// 보면 조건을 뒤집어도 통과한다. 같은 값을 두 모드로 그려 **차이 자체**를 못박는다.
describe("WorkInfo가 세계를 탄다", () => {
  // 실재하는 Room이다 — 코어의 nothing_to_decide는 세 조건을 **모두** 요구하므로
  // (works.rs) 이름을 주고 만든 Room에는 프로젝트가 0개여도 브랜치가 실려 온다.
  // 「값이 비어 있으니 어차피 안 그려진다」가 성립하지 않는 자리가 여기다.
  const room: Partial<WorkView> = { projects: [], worktrees: [], branch: "feat/some-room" };

  // **값이 실려 온 채로 잰다.** 프로젝트도 워크트리도 없는 픽스처로만 재면
  // 「worktree 줄이 없다」가 공허하게 참이다 — 그 줄은 `work.projects.length > 0`일 때만
  // 도는 map 안에 살아서, 조건을 통째로 지워도(Atelier에서도) 안 그려진다. 지금은 같은
  // 게이트가 「프로젝트」 구획까지 감싸고 있어 그쪽 어서션이 대신 물지만, 워크트리 줄이
  // 자기 구획으로 나가는 날 Maison 렌더를 잡을 그물이 사라진다.
  it("Maison에는 프로젝트·브랜치·워크트리가 한 글자도 없다", () => {
    const markup = render({}, registered, "maison");
    // 구획 제목도, 그 안의 프로젝트 이름도, 워크트리 줄의 라벨도 함께 걷힌다
    expect(markup).not.toContain("프로젝트");
    expect(markup).not.toContain("worktree");
    expect(markup).not.toContain("trees/atelier");
    expect(rowValue(markup, "브랜치")).toBeNull();
    expect(markup).not.toContain("feat/some-work");
  });

  // 프로젝트가 0개인 Room도 같은 자리에 선다 — 걷히는 이유가 「값이 비어서」가 아니라
  // 「세계가 달라서」임을 이 짝이 못박는다(코어는 이름을 준 Room에 브랜치를 실어 보낸다).
  it("프로젝트 0개 Room에도 브랜치가 안 뜬다", () => {
    const markup = render(room, {}, "maison");
    expect(markup).not.toContain("프로젝트");
    expect(rowValue(markup, "브랜치")).toBeNull();
    expect(markup).not.toContain("feat/some-room");
  });

  it("같은 Room을 Atelier로 그리면 브랜치 줄과 프로젝트 구획이 선다", () => {
    const markup = render(room, {}, "atelier");
    expect(rowValue(markup, "브랜치")).toBe("feat/some-room");
    expect(markup).toContain("아직 프로젝트가 없어요.");
  });

  it("남는 구획 둘은 Maison에서도 그대로다", () => {
    // 걷히는 것이 셋뿐이라는 뜻이다 — 항목 구획과 「문서」까지 함께 사라지면 정보 탭이
    // 저 세계에서 빈 탭이 되는데, 위 검사들만으로는 그 화면도 초록이다.
    const markup = render(room, {}, "maison");
    expect(rowValue(markup, "slug")).toBe("some-work");
    expect(rowValue(markup, "생성일")).toBe("2026-08-16");
    // **경로도 저 세계의 것이다**(#186). Atelier 루트가 남아 있으면 사용자는 여기서 복사한
    // 줄을 그대로 열었다가 없는 폴더를 만난다 — 값이 그럴듯해서 화면에서는 안 보인다.
    expect(rowValue(markup, "Room 폴더")).toBe("~/.atelier/maison/rooms/some-work/");
    expect(rowValue(markup, "spec")).toBe("spec/");
  });

  // **낱말도 세계를 탄다.** 구획 머리와 폴더 줄의 이름표가 Atelier 말로 남아 있었다 —
  // 이 판이 사이드바·본문·아카이브의 어휘를 갈라 놓고도 정보 탭을 안 집었고, 그래서
  // Maison의 정보 탭이 Room을 통째로 「작업」이라 불렀다(CONTEXT.md 「Room」 항목).
  it("Maison 정보 탭에는 「작업」이라는 말이 없다", () => {
    const markup = render(room, {}, "maison");
    expect(markup).not.toContain("작업");
    expect(markup).toContain("Room");
  });

  // 반대쪽. 이 줄이 없으면 두 세계를 다 Room 어휘로 눕혀도 위 검사가 초록이다.
  it("Atelier 정보 탭의 낱말은 한 글자도 안 바뀐다", () => {
    const markup = render(room, {}, "atelier");
    expect(rowValue(markup, "작업 폴더")).toBe("~/.atelier/works/some-work/");
    expect(markup).not.toContain("Room");
  });
});

describe("relativeToWorkDir", () => {
  it("화면에 보이는 값은 복사되는 값의 꼬리다", () => {
    // 표기만 줄이는 것이고 클립보드로 나가는 것은 전체 경로다. 둘이 갈리면 화면을 믿고
    // 붙여 넣은 경로가 다른 곳을 가리킨다.
    const full = worktreeDirRef(work.worktrees[0].path);
    expect(full.endsWith(relativeToWorkDir(full, workDirRef("atelier", work.slug)))).toBe(true);
    expect(relativeToWorkDir(full, workDirRef("atelier", work.slug))).toBe("trees/atelier/");
  });

  it("접두어가 맞지 않으면 전체를 그대로 보인다", () => {
    // 데이터 루트를 옮긴 설치에서는 워크트리 경로가 작업 폴더 아래가 아니다
    expect(relativeToWorkDir("/elsewhere/trees/atelier/", "~/.atelier/works/some-work/")).toBe(
      "/elsewhere/trees/atelier/",
    );
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkPanel, { type PanelView } from "./WorkPanel";
import { projectsQuery } from "@/features/projects/hooks";
import type { ProjectView } from "@/features/projects/types";
import type { WorkView } from "./types";
import { specDocs, workFixture } from "./work-fixture";

// 이 컴포넌트는 작업 패널 **카드 안**(고른 칸의 제목 하나뿐인 머리와 두 몸)을 그린다. 바깥 상자(두 번째 `aside`) · 카드 · 틈 · 폭
// 손잡이 · 접힘은 공용 틀의 패널 칸이 들어(ui-refresh 결정 27) 그 단언은 화면을 통째로 그리는 `WorksPage.test.tsx`에 있다. 칸을
// 고르고 여닫는 자리(레일 · 패널 토글)도 패널 밖이라 그쪽에 있다(ui-refresh 결정 9 · 10).
//
// WorkPanel은 프로젝트 목록을 스스로 조회해 **info 몸에 값으로 내려준다.** 그래서 여기가
// 로딩·미등록·등록됨 셋을 가르는 유일한 자리다 — info 몸은 순수 표현이라 받은 prop만
// 증명할 수 있다.
//
// **로딩 중 값은 빈 배열이 아니라 `undefined`다.** 그 둘이 같아지면(`= []` 기본값) 목록이
// 오기 전과 등록이 사라진 뒤가 구분되지 않아, 정상 등록된 프로젝트에도 "알 수 없다"가
// 스친다. 아래 테스트 넷이 그 갈림을 고정한다.

const work: WorkView = workFixture(specDocs(["overview.md"]));

// projects를 넘기지 않으면 조회가 **pending 그대로다** — 정적 렌더는 이펙트를 돌리지 않아
// 요청이 나가지 않는다. 값을 넘기면 캐시에서 그대로 읽힌다.
//
// `view`는 레일에서 고른 칸이다 — 그 값의 주인은 화면(`WorksPage`)이고 이 컴포넌트는 받은 대로 그린다. 맨 **뒤에** 두는 것은
// 기본값이 있어 기존 호출이 바뀌지 않게 하려는 것이다.
function render(
  open: boolean,
  override: Partial<WorkView> = {},
  projects?: ProjectView[],
  view: PanelView = "spec",
): string {
  const client = new QueryClient();
  if (projects !== undefined) client.setQueryData(projectsQuery().queryKey, projects);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <WorkPanel
        work={{ ...work, ...override }}
        view={view}
        currentFile={null}
        onSelectFile={() => {}}
        onCopy={() => {}}
        onOpenProject={() => {}}
        open={open}
        unseen={[]}
        onOpenDoc={() => {}}
      />
    </QueryClientProvider>,
  );
}

/** 카드 머리 — 고른 칸의 제목이 서는 줄. */
const headOf = (markup: string) => markup.match(/<div data-slot="card-head"[^>]*>[\s\S]*?<\/div>/)?.[0] ?? "";
/** 두 몸의 상자 — 숨은 쪽은 `hidden`과 `inert`를 단다. 몸의 표식(`data-panel-view`)으로 집는다. */
const bodyTag = (markup: string, view: PanelView) =>
  markup.match(new RegExp(`<div[^>]*data-panel-view="${view}"[^>]*>`))?.[0] ?? "";

const oneProject: Partial<WorkView> = {
  projects: ["atelier"],
  worktrees: [
    {
      project: "atelier",
      path: "~/.atelier/works/some-work/trees/atelier",
      exists: true,
      dirty: false,
    },
  ],
};

const twoProjects: Partial<WorkView> = {
  projects: ["atelier", "notes"],
  worktrees: [
    { project: "atelier", path: "~/.atelier/works/some-work/trees/atelier", exists: true, dirty: false },
    { project: "notes", path: "~/.atelier/works/some-work/trees/notes", exists: true, dirty: false },
  ],
};

function project(slug: string, baseBranch: string): ProjectView {
  return {
    slug,
    name: slug,
    path: `~/MyProjects/${slug}`,
    baseBranch,
    createdAt: "2026-08-01",
    description: "",
    git: null,
    missing: false,
  };
}

function stubEmptyStorage() {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
}

// 칸을 바꾸는 것 자체(클릭)는 여기서 볼 수 없다 — 이 seam은 정적 마크업이라 이벤트가 돌지 않는다(L3 `tab-keys.spec.ts`가
// 레일로 잰다). 대신 **받은 칸으로 그린 구조**를 못 박는다: 머리가 그 칸의 제목 하나인가, 두 몸이 함께 마운트돼 있고 안 보이는
// 쪽이 가려졌는가, 스크롤 경계가 여전히 패널 카드에 있는가.
describe("WorkPanel 머리와 두 몸", () => {
  beforeEach(stubEmptyStorage);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("머리는 고른 칸의 제목 하나다 — 탭도 닫는 `×`도 없다", () => {
    // ui-refresh 결정 9 · 10. 칸을 고르는 자리(레일)와 여닫는 자리(패널 토글)가 패널 밖으로 나갔다 — 머리에 탭이나 `×`가
    // 남으면 같은 일을 하는 컨트롤이 한 화면에 둘이 된다. 닫는 길은 토글과 켜진 칸 다시 누르기다.
    const spec = headOf(render(true));
    expect(spec, "패널 머리를 찾지 못했다").not.toBe("");
    expect(spec).toMatch(/>spec</);
    expect(headOf(render(true, {}, undefined, "info"))).toMatch(/>info</);
    const markup = render(true);
    expect(markup).not.toMatch(/role="tab/);
    expect(markup).not.toMatch(/aria-selected/);
    expect(markup).not.toContain('aria-label="작업 패널 접기"');
    expect(spec).not.toContain("<button");
    // 라벨은 **소문자 영어다**(결정 41) — 탭 줄 · 레일의 `spec` · `info`와 한 가족이다. 프로토타입 머리의 「문서 16」은
    // info에 이미 있는 수라 싣지 않는다(ui-refresh 결정 33).
    expect(spec).not.toMatch(/>정보</);
    expect(spec).not.toContain("문서");
  });

  it("머리 제목은 카드 제목 규격이다 — 13px · 600", () => {
    // 디자인 시스템의 `.at-card-title`(13px · 600). 「무엇을 볼까」를 고르는 컨트롤이 아니라 그 칸의 이름이라 글자 버튼의
    // 규격(500)이 아니다.
    const title = headOf(render(true)).match(/<span class="([^"]*)"[^>]*>spec</)?.[1] ?? "";
    expect(title, "제목을 찾지 못했다").not.toBe("");
    expect(title).toContain("text-ui");
    expect(title).toContain("font-semibold");
  });

  it("`shell` 칸이 없다 — 셸을 고르는 자리는 탭 줄이다", () => {
    // 결정 71. 되살아나면 **같은 것을 두 자리에서 고르게 되고**, 화면으로는 둘 다 멀쩡해
    // 보여서 어느 쪽이 지금인지가 안 드러난다. 앞 판이 가로 탭 줄에서 겪은 그 병이다.
    const markup = render(true);
    expect(markup).not.toMatch(/<button[^>]*>shell</);
    // 안 보이는 몸까지 마운트돼 있으므로 `+`도 함께 딸려 오면 안 된다.
    expect(markup).not.toContain('aria-label="셸 열기"');
  });

  it("보이지 않는 몸도 함께 마운트돼 있고, `hidden` · `inert`로 가려진다", () => {
    // info 몸은 지금 안 보이지만 마크업에 있다. 언마운트하면 메타를 보고 spec으로 돌아왔을 때 접어둔 판이 펴져 있다
    // (결정 9·13 — 한때 탭 패널의 `keepMounted`가 지키던 것). 다녀와도 접힘이 남는지는 L3가 잰다(`tab-keys.spec.ts`).
    const spec = render(true);
    expect(spec).toContain("feat/some-work");
    expect(bodyTag(spec, "spec")).not.toBe("");
    expect(bodyTag(spec, "spec")).not.toMatch(/\b(hidden|inert)=/);
    expect(bodyTag(spec, "info")).toMatch(/\bhidden=""/);
    expect(bodyTag(spec, "info")).toMatch(/\binert=""/);
    // 반대쪽 — info를 고르면 spec 몸이 가려지고, 트리는 여전히 마운트돼 있다. 순서는 spec → info 그대로다.
    const info = render(true, {}, undefined, "info");
    expect(info).toContain("overview.md");
    expect(bodyTag(info, "spec")).toMatch(/\bhidden=""/);
    expect(bodyTag(info, "spec")).toMatch(/\binert=""/);
    expect(bodyTag(info, "info")).not.toMatch(/\b(hidden|inert)=/);
    expect(info.indexOf('data-panel-view="info"')).toBeGreaterThan(info.indexOf('data-panel-view="spec"'));
  });

  it("몸 안의 스크롤 영역이 패널 카드의 남는 높이를 차지한다", () => {
    // 지켜야 할 불변조건은 "spec 몸이 조각을 돌려준다"가 아니라 **"스크롤 영역이
    // 패널 카드의 직계 flex 자식이어야 한다"**이다. 몸의 상자가 평범한 상자면
    // flex-1의 기준이 카드에서 껍데기로 옮겨가 카드의 넘침 감춤에 트리가 잘리는데,
    // 마크업만 보면 멀쩡하다. 몸의 상자가 `contents`라 그 통과를 맡는다 — 숨으면 `hidden`이
    // preflight(`display: none !important`)로 이긴다.
    const markup = render(true);
    expect(bodyTag(markup, "spec")).toMatch(/class="[^"]*\bcontents\b/);
    // 통과시키는 것만으로는 모자라다 — 받는 쪽이 그 자리를 차지해야 트리가 스크롤한다.
    // 둘 중 하나만 빠져도 트리가 내용 높이만큼 늘어나 카드에 잘린다.
    const scrollBox = markup.match(/<div class="([^"]*\boverflow-y-auto\b[^"]*)"/)?.[1] ?? "";
    expect(scrollBox).toMatch(/\bflex-1\b/);
    expect(scrollBox).toMatch(/\bmin-h-0\b/);
  });

  it("워크트리 개수 배지가 없다", () => {
    const markup = render(true, oneProject);
    // 사라지는 것은 개수 배지다 — 그 프로젝트의 덩어리와 워크트리 경로는 그대로 남는다.
    // 배지는 exists가 참인 것만 세어 프로젝트 덩어리 개수와 어긋난다 (결정 24).
    expect(markup).toContain("trees/atelier/");
    expect(markup).not.toMatch(/worktree 1/);
  });

  it("프로젝트 목록이 아직 안 왔을 때는 base 자리를 비운다", () => {
    // 정적 렌더는 이펙트를 돌리지 않으므로 여기 조회는 **pending 그대로다**. 목록을 받는
    // 자리에 `= []` 기본값을 두면 그 순간이 "등록이 하나도 없다"와 완전히 같은 값이 되어,
    // 화면이 로딩 중에도 "알 수 없다"를 내보인다. 이 화면은 목록을 프리로드하지 않으므로
    // 그 순간이 매번 실재한다.
    const markup = render(true, oneProject);
    expect(markup).toContain("trees/atelier/");
    expect(markup).not.toContain("알 수 없다");
  });

  it("등록된 프로젝트의 base가 그 덩어리에 붙는다", () => {
    const markup = render(true, oneProject, [project("atelier", "develop")]);
    expect(markup).toContain("develop");
    expect(markup).not.toContain("알 수 없다");
  });

  it("프로젝트가 둘이면 각 덩어리가 **자기** base를 받는다", () => {
    // 이 작업이 고치려는 버그가 바로 이것이다 — 오늘은 base들을 Set으로 모아
    // `feat/… → develop, main`처럼 이어 붙여, 어느 base가 어느 프로젝트 것인지 사라진다.
    // 뽑는 쪽이 slug로 맞추지 않으면 덩어리마다 남의 base가 붙는데 화면은 멀쩡해 보인다.
    const markup = render(true, twoProjects, [
      project("atelier", "develop"),
      project("notes", "main"),
    ]);
    const first = markup.slice(
      markup.indexOf('aria-label="atelier 프로젝트 상세로 이동"'),
      markup.indexOf('aria-label="notes 프로젝트 상세로 이동"'),
    );
    expect(first).toMatch(/>develop</);
    expect(first).not.toMatch(/>main</);
    expect(markup).toMatch(/>main</);
  });

  it("base가 빈 문자열이면 그 줄을 아예 그리지 않는다", () => {
    // 코어가 빈 base_branch를 막지 않는다 — 이름은 EmptyName으로 거부하는데 base는 검증이
    // 없고, MCP의 atelier_edit_project가 값을 그대로 통과시킨다. 받는 자리를 `??`로 쓰면
    // ""가 null이 되지 않아 프로젝트 구획은 `base !== null`이 참이라 **뒤에 아무것도 없는 →
    // 글리프만** 그린다. 같은 값을 맨 위 브랜치 줄은 truthy로 봐서 꼬리를 안 그리므로,
    // 한 값이 두 자리에서 다르게 읽힌다. 값을 정하는 이 한 곳에서 `||`로 접는다.
    const empty = render(true, oneProject, [project("atelier", "")]);
    expect(empty).toContain("trees/atelier/");
    // 등록은 돼 있다 — "알 수 없다"는 다른 사실이라 여기서 나오면 안 된다
    expect(empty).not.toContain("알 수 없다");
    // base 값의 표식은 앞의 → 글리프다 — 그 칸에만 선다(맨 위 브랜치 줄의 꼬리는 글리프 없이 글자뿐이다).
    expect(empty).not.toMatch(/lucide-arrow-right/);
    // 같은 자리에 진짜 base가 오면 그 줄이 선다 — 위 부재가 "원래 없는 줄"이 아님을 못 박는다
    expect(render(true, oneProject, [project("atelier", "develop")])).toMatch(/lucide-arrow-right/);
  });

  it("목록이 왔는데 그 프로젝트가 없으면 등록이 사라진 것이다", () => {
    // 프로젝트를 지워도 그것을 쓰는 작업은 남는다. 로딩 중(위 테스트)과 **다른 말**을
    // 해야 하고, 그러라고 값이 둘로 갈려 내려간다.
    expect(render(true, oneProject, [])).toContain("알 수 없다");
  });

  it("트리 위 Spec 소제목이 없다", () => {
    // 바로 위 머리 제목이 이미 spec이라 같은 말이 두 줄 연달아 나온다 (결정 23)
    expect(render(true)).not.toMatch(/>Spec</);
  });
});

// spec 몸은 **work 응답에 실려 온 spec 트리를 그린다**(spec 레이아웃 결정 13·24). 파일 목록을
// 다시 갈라 판 구획(`Iterations N`)과 판 밖 구획(`Documents`)을 세우던 것이 사라졌다 — 트리가
// 곧 레이아웃의 순서이고, 판 폴더는 그 자리(내장본에서는 `overview.md` 다음)에 선다.
describe("WorkPanel spec 몸", () => {
  beforeEach(stubEmptyStorage);
  afterEach(() => vi.unstubAllGlobals());

  // 커널이 주는 파일 목록은 경로 순서이고, 트리는 엔진이 레이아웃의 자리로 가른 순서다. 둘이
  // 달라야 「어느 것을 그리는가」가 갈린다.
  const layered: Partial<WorkView> = {
    specFiles: ["01-첫째/plan.md", "02-둘째/plan.md", "overview.md"],
    specTree: {
      fallback: null,
      defaultDoc: "overview.md",
      items: [
        { name: "overview.md", path: "overview.md", kind: "file", icon: "compass", group: null, children: [] },
        {
          name: "02-둘째",
          path: "02-둘째",
          kind: "folder",
          icon: "layers",
          group: { key: "{n}-{name}", n: 2, latest: true },
          children: [
            { name: "plan.md", path: "02-둘째/plan.md", kind: "file", icon: null, group: null, children: [] },
          ],
        },
        {
          name: "01-첫째",
          path: "01-첫째",
          kind: "folder",
          icon: "layers",
          group: { key: "{n}-{name}", n: 1, latest: false },
          children: [
            { name: "plan.md", path: "01-첫째/plan.md", kind: "file", icon: null, group: null, children: [] },
          ],
        },
      ],
    },
  };

  it("구획 머리 없이 spec 트리를 받은 순서대로 그린다", () => {
    const markup = render(true, layered);
    expect(markup).not.toContain("Iterations");
    expect(markup).not.toContain("Documents");
    const overview = markup.indexOf(">overview.md<");
    const latest = markup.indexOf(">02-둘째<");
    const older = markup.indexOf(">01-첫째<");
    expect(overview).toBeGreaterThan(0);
    expect(latest).toBeGreaterThan(overview);
    expect(older).toBeGreaterThan(latest);
  });

  it("레이아웃이 물러섰어도 말하지 않고 받은 트리를 그린다", () => {
    // 알리는 것은 설정 페이지의 일이다(spec 레이아웃 구현 스펙 4절) — 이 몸은 조용히 내장본으로 그린다.
    const reason = "layout.json is missing";
    const markup = render(true, { ...layered, specTree: { ...layered.specTree!, fallback: reason } });
    expect(markup).not.toContain(reason);
    expect(markup).toContain(">overview.md<");
  });

  it("spec 트리가 비면 아직 파일이 없다고 말한다", () => {
    expect(render(true, specDocs([]))).toContain("아직 spec 파일이 없어요");
  });
});

// 문서/원문 전환은 **이 패널에 없다**(ui-refresh 판 04) — 바꾸는 것이 왼쪽 문서라 문서 카드 머리로 갔다. 한때 이 패널 머리행에
// 앉아 「본문을 바꾸는 유일한 컨트롤」이었는데, 그것이 남아 있으면 같은 일을 하는 버튼이 한 화면에 둘이 된다. 문서 카드 머리
// 쪽 단언은 `WorksPage.test.tsx`에, 두 칸이 받은 값을 그대로 그리는가는 부품의 검사(`SourceToggle.test.tsx`)에 있다.
describe("WorkPanel 소스 토글", () => {
  beforeEach(stubEmptyStorage);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("원문 전환이 패널에 없다", () => {
    const markup = render(true);
    expect(markup).not.toContain('aria-label="원문 보기"');
    expect(markup).not.toContain('aria-label="문서로 보기"');
    // 머리에 남는 것은 고른 칸의 제목이다 — 이것이 없으면 위 부재가 「머리가 통째로 안 섰다」로도 초록이다.
    expect(headOf(markup)).toMatch(/>spec</);
  });
});

// 이 패널은 바탕 줄 아래에 뜬 카드다(ui-refresh 결정 4) — 머리는 다른 카드와 같은 카드 머리(48px)다.
describe("WorkPanel 머리행", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("머리 행이 카드 머리 높이를 그대로 읽는다", () => {
    // 값을 손으로 적으면(h-12 같은 것) 카드 머리 높이가 바뀔 때 이 줄만 남아 옆 문서 카드의 머리와 어긋난다.
    // 머리는 카드 안이라 창을 끄는 자리가 아니다 — 그 일은 바탕 줄과 회색 틈이 한다.
    const markup = render(true);
    expect(markup).toContain("h-(--card-head)");
    expect(markup).not.toContain("h-(--titlebar-height)");
    expect(markup).not.toContain("data-tauri-drag-region");
  });

  it("왼쪽 경계선이 없다 — 문서와의 구분은 틈이 맡는다", () => {
    // ui-refresh 결정 4로 **뒤집혔다**: 한때 창 끝에서 끝까지 가는 컬럼이라 경계선 하나가 본문과 갈랐는데, 이제 패널은
    // 바탕 위에 뜬 둥근 카드이고(그 카드는 공용 틀이 그린다 — `WorksPage.test.tsx`) 사이 틈이 구분을 맡는다.
    expect(render(true)).not.toContain("border-l");
  });
});

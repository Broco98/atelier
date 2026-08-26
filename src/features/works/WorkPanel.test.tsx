import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkPanel from "./WorkPanel";
import { projectsQuery } from "@/features/projects/hooks";
import type { ProjectView } from "@/features/projects/types";
import type { WorkView } from "./types";

// 이 패널은 화면 **오른쪽**에 있어 핸들이 왼쪽 가장자리에 붙고 끄는 방향의 부호가 반대다.
// 호출부가 side를 빠뜨리거나 "left"로 적으면 핸들이 패널 건너편으로 가 잡을 곳이 사라지는데,
// 훅 쪽 테스트는 이 배선을 보지 못한다.
//
// WorkPanel은 프로젝트 목록을 스스로 조회해 **정보 탭에 값으로 내려준다.** 그래서 여기가
// 로딩·미등록·등록됨 셋을 가르는 유일한 자리다 — 정보 탭 본문은 순수 표현이라 받은 prop만
// 증명할 수 있다.
//
// **로딩 중 값은 빈 배열이 아니라 `undefined`다.** 그 둘이 같아지면(`= []` 기본값) 목록이
// 오기 전과 등록이 사라진 뒤가 구분되지 않아, 정상 등록된 프로젝트에도 "알 수 없다"가
// 스친다. 아래 테스트 넷이 그 갈림을 고정한다.
//
// 폭은 localStorage에서 읽어 온다.

const work: WorkView = {
  slug: "some-work",
  title: "어떤 작업",
  status: "active",
  branch: "feat/some-work",
  createdAt: "2026-08-16",
  projects: [],
  pinned: false,
  worktrees: [],
  specDir: "~/.atelier/works/some-work/spec",
  specFiles: ["overview.md"],
};

// projects를 넘기지 않으면 조회가 **pending 그대로다** — 정적 렌더는 이펙트를 돌리지 않아
// 요청이 나가지 않는다. 값을 넘기면 캐시에서 그대로 읽힌다.
//
// source는 소스 토글의 상태다. 이 패널은 그것을 소유하지 않고 **보여주기만** 하므로
// 여기서는 값으로 넣는다 — 어느 식에서 나오는지는 화면(WorksPage) 쪽 계약이다.
// on은 사람이 정한 켜짐이고, locked는 이 파일에서 토글이 먹지 않는다는 뜻이다. **둘은 독립이다.**

function render(
  open: boolean,
  override: Partial<WorkView> = {},
  projects?: ProjectView[],
  source: { on: boolean; locked: boolean } = { on: false, locked: false },
): string {
  const client = new QueryClient();
  if (projects !== undefined) client.setQueryData(projectsQuery.queryKey, projects);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <WorkPanel
        work={{ ...work, ...override }}
        currentFile={null}
        onSelectFile={() => {}}
        onCopy={() => {}}
        onClose={() => {}}
        onOpenProject={() => {}}
        sourceOn={source.on}
        sourceLocked={source.locked}
        onToggleSource={() => {}}
        open={open}
      />
    </QueryClientProvider>,
  );
}

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

describe("WorkPanel 폭 조절", () => {
  beforeEach(stubEmptyStorage);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("펼쳐져 있으면 왼쪽 가장자리에 핸들이 선다", () => {
    const markup = render(true);
    expect(markup).toMatch(/cursor-col-resize/);
    // 핸들과 심 라인 둘 다 왼쪽에 붙어야 한다 — 오른쪽이면 패널 건너편이다
    expect(markup.match(/left-0/g)).toHaveLength(2);
    // 핸들은 absolute다. 이 상자가 기준이 아니면 조상 어딘가를 기준으로 서서
    // 화면 엉뚱한 곳에 붙는데, 마크업만 보면 멀쩡하다.
    expect(markup).toMatch(/<aside [^>]*class="[^"]*\brelative\b/);
  });

  it("폭을 다른 패널과 따로 기억한다", () => {
    const asked: string[] = [];
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => {
        asked.push(key);
        return null;
      },
      setItem: () => {},
    });
    render(true);
    // 사이드바·목록 패널의 키를 건드리면 폭 범위가 다른 둘이 서로를 덮는다
    expect(asked).not.toHaveLength(0);
    expect(asked).not.toContain("sidebar-width");
    expect(asked).not.toContain("panel-width");
    expect(asked).not.toContain("archive-panel-width");
  });

  it("접혀 있으면 핸들이 없다", () => {
    expect(render(false)).not.toMatch(/cursor-col-resize/);
  });

  it("기본 폭 330으로 서고, 바깥과 안쪽이 같은 폭을 읽는다", () => {
    const markup = render(true);
    expect(markup).toMatch(/--work-panel-width:\s*330px/);
    // 변수를 **선언**만 하고 쓰지 않으면 폭이 못 박힌 채로도 전부 초록이다 — 핸들도 서고
    // 커서도 뜨는데 끌어도 1px도 안 움직인다. 바깥은 접히는 폭이고 안쪽은 그 폭으로
    // 버티는 자리라, 둘이 갈리면 접히는 동안 글이 되흐른다. 그래서 정확히 둘이다.
    expect(markup.match(/w-\(--work-panel-width\)/g)).toHaveLength(2);
  });

  it("지난번에 바꾼 폭으로 다시 선다", () => {
    // **기본 폭과 다른 값이어야 한다.** 같으면 저장값을 통째로 무시해도 이 검사가 초록이라
    // 아무것도 지키지 못한다 (기본 폭을 296에서 420으로 올릴 때 실제로 그렇게 될 뻔했다).
    vi.stubGlobal("localStorage", { getItem: () => "500", setItem: () => {} });
    expect(render(true)).toMatch(/--work-panel-width:\s*500px/);
  });
});

// 탭 전환 자체(클릭)는 여기서 볼 수 없다 — 이 seam은 정적 마크업이라 이벤트가 돌지 않는다.
// 대신 **첫 화면의 구조**를 못 박는다: 탭 바가 서 있는가, 세 탭이 함께 마운트돼 있는가,
// 스크롤 경계가 여전히 패널 카드에 있는가.
describe("WorkPanel 두 탭", () => {
  beforeEach(stubEmptyStorage);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("맨 위가 spec | info 탭 바이고, 처음 켜져 있는 것은 spec이다", () => {
    const markup = render(true);
    // 켜짐·꺼짐 둘 다 기존 토글 어휘를 그대로 쓴다 — 새 토큰을 만들지 않았다
    expect(markup).toMatch(/<button[^>]*\btoggle-on\b[^>]*>spec</);
    // 라벨은 **소문자 영어다**(결정 41). `정보`·`세션`으로 되돌아오면 사이드바 가지의
    // `spec`·`terminal`과 언어가 갈린다 — 그 셋은 한 가족으로 읽혀야 한다. `세션`은 특히
    // 앱의 말이 아니다(CONTEXT.md) — `claude`가 자기 쪽에 저장하는 대화 몫이다.
    expect(markup).toMatch(/<button[^>]*\bquiet-hover\b[^>]*>info</);
    expect(markup).not.toMatch(/<button[^>]*>정보</);
    expect(markup).not.toMatch(/<button[^>]*>세션</);
  });

  it("`shell` 탭이 없다 — 셸을 고르는 자리는 사이드바 가지다", () => {
    // 결정 71. 되살아나면 **같은 것을 두 자리에서 고르게 되고**, 화면으로는 둘 다 멀쩡해
    // 보여서 어느 쪽이 지금인지가 안 드러난다. 앞 판이 가로 탭 줄에서 겪은 그 병이다.
    const markup = render(true);
    expect(markup).not.toMatch(/<button[^>]*>shell</);
    // 안 보이는 탭까지 마운트돼 있으므로 `+`도 함께 딸려 오면 안 된다.
    expect(markup).not.toContain('aria-label="셸 열기"');
  });

  it("순서가 spec → info다", () => {
    const markup = render(true);
    const at = (label: string) => markup.search(new RegExp(`<button[^>]*>${label}<`));
    expect(at("spec")).toBeGreaterThan(-1);
    expect(at("info")).toBeGreaterThan(at("spec"));
  });

  it("탭 규격이 헤더 뷰 탭과 같은 가족이다", () => {
    // 이 탭과 헤더의 `spec` 뷰 탭은 **같은 44px 층에 24px 간격으로** 서고, 글자도 켜짐도
    // 같다. 정본이 둘의 반지름·글자 크기·굵기를 맞추고 높이만 2px 낮춘 이유가 그것이다.
    // 처음에는 없어진 헤더 [소스] 토글의 규격(h-6 · radius 8 · 12.5px)을 물려받고 있었는데,
    // 그것은 **토글의 규격이지 탭의 규격이 아니다.**
    const tab = render(true).match(/<button[^>]*class="([^"]*)"[^>]*>spec</)?.[1] ?? "";
    expect(tab).not.toBe("");
    expect(tab).toContain("rounded-[9px]");
    expect(tab).toContain("text-[13px]");
    expect(tab).toContain("font-medium");
  });

  it("보이지 않는 탭도 함께 마운트돼 있다", () => {
    const markup = render(true);
    // info 탭은 지금 안 보이지만 마크업에 있다. 언마운트하면 메타를 보고 spec으로
    // 돌아왔을 때 접어둔 판이 펴져 있다 (결정 13).
    expect(markup).toContain("feat/some-work");
    // 안 보이는 탭이 하나다 — `cn`이 display 충돌을 정리해 `contents`가 `hidden`으로 접힌다.
    expect(markup.match(/class="hidden"/g)).toHaveLength(1);
  });

  it("탭 껍데기가 패널 카드의 flex 컨텍스트를 통과시킨다", () => {
    // 지켜야 할 불변조건은 "SpecSection이 조각을 돌려준다"가 아니라 **"스크롤 영역이
    // 패널 카드의 직계 flex 자식이어야 한다"**이다. 탭 내용을 평범한 div로 감싸면
    // flex-1의 기준이 카드에서 껍데기로 옮겨가 카드의 넘침 감춤에 트리가 잘리는데,
    // 마크업만 보면 멀쩡하다. display:contents가 그 통과를 맡는다.
    const markup = render(true);
    expect(markup.match(/class="contents"/g)).toHaveLength(1);
    // 통과시키는 것만으로는 모자라다 — 받는 쪽이 그 자리를 차지해야 트리가 스크롤한다.
    // 둘 중 하나만 빠져도 트리가 내용 높이만큼 늘어나 카드에 잘린다.
    const scrollBox = markup.match(/<div class="([^"]*\boverflow-y-auto\b[^"]*)"/)?.[1] ?? "";
    expect(scrollBox).toMatch(/\bflex-1\b/);
    expect(scrollBox).toMatch(/\bmin-h-0\b/);
  });

  it("탭 바 오른쪽 끝에서 패널을 닫는다", () => {
    expect(render(true)).toMatch(/aria-label="작업 패널 접기"/);
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
    // ""가 null이 되지 않아 정보 탭은 `base !== null`이 참이라 **뒤에 아무것도 없는 →
    // 글리프만** 그린다. 같은 값을 ⓘ 팝오버는 truthy로 봐서 꼬리를 안 그리므로,
    // 한 값이 두 화면에서 다르게 읽힌다. 값을 정하는 이 한 곳에서 `||`로 접는다.
    const empty = render(true, oneProject, [project("atelier", "")]);
    expect(empty).toContain("trees/atelier/");
    // 등록은 돼 있다 — "알 수 없다"는 다른 사실이라 여기서 나오면 안 된다
    expect(empty).not.toContain("알 수 없다");
    expect(empty).not.toContain("font-mono text-[12px] text-tertiary");
    // 같은 자리에 진짜 base가 오면 그 줄이 선다 — 위 부재가 "원래 없는 줄"이 아님을 못 박는다
    expect(render(true, oneProject, [project("atelier", "develop")])).toContain(
      "font-mono text-[12px] text-tertiary",
    );
  });

  it("목록이 왔는데 그 프로젝트가 없으면 등록이 사라진 것이다", () => {
    // 프로젝트를 지워도 그것을 쓰는 작업은 남는다. 로딩 중(위 테스트)과 **다른 말**을
    // 해야 하고, 그러라고 값이 둘로 갈려 내려간다.
    expect(render(true, oneProject, [])).toContain("알 수 없다");
  });

  it("트리 위 Spec 소제목이 없다", () => {
    // 바로 위 탭 버튼이 이미 spec이라 같은 말이 두 줄 연달아 나온다 (결정 23)
    expect(render(true)).not.toMatch(/>Spec</);
  });
});

// `</>`는 **왼쪽 본문**을 바꾸는데 오른쪽 패널 머리행에 앉는다 (결정 6). 그래서 이 seam이
// 보는 것은 "무엇을 바꾸는가"가 아니라 **버튼이 받은 두 값을 그대로 그리는가**다 —
// 본문과 켜짐이 같은 식에서 나오는지는 화면(WorksPage) 쪽에서 본다.
describe("WorkPanel 소스 토글", () => {
  beforeEach(stubEmptyStorage);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const LABEL = 'aria-label="마크다운 원문 보기"';

  // 여는 태그만 잘라낸다 — 클래스와 속성을 함께 봐야 "꺼짐 어휘"와 "잠김"이 갈린다
  function toggle(markup: string): string {
    return markup.match(new RegExp(`<button[^>]*${LABEL}[^>]*>`))?.[0] ?? "";
  }

  it("탭 바 오른쪽 끝, ×보다 왼쪽에 선다", () => {
    const markup = render(true);
    // 자리를 못 박는 이유: `</>`가 ×보다 오른쪽으로 가면 창을 닫는 버튼이 안쪽으로 밀려
    // 다른 패널들의 × 위치와 어긋난다. 오른쪽 끝은 창을 닫는 자리다.
    const source = markup.indexOf(LABEL);
    const close = markup.indexOf('aria-label="작업 패널 접기"');
    expect(source).toBeGreaterThan(-1);
    expect(close).toBeGreaterThan(source);
    // 순서만으로는 모자라다. 오른쪽 끝으로 밀어내는 것은 ml-auto인데 그것이 ×로 옮겨가면
    // 둘의 순서는 그대로인 채 `</>`만 `정보` 옆에 붙는다 — 마크업 순서로는 안 보인다.
    expect(toggle(markup)).toContain("ml-auto");
    expect(markup.slice(close)).not.toContain("ml-auto");
    // 글리프는 `</>` 하나뿐이다 — Code(꺾쇠 둘)와 달리 CodeXml만 슬래시를 가진다
    expect(markup).toMatch(/lucide-code-xml\b/);
  });

  it("예쁜 보기에서는 꺼져 있고 누를 수 있다", () => {
    const button = toggle(render(true));
    expect(button).toContain('aria-pressed="false"');
    expect(button).not.toMatch(/\sdisabled=""/);
    expect(button).toContain("quiet-hover");
  });

  it("소스 보기에서는 기존 켜짐 어휘를 그대로 쓴다", () => {
    const button = toggle(render(true, {}, undefined, { on: true, locked: false }));
    expect(button).toContain('aria-pressed="true"');
    expect(button).toContain("toggle-on");
    // 켜짐과 quiet-hover가 한 요소에 겹치면 hover 규칙이 두 벌이 되어 유틸리티 정렬
    // 순서가 승자를 정한다 (index.css의 quiet-hover 주석). 꺼진 가지 안에만 둘 것.
    //
    // 규격도 icon-button **맨몸**이어야 한다. icon-button-quiet은 quiet-hover를 품고
    // 있어서 겹침이 클래스 이름 안으로 숨는다 — 위 검사만으로는 그것이 통과한다.
    expect(button).not.toContain("quiet-hover");
    expect(button).not.toContain("icon-button-quiet");
  });

  it("잠기면 흐려지고 눌리지 않는다", () => {
    // 비-md 파일은 토글과 무관하게 코드뷰로 고정된다 (결정 6·21). 흐리게만 하고
    // disabled를 빠뜨리면 눌리는데 아무 일도 없는 오늘 그대로다 — 둘을 함께 본다.
    const button = toggle(render(true, {}, undefined, { on: false, locked: true }));
    expect(button).toMatch(/\sdisabled=""/);
    expect(button).toContain("disabled:pointer-events-none");
    expect(button).toMatch(/disabled:opacity-\d+/);
  });

  it("잠김이 켜짐을 만들지 않는다", () => {
    // 잠김과 켜짐은 **독립이다.** 비-md 파일도 본문은 코드뷰이므로 "본문이 소스니까
    // 켜진 것"으로 그리고 싶어지는데, 그러면 트리에서 md와 비-md를 오갈 때마다 누른 적도
    // 없는 버튼이 저 혼자 켜졌다 꺼진다. 잠김을 말하는 것은 흐림이지 켜짐이 아니다.
    const button = toggle(render(true, {}, undefined, { on: false, locked: true }));
    expect(button).toContain('aria-pressed="false"');
    expect(button).not.toContain("toggle-on");
  });

  it("켜 둔 채 잠기면 켜짐이 유지된다", () => {
    // 반대 방향도 못 박는다 — 잠김이 켜짐을 **끄지도** 않는다. 사람이 켜 둔 값은
    // 비-md 파일을 스쳐도 그대로여야 다시 md로 돌아왔을 때 소스 보기가 살아 있다.
    const button = toggle(render(true, {}, undefined, { on: true, locked: true }));
    expect(button).toContain('aria-pressed="true"');
    expect(button).toContain("toggle-on");
    expect(button).toMatch(/\sdisabled=""/);
  });
});

// 이 패널은 화면 머리행과 **같은 층의 옆 컬럼**이다 — 창 맨 위에서 시작해 아래까지 내려온다.
// 그래서 탭 행이 브레드크럼과 같은 높이에 서야 두 층이 한 줄로 읽힌다.
describe("WorkPanel 머리행", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("탭 행이 타이틀바 높이를 그대로 읽는다", () => {
    // 값을 손으로 적으면(h-11 같은 것) 타이틀바 높이가 바뀔 때 이 줄만 남아 어긋난다.
    // 두 층이 어긋난 것은 화면을 열어 보기 전에는 드러나지 않는다.
    expect(render(true)).toContain("h-(--titlebar-height)");
  });

  it("떠 있는 카드가 아니라 왼쪽 경계선을 가진 컬럼이다", () => {
    // 전체 높이를 차지하는 surface라 둥근 모서리와 바깥 여백이 설 자리가 없다 —
    // 창 위·아래 끝에서 카드가 잘린 것처럼 보인다. 본문과의 구분은 경계선 하나가 맡는다.
    const markup = render(true);
    expect(markup).toContain("border-l");
    expect(markup).not.toContain("rounded-[16px]");
  });
});

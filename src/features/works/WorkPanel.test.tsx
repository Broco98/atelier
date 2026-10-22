import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkPanel, { type PanelView } from "./WorkPanel";
import type { WorkView } from "./types";
import { specDocs, workFixture } from "./work-fixture";

// 이 컴포넌트는 작업 패널 **카드 안**(고른 칸의 이름과 그 칸의 할 일을 든 머리, 그리고 몸)을 그린다. 바깥 상자(두 번째 `aside`) ·
// 카드 · 틈 · 폭 손잡이 · 접힘은 공용 틀의 패널 칸이 들어(ui-refresh 결정 27) 그 단언은 화면을 통째로 그리는 `WorksPage.test.tsx`에
// 있다. 칸을 고르고 여닫는 자리(레일 · 패널 토글)도 패널 밖이라 그쪽에 있다(ui-refresh 결정 9 · 10).
//
// 몸은 `spec` · `files` 둘이다 — `info` 몸을 걷었다(codex-ds 결정 25: 보기는 호버 카드가, 복사 · Finder 열기는 work 메뉴가 든다).
// files 몸(git-integration 판 01)은 워크트리 트리를 스스로 조회하므로 프로바이더를 세운다 — 정적 렌더는 이펙트를 돌리지 않아
// 요청은 나가지 않는다.

const work: WorkView = workFixture(specDocs(["overview.md"]));

// `view`는 레일에서 고른 칸이다 — 그 값의 주인은 화면(`WorksPage`)이고 이 컴포넌트는 받은 대로 그린다. 맨 **뒤에** 두는 것은
// 기본값이 있어 기존 호출이 바뀌지 않게 하려는 것이다.
function render(open: boolean, override: Partial<WorkView> = {}, view: PanelView = "spec"): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <WorkPanel
        work={{ ...work, ...override }}
        view={view}
        currentFile={null}
        onSelectFile={() => {}}
        currentCode={null}
        onPressCode={() => {}}
        onCopy={() => {}}
        onOpenFolder={() => {}}
        open={open}
      />
    </QueryClientProvider>,
  );
}

/**
 * 카드 머리 — 고른 칸의 이름과 그 칸의 할 일이 서는 줄. 머리 안에 상자가 겹쳐 서서(끝 묶음) 짝이 맞는 `</div>`까지 깊이를 센다.
 */
function headOf(markup: string): string {
  const open = markup.search(/<div data-slot="card-head"/);
  if (open < 0) return "";
  const tags = /<div\b|<\/div>/g;
  tags.lastIndex = open;
  let depth = 0;
  for (let tag = tags.exec(markup); tag; tag = tags.exec(markup)) {
    depth += tag[0] === "</div>" ? -1 : 1;
    if (depth === 0) return markup.slice(open, tag.index + tag[0].length);
  }
  return "";
}
/** 몸의 상자 — 안 보이는 몸은 `hidden`과 `inert`를 단다. 몸의 표식(`data-panel-view`)으로 집는다. */
const bodyTag = (markup: string, view: string) =>
  markup.match(new RegExp(`<div[^>]*data-panel-view="${view}"[^>]*>`))?.[0] ?? "";

function stubEmptyStorage() {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
}

// 칸을 바꾸는 것 자체(클릭)는 여기서 볼 수 없다 — 이 seam은 정적 마크업이라 이벤트가 돌지 않는다(칸이 둘인 레일의 누름과 안 보이는
// 몸의 숨김은 L3 `rail.spec.ts`가 진열대로 잰다). 대신 **받은 칸으로 그린 구조**를 못 박는다: 머리가 그 칸의 이름과 할 일인가, 몸이
// 하나이고 보이는가, 스크롤 경계가 여전히 패널 카드에 있는가. 「spec 폴더 열기」가 무엇을 부르는지는 L3(`works-floating.spec.ts`)가,
// 머리 제목의 글자와 자리(DS 패널 머리 제목)는 L3(`frame.spec.ts`)가 칠해진 값으로 잰다.
describe("WorkPanel 머리와 몸", () => {
  beforeEach(stubEmptyStorage);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("머리는 고른 칸의 이름 `spec`과 그 칸의 할 일(spec 폴더 열기) 하나다 — 탭도 닫는 `×`도 없다", () => {
    // ui-refresh 결정 9 · 10. 칸을 고르는 자리(레일)와 여닫는 자리(패널 토글)가 패널 밖으로 나갔다 — 머리에 탭이나 `×`가
    // 남으면 같은 일을 하는 컨트롤이 한 화면에 둘이 된다. 할 일은 codex-ds 스펙 §6 「작업 패널」의 spec 폴더 열기다.
    const head = headOf(render(true));
    expect(head, "패널 머리를 찾지 못했다").not.toBe("");
    expect(head).toMatch(/>spec</);
    expect(head.match(/<button[^>]*>/g) ?? []).toEqual([expect.stringContaining('aria-label="spec 폴더 열기"')]);
    const markup = render(true);
    expect(markup).not.toMatch(/role="tab/);
    expect(markup).not.toMatch(/aria-selected/);
    expect(markup).not.toContain('aria-label="작업 패널 접기"');
    // 라벨은 **소문자 영어다**(결정 41) — 탭 줄의 `spec`과 한 가족이다.
    expect(head).not.toMatch(/>정보</);
    expect(head).not.toContain("문서");
  });

  it("`shell` 칸이 없다 — 셸을 고르는 자리는 탭 줄이다", () => {
    // 결정 71. 되살아나면 **같은 것을 두 자리에서 고르게 되고**, 화면으로는 둘 다 멀쩡해
    // 보여서 어느 쪽이 지금인지가 안 드러난다. 앞 판이 가로 탭 줄에서 겪은 그 병이다.
    const markup = render(true);
    expect(markup).not.toMatch(/<button[^>]*>shell</);
    expect(markup).not.toContain('aria-label="셸 열기"');
  });

  it("몸은 `spec` · `files` 둘이다 — `info` 몸과 그 프로젝트 · 워크트리 칸이 없다", () => {
    // codex-ds 결정 25. info의 보기는 사이드바 행의 호버 카드가(프로젝트마다 base · 변경 있음), 복사 · Finder 열기는 work 메뉴가
    // 든다 — 같은 정보를 두 자리에서 보지 않는다. files 몸은 spec 뒤에 선다(git-integration 결정 29).
    const markup = render(true, {
      projects: ["atelier"],
      worktrees: [{ project: "atelier", path: "~/.atelier/works/some-work/trees/atelier", exists: true, dirty: false }],
    });
    expect(markup.match(/data-panel-view="([^"]+)"/g)).toEqual(['data-panel-view="spec"', 'data-panel-view="files"']);
    expect(markup).not.toContain("trees/atelier");
    expect(markup).not.toContain("프로젝트 상세로 이동");
    expect(markup).toContain(">overview.md<");
  });

  it("보이지 않는 몸도 함께 마운트돼 있고, `hidden` · `inert`로 가려진다", () => {
    // files 몸은 지금 안 보이지만 마크업에 있다(git-integration 판 01) — 숨은 동안에도 마운트돼 있어 접힘을 든다. 트리를 묻는
    // 것은 보일 때뿐이다(L3). 언마운트하면 files를 보고 spec으로 돌아왔을 때 접어둔 판이 펴져 있다(결정 9·13).
    const spec = render(true);
    expect(bodyTag(spec, "spec")).not.toBe("");
    expect(bodyTag(spec, "spec")).not.toMatch(/\b(hidden|inert)=/);
    expect(bodyTag(spec, "files")).toMatch(/\bhidden=""/);
    expect(bodyTag(spec, "files")).toMatch(/\binert=""/);
    // 반대쪽 — files를 고르면 spec 몸이 가려지고, 트리는 여전히 마운트돼 있다.
    const files = render(true, {}, "files");
    expect(files).toContain("overview.md");
    expect(bodyTag(files, "spec")).toMatch(/\bhidden=""/);
    expect(bodyTag(files, "spec")).toMatch(/\binert=""/);
    expect(bodyTag(files, "files")).not.toMatch(/\b(hidden|inert)=/);
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

// 문서/원문 전환은 **이 패널에 없다**(ui-refresh 판 04) — 바꾸는 것이 왼쪽 문서라 문서 쪽(지금은 문서 위 경로 줄)으로 갔다. 한때
// 이 패널 머리행에 앉아 「본문을 바꾸는 유일한 컨트롤」이었는데, 그것이 남아 있으면 같은 일을 하는 버튼이 한 화면에 둘이 된다.
// 경로 줄 쪽 단언은 `WorksPage.test.tsx`에, 두 칸이 받은 값을 그대로 그리는가는 부품의 검사(`PathBar.test.tsx`)에 있다.
describe("WorkPanel 소스 토글", () => {
  beforeEach(stubEmptyStorage);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("원문 전환이 패널에 없다", () => {
    const markup = render(true);
    expect(markup).not.toContain('aria-label="원문 보기"');
    expect(markup).not.toContain('aria-label="문서로 보기"');
    // 머리에 남는 것은 고른 칸의 이름이다 — 이것이 없으면 위 부재가 「머리가 통째로 안 섰다」로도 초록이다.
    expect(headOf(markup)).toMatch(/>spec</);
  });
});

// 이 패널은 머리 줄 아래에 뜬 카드다(ui-refresh 결정 4) — 머리는 다른 카드와 같은 카드 머리(46px — `--card-head`)다.
describe("WorkPanel 머리행", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("머리 행이 카드 머리 높이를 그대로 읽는다", () => {
    // 값을 손으로 적으면(h-12 같은 것) 카드 머리 높이가 바뀔 때 이 줄만 남아 옆 문서 카드의 머리와 어긋난다.
    // 머리는 카드 안이라 창을 끄는 자리가 아니다 — 그 일은 머리 줄과 회색 틈이 한다.
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

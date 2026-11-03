import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkPanel from "./WorkPanel";
import type { WorkView } from "./types";
import { specDocs, workFixture } from "./work-fixture";

// 이 컴포넌트는 spec 패널 **카드 안**(이름 `spec`과 그 할 일을 든 머리, 그리고 spec 트리)을 그린다. 바깥 상자(`aside`) · 카드 · 틈 · 폭
// 손잡이 · 접힘은 앱 셸의 작업공간 도구 기둥이 든다(`WorkTools` — restart 02a-14, 그 단언은 `WorkTools.test.tsx`에 있다). 여닫는 자리(레일 ·
// 패널 토글)도 패널 밖이다(ui-refresh 결정 9 · 10).
//
// 몸은 spec 트리 하나다 — `files` 몸을 걷었다(restart 02a-14 — 워크트리 파일은 넓힌 카드의 Project 트리에서 연다, 02a-12). 그 앞에 `info`
// 몸을 걷었다(codex-ds 결정 25: 보기는 호버 카드가, 복사 · Finder 열기는 work 메뉴가 든다).

const work: WorkView = workFixture(specDocs(["overview.md"]));

// 패널이 열렸는지는 받지 않는다 — 닫혀도 몸은 접힌 상자 안에 그대로라(기둥) 그릴 것이 같다.
function render(override: Partial<WorkView> = {}): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <WorkPanel
        work={{ ...work, ...override }}
        currentFile={null}
        onSelectFile={() => {}}
        onCopy={() => {}}
        onOpenFolder={() => {}}
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
function stubEmptyStorage() {
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
}

// **그린 구조**를 못 박는다: 머리가 이름 `spec`과 그 할 일인가, 몸이 spec 트리 하나인가, 스크롤 경계가 여전히 패널 카드에 있는가.
// 「spec 폴더 열기」가 무엇을 부르는지는 L3(`works-floating.spec.ts`)가, 머리 제목의 글자와 자리(DS 패널 머리 제목)는 L3(`frame.spec.ts`)가
// 칠해진 값으로 잰다.
describe("WorkPanel 머리와 몸", () => {
  beforeEach(stubEmptyStorage);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("머리는 이름 `spec`과 그 할 일(spec 폴더 열기) 하나다 — 탭도 닫는 `×`도 없다", () => {
    // ui-refresh 결정 9 · 10. 칸을 고르는 자리(레일)와 여닫는 자리(패널 토글)가 패널 밖으로 나갔다 — 머리에 탭이나 `×`가
    // 남으면 같은 일을 하는 컨트롤이 한 화면에 둘이 된다. 할 일은 codex-ds 스펙 §6 「작업공간 패널」의 spec 폴더 열기다.
    const head = headOf(render());
    expect(head, "패널 머리를 찾지 못했다").not.toBe("");
    expect(head).toMatch(/>spec</);
    expect(head.match(/<button[^>]*>/g) ?? []).toEqual([expect.stringContaining('aria-label="spec 폴더 열기"')]);
    const markup = render();
    expect(markup).not.toMatch(/role="tab/);
    expect(markup).not.toMatch(/aria-selected/);
    expect(markup).not.toContain('aria-label="작업공간 패널 접기"');
    // 라벨은 **소문자 영어다**(결정 41) — 탭 줄의 `spec`과 한 가족이다.
    expect(head).not.toMatch(/>정보</);
    expect(head).not.toContain("문서");
  });

  it("`shell` 칸이 없다 — 셸을 고르는 자리는 탭 줄이다", () => {
    // 결정 71. 되살아나면 **같은 것을 두 자리에서 고르게 되고**, 화면으로는 둘 다 멀쩡해
    // 보여서 어느 쪽이 지금인지가 안 드러난다. 앞 판이 가로 탭 줄에서 겪은 그 병이다.
    const markup = render();
    expect(markup).not.toMatch(/<button[^>]*>shell</);
    expect(markup).not.toContain('aria-label="셸 열기"');
  });

  it("몸은 spec 트리 하나다 — files 몸(워크트리 트리 · 새로고침)도 `info` 몸도 없다", () => {
    // restart 02a-14 — 레일의 files 칸이 걷혔다. 워크트리 파일은 넓힌 카드의 Project 트리에서 열고(바뀌지 않은 파일은 파일 탭 — 02a-12),
    // 이 패널이 다시 files 몸을 들면 같은 트리를 두 자리에서 고르게 된다. codex-ds 결정 25 — info의 보기는 사이드바 행의 호버 카드가,
    // 복사 · Finder 열기는 work 메뉴가 든다.
    const markup = render({
      projects: ["atelier"],
      worktrees: [{ project: "atelier", path: "~/.atelier/works/some-work/trees/atelier", exists: true, dirty: false }],
    });
    expect(markup).not.toContain("data-panel-view");
    expect(markup).not.toContain("data-files-tree");
    expect(markup).not.toContain('aria-label="새로고침"');
    expect(markup).not.toContain("trees/atelier");
    expect(markup).not.toContain("프로젝트 상세로 이동");
    expect(markup).toContain(">overview.md<");
  });

  it("스크롤 영역이 패널 몸의 직계 flex 자식으로 남는 높이를 차지한다", () => {
    // 지켜야 할 불변조건은 **"스크롤 영역이 패널 카드의 직계 flex 자식이어야 한다"**이다. 한 겹 감싸면 flex-1의 기준이 카드에서 껍데기로
    // 옮겨가 카드의 넘침 감춤에 트리가 잘리는데, 마크업만 보면 멀쩡하다. 몸의 뿌리는 기둥의 자리(`contents`)를 지나 패널 카드의 직계다.
    const markup = render();
    const root = markup.match(/^<div class="([^"]*)">/)?.[1] ?? "";
    expect(root.split(" ")).toEqual(expect.arrayContaining(["flex", "min-h-0", "flex-1", "flex-col"]));
    // 머리 다음 형제가 곧 스크롤 영역이다 — 그 사이에 상자가 끼지 않는다.
    const afterHead = markup.slice(markup.indexOf(headOf(markup)) + headOf(markup).length);
    const scrollBox = afterHead.match(/^<div class="([^"]*)"/)?.[1] ?? "";
    expect(scrollBox).toMatch(/\boverflow-y-auto\b/);
    expect(scrollBox).toMatch(/\bflex-1\b/);
    expect(scrollBox).toMatch(/\bmin-h-0\b/);
  });

  it("트리 위 Spec 소제목이 없다", () => {
    // 바로 위 머리 제목이 이미 spec이라 같은 말이 두 줄 연달아 나온다 (결정 23)
    expect(render()).not.toMatch(/>Spec</);
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
    const markup = render(layered);
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
    const markup = render({ ...layered, specTree: { ...layered.specTree!, fallback: reason } });
    expect(markup).not.toContain(reason);
    expect(markup).toContain(">overview.md<");
  });

  it("spec 트리가 비면 아직 파일이 없다고 말한다", () => {
    expect(render(specDocs([]))).toContain("아직 spec 파일이 없어요");
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
    const markup = render();
    expect(markup).not.toContain('aria-label="원문 보기"');
    expect(markup).not.toContain('aria-label="문서로 보기"');
    // 머리에 남는 것은 고른 칸의 이름이다 — 이것이 없으면 위 부재가 「머리가 통째로 안 섰다」로도 초록이다.
    expect(headOf(markup)).toMatch(/>spec</);
  });
});

// 이 패널은 머리 줄 아래에 뜬 카드다(ui-refresh 결정 4). 안의 규격은 시안 Shell 「spec 패널」 · Main `.ra-phead` · `.ra-pbody` ·
// `.ra-tree-row`다(restart 03-12a — report 02a-17 「spec 패널 안」): 머리 40 · 안쪽 왼 14 · 오 8, 끝 단추 24 · 글리프 14, 몸 안쪽 0 6 8, 행은
// 촘촘한 트리 행(24 · 둥글기 4 · 사이 2 · 들여쓰기 8 + 깊이 × 12 · 확장자 글자). 한때 카드 머리 46(`--card-head`) · 제목 카드 + 16 · 행 28 ·
// 둥글기 10이었다.
describe("WorkPanel 머리행", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("머리는 40 · 제목이 카드 + 14이고, 끝 단추는 24 · 글리프 14다", () => {
    // 머리는 카드 안이라 창을 끄는 자리가 아니다 — 그 일은 머리 줄과 회색 틈이 한다.
    const head = headOf(render());
    const open = head.match(/^<div[^>]*>/)?.[0] ?? "";
    expect(open).toMatch(/\bh-10\b/);
    expect(open).toMatch(/\bpl-3\.5\b/);
    expect(open).toMatch(/\bpr-2\b/);
    expect(head).not.toContain("h-(--card-head)");
    expect(head).not.toContain("data-tauri-drag-region");
    const title = head.match(/<span[^>]*>spec<\/span>/)?.[0] ?? "";
    expect(title, "제목").not.toMatch(/\bpx-/);
    const button = head.match(/<button[^>]*>/)?.[0] ?? "";
    expect(button).toMatch(/\bicon-button-xs\b/);
    expect(head).toMatch(/<svg[^>]*class="[^"]*size-3\.5/);
  });

  it("몸은 안쪽 0 6 8이고 트리는 촘촘한 행이다", () => {
    const markup = render();
    expect(markup).toMatch(/class="[^"]*\bpx-1\.5\b[^"]*\bpb-2\b[^"]*"/);
    // 촘촘한 행(`TreeRows`의 `dense`) — 24 · 둥글기 4. 28 · 둥글기 10(`h-7` · `rounded-lg`)의 파일 행이 남지 않는다.
    const row = markup.match(/<div[^>]*data-spec-file="overview\.md"[^>]*><div class="([^"]*)"/)?.[1] ?? "";
    expect(row, "overview.md 행").toMatch(/\bh-6\b/);
    expect(row).toMatch(/\brounded-ctl\b/);
  });

  it("왼쪽 경계선이 없다 — 문서와의 구분은 틈이 맡는다", () => {
    // ui-refresh 결정 4로 **뒤집혔다**: 한때 창 끝에서 끝까지 가는 컬럼이라 경계선 하나가 본문과 갈랐는데, 이제 패널은
    // 바탕 위에 뜬 둥근 카드이고(그 카드는 공용 틀이 그린다 — `WorksPage.test.tsx`) 사이 틈이 구분을 맡는다.
    expect(render()).not.toContain("border-l");
  });
});

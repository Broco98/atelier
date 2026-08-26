/// <reference types="node" />
// 소스 스캔 한 건 때문에 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorksPage, { togglesWorkPanel } from "./WorksPage";
import { worksQuery } from "./hooks";
import type { WorkView } from "./types";
import type { SplitSide, ViewTab } from "@/routes/-work-search";
// 셸 목록이 패널로 오면서(결정 42) 이 화면이 터미널 스토어를 조립한다. 그 배선은 상태를
// 손으로 넣어야 보이므로 여기서 스토어를 직접 만진다 — **모듈 싱글턴이라 비우고 나간다.**
import { MAX_SHELLS, NO_SHELLS, openShell, shellCapNotice } from "@/features/terminal/shell-registry";
import {
  ensureShell,
  onShellOpenRejected,
  openNewShell,
  terminalStore,
} from "@/features/terminal/terminal-store";

// 헤더의 여는 아이콘은 **패널이 닫혔을 때만** 뜬다 — 여는 길과 닫는 길이 각각 하나다.
// 그 판단이 뒤집히면 닫는 길이 둘이 되는데, 화면을 열어 보기 전에는 드러나지 않는다.
//
// 이 화면은 작업 하나가 골라져 있어야 헤더 우측이 그려진다. 조회를 가로채는 대신
// 쿼리 캐시에 목록을 미리 넣어 둔다 — 정적 렌더는 이펙트를 돌리지 않으므로 IPC는 나가지
// 않고, 캐시에 있는 값은 그대로 읽힌다.
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
  specFiles: [],
};

// 이 화면의 소스를 문자열로 읽는다. 렌더로 볼 수 없는 불변조건(이펙트·리마운트 자리)이
// 여기 걸리고, 그 방식은 이 저장소가 파일 간 계약에 쓰는 것과 같다
// (state-scale.test.ts · theme-tokens.test.ts · tauri-commands.test.ts).
function source(file: "WorksPage.tsx" | "SpecViewer.tsx" | "../terminal/terminal-store.ts"): string {
  return readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), "utf8");
}

// 리터럴이 **몇 번** 나오는가. 파싱이 필요 없어 파서가 샐 자리가 없다 —
// 개수가 달라지면 반드시 빨개진다(shell-registry.test.ts가 같은 것을 쓴다).
const countOf = (text: string, literal: string) => text.split(literal).length - 1;

function render(
  overrides: Partial<WorkView> = {},
  tab: ViewTab = "spec",
  split: SplitSide | null = null,
): string {
  const client = new QueryClient();
  client.setQueryData(worksQuery.queryKey, [{ ...work, ...overrides }]);
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <WorksPage
        sidebarOpen
        selectedSlug={work.slug}
        currentFile={null}
        onSelectFile={() => {}}
        onOpenProject={() => {}}
        tab={tab}
        onSelectTab={() => {}}
        split={split}
        onSelectSplit={() => {}}
        onDropInto={() => {}}
      />
    </QueryClientProvider>,
  );
}

describe("WorksPage 헤더의 여는 아이콘", () => {
  beforeEach(() => {
    // 작업 패널이 폭을 여기서 읽는다
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("패널이 열려 있으면 헤더에 여는 아이콘이 없다", () => {
    // 첫 화면은 패널이 열린 상태다 (WorksPage의 workPanelOpen 초기값)
    const markup = render();
    expect(markup).toMatch(/aria-label="작업 패널 접기"/); // 닫는 길은 패널 안 ×
    expect(markup).not.toMatch(/aria-label="작업 패널 펼치기"/);
  });

  it("헤더에 늘 보이는 패널 토글이 없다", () => {
    // 늘 보이는 토글을 두면 닫는 길이 둘이 된다. 패널이 열려 있으면 헤더 우측은
    // **아예 비어 있다** — [소스]는 패널 머리행으로 갔고(결정 6), 목록 글리프는 이
    // 화면에서 완전히 사라졌다(정보 탭이 생기면 이 패널은 더는 "작업 목록"이 아니다).
    //
    // 여는 아이콘이 PanelRight인지는 이 seam에서 볼 수 없다: 정적 렌더로 패널이 닫힌
    // 상태를 만들 길이 없다(접기 state가 이 컴포넌트 안에 살고 여는 길은 클릭뿐이다).
    // 글리프 자체는 실물로 짚는다.
    expect(render()).not.toMatch(/lucide-list\b/);
  });

  it("헤더에 프로젝트 칩이 없고, 상태 배지와 ⋯는 그대로 있다", () => {
    // 칩은 정보 탭으로 갔다 — 그 프로젝트의 base·워크트리와 한 덩어리로 묶여야 어느 것이
    // 어느 프로젝트 것인지가 이어진다. 정보 탭 본문도 같은 화면에 마운트돼 있으므로
    // (두 탭 동시 마운트) 이름을 세는 것으로는 안 되고 **헤더 안에서만** 본다.
    const markup = render({
      projects: ["atelier"],
      worktrees: [
        {
          project: "atelier",
          path: "~/.atelier/works/some-work/trees/atelier",
          exists: true,
          dirty: false,
        },
      ],
    });
    const header = markup.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
    expect(header).not.toBe("");
    expect(header).not.toContain("atelier");
    // 상태 배지와 ⋯는 남는다 — 자주 누르는 조작이라 탭 뒤에 숨기면 클릭이 두 번 든다
    expect(header).toContain("active");
    expect(header).toMatch(/aria-label="작업 메뉴"/);
    // 그리고 프로젝트 덩어리는 정보 탭에 있다
    expect(markup).toContain("trees/atelier/");
  });
});

// 여기가 이 판에서 유일하게 **본문과 토글을 한 화면에서** 보는 자리다.
// WorksPage → SpecViewer → WorkPanel 셋이 다 도므로, **버튼만 패널로 가고 주인은
// 화면(WorksPage)에 있는** 배선이 실제로 이어졌는지가 드러난다 (결정 6·49).
describe("WorksPage 소스 토글이 패널 머리행으로 갔다", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const LABEL = 'aria-label="마크다운 원문 보기"';

  function toggle(markup: string): string {
    return markup.match(new RegExp(`<button[^>]*${LABEL}[^>]*>`))?.[0] ?? "";
  }

  it("헤더에 [소스] 버튼이 없다", () => {
    const header = render({ specFiles: ["overview.md"] }).match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
    expect(header).not.toBe("");
    expect(header).not.toContain("소스");
  });

  it("토글은 작업 패널 안에 있다", () => {
    const markup = render({ specFiles: ["overview.md"] });
    const header = markup.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
    expect(markup).toContain(LABEL);
    // 헤더에 남아 있으면 이 판이 옮긴 것이 아무것도 없는 것이다
    expect(header).not.toContain(LABEL);
  });

  it("마크다운 문서에서는 예쁜 보기이고 토글이 살아 있다", () => {
    const markup = render({ specFiles: ["overview.md"] });
    expect(markup).not.toContain("[tab-size:4]"); // 소스 보기의 코드 상자
    expect(toggle(markup)).not.toMatch(/\sdisabled=""/);
  });

  it("비-md 문서를 열면 본문이 코드뷰로 고정되고 토글이 잠긴다", () => {
    // 본문과 버튼을 **함께** 본다. 하나만 보면 "코드뷰인데 버튼은 멀쩡히 살아 있다"는
    // 바로 그 어긋남(결정 21)이 통과한다.
    const markup = render({ specFiles: ["diagram.puml"] });
    expect(markup).toContain("[tab-size:4]");
    const button = toggle(markup);
    expect(button).toMatch(/\sdisabled=""/);
    // 그런데 **켜지지는 않는다.** 아무도 누르지 않았기 때문이다 — 파일을 여는 것만으로
    // 토글이 켜지면 트리를 훑는 동안 버튼이 저 혼자 깜빡인다. 잠김은 흐림이 말한다.
    expect(button).toContain('aria-pressed="false"');
    expect(button).not.toContain("toggle-on");
  });

  it("spec 문서가 하나도 없으면 토글이 잠긴다", () => {
    // 본문이 "아직 spec이 없어요"에 고정이라 눌러도 아무 일이 없다 — 결정 21이 없애려는
    // 바로 그 어긋남이다. 비-md 파일보다 **먼저** 만나는 화면이기도 하다: 새로 만든
    // 작업은 spec이 0개이므로 항상 여기서 시작한다.
    const markup = render(); // specFiles: []가 기본값이다
    expect(markup).toContain("아직 spec이 없어요");
    const button = toggle(markup);
    expect(button).toMatch(/\sdisabled=""/);
    expect(button).toContain('aria-pressed="false"');
  });

  it("터미널 탭에서는 spec 문서가 있어도 토글이 잠긴다", () => {
    // 이 절은 **이 판이 새로 만든 보장이다.** 앞 판은 터미널 가지가 `sourceLocked`를
    // 통째로 하드코딩했는데, 결정 49로 호출부가 하나가 되면서 그 하드코딩이 사라졌다.
    // 잠그지 않으면 spec 문서가 있는 작업의 터미널 탭에서 토글이 살아나고, 본문은 셸이라
    // 눌러도 아무 일이 없다 — 결정 11·21이 없애려는 바로 그 버튼이다.
    const markup = render({ specFiles: ["overview.md"] }, "terminal");
    const button = toggle(markup);
    expect(button).not.toBe("");
    expect(button).toMatch(/\sdisabled=""/);
  });
});

// v2 디자인의 머리행 배치 — 작업 그 자체를 말하는 것(제목 · ⓘ · ⋯)은 브레드크럼에 모이고,
// 지금 무엇을 하는가(상태 · 패널)는 오른쪽 actions로 간다.
describe("WorksPage 머리행 배치", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function header(markup: string): string {
    return markup.match(/<header[\s\S]*?<\/header>/)?.[0] ?? "";
  }
  // actions는 헤더의 마지막 자식이다 (PageHeader)
  function actions(markup: string): string {
    return header(markup).match(/<div class="flex shrink-0 items-center gap-2">([\s\S]*)<\/div><\/header>/)?.[1] ?? "";
  }

  it("제목 뒤에 ⓘ가 오고, 그 뒤가 ⋯다", () => {
    const h = header(render());
    const info = h.indexOf('aria-label="작업 메타"');
    const menu = h.indexOf('aria-label="작업 메뉴"');
    expect(info).toBeGreaterThan(-1);
    expect(menu).toBeGreaterThan(info);
  });

  it("맞붙어 선 ⓘ와 ⋯가 같은 상자를 쓴다", () => {
    // 둘 사이에 여백이 없다(meta 묶음에 gap이 없다). 그래서 hover 배경이 한 버튼에서 다음
    // 버튼으로 **끊김 없이** 옮겨가고, 상자가 다르면 그 순간 배경이 커졌다 작아진다.
    // 눈으로는 "살짝 튄다"로만 보여서, 어느 쪽이 틀렸는지는 나란히 놓고 재기 전에 안 드러난다.
    // ⋯가 22px·radius 7이었던 것은 옛 이웃인 상태 배지에 맞춘 값인데, 그 배지가 오른쪽
    // actions로 가면서 맞출 상대가 24px 아이콘 버튼으로 바뀌었다.
    const h = header(render());
    const box = (label: string) =>
      h.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*class="([^"]*)"`))?.[1] ?? "";
    expect(box("작업 메타")).toMatch(/\bicon-button/);
    expect(box("작업 메뉴")).toMatch(/\bicon-button/);
    // 손으로 적은 상자 규격이 다시 들어오면 여기서 갈린다
    expect(box("작업 메뉴")).not.toMatch(/\bh-\[/);
  });

  it("상태 배지는 오른쪽 actions에 있고, ⓘ·⋯는 거기 없다", () => {
    // 배지가 브레드크럼에 남아 있으면 제목과 ⓘ 사이를 가른다 — 셋이 한 덩어리로 읽히지 않는다.
    const a = actions(render());
    expect(a).not.toBe("");
    expect(a).toContain('title="상태 변경"');
    expect(a).not.toContain('aria-label="작업 메타"');
    expect(a).not.toContain('aria-label="작업 메뉴"');
  });
});

// 뷰 탭 — `spec`과 `terminal` 둘이다(결정 9). `파일`은 별도 작업으로 빠졌다.
// 라벨이 소문자 영어인 것은 결정 41이다.
describe("WorksPage 헤더에서 뷰 탭이 걷혔다", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function actions(markup: string): string {
    return (
      markup
        .match(/<header[\s\S]*?<\/header>/)?.[0]
        .match(/<div class="flex shrink-0 items-center gap-2">([\s\S]*)<\/div><\/header>/)?.[1] ?? ""
    );
  }

  // 결정 70. 본문을 고르는 자리가 **사이드바 트리로 갔다.** 되살아나면 같은 것을 두 자리에서
  // 고르게 되고, 화면으로는 둘 다 멀쩡해 보여서 어느 쪽이 지금인지가 안 드러난다 —
  // 앞 판이 가로 탭 줄에서 겪은 그 병이다.
  it("`spec`·`terminal` 칸이 헤더에 없다", () => {
    for (const tab of ["spec", "terminal"] as const) {
      const markup = render({}, tab);
      expect(markup, tab).not.toContain('aria-label="spec 보기"');
      expect(markup, tab).not.toContain('aria-label="terminal 보기"');
    }
  });

  it("상태 배지는 남는다", () => {
    // 배지는 「어느 단계인가」라 뷰 탭과 성질이 다르다 — 자주 누르는 조작이라 헤더에 남는다.
    // 뷰 탭을 걷으면서 함께 쓸려 나가면 상태를 바꾸는 데 클릭이 두 번 든다.
    expect(actions(render())).toContain('title="상태 변경"');
  });
});

// 결정 11. 터미널 탭에도 작업 패널이 선다 — 여는 아이콘이 탭을 가리면 **눌러도 아무 일이
// 없는 버튼**이 된다. 화면으로는 "안 열리네"로만 보여서, 버튼이 있어야 할 자리에 없는 것보다
// 알아채기 어렵다.
describe("WorksPage 터미널 탭", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // **여는 아이콘은 렌더로 못 본다.** `workPanelOpen`이 false일 때만 뜻이 있는데 그 값은
  // 이 화면의 useState(초기값 true)라 정적 렌더에서 뒤집을 방법이 없다.
  it("여는 아이콘은 탭을 안 가린다", () => {
    // **패널이 닫혀 있을 때만**이고 탭은 안 본다. 두 탭 다 패널을 이고 있다.
    expect(source("WorksPage.tsx")).toMatch(/\{!workPanelOpen && \(/);
    // 한때 있던 탭 조건이 되살아나면 터미널 탭에서 다시 못 연다.
    expect(source("WorksPage.tsx")).not.toMatch(/tab === "spec" && !workPanelOpen/);
  });

  // 결정 26. **순서가 계약이다** — dirty 판정은 확인 대화가 아니라 그 뒤 코어에서 나므로,
  // 먼저 죽이면 거부당했을 때 Work는 남고 돌던 claude만 사라진다. 이것도 렌더로 못 본다
  // (네이티브 대화가 끼어 있다). 자리를 세 지점의 **순서**로 못박는다 — 문자열 하나를
  // 통째로 맞추면 줄바꿈만 바뀌어도 깨지고, 순서가 이 계약의 전부다.
  it("셸은 명령이 성공한 뒤에 거둔다", () => {
    const worksPage = source("WorksPage.tsx");
    const call = worksPage.indexOf("await call();");
    // `await` **뒤에서** 찾는다 — 같은 문구가 위쪽 주석에도 나온다(실측으로 걸렸다).
    const bail = worksPage.indexOf("return;", worksPage.indexOf("하지 못했습니다", call));
    const reap = worksPage.indexOf("closeShellsOf(work.slug)");

    expect(call, "await call()을 찾지 못했다").toBeGreaterThan(-1);
    // 실패하면 **거두지 않고 돌아간다** — 이 return이 빠지면 거부당한 Work의 셸이 죽는다.
    expect(bail, "catch에서 돌아가는 자리를 찾지 못했다").toBeGreaterThan(call);
    expect(reap, "성공 뒤 회수를 찾지 못했다").toBeGreaterThan(bail);
  });

  // 결정 102. 가로 탭 줄이 걷힌 뒤로 **본문에서 셸을 여는 길이 여기뿐이다** — 정상 종료한
  // 셸은 목록에서 스스로 빠지고(결정 48), 마지막 칸을 `×`로 닫은 자리에서는 새 셸이 저절로
  // 뜨지 않는다(판 02). 셸이 0개인 화면이 실재하고, 그때 본문이 그 자리를 내야 한다.
  //
  // **본문 안(`</main>` 앞)만 센다.** 사이드바 가지와 패널에도 같은 이름의 `+`가 있어서
  // 마크업 전체에서 세면 「본문에 있다」와 「어딘가 있다」가 같아진다.
  it("셸이 0개면 터미널 본문이 여는 자리를 낸다", () => {
    const markup = render({}, "terminal");
    const bodyEnd = markup.indexOf("</main><aside");
    expect(bodyEnd, "본문과 패널의 경계를 찾지 못했다").toBeGreaterThan(-1);
    const body = markup.slice(0, bodyEnd);
    expect(body.match(/aria-label="셸 열기"/g)).toHaveLength(1);
    // 패널이 **함께** 있다. 그 머리행의 닫는 ×로 확인한다.
    expect(markup).toContain('aria-label="작업 패널 접기"');
  });

  it("spec 본문에는 여는 자리가 아예 없다", () => {
    // 결정 71·102. 셸을 여는 자리는 사이드바 가지와 **셸 0개인 터미널 본문**뿐이다.
    // 문서를 읽는 화면에 `+`가 남아 있으면 그것이 어느 화면의 셸을 여는지가 흐려진다.
    const markup = render({}, "spec");
    expect(markup).not.toContain('aria-label="셸 열기"');
    expect(markup).toContain('aria-label="작업 패널 접기"');
  });

  // 본문이 셸이라 `</>`가 적용될 곳이 없다. 잠기지 않으면 눌러도 아무 일이 없는 버튼이 된다.
  it("터미널 탭에서는 소스 토글이 잠겨 있다", () => {
    const markup = render({}, "terminal");
    const toggle = markup.match(/<button[^>]*aria-label="마크다운 원문 보기"[^>]*>/);
    expect(toggle, "소스 토글을 찾지 못했다").not.toBeNull();
    expect(toggle![0]).toContain("disabled");
  });
});

// 패널을 여는 버튼(헤더 actions)과 닫는 ×(패널 머리행)는 **같은 화면에 함께 나오지 않는다** —
// 하나가 뜨면 다른 하나가 사라진다. 그래서 어긋나 있으면 "버튼이 튄다"로만 보이고
// 어느 쪽이 틀렸는지는 나란히 놓고 재기 전에는 드러나지 않는다. 둘이 한 마크업에 있는
// 자리는 여기뿐이라, 오른쪽 여백이 같다는 것을 여기서 못 박는다.
describe("WorksPage 여는 버튼과 닫는 ×의 오른쪽 여백", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("헤더와 패널 머리행이 같은 오른쪽 여백을 쓴다", () => {
    const markup = render();
    const header = markup.match(/<header[^>]*class="([^"]*)"/)?.[1] ?? "";
    const panelHead = markup.match(/<div data-tauri-drag-region[^>]*class="([^"]*)"/)?.[1] ?? "";
    expect(header).not.toBe("");
    expect(panelHead).not.toBe("");
    expect(header).toContain("pr-4");
    expect(panelHead).toContain("pr-4");
  });
});

// 본문 열과 작업 패널을 담는 행은 **자기도 flex 항목이라** min-w-0이 필요하다.
// 없으면 min-width가 auto가 되어 자기 min-content만큼 부풀고, 그만큼 패널이 창 밖으로
// 밀려 잘린다. 미는 양이 본문 내용에 따라 달라지기 때문에 **패널 폭이 저 혼자 바뀌는
// 것처럼 보인다** — 실제로 소스 보기를 켜고 끌 때마다 그랬다.
//
// **그 행이 이제 이 화면의 것이다**(결정 49) — 한때 SpecViewer가 들고 있었는데, 패널이
// 올라오면서 본문과 패널을 나란히 세우는 일도 함께 올라왔다.
//
// 레이아웃은 정적 마크업으로 볼 수 없으므로 클래스가 붙어 있다는 것만 본다. 약한 검사지만
// 이 한 줄이 사라지는 것을 아무도 못 잡는 상태보다는 낫다.
describe("WorksPage 본문·패널 행의 min-w-0", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("본문 열과 패널을 담는 행이 min-w-0을 갖는다", () => {
    // relative는 생애주기 오버레이·토스트가 이 영역을 기준으로 서기 위한 것이다
    expect(render()).toContain('class="relative flex min-h-0 min-w-0 flex-1"');
  });
});

// ─── 결정 49: 패널을 이 화면으로 끌어올린다 ───

// 1판은 이 패널을 **두 곳**에서 그렸다(여기와 SpecViewer). 두 본문이 형제 컬럼이라
// 어쩔 수 없었던 것인데, 그 대가로 뷰 탭을 오갈 때마다 패널 인스턴스가 갈려 탭 선택·트리
// 접힘이 초기화됐다. 호출부를 하나로 합치는 것이 이 판의 구조 변경이다.
describe("WorksPage 작업 패널은 한 곳에서만 선다", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("두 탭 모두에서 본문 열 바로 뒤에 선다", () => {
    // 같은 자리(본문 `</main>` 다음)에 있다는 것이 React가 인스턴스를 그대로 잇는 조건이다.
    // 탭에 따라 자리가 달라지면 그 순간 패널이 새로 서고 탭 선택이 spec으로 튄다.
    for (const tab of ["spec", "terminal"] as const) {
      expect(render({ specFiles: ["overview.md"] }, tab), tab).toContain("</main><aside");
    }
  });

  it("그리는 곳이 한 곳이고, key가 없다", () => {
    const worksPage = source("WorksPage.tsx");
    // SpecViewer가 다시 패널을 그리면 인스턴스가 도로 둘이 된다 — 1판이 그랬다.
    expect(source("SpecViewer.tsx")).not.toContain("WorkPanel");
    expect(worksPage.match(/<WorkPanel\b/g)).toHaveLength(1);
    // **key를 주면 앞 판 결정 4(작업을 옮기면 spec으로 리셋)가 되살아난다.** 결정 49가
    // 그것을 명시적으로 뒤집었으므로, 되살아나면 여기서 걸려야 한다.
    const call = worksPage.match(/<WorkPanel\b[\s\S]*?\/>/);
    expect(call, "WorkPanel 호출부를 찾지 못했다").not.toBeNull();
    expect(call![0]).not.toMatch(/\bkey=/);
    // 그리고 **작업 하나에 매달린 값**을 key처럼 쓰는 우회로도 없다
    expect(call![0]).not.toMatch(/\bkey=\{[^}]*slug/);
  });

  it("트리의 '지금 이 문서' 표시를 두 탭이 같은 값으로 받는다", () => {
    // 1판은 터미널 탭에서 폴백을 거치지 않은 raw 주소를 내려줘, 뷰 탭을 오갈 때마다
    // 트리 표시가 켜졌다 꺼졌다. 값을 정하는 지점이 하나여야 그 깜빡임이 사라진다.
    // 표시는 트리 행의 selected-row다 (SpecTree)
    for (const tab of ["spec", "terminal"] as const) {
      expect(render({ specFiles: ["overview.md"] }, tab), tab).toContain("selected-row");
    }
  });
});

// 결정 47. 앞 판에서 토스트는 SpecViewer의 지역 상태였고, 터미널 탭에는 SpecViewer가
// 없으므로 **트리를 복사해도 아무 말이 없었다**(1판이 남긴 구멍 1). 화면으로 올리면 닫힌다.
describe("WorksPage 복사 토스트", () => {
  // 토스트가 뜬 화면은 정적 렌더로 만들 수 없다 — 상태가 이 화면의 useState이고 그것을
  // 올리는 것은 클릭이다. 그래서 **소유자와 배선**을 소스에서 본다.
  it("화면이 소유하고, 뷰 분기 밖에서 그려진다", () => {
    const worksPage = source("WorksPage.tsx");
    expect(source("SpecViewer.tsx")).not.toContain("setToast");
    expect(worksPage).toContain("const [toast, setToast]");

    // 그리는 자리가 본문 분기 **밖**이다. 분기 안이면 한 탭에서만 뜬다.
    //
    // 닻이 `const body =`까지인 것은 판 05가 여기에 분할 가지를 하나 더 얹었기 때문이다 —
    // 분기의 **첫 조건**을 닻으로 삼으면 가지가 늘 때마다 이 검사가 무관하게 깨진다.
    const body = worksPage.indexOf("const body =");
    const ret = worksPage.indexOf("return (", body);
    const toast = worksPage.indexOf("{toast && (", ret);
    expect(body, "본문 분기를 찾지 못했다").toBeGreaterThan(-1);
    expect(ret, "화면의 return을 찾지 못했다").toBeGreaterThan(body);
    expect(toast, "본문 분기 밖에서 토스트를 찾지 못했다").toBeGreaterThan(ret);
  });

  it("패널의 복사가 토스트를 띄우는 그 함수를 부른다", () => {
    const worksPage = source("WorksPage.tsx");
    const call = worksPage.match(/<WorkPanel\b[\s\S]*?\/>/);
    expect(call, "WorkPanel 호출부를 찾지 못했다").not.toBeNull();
    // 1판의 터미널 가지는 여기에 토스트 없는 맨 복사를 넘겼다 — 그 배선이 구멍이었다.
    expect(call![0]).toContain("onCopy={copyText}");
    expect(call![0]).not.toContain("navigator.clipboard");
    expect(worksPage).toMatch(/const copyText = useCallback\([\s\S]{0,200}?showToast\(/);
  });
});

// 결정 43. ⌘Enter는 이제 **탭이 아니라 포커스로** 갈린다. 앞 판의
// `if (tab === "terminal") return;` 한 줄이 사라졌고, 그 줄이 남겼던 「알려진 비대칭」
// (포커스가 트리에 있어도 터미널 탭에서는 안 듣는다)도 함께 사라진다.
//
// 판단을 순수 함수로 꺼내 둔 덕에 **이건 소스 훑기가 아니라 진짜로 도는 검사다.**
// (`shellHotkey`와 같은 방식이다.)
describe("WorksPage ⌘Enter", () => {
  // 노드 환경에는 DOM 생성자가 없다. `instanceof`가 보는 것은 그 자리의 전역이므로
  // 세워 두면 그대로 갈린다. 셸의 입력 자리가 숨은 <textarea>라는 것이 이 검사의 전제다.
  class FakeTextArea extends EventTarget {}
  class FakeInput extends EventTarget {}
  class FakeEditable extends EventTarget {
    isContentEditable = true;
  }

  beforeEach(() => {
    vi.stubGlobal("HTMLTextAreaElement", FakeTextArea);
    vi.stubGlobal("HTMLInputElement", FakeInput);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  type Hotkey = Parameters<typeof togglesWorkPanel>[0];
  // 트리·패널의 평범한 요소 — 입력도 편집 가능도 아니다
  const key = (over: Partial<Hotkey> = {}): Hotkey => ({
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    key: "Enter",
    target: new EventTarget(),
    ...over,
  });

  it("포커스가 트리·패널에 있으면 패널 몫이다", () => {
    expect(togglesWorkPanel(key())).toBe(true);
  });

  it("셸(xterm의 숨은 <textarea>)에 포커스가 있으면 셸 몫이다", () => {
    // 결정 29 그대로다. 첫 줄(탭 가드)을 지워도 이 경우는 안 바뀐다는 것이 결정 43의 전제고,
    // 그 전제가 깨지면 터미널에서 ⌘Enter를 칠 때마다 패널이 여닫힌다.
    expect(togglesWorkPanel(key({ target: new FakeTextArea() }))).toBe(false);
  });

  it("입력·편집 가능 요소도 그대로 비켜간다", () => {
    expect(togglesWorkPanel(key({ target: new FakeInput() }))).toBe(false);
    expect(togglesWorkPanel(key({ target: new FakeEditable() }))).toBe(false);
  });

  it("수식키가 하나라도 더 붙거나 다른 키면 아니다", () => {
    for (const extra of ["ctrlKey", "altKey", "shiftKey"] as const) {
      expect(togglesWorkPanel(key({ [extra]: true })), extra).toBe(false);
    }
    expect(togglesWorkPanel(key({ metaKey: false }))).toBe(false);
    expect(togglesWorkPanel(key({ key: "t" }))).toBe(false);
  });

  // 결정 93·98. ⌘T가 xterm 밖에서도 들린다 — 셸이 0개인 화면에는 xterm이 없어 그 키를
  // 들을 사람이 없었다. **판정은 `opensShellFromWindow`가 혼자 알고**(그쪽 검사는
  // shell-registry.test.ts에 전수돼 있다) 여기서 보는 것은 그 판정이 이 화면에 실제로
  // 배선돼 있는가다 — 이펙트는 정적 렌더에서 안 돈다.
  it("⌘T를 window에서 듣고, 열리면 본문이 터미널로 간다", () => {
    const worksPage = source("WorksPage.tsx");
    // **이펙트를 정규식으로 잘라내지 않는다.** 한때 그렇게 했는데 앞쪽 `[\s\S]*?`가
    // **다른 이펙트(⌘Enter, 156행)에서 출발**해 103줄을 통째로 삼켰고, 그래서 아래
    // 리터럴들이 남의 이펙트로 충족됐다 — ⌘T의 `addEventListener` 한 줄을 지워도 초록이었다
    // (실측). 파싱을 없애고 **리터럴과 개수**로 본다: 새면 통과가 아니라 실패가 되는 모양이다.
    //
    // **이름이 있는지만 보면 안 된다.** 가드의 `!` 하나를 지우면 ⌘T가 영영 안 먹고 다른
    // 모든 키가 셸을 여는데, 그렇게 뒤집어도 초록이었다. 리터럴 그대로 못박는다.
    expect(worksPage).toContain("if (!opensShellFromWindow(e)) return;");
    // 딛고 선 작업. `selected`로 바꾸면 본문이 보여주는 셸과 **다른 작업의** 셸이 열린다.
    expect(worksPage).toContain("workShellOrigin(panelWork, null)");
    // 결정 98이 넓힌 절반이다. 열기만 하고 본문을 안 옮기면 ⌘1·⌘2~9 한 벌에서 혼자 어긋난다.
    expect(worksPage).toContain("onSelectTab(\"terminal\")");
    expect(worksPage).toContain("openNewShell(origin);");
    // **등록을 따로 센다.** 위 리터럴은 전부 핸들러 **본문**이라, 핸들러가 window에 안
    // 걸려도 그대로 남는다 — 정리 함수가 계속 참조하므로 tsc도 안 막는다. 이 화면이
    // window에서 키를 듣는 자리는 둘이다(⌘Enter의 패널 토글 · ⌘T). 하나가 등록을 잃으면
    // 셸이 0개인 화면에서 ⌘T가 다시 안 먹는다 — 결정 93이 없애려던 증상 그 자체다.
    // 이 화면이 window에서 듣는 자리는 **셋이다** — ⌘Enter(패널 접기) · ⌘T(셸 열기) ·
    // 본문을 옮기는 ⌘1~9·⌃Tab(결정 78·79). 줄어들면 그중 한 벌이 통째로 죽은 것이다.
    expect(
      countOf(worksPage, 'window.addEventListener("keydown", onKeyDown);'),
      "window에서 키를 듣는 자리가 셋이 아니다 — ⌘Enter · ⌘T · ⌘1~9·⌃Tab",
    ).toBe(3);
  });

  // 결정 78·109. ⌘1은 spec, ⌘2~9는 **이 화면의** 셸이다. 클릭도 키도 이 seam에서는 못
  // 거니(정적 마크업이다) 배선을 소스에서 본다 — 표현식을 통째로 못박는다.
  it("⌘1은 spec, ⌘2~9는 이 화면의 셸이다", () => {
    const worksPage = source("WorksPage.tsx");
    expect(worksPage).toContain("const nav = shellNavFromWindow(e);");
    // 세는 것이 이 work의 셸이 아니면, 사이드바에 펼쳐 둔 **남의 셸까지** 세게 된다.
    expect(worksPage).toContain("const shells = shellsOf(state, panelWork.slug);");
    // ⌘1만 spec이고 나머지는 한 칸 밀린다. 안 밀면 ⌘1이 spec이면서 첫 셸이 되고,
    // 마지막 셸은 영영 못 고른다.
    expect(worksPage).toContain('if (nav.kind === "index" && nav.n === 1) {\n        onSelectTab("spec");');
    expect(worksPage).toContain("shellForNav(shells, activeIdOf(state, panelWork.slug), nav, 2)");
  });

  it("듣는 자리가 탭을 안 본다 — 가드 한 줄이 되살아나면 걸린다", () => {
    const worksPage = source("WorksPage.tsx");
    // 지운 그 줄. 되살아나면 앞 판의 비대칭이 그대로 돌아온다.
    expect(worksPage).not.toMatch(/if \(tab === "terminal"\) return;/);
    // 가드가 없어졌다는 것만 보면 **핸들러가 통째로 사라져도 초록이다** — 이펙트를 함께 본다.
    const effect = worksPage.match(
      /useEffect\(\(\) => \{[\s\S]*?window\.addEventListener\("keydown"[\s\S]*?\}, \[([^\]]*)\]\);/,
    );
    expect(effect, "⌘Enter 효과를 찾지 못했다").not.toBeNull();
    expect(effect![0]).toContain("togglesWorkPanel");
    expect(effect![0]).toContain("setWorkPanelOpen");
    // `tab`을 안 보므로 의존성도 비어 있다. 남아 있으면 판단이 아직 탭에 매여 있다는 뜻이다.
    expect(effect![1].trim()).toBe("");
    expect(effect![0]).not.toContain("tab");
  });
});

// ─── 결정 42·47·50: 셸 목록이 패널로 왔다 ───

// 이 화면은 셸 목록을 **슬롯으로 조립한다** — 스토어를 구독하는 가지 하나(PanelShells)를
// 만들어 패널에 넘긴다. 그래서 「목록이 실제로 이 Work의 셸을 그리는가」는 여기서만 보인다:
// 패널 쪽 seam은 슬롯을 표식으로 대신하고, 목록 쪽 seam은 상태를 손으로 넣는다.
describe("WorksPage에 셸 목록이 없다", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    // 스토어는 모듈 싱글턴이라 이 파일 안에서 새어 나간다. 비우고 나간다.
    terminalStore.setState(() => NO_SHELLS);
  });

  function seed(count: number, owner: string, cwd: string): void {
    let state = NO_SHELLS;
    for (let n = 0; n < count; n += 1) {
      state = openShell(state, { owner, project: null, cwd })!.state;
    }
    terminalStore.setState(() => state);
  }

  // 결정 71. 셸을 고르는 자리가 사이드바 가지 하나다. 이 화면에 목록이 남아 있으면
  // 같은 것이 두 자리에 서고, 어느 쪽이 지금인지가 화면마다 갈린다.
  it("이 Work의 셸이 도는 중에도 패널에 행이 서지 않는다", () => {
    seed(1, work.slug, "~/.atelier/works/some-work/trees/atelier");
    const markup = render();
    expect(markup).not.toContain("~/.atelier/works/some-work/trees/atelier");
    expect(markup).not.toMatch(/aria-label="[^"]*닫기"/);
  });
});

// 결정 47. 상한 8에서 ⌘T는 **아무 일도 안 일어난 것처럼** 보였다(스토리 33의 알려진 구멍) —
// 그 키는 xterm의 키 핸들러에서 오고 그것은 React 트리 밖이라 화면의 토스트를 부를 길이
// 없었다. 스토어가 거절을 알리고 이 화면이 그것을 받는다.
describe("WorksPage 상한에서 ⌘T가 말한다", () => {
  afterEach(() => {
    terminalStore.setState(() => NO_SHELLS);
  });

  it("상한에서 셸을 열려 하면 잠긴 `+`와 **같은 문장**이 온다", () => {
    let state = NO_SHELLS;
    for (let n = 0; n < MAX_SHELLS; n += 1) {
      state = openShell(state, { owner: null, project: null, cwd: null })!.state;
    }
    terminalStore.setState(() => state);

    const heard: string[] = [];
    const stop = onShellOpenRejected((notice) => heard.push(notice));
    // ⌘T가 부르는 그 함수다. 상한에서는 인스턴스를 만들기 전에 돌아오므로 xterm이 안 뜬다.
    openNewShell({ owner: null, project: null, cwd: null });
    stop();

    expect(heard).toEqual([shellCapNotice(terminalStore.state)]);
    expect(heard[0]).toContain(`${MAX_SHELLS}개까지`);
  });

  // 「상한이 아니면 아무 말도 하지 않는다」는 여기 없다 — 이 seam에서 상한 아래로
  // `openNewShell`을 부르면 실제로 열려 xterm 인스턴스가 뜬다(DOM이 없다). 그래서 그 절반은
  // 판정을 순수 모듈로 내려 shell-registry.test.ts의 「열렸으면 아무 말도 하지 않는다」가
  // 실제로 돌며 지킨다. 여기 구독만 걸고 곧바로 비었음을 보는 검사를 두면 어떤 구현에도
  // 통과하는 이름뿐인 그물이 된다.

  // **화면에 들어가기만 한 것은 거절이 아니라 부작용이다.** 상한에 닿은 채 어떤 Work의 터미널
  // 탭에 들어가면 `ensureShell`이 「이 화면엔 칸이 0개」라며 열려다 거절당하는데, 그때도 토스트가
  // 뜨면 아무도 안 누른 알림이 탭을 오갈 때마다 다시 뜬다. 그 화면에는 이미 말할 자리가 있다 —
  // 잠긴 `+` 행이 같은 문장을 보이는 글자로 쓰고 있다(결정 47).
  it("화면에 들어간 것만으로는 아무 말도 하지 않는다", () => {
    // 상한을 **다른 소유자**로 채운다 — 그래야 이 화면의 칸이 0개라 `ensureShell`이 실제로
    // 여는 길까지 가고, 거기서 앱 전체 상한에 걸린다(결정 30).
    let state = NO_SHELLS;
    for (let n = 0; n < MAX_SHELLS; n += 1) {
      state = openShell(state, { owner: "가", project: null, cwd: null })!.state;
    }
    terminalStore.setState(() => state);

    const heard: string[] = [];
    const stop = onShellOpenRejected((notice) => heard.push(notice));
    ensureShell({ owner: "나", project: null, cwd: null });
    stop();

    expect(heard).toEqual([]);
    // 열리지 않은 것까지 함께 본다 — 조용해진 이유가 「그냥 열려 버려서」이면 안 된다.
    expect(terminalStore.state.shells).toHaveLength(MAX_SHELLS);
  });

  it("구독을 끊으면 더 듣지 않는다", () => {
    // 화면이 언마운트된 뒤에도 듣고 있으면 사라진 화면의 setState가 불린다.
    let state = NO_SHELLS;
    for (let n = 0; n < MAX_SHELLS; n += 1) {
      state = openShell(state, { owner: null, project: null, cwd: null })!.state;
    }
    terminalStore.setState(() => state);

    const heard: string[] = [];
    onShellOpenRejected((notice) => heard.push(notice))();
    openNewShell({ owner: null, project: null, cwd: null });
    expect(heard).toEqual([]);
  });

  it("화면이 그 통로를 실제로 구독한다", () => {
    // 위 넷은 스토어 쪽 계약이다. 화면이 그것을 안 들으면 전부 초록인 채로 ⌘T가 다시
    // 조용해진다. 그리고 **토스트로** 말해야 한다 — 콘솔이나 대화 상자가 아니라.
    const worksPage = source("WorksPage.tsx");
    const effect = worksPage.match(/useEffect\(\(\) => onShellOpenRejected\([\s\S]*?\);/)?.[0] ?? "";
    expect(effect, "거절을 듣는 효과를 찾지 못했다").not.toBe("");
    expect(effect).toContain("showToast");
  });

  it("⌘T는 알리는 쪽으로 온다", () => {
    // `ensureShell`이 조용한 짝을 쓰게 되면서 **같은 모듈에 여는 함수가 둘**이 됐다. ⌘T가
    // 실수로 조용한 쪽으로 옮겨가면 상한에서 다시 아무 말이 없어지는데 — 스토리 33의 그
    // 구멍이 되돌아온다 — 그것을 잡는 것이 이 검사 하나다(실측: 이 검사를 넣기 전에는
    // 바꿔도 431건이 전부 초록이었다).
    //
    // ⌘T가 React 트리 밖(`attachCustomKeyEventHandler`)에 살아 렌더로는 못 본다. 그래서
    // 소스를 읽되 **못 찾으면 실패한다** — 못 찾은 것을 통과로 읽으면 이 검사가 지키는 것은
    // 배선이 아니라 자기 자신이다.
    const store = source("../terminal/terminal-store.ts");
    const branch = store.match(/if \(hotkey === "new"\)[\s\S]{0,120}/)?.[0] ?? "";
    expect(branch, "⌘T가 새 셸을 여는 자리를 찾지 못했다").not.toBe("");
    expect(branch).toContain("openNewShell");
  });
});

// 판 05 — 분할. 결정 86~90·97·104·106.
//
// 정적 마크업이라 **여닫는 동작은 안 보인다** — 여기서 보는 것은 「주소가 분할이면 화면이
// 무엇으로 서는가」다. 켜고 끄는 판정은 순수 함수(split-view.test.ts)와 주소
// (-work-search.test.ts)가 각자 든다.
describe("분할 뷰", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const withSpec = { specFiles: ["05-분할-뷰/spec.md"] };

  // 결정 89. 단일 뷰에 두면 분할을 켤 때마다 층이 하나 늘었다 줄어 본문이 위아래로 밀린다.
  it("단일 뷰에는 열 머리가 없다", () => {
    expect(countOf(render(withSpec, "spec", null), "data-column=")).toBe(0);
    expect(countOf(render(withSpec, "terminal", null), "data-column=")).toBe(0);
  });

  it("분할이면 열 머리가 둘 선다", () => {
    expect(countOf(render(withSpec, "spec", "lr"), "data-column=")).toBe(2);
  });

  // 결정 104. basename만 쓰면 판마다 `spec.md`라 열 머리가 늘 같은 글자가 된다.
  it("문서 열 머리가 판 폴더까지 말한다", () => {
    expect(render(withSpec, "spec", "lr")).toContain("05-분할-뷰 / spec.md");
  });

  // 결정 87. 좌우만 바뀐다 — 마크업에서 먼저 나오는 것이 왼쪽 열이다.
  it("lr은 문서가 왼쪽, rl은 문서가 오른쪽이다", () => {
    const lr = render(withSpec, "spec", "lr");
    expect(lr.indexOf('data-column="spec"')).toBeLessThan(lr.indexOf('data-column="terminal"'));
    const rl = render(withSpec, "spec", "rl");
    expect(rl.indexOf('data-column="terminal"')).toBeLessThan(rl.indexOf('data-column="spec"'));
  });

  // 결정 87의 뒷면 — 분할이면 `tab`과 무관하게 **둘 다** 선다. `tab`은 이때
  // 「끄면 남는 쪽」일 뿐이라, 이것이 어긋나면 터미널을 보다 분할을 켜면 문서 열이 빈다.
  it("분할이면 tab과 무관하게 둘 다 선다", () => {
    expect(countOf(render(withSpec, "terminal", "rl"), "data-column=")).toBe(2);
  });

  // 결정 106. 이 저장소는 같은 일을 하는 버튼을 한 화면에 둘 두지 않는다.
  it("열 머리의 `</>`는 패널이 접혔을 때만 선다", () => {
    // 분할을 켜면 패널이 접히므로(결정 88) 이 화면에는 열 머리의 것이 서 있다.
    expect(countOf(render(withSpec, "spec", "lr"), 'data-column-source=""')).toBe(1);
    // 단일 뷰에는 열 머리 자체가 없다.
    expect(countOf(render(withSpec, "spec", null), 'data-column-source=""')).toBe(0);
    // **패널을 다시 연 화면은 정적 렌더로 만들 수 없다** — 여닫음이 이 화면의 useState이고
    // 그것을 뒤집는 것은 클릭이다. 결정 106의 나머지 절반은 배선을 리터럴로 못박는다.
    expect(countOf(source("WorksPage.tsx"), "source={\n        !workPanelOpen && (")).toBe(1);
  });

  // 결정 89의 「끄는 길」 둘 중 하나. 남는 쪽이 서로 반대여야 `×`가 「이 열을 닫는다」가 된다.
  it("열마다 닫는 버튼이 하나씩 있다", () => {
    const html = render(withSpec, "spec", "lr");
    expect(countOf(html, 'aria-label="spec 열 닫기"')).toBe(1);
    expect(countOf(html, 'aria-label="terminal 열 닫기"')).toBe(1);
  });

  // 결정 86. 뷰 탭이 있던 자리다 — 단일 뷰에도 있어야 켤 수 있다.
  it("분할 토글이 두 상태 모두에 서고 켜짐을 말한다", () => {
    expect(render(withSpec, "spec", null)).toContain('aria-label="2열로 보기" aria-pressed="false"');
    expect(render(withSpec, "spec", "lr")).toContain('aria-label="2열로 보기" aria-pressed="true"');
  });
});

// 결정 88. **한 번은 「사람이 켠 그 순간」이지 상태 전이가 아니다.** 한때 `split`을 보는
// 이펙트로 두었는데, 그러면 분할인 A에서 단일인 B로 갔다 A로 돌아올 때도 `null → lr`이라
// 사람이 다시 열어 둔 패널을 또 접었다 — 「억지로 닫지 않는다」의 반대다. 켜는 길이
// 둘(헤더 토글·드래그 놓기)이므로 **판정이 한 자리에 있고 둘이 그것을 부른다**를 함께 본다.
describe("분할을 켜면 패널을 한 번 접는다", () => {
  beforeEach(() => {
    // 아래 렌더 검사가 폭 둘(작업 패널·분할 경계)을 여기서 읽는다
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("판정이 한 자리이고, 켜는 길 둘이 그것을 부른다", () => {
    const worksPage = source("WorksPage.tsx");
    expect(worksPage).toContain("if (next !== null && split === null) setWorkPanelOpen(false);");
    expect(countOf(worksPage, "collapseOnSplit(next)")).toBe(2);
  });

  // 새로고침·링크로 **분할인 채 들어오는** 길이 있고, 그때는 「켠 순간」이 한 번도 안 돈다.
  // 그 화면이 3열이면 결정 88이 계산한 「터미널 ≈34칸」이 그대로 재현된다.
  //
  // 접혔다는 것은 **헤더에 여는 버튼이 서는 것**으로 보인다(닫혀 있을 때만 그린다).
  it("분할인 채 들어와도 3열로 서지 않는다", () => {
    const withSpec = { specFiles: ["05-분할-뷰/spec.md"] };
    expect(countOf(render(withSpec, "spec", "lr"), 'aria-label="작업 패널 펼치기"')).toBe(1);
    expect(countOf(render(withSpec, "spec", null), 'aria-label="작업 패널 펼치기"')).toBe(0);
  });
});

// **마지막 셸이 닫히면 본문에서 터미널이 걷힌다.** 판정은 `shellsEmptied`가 들고
// (shell-registry.test.ts), 그것을 실제로 딛는지는 렌더로 안 보인다 — 이펙트라서다.
//
// 두 가지를 함께 못박는다: **분할이면 분할째로 걷는다**(빈 터미널 열이 반을 차지한 채
// 남으면 두 열을 세운 이유와 정면으로 어긋난다) · **본문에 터미널이 서 있을 때만**이다
// (문서를 읽는 중에 사이드바로 셸을 닫은 것은 화면에서 아무것도 안 바뀌어야 한다).
it("마지막 셸이 닫히면 분할째로 걷고, 문서만 읽던 중이면 가만있는다", () => {
  expect(source("WorksPage.tsx")).toContain(
    'if (emptied && (tab === "terminal" || split !== null)) changeSplit(null, "spec");',
  );
});

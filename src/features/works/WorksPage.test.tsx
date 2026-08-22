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
import type { ViewTab } from "@/routes/-work-search";

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
  worktrees: [],
  specDir: "~/.atelier/works/some-work/spec",
  specFiles: [],
};

// 이 화면의 소스를 문자열로 읽는다. 렌더로 볼 수 없는 불변조건(이펙트·리마운트 자리)이
// 여기 걸리고, 그 방식은 이 저장소가 파일 간 계약에 쓰는 것과 같다
// (state-scale.test.ts · theme-tokens.test.ts · tauri-commands.test.ts).
function source(file: "WorksPage.tsx" | "SpecViewer.tsx"): string {
  return readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), "utf8");
}

function render(overrides: Partial<WorkView> = {}, tab: ViewTab = "spec"): string {
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
describe("WorksPage 뷰 탭", () => {
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

  it("상태 배지 **다음**에 온다", () => {
    // 배지는 "어느 단계인가", 뷰 탭은 "무엇을 보고 있는가"다. 순서가 뒤집히면 지금 보는
    // 것이 작업의 상태보다 앞서 읽힌다.
    const a = actions(render());
    const badge = a.indexOf('title="상태 변경"');
    const spec = a.indexOf('aria-label="spec 보기"');
    expect(badge).toBeGreaterThan(-1);
    expect(spec).toBeGreaterThan(badge);
  });

  it("두 칸이 있고 보고 있는 쪽만 켜져 있다", () => {
    // 라벨은 **소문자 영어다**(결정 41) — 패널 탭과 같은 44px 층에 서므로 한 가족으로
    // 읽혀야 한다. 한국어로 되돌아오면 여기서 갈린다.
    for (const [tab, label] of [
      ["spec", "spec"],
      ["terminal", "terminal"],
    ] as const) {
      const a = actions(render({}, tab));
      const on = [...a.matchAll(/aria-label="([^"]*) 보기"[^>]*aria-pressed="true"/g)];
      expect(on.map((found) => found[1]), tab).toEqual([label]);
      expect([...a.matchAll(/aria-label="[^"]* 보기"/g)], tab).toHaveLength(2);
    }
  });

  // toggle-on은 자기 hover를 품는다. 꺼진 가지의 hover가 같은 요소에 함께 오면
  // 어느 쪽이 이길지를 유틸리티 정렬 순서가 정한다(index.css의 경고).
  it("한 칸에 hover 규칙이 두 벌 얹히지 않는다", () => {
    const a = actions(render());
    const tabs = [...a.matchAll(/<button[^>]*aria-label="[^"]* 보기"[^>]*>/g)].map((f) => f[0]);
    expect(tabs).toHaveLength(2);
    expect(tabs.filter((one) => /toggle-on/.test(one) && /(hover:|quiet-hover)/.test(one))).toEqual(
      [],
    );
    // 꺼진 칸은 조용한 hover를 갖는다 — 누를 수 있다는 것이 보여야 한다.
    expect(tabs.filter((one) => /quiet-hover/.test(one))).toHaveLength(1);
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

  it("본문이 셸 탭 줄로 바뀌고, 작업 패널은 옆에 그대로 선다", () => {
    const markup = render({}, "terminal");
    expect(markup).toContain('aria-label="셸 열기"');
    // 패널이 **함께** 있다. 그 머리행의 닫는 ×로 확인한다.
    expect(markup).toContain('aria-label="작업 패널 접기"');
  });

  it("spec 탭에는 셸 탭 줄이 없고 작업 패널이 있다", () => {
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
    const body = worksPage.indexOf("const body = terminalWork ?");
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

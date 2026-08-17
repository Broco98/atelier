import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorksPage from "./WorksPage";
import { worksQuery } from "./hooks";
import type { WorkView } from "./types";

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

function render(overrides: Partial<WorkView> = {}): string {
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
// WorksPage → SpecViewer → WorkPanel 셋이 다 도므로, 소스 보기의 주인이 화면에서
// 패널 쪽으로 내려간 배선이 실제로 이어졌는지가 드러난다 (결정 22).
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

  it("상태 배지는 오른쪽 actions에 있고, ⓘ·⋯는 거기 없다", () => {
    // 배지가 브레드크럼에 남아 있으면 제목과 ⓘ 사이를 가른다 — 셋이 한 덩어리로 읽히지 않는다.
    const a = actions(render());
    expect(a).not.toBe("");
    expect(a).toContain('title="상태 변경"');
    expect(a).not.toContain('aria-label="작업 메타"');
    expect(a).not.toContain('aria-label="작업 메뉴"');
  });
});

// 뷰 탭 — 지금은 spec 하나뿐이고 앞으로 `파일`·`터미널`이 이 묶음에 붙는다.
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

  it("켜진 상태로 그려진다 — 지금은 이 뷰 하나뿐이다", () => {
    // 형제가 생기기 전까지 이 탭은 늘 켜져 있다. 꺼진 모습이 나오면 볼 수 없는 뷰가
    // 켜져 있다는 뜻이라 거짓이 된다.
    const a = actions(render());
    expect(a).toContain('aria-pressed="true"');
    expect(a).toContain("toggle-on");
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

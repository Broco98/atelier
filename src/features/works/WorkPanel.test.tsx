import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WorkPanel from "./WorkPanel";
import type { WorkView } from "./types";

// 이 패널은 화면 **오른쪽**에 있어 핸들이 왼쪽 가장자리에 붙고 끄는 방향의 부호가 반대다.
// 호출부가 side를 빠뜨리거나 "left"로 적으면 핸들이 패널 건너편으로 가 잡을 곳이 사라지는데,
// 훅 쪽 테스트는 이 배선을 보지 못한다.
//
// WorkPanel은 프로젝트 목록을 스스로 조회하므로 쿼리 프로바이더를 세워 준다 — 조회 결과는
// 여기서 쓰지 않는다(로딩 중이라 빈 배열이다). 폭은 localStorage에서 읽어 온다.

const work: WorkView = {
  slug: "some-work",
  title: "어떤 작업",
  status: "active",
  branch: "feat/some-work",
  createdAt: "2026-08-16T00:00:00Z",
  projects: [],
  worktrees: [],
  specDir: "~/.atelier/works/some-work/spec",
  specFiles: ["overview.md"],
};

function render(open: boolean, override: Partial<WorkView> = {}): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <WorkPanel
        work={{ ...work, ...override }}
        currentFile={null}
        onSelectFile={() => {}}
        onCopy={() => {}}
        onClose={() => {}}
        open={open}
      />
    </QueryClientProvider>,
  );
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

  it("기본 폭 296으로 서고, 바깥과 안쪽이 같은 폭을 읽는다", () => {
    const markup = render(true);
    expect(markup).toMatch(/--work-panel-width:\s*296px/);
    // 변수를 **선언**만 하고 쓰지 않으면 폭이 못 박힌 채로도 전부 초록이다 — 핸들도 서고
    // 커서도 뜨는데 끌어도 1px도 안 움직인다. 바깥은 접히는 폭이고 안쪽은 그 폭으로
    // 버티는 자리라, 둘이 갈리면 접히는 동안 글이 되흐른다. 그래서 정확히 둘이다.
    expect(markup.match(/w-\(--work-panel-width\)/g)).toHaveLength(2);
  });

  it("지난번에 바꾼 폭으로 다시 선다", () => {
    vi.stubGlobal("localStorage", { getItem: () => "420", setItem: () => {} });
    expect(render(true)).toMatch(/--work-panel-width:\s*420px/);
  });
});

// 탭 전환 자체(클릭)는 여기서 볼 수 없다 — 이 seam은 정적 마크업이라 이벤트가 돌지 않는다.
// 대신 **첫 화면의 구조**를 못 박는다: 탭 바가 서 있는가, 두 탭이 함께 마운트돼 있는가,
// 스크롤 경계가 여전히 패널 카드에 있는가.
describe("WorkPanel 두 탭", () => {
  beforeEach(stubEmptyStorage);
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("맨 위가 spec | 정보 탭 바이고, 처음 켜져 있는 것은 spec이다", () => {
    const markup = render(true);
    // 켜짐·꺼짐 둘 다 기존 토글 어휘를 그대로 쓴다 — 새 토큰을 만들지 않았다
    expect(markup).toMatch(/<button[^>]*\btoggle-on\b[^>]*>spec</);
    expect(markup).toMatch(/<button[^>]*\bquiet-hover\b[^>]*>정보</);
  });

  it("보이지 않는 탭도 함께 마운트돼 있다", () => {
    const markup = render(true);
    // 정보 탭은 지금 안 보이지만 마크업에 있다. 언마운트하면 메타를 보고 spec으로
    // 돌아왔을 때 접어둔 판이 펴져 있다 (결정 13).
    expect(markup).toContain("feat/some-work");
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
    const markup = render(true, {
      projects: ["atelier"],
      worktrees: [
        { project: "atelier", path: "~/.atelier/works/some-work/trees/atelier", exists: true, dirty: false },
      ],
    });
    // 사라지는 것은 개수 배지다 — 경로 복사 행은 그대로 남는다.
    // 배지는 exists가 참인 것만 세어 다음 티켓의 프로젝트 덩어리 개수와 어긋난다 (결정 24).
    expect(markup).toContain("worktree · atelier");
    expect(markup).not.toMatch(/worktree 1/);
  });

  it("트리 위 Spec 소제목이 없다", () => {
    // 바로 위 탭 버튼이 이미 spec이라 같은 말이 두 줄 연달아 나온다 (결정 23)
    expect(render(true)).not.toMatch(/>Spec</);
  });
});

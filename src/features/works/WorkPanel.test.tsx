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

function render(open: boolean): string {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <WorkPanel
        work={work}
        currentFile={null}
        onSelectFile={() => {}}
        onCopy={() => {}}
        open={open}
      />
    </QueryClientProvider>,
  );
}

describe("WorkPanel 폭 조절", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => {} });
  });
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

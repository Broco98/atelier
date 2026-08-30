/// <reference types="node" />
// 소스 스캔 한 건 때문에 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SearchList } from "./SearchPalette";
import type { SearchHit } from "./types";

// 세 상태는 저쪽 계약에서 그대로 받아 온다 — 여기에 리터럴로 베껴 적으면 상태가 하나 느는 날
// 검사만 옛 목록을 든 채로 초록이다.
type SearchState = ComponentProps<typeof SearchList>["state"];

// 팔레트가 **그리는 것**을 본다. 순서와 층 규칙은 코어가 정하므로(결정 15) 여기서 재는 것은
// 「받은 줄이 화면에 어떻게 서는가」뿐이다.

const doc = (slug: string, path: string, archived = false): SearchHit => ({
  kind: "doc",
  slug,
  title: `${slug} 작업`,
  path,
  archived,
});

const workHit = (slug: string, archived = false): SearchHit => ({
  kind: "work",
  slug,
  title: `${slug} 작업`,
  archived,
});

const text = (slug: string, path: string, snippet: string, archived = false): SearchHit => ({
  kind: "text",
  slug,
  title: `${slug} 작업`,
  path,
  archived,
  snippet,
});

const project = (slug: string, name: string): SearchHit => ({ kind: "project", slug, name });

const destination = (key: string): SearchHit => ({ kind: "destination", key });

const render = (
  hits: SearchHit[],
  {
    selected = 0,
    query = "",
    truncated = false,
    state = "ready",
  }: { selected?: number; query?: string; truncated?: boolean; state?: SearchState } = {},
) =>
  renderToStaticMarkup(
    <SearchList
      query={query}
      hits={hits}
      state={state}
      truncated={truncated}
      selected={selected}
      onQuery={() => {}}
      onGo={() => {}}
      onClose={() => {}}
    />,
  );

// 줄을 **표식으로** 집는다 — 모양(클래스 문자열)으로 가르면 규격을 손보는 날 검사가 샌다.
// 줄 안에는 다른 button이 없어 첫 `</button>`까지가 그 줄 전부다.
const rowsOf = (markup: string) =>
  markup.match(/<button[^>]*data-row=""[\s\S]*?<\/button>/g) ?? [];

// 구획 머리도 **표식으로** 집는다. 글로만 찾으면 목적지 라벨 `Projects`와 그룹 머리
// 「프로젝트」가 같은 자리에 있는지 없는지를 못 가른다.
const headsOf = (markup: string) =>
  [...markup.matchAll(/<p[^>]*data-head=""[^>]*>([^<]*)<\/p>/g)].map((m) => m[1]);

// 소스를 그대로 센다. **리터럴로 센다** — 정규식으로 import 블록을 잘라내는 판정은 남의
// 코드를 읽고도 초록이었다(사이드바 목록의 같은 검사가 적어 둔 자리).
const source = readFileSync(fileURLToPath(new URL("./SearchPalette.tsx", import.meta.url)), "utf8");
const countOf = (literal: string) => source.split(literal).length - 1;

describe("팔레트가 그리는 줄", () => {
  // 결정 12. `overview.md`가 29개라 파일명만으로는 아무것도 못 고른다 — **한 줄 안에**
  // work 제목과 경로가 함께 있어야 한다. 마크업 전체에서 문자열만 찾으면 제목이 이 줄에
  // 있고 경로가 저 줄에 있어도 초록이 된다.
  it("한 줄 안에 work 제목과 경로가 함께 적힌다", () => {
    const rows = rowsOf(render([doc("가", "overview.md"), doc("나", "01-판/spec.md")]));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("가 작업");
    expect(rows[0]).toContain("overview.md");
    expect(rows[1]).toContain("나 작업");
    expect(rows[1]).toContain("01-판/spec.md");
  });

  // 아카이브 문서는 **가는 화면이 다르다** — 고르기 전에 그것을 알아야 한다. 이것도 줄
  // 안에서 본다: 전체에서 「아카이브」를 찾으면 꼬리표가 엉뚱한 줄에 서도 걸리지 않는다.
  it("아카이브 줄만 아카이브라고 말한다", () => {
    const rows = rowsOf(render([doc("가", "overview.md"), doc("옛일", "record.md", true)]));
    expect(rows[0]).not.toContain("아카이브");
    expect(rows[1]).toContain("아카이브");
  });

  // 방향키가 옮기는 그 표시다. **하나뿐이어야 한다** — 둘이면 Enter가 어느 것을 여는지
  // 화면이 말하지 못한다.
  it("골라진 줄이 하나이고 그것이 그 자리다", () => {
    const rows = rowsOf(render([doc("가", "a.md"), doc("나", "b.md"), doc("다", "c.md")], { selected: 1 }));
    expect(rows.filter((row) => row.includes('aria-selected="true"'))).toHaveLength(1);
    expect(rows[1]).toContain('aria-selected="true"');
  });

  // 목록이 비면 고른 자리가 없다(`-1`) — 그때 골라진 줄도 없어야 한다. 자리를 0으로 두면
  // 없는 줄을 가리킨 채 Enter가 무엇을 여는지 모르게 된다.
  it("줄이 없으면 골라진 것도 없다", () => {
    const markup = render([], { selected: -1 });
    expect(rowsOf(markup)).toEqual([]);
    expect(markup).not.toContain('aria-selected="true"');
  });
});

describe("치는 자리와 목록이 하는 말", () => {
  // 좁히는 일이 시작되는 자리다. **친 것이 그 칸에 그대로 서야** 지운 것도 지워진다 —
  // 값을 안 걸면 화면과 질의가 갈려서, 다 지웠는데 목록은 좁혀진 채로 남는다.
  it("입력칸이 서고 친 것이 그대로 적힌다", () => {
    const markup = render([doc("가", "overview.md")], { query: "가 네비" });
    const input = /<input[^>]*>/.exec(markup)?.[0] ?? "";
    expect(input, "입력칸이 없다").not.toBe("");
    expect(input).toContain('value="가 네비"');
  });

  // 맞는 것이 없는 것과 **고장 난 것**은 화면에서 같아 보인다 — 빈 상자는 아무 말도 안 한다.
  it("맞는 것이 없으면 없다고 말하는 줄이 선다", () => {
    const markup = render([], { selected: -1, query: "없는말" });
    expect(markup).toContain("맞는 것이 없습니다");
    // 그 줄은 **고를 수 있는 것이 아니다** — 방향키가 서면 Enter가 갈 곳이 없다.
    expect(markup).not.toContain('role="option"');
  });

  // 답이 오기 전의 빈 목록은 **「없다」가 아니다.** 팔레트는 열 때마다 새로 마운트되고 캐시도
  // 안 남기므로(hooks.ts), 이것을 안 가르면 여는 것마다 첫 답이 올 때까지 「맞는 것이
  // 없습니다」가 선다 — 「치는 동안 즉시 따라온다」의 반대다.
  it("아직 답이 안 왔으면 아무 말도 안 한다", () => {
    const markup = render([], { selected: -1, state: "pending" });
    expect(markup).not.toContain("맞는 것이 없습니다");
    // 「못 물었다」도 아니다 — 셋이 갈리지 않으면 여는 것마다 이 줄이 깜빡인다.
    expect(markup).not.toContain("검색하지 못했습니다");
  });

  // **못 물은 것과 없는 것은 다르다.** 이 줄이 없으면 첫 질의가 실패했을 때 입력칸과 빈 상자만
  // 남아, 사용자가 「고장」이 아니라 「결과가 없다」로 읽는다.
  it("못 물었으면 없다고 하지 않고 못했다고 말한다", () => {
    const markup = render([], { selected: -1, query: "가", state: "failed" });
    expect(markup).toContain("검색하지 못했습니다");
    expect(markup).not.toContain("맞는 것이 없습니다");
    // 그 줄도 **고를 수 있는 것이 아니다** — 방향키가 서면 Enter가 갈 곳이 없다.
    expect(markup).not.toContain('role="option"');
  });

  // 결정 24. 상한에 걸린 것을 말하지 않으면, 안 나온 문서가 **없는 것처럼** 보인다.
  // **수는 안 센다.** 상한은 코어 한 자리에 살고(`LAYER_LIMIT`) 화면으로 오지 않으므로,
  // 여기서 수를 세면 상한을 고치는 날 화면과 검사가 함께 낡는다.
  it("잘렸을 때만 잘렸다고 말한다", () => {
    expect(render([doc("가", "overview.md")], { truncated: true })).toContain("일부만 보입니다");
    expect(render([doc("가", "overview.md")])).not.toContain("일부만 보입니다");
  });
});

describe("갈래마다 다른 것을 그린다", () => {
  // 결정 21. 목적지 줄이 드는 말은 **프런트 것이다** — 코어는 `key`만 돌려주고, 라벨은
  // `nav-items.ts`가 정한다. 줄 안에서 본다: 마크업 전체에서 찾으면 라벨이 엉뚱한 줄에
  // 서도 초록이 된다.
  it("목적지 줄에 main nav의 라벨이 선다", () => {
    const rows = rowsOf(render([destination("projects"), destination("terminal")]));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("Projects");
    expect(rows[1]).toContain("Terminal");
  });

  // 결정 14. **문서가 0개인 work도 한 줄로 선다** — 줄이 드는 것은 그 work의 제목이다.
  it("work 줄에 제목이 서고 아카이브 work만 아카이브라고 말한다", () => {
    const rows = rowsOf(render([workHit("가"), workHit("옛일", true)]));
    expect(rows[0]).toContain("가 작업");
    expect(rows[0]).not.toContain("아카이브");
    expect(rows[1]).toContain("옛일 작업");
    expect(rows[1]).toContain("아카이브");
  });

  // 판 02. **스니펫은 본문 줄만의 것이다** — 「왜 떴는지」를 열기 전에 말하는 자리라,
  // 이름으로 맞은 문서 줄에는 말할 것이 없다. 줄 안에서 본다: 마크업 전체에서 찾으면
  // 스니펫이 엉뚱한 줄에 서 있어도 초록이 된다.
  it("본문 줄에만 스니펫이 서고 문서 줄에는 없다", () => {
    const rows = rowsOf(render([doc("가", "overview.md"), text("가", "decisions.md", "맞은 대목 한 줄")]));
    expect(rows[0]).not.toContain("맞은 대목 한 줄");
    expect(rows[1]).toContain("맞은 대목 한 줄");
    // 본문 줄도 **어느 work의 무엇인지**를 함께 말한다 — 문서 줄과 같은 이유다(결정 12).
    expect(rows[1]).toContain("가 작업");
    expect(rows[1]).toContain("decisions.md");
  });

  it("아카이브 본문 줄만 아카이브라고 말한다", () => {
    const rows = rowsOf(render([text("가", "a.md", "여기"), text("옛일", "record.md", "저기", true)]));
    expect(rows[0]).not.toContain("아카이브");
    expect(rows[1]).toContain("아카이브");
  });

  it("프로젝트 줄에 이름이 선다", () => {
    const rows = rowsOf(render([project("billing", "빌링")]));
    expect(rows[0]).toContain("빌링");
    // slug는 화면에 안 선다 — 사이드바·Projects 화면이 이름으로 부르는 것과 같다.
    expect(rows[0]).not.toContain("billing");
  });
});

describe("구획 머리", () => {
  // 결정 17. 「가는 곳」·「작업」·「프로젝트」·「문서」·「본문」 — **사이드바 목록과 같은
  // 계통의 한국어다.** 순서는 코어가 정한 층 순서 그대로다.
  it("층마다 한 번씩 그 순서로 선다", () => {
    const markup = render([
      destination("projects"),
      workHit("가"),
      workHit("옛일", true),
      project("billing", "빌링"),
      doc("가", "overview.md"),
      doc("옛일", "record.md", true),
      text("가", "decisions.md", "맞은 대목"),
      text("옛일", "record.md", "옛 대목", true),
    ]);
    expect(headsOf(markup)).toEqual(["가는 곳", "작업", "프로젝트", "문서", "본문"]);
  });

  // **결과가 없는 그룹은 머리도 안 선다** — 비어 있는 머리는 「여기 뭔가 있었는데」로 읽힌다.
  it("줄이 없는 그룹은 머리도 없다", () => {
    expect(headsOf(render([doc("가", "overview.md")]))).toEqual(["문서"]);
    expect(headsOf(render([]))).toEqual([]);
  });

  // 머리는 **고를 수 있는 것이 아니다.** 방향키가 여기 서면 Enter가 갈 곳이 없는 자리가
  // 생기고, 코어가 세는 줄 수와 화면이 고를 수 있는 자리 수가 갈린다.
  it("머리에는 방향키가 서지 않는다", () => {
    const hits = [destination("projects"), workHit("가"), doc("가", "overview.md")];
    const markup = render(hits);
    expect(headsOf(markup)).toHaveLength(3);
    expect(markup.match(/role="option"/g) ?? []).toHaveLength(hits.length);
  });
});

describe("팔레트에는 프리뷰가 없다", () => {
  // 결정 6. 노션의 오른쪽 프리뷰는 **제목**을 찾는 검색이라 「이 페이지가 맞나」를 답해야
  // 해서 있는 것이다. **여기는 본문 전문검색이라 매치된 줄 자체가 그 답이다.** 그리고 spec
  // 문서에는 mermaid가 흔해서, 프리뷰는 방향키로 훑을 때마다 다이어그램을 다시 그린다.
  it("문서를 그리는 것을 부르지 않는다", () => {
    // 부르지 않으면 **방향키가 다시 그릴 것도 없다.** 주석에 적어도 빨개진다 — 세는 것이
    // import가 아니라 리터럴이고, 그 성질은 아래 검사와 같은 이유로 그대로 둔다.
    expect(countOf("SpecViewer")).toBe(0);
    expect(countOf("MermaidBlock")).toBe(0);
    expect(countOf("react-markdown")).toBe(0);
  });

  // 위 검사는 「무엇을 안 부른다」이고 이것은 **「무엇을 안 그린다」**다. 방향키가 옮기는 것이
  // 표시 하나뿐이면 **줄 밖의 화면은 글자 하나 안 바뀐다** — 프리뷰가 있으면 고른 줄마다
  // 다른 문서가 펴지므로 여기가 갈린다.
  it("고른 줄이 바뀌어도 줄 밖의 화면은 그대로다", () => {
    const hits = [text("가", "a.md", "첫 대목"), text("가", "b.md", "둘째 대목")];
    const outside = (at: number) =>
      render(hits, { selected: at }).replace(/<button[^>]*data-row=""[\s\S]*?<\/button>/g, "[줄]");
    expect(outside(0)).toBe(outside(1));
  });
});

describe("팔레트는 터미널을 모른다", () => {
  it("터미널 스토어를 import하지 않는다", () => {
    // 이 계약이 깨지면 `@xterm/*`와 그 CSS가 여기로 따라 들어와 **위 검사 전부가** 서지
    // 못한다 — 이 파일의 seam은 DOM 없는 환경의 정적 마크업이다.
    //
    // **주석에 적어도 빨개진다.** 세는 것이 import가 아니라 리터럴이라 그렇고, 그 성질은
    // 일부러 그대로 둔다: 「여기서는 그 모듈을 부를 수 없다」를 가장 싸게 지키는 방법이다.
    expect(countOf("terminal-store")).toBe(0);
    expect(countOf("@/features/terminal")).toBe(0);
  });
});

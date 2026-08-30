import { describe, expect, it } from "vitest";
import { rememberView } from "@/routes/-work-search";
import { hitTarget } from "./hit-target";
import type { SearchHit } from "./types";

// 고른 줄이 **어디로 가는가.** 이 판정만 순수 함수로 떼어 두는 것은 실제 이동을 재는 층이
// L3인데 그쪽 픽스처가 아카이브 화면까지 태우지 않기 때문이다 — 그리고 여기서 재는 것이
// 「주소를 짓는 규칙을 다시 적지 않았다」이기도 하다: 값이 `fileSearch`·`viewSearch`·
// `destinations.ts`에서 나오므로, 그것들이 바뀌면 여기가 함께 움직인다.

const doc = (over: Partial<Extract<SearchHit, { kind: "doc" }>> = {}): SearchHit => ({
  kind: "doc",
  slug: "가",
  title: "가 작업",
  path: "overview.md",
  archived: false,
  ...over,
});

const workHit = (over: Partial<Extract<SearchHit, { kind: "work" }>> = {}): SearchHit => ({
  kind: "work",
  slug: "가",
  title: "가 작업",
  archived: false,
  ...over,
});

describe("문서 줄이 가는 곳", () => {
  it("활성 문서는 그 work의 spec 화면에서 열린다", () => {
    expect(hitTarget(doc())).toEqual({
      to: "/works/$slug",
      params: { slug: "가" },
      search: { file: "overview.md", tab: undefined, split: undefined },
    });
  });

  // 결정 16·77. **「그 work의 기억 위에 문서를 얹어」 간다** — 분할해 둔 채로 문서를 골라도
  // 분할이 안 무너지고, 터미널을 보고 있었어도 문서를 골랐으면 spec으로 돌아온다.
  // 기억에 다른 문서가 적혀 있어도 **고른 문서**가 이긴다 — 문서 줄은 문서를 골랐다.
  it("분할은 그 work의 기억에서 살아남고 탭은 spec으로 돌아온다", () => {
    rememberView("갈라둔것", { tab: "terminal", split: "rl", file: "기억에적힌것.md" });
    expect(hitTarget(doc({ slug: "갈라둔것", path: "01-판/spec.md" }))).toEqual({
      to: "/works/$slug",
      params: { slug: "갈라둔것" },
      search: { file: "01-판/spec.md", tab: undefined, split: "rl" },
    });
  });

  // 아카이브 문서는 **아카이브 화면**으로 간다. 경로는 work 루트 기준이고(`record.md`가
  // spec 밖에 있다) `file` 검증기는 두 화면이 이미 공유한다.
  it("아카이브 문서는 아카이브 화면에서 열린다", () => {
    expect(hitTarget(doc({ slug: "옛일", path: "record.md", archived: true }))).toEqual({
      to: "/archive/$slug",
      params: { slug: "옛일" },
      search: { file: "record.md" },
    });
    expect(hitTarget(doc({ slug: "옛일", path: "spec/overview.md", archived: true }))).toEqual({
      to: "/archive/$slug",
      params: { slug: "옛일" },
      search: { file: "spec/overview.md" },
    });
  });
});

describe("본문 줄이 가는 곳", () => {
  // 판 02. **갈래가 갈리는 것은 「왜 떴는가」이지 「어디로 가는가」가 아니다** — 본문 줄도
  // 그 문서를 여는 한 가지 뜻이라, 문서 줄과 **같은 주소**가 나와야 한다. 여기서 갈리면
  // 같은 문서를 여는 길이 둘인데 도착지가 다른 세상이 생긴다. (매치를 품은 헤딩까지
  // 데려가는 것은 판 03의 몫이고, 그때도 주소는 이 값 그대로다 — 결정 8.)
  const text = (over: Partial<Extract<SearchHit, { kind: "text" }>> = {}): SearchHit => ({
    kind: "text",
    slug: "가",
    title: "가 작업",
    path: "overview.md",
    archived: false,
    snippet: "맞은 대목 한 줄",
    ...over,
  });

  it("활성 본문 줄은 그 문서 줄과 같은 곳으로 간다", () => {
    expect(hitTarget(text())).toEqual(hitTarget(doc()));
  });

  it("아카이브 본문 줄은 그 문서 줄과 같은 곳으로 간다", () => {
    expect(hitTarget(text({ slug: "옛일", path: "record.md", archived: true }))).toEqual(
      hitTarget(doc({ slug: "옛일", path: "record.md", archived: true })),
    );
  });
});

describe("work 줄이 가는 곳", () => {
  // 결정 14·77 · #156 수용 기준 2(「문서·탭·분할이 살아 있다」). **문서 줄과 다른 일이다** —
  // 여기서는 문서를 안 골랐으므로 spec으로 떨어지지 않고, 그 work을 마지막으로 보던 화면이
  // **셋 다** 그대로 선다. 주소를 짓는 모양이 사이드바의 work 행과 **같아야 한다**
  // (`SidebarWorkList`의 `goTo`): work을 고르는 길이 둘인데 도착지가 갈리면 어긋나도
  // 화면에 티가 안 난다.
  it("그 work을 마지막으로 보던 화면으로 간다 — 문서·탭·분할 셋 다", () => {
    rememberView("터미널보던것", { tab: "terminal", split: "lr", file: "03-판/spec.md" });
    expect(hitTarget(workHit({ slug: "터미널보던것" }))).toEqual({
      to: "/works/$slug",
      params: { slug: "터미널보던것" },
      search: { tab: "terminal", split: "lr", file: "03-판/spec.md" },
    });
  });

  // 기억이 없으면 기본값이다 — 방금 만들어 아직 안 열어 본 work이 그 자리다(결정 14가
  // 세우려는 것이 바로 그런 work이다).
  it("아직 안 본 work은 기본 화면으로 간다", () => {
    expect(hitTarget(workHit({ slug: "방금만든것" }))).toEqual({
      to: "/works/$slug",
      params: { slug: "방금만든것" },
      search: { tab: undefined, split: undefined, file: undefined },
    });
  });

  // 아카이브 work은 **가는 화면이 다르다.** 문서를 안 골랐으므로 `file`도 없다.
  it("아카이브 work은 아카이브 화면으로 간다", () => {
    expect(hitTarget(workHit({ slug: "옛일", archived: true }))).toEqual({
      to: "/archive/$slug",
      params: { slug: "옛일" },
      search: {},
    });
  });
});

describe("프로젝트 줄과 목적지 줄이 가는 곳", () => {
  it("프로젝트 줄은 그 프로젝트 화면으로 간다", () => {
    expect(hitTarget({ kind: "project", slug: "billing", name: "빌링" })).toEqual({
      to: "/projects/$slug",
      params: { slug: "billing" },
    });
  });

  // 결정 21. 라우트는 **프런트 것이다** — 코어는 `key`만 돌려주고, 그 key를 주소로 푸는
  // 자리가 `destinations.ts` 하나다. 사이드바가 가는 곳과 같은 값이 나온다.
  it("목적지 줄은 사이드바가 가는 곳으로 간다", () => {
    expect(hitTarget({ kind: "destination", key: "projects" })).toEqual({ to: "/projects" });
    expect(hitTarget({ kind: "destination", key: "terminal" })).toEqual({ to: "/terminal" });
    expect(hitTarget({ kind: "destination", key: "archive" })).toEqual({ to: "/archive" });
    // **설정은 `navItems`에 없다**(결정 51 — 사이드바 바닥에 고정된 자리를 줬다). 그래도 갈
    // 수 있는 화면이라 여기서 풀려야 한다: 그 배열만 훑으면 팔레트 목록에는 뜨는데 Enter가
    // 아무 일도 안 하는 줄이 되고, **그 실패는 목록만 보면 안 보인다.**
    expect(hitTarget({ kind: "destination", key: "settings" })).toEqual({ to: "/settings" });
  });

  // 코어는 여기서 건넨 key만 돌려주므로(결정 21) 모르는 key는 계약이 깨진 것이다.
  // **갈 곳을 지어내지 않는다** — 지어내면 엉뚱한 화면으로 데려가고 그것이 조용하다.
  it("모르는 목적지는 갈 곳이 없다고 말한다", () => {
    expect(hitTarget({ kind: "destination", key: "없는목적지" })).toBeNull();
  });
});

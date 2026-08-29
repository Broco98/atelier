import { describe, expect, it } from "vitest";
import { rememberView } from "@/routes/-work-search";
import { hitTarget } from "./hit-target";
import type { SearchHit } from "./types";

// 고른 줄이 **어디로 가는가.** 이 판정만 순수 함수로 떼어 두는 것은 실제 이동을 재는 층이
// L3인데 그쪽 픽스처가 아카이브 화면까지 태우지 않기 때문이다 — 그리고 여기서 재는 것이
// 「주소를 짓는 규칙을 다시 적지 않았다」이기도 하다: 값이 `fileSearch`·`viewSearch`에서
// 나오므로, 그 함수들이 바뀌면 여기가 함께 움직인다.

const doc = (over: Partial<SearchHit> = {}): SearchHit => ({
  kind: "doc",
  slug: "가",
  title: "가 작업",
  path: "overview.md",
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
  it("분할은 그 work의 기억에서 살아남고 탭은 spec으로 돌아온다", () => {
    rememberView("갈라둔것", { tab: "terminal", split: "rl" });
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
    expect(hitTarget(doc({ slug: "옛일", path: "spec/overview.md", archived: true })).search).toEqual(
      { file: "spec/overview.md" },
    );
  });
});

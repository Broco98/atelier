import { describe, expect, it } from "vitest";
import { resolveHref } from "./doc-refs";

// spec 폴더의 실제 모양을 흉내낸 목록 — 한글 폴더명이 들어 있는 것이 중요하다.
// 마크다운 렌더러가 비ASCII 경로를 퍼센트 인코딩해 넘기기 때문이다.
const FILES = [
  "overview.md",
  "01-삭제-관통/spec.md",
  "01-삭제-관통/tickets/01.md",
  "research/prompt.md",
];

describe("resolveHref", () => {
  it("같은 폴더의 문서를 가리킨다 — ./ 있는 형태와 없는 형태 둘 다", () => {
    expect(resolveHref("overview.md", "./research/prompt.md", FILES)).toEqual({
      kind: "doc",
      path: "research/prompt.md",
    });
    expect(resolveHref("research/prompt.md", "prompt.md", FILES)).toEqual({
      kind: "doc",
      path: "research/prompt.md",
    });
  });

  it("하위 폴더로 내려간다", () => {
    expect(resolveHref("01-삭제-관통/spec.md", "tickets/01.md", FILES)).toEqual({
      kind: "doc",
      path: "01-삭제-관통/tickets/01.md",
    });
  });

  it("상위 폴더로 올라간다", () => {
    expect(resolveHref("01-삭제-관통/spec.md", "../overview.md", FILES)).toEqual({
      kind: "doc",
      path: "overview.md",
    });
    expect(resolveHref("01-삭제-관통/tickets/01.md", "../../overview.md", FILES)).toEqual({
      kind: "doc",
      path: "overview.md",
    });
  });

  it("spec 루트를 벗어나면 none이다 — 앱이 spec 밖 파일을 열지 않는다", () => {
    expect(resolveHref("overview.md", "../secret.md", FILES)).toEqual({ kind: "none" });
    expect(resolveHref("01-삭제-관통/spec.md", "../../../etc/passwd", FILES)).toEqual({
      kind: "none",
    });
  });

  it("퍼센트 인코딩된 경로를 목록의 이름으로 되돌린다", () => {
    // 마크다운 렌더러가 [스펙](01-삭제-관통/spec.md)를 이 형태로 넘긴다
    const encoded = "01-%EC%82%AD%EC%A0%9C-%EA%B4%80%ED%86%B5/spec.md";
    expect(resolveHref("overview.md", encoded, FILES)).toEqual({
      kind: "doc",
      path: "01-삭제-관통/spec.md",
    });
  });

  it("spec 안이지만 목록에 없으면 missing이다", () => {
    expect(resolveHref("overview.md", "./없는문서.md", FILES)).toEqual({
      kind: "missing",
      path: "없는문서.md",
    });
  });

  it("http·https만 external이다", () => {
    expect(resolveHref("overview.md", "https://github.com/a/b", FILES)).toEqual({
      kind: "external",
      url: "https://github.com/a/b",
    });
    expect(resolveHref("overview.md", "http://localhost:1420", FILES)).toEqual({
      kind: "external",
      url: "http://localhost:1420",
    });
  });

  it("앵커는 none이다 — 같은 문서 안 이동은 범위 밖", () => {
    expect(resolveHref("overview.md", "#결정-1", FILES)).toEqual({ kind: "none" });
  });

  it("http·https가 아닌 스킴은 none이다", () => {
    expect(resolveHref("overview.md", "mailto:a@b.com", FILES)).toEqual({ kind: "none" });
    expect(resolveHref("overview.md", "file:///etc/passwd", FILES)).toEqual({ kind: "none" });
    expect(resolveHref("overview.md", "javascript:alert(1)", FILES)).toEqual({ kind: "none" });
  });

  it("경로 뒤 앵커는 떼고 문서만 연다 — 앵커로 스크롤하지는 않는다", () => {
    expect(resolveHref("overview.md", "research/prompt.md#질문", FILES)).toEqual({
      kind: "doc",
      path: "research/prompt.md",
    });
  });

  it("href가 없거나 비어 있으면 none이다", () => {
    expect(resolveHref("overview.md", "", FILES)).toEqual({ kind: "none" });
    expect(resolveHref("overview.md", undefined, FILES)).toEqual({ kind: "none" });
  });

  it("보고 있는 파일이 없으면 none이다 — 기준이 없으면 상대경로를 풀 수 없다", () => {
    expect(resolveHref(null, "./other.md", FILES)).toEqual({ kind: "none" });
  });
});

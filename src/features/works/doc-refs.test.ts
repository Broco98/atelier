import { describe, expect, it } from "vitest";
import { calloutKind, expandHome, resolveHref, resolveImageSrc } from "./doc-refs";

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

describe("expandHome", () => {
  it("~를 홈으로 편다 — 코어가 홈을 축약해 넘기므로 그대로는 URL을 만들 수 없다", () => {
    expect(expandHome("~/.atelier/works/x/spec", "/Users/gim")).toBe(
      "/Users/gim/.atelier/works/x/spec",
    );
  });

  it("홈에 붙은 슬래시를 겹치지 않게 한다 — 플랫폼 API가 끝에 슬래시를 붙여 준다", () => {
    expect(expandHome("~/.atelier", "/Users/gim/")).toBe("/Users/gim/.atelier");
  });

  it("~로 시작하지 않으면 그대로다", () => {
    expect(expandHome("/tmp/spec", "/Users/gim")).toBe("/tmp/spec");
  });
});

describe("resolveImageSrc", () => {
  const ROOT = "/Users/gim/.atelier/works/x/spec";
  const IMAGES = [...FILES, "shot.png", "images/panel.png", "01-삭제-관통/before.png"];

  it("같은 폴더의 이미지를 spec 루트 기준 절대 경로로 편다", () => {
    expect(resolveImageSrc(ROOT, "overview.md", "shot.png", IMAGES)).toEqual({
      kind: "file",
      path: `${ROOT}/shot.png`,
    });
  });

  it("하위 폴더 이미지도 편다", () => {
    expect(resolveImageSrc(ROOT, "overview.md", "images/panel.png", IMAGES)).toEqual({
      kind: "file",
      path: `${ROOT}/images/panel.png`,
    });
  });

  it("상위 폴더 참조도 spec 루트 안이면 편다", () => {
    expect(resolveImageSrc(ROOT, "01-삭제-관통/spec.md", "../shot.png", IMAGES)).toEqual({
      kind: "file",
      path: `${ROOT}/shot.png`,
    });
  });

  it("spec 루트를 벗어나면 그리지 않는다", () => {
    expect(resolveImageSrc(ROOT, "overview.md", "../../secret.png", IMAGES)).toEqual({
      kind: "missing",
    });
  });

  it("http·https는 변환 없이 그대로 통과한다", () => {
    expect(resolveImageSrc(ROOT, "overview.md", "https://example.com/a.png", IMAGES)).toEqual({
      kind: "url",
      url: "https://example.com/a.png",
    });
  });

  it("목록에 없는 이미지는 missing이다 — 깨진 아이콘 대신 자리표시가 선다", () => {
    expect(resolveImageSrc(ROOT, "overview.md", "없는그림.png", IMAGES)).toEqual({
      kind: "missing",
    });
  });

  it("spec 루트를 모르면 로컬 이미지는 그리지 않는다 — 아카이브 화면이 그렇다", () => {
    expect(resolveImageSrc(null, "overview.md", "shot.png", IMAGES)).toEqual({ kind: "missing" });
    // 외부 URL은 루트를 몰라도 그릴 수 있다
    expect(resolveImageSrc(null, "overview.md", "https://example.com/a.png", IMAGES)).toEqual({
      kind: "url",
      url: "https://example.com/a.png",
    });
  });
});

describe("calloutKind", () => {
  it.each(["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"])(
    "%s 마커를 알아본다 — 제목이 없으면 종류 이름이 제목이 된다",
    (kind) => {
      expect(calloutKind(`[!${kind}]`)).toEqual({ kind, title: null });
    },
  );

  it("마커 뒤 텍스트가 제목이 된다", () => {
    expect(calloutKind("[!WARNING] 되돌릴 수 없어요")).toEqual({
      kind: "WARNING",
      title: "되돌릴 수 없어요",
    });
  });

  it("대소문자를 가리지 않는다 — GitHub·Obsidian 둘 다 그렇다", () => {
    expect(calloutKind("[!note]")).toEqual({ kind: "NOTE", title: null });
    expect(calloutKind("[!Tip] 힌트")).toEqual({ kind: "TIP", title: "힌트" });
  });

  // 기존 스펙들이 `> **커버:** …` 같은 평범한 인용을 많이 쓴다. 그것들이 갑자기
  // 색을 갖게 되면 회귀다 — 마커가 있을 때**만** 콜아웃이다.
  it("마커가 없는 인용은 콜아웃이 아니다", () => {
    expect(calloutKind("**커버:** 이 문서가 답하는 것")).toBeNull();
    expect(calloutKind("")).toBeNull();
  });

  it("알 수 없는 마커는 콜아웃이 아니다", () => {
    expect(calloutKind("[!TODO] 나중에")).toBeNull();
    expect(calloutKind("[!] 빈 것")).toBeNull();
  });

  it("마커가 첫 줄 맨 앞에 있어야 한다", () => {
    expect(calloutKind("앞말 [!NOTE] 뒷말")).toBeNull();
  });
});

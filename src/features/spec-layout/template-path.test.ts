import { describe, expect, it } from "vitest";
import { templatePathFor } from "./template-path";

// 템플릿 파일의 이름 짓기(spec 레이아웃 티켓 12 · 구현 스펙 5절 「템플릿 파일은 `layout.json`과 같은 폴더에
// 둔다」 · 결정 6). **경로는 사람이 적지 않는다** — 편집기가 템플릿을 켤 때 이름 틀과 이미 쓰인 경로들을
// 보고 한 번 정한다. 템플릿은 `layout.json`과 같은 폴더에 선다.

describe("템플릿 경로 이름 짓기", () => {
  it("고정 이름은 그 이름을 그대로 쓴다", () => {
    expect(templatePathFor("decisions.md", [])).toBe("decisions.md");
  });

  // 자리 표시자의 중괄호만 걷는다 — 파일 이름에 남은 글자가 어느 자리였는지 알려 준다.
  it("이름 틀은 자리 표시자를 걷어 낸 이름을 쓴다", () => {
    expect(templatePathFor("adr-{n}-{name}.md", [])).toBe("adr-n-name.md");
    expect(templatePathFor("{name}.md", [])).toBe("name.md");
  });

  // 번호는 확장자 앞에 붙는다 — 편집기에서 열어도 같은 종류의 파일로 읽힌다.
  it("이미 쓰인 이름과 겹치면 `-2`, `-3`을 붙인다", () => {
    expect(templatePathFor("decisions.md", ["decisions.md"])).toBe("decisions-2.md");
    expect(templatePathFor("decisions.md", ["decisions.md", "decisions-2.md"])).toBe("decisions-3.md");
    expect(templatePathFor("{n}-{name}", ["n-name"])).toBe("n-name-2");
  });

  // macOS의 기본 파일 시스템에서 `Decisions.md`와 `decisions.md`는 같은 파일이다 — 글자로만 가리면 두
  // 항목이 한 파일을 나눠 쓰다 한쪽의 본문이 다른 쪽을 덮는다.
  it("대소문자만 다른 이름도 겹침으로 친다", () => {
    expect(templatePathFor("Decisions.md", ["decisions.md"])).toBe("Decisions-2.md");
    expect(templatePathFor("adr.md", ["ADR.md", "Adr-2.md"])).toBe("adr-3.md");
  });

  // 레이아웃 파일 자신을 템플릿으로 삼으면 저장이 그 본문으로 레이아웃을 덮는다 — 엔진은 그런 레이아웃을
  // 거절한다. 같은 폴더라 이름 틀이 `layout.json`이면 부딪치고, 대소문자만 달라도 같은 파일이다.
  it("`layout.json`은 피하고, `Layout.json`도 피한다", () => {
    expect(templatePathFor("layout.json", [])).toBe("layout-2.json");
    expect(templatePathFor("Layout.json", [])).toBe("Layout-2.json");
    expect(templatePathFor("LAYOUT.JSON", ["layout-2.json"])).toBe("LAYOUT-3.JSON");
  });

  // 점으로 시작하는 파일은 엔진이 보지 않는다(원자적 쓰기의 임시 파일 자리다) — 그런 이름의 템플릿은
  // 디스크에 있어도 늘 「없는 템플릿」이라 에이전트가 `Template:` 줄을 받지 못한다. 이름이 남지 않으면
  // (막 더한 빈 이름 틀) 이름을 하나 지어 준다.
  it("앞의 점은 떼고, 남는 이름이 없으면 `template.md`다", () => {
    expect(templatePathFor(".env", [])).toBe("env");
    expect(templatePathFor("", [])).toBe("template.md");
    expect(templatePathFor("..", [])).toBe("template.md");
    expect(templatePathFor("", ["Template.md"])).toBe("template-2.md");
  });

  // 경로는 켤 때 한 번 정하고 이름 틀을 따라가지 않는다 — 이름 틀에 잠깐 든 `/`가 경로에 남으면 템플릿이
  // 하위 폴더(`a/b.md`)에 서거나, 앞의 점을 뗀 `../x.md`가 절대 경로(`/x.md`)가 되어 저장이 늘 거절한다.
  // 마지막 조각만 쓰면 템플릿은 늘 레이아웃 폴더 바로 아래다.
  it("이름 틀에 `/`가 들어 있으면 마지막 조각만 쓴다", () => {
    expect(templatePathFor("a/b.md", [])).toBe("b.md");
    expect(templatePathFor("../x.md", [])).toBe("x.md");
    expect(templatePathFor("sub/.x.md", [])).toBe("x.md");
    expect(templatePathFor("a\\b.md", [])).toBe("b.md");
    expect(templatePathFor("docs/", [])).toBe("template.md");
    expect(templatePathFor("a/decisions.md", ["decisions.md"])).toBe("decisions-2.md");
  });
});

/// <reference types="node" />
// 소스 스캔 두 건 때문에 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import {
  recallTab,
  rememberTab,
  tabSearch,
  validateWorkSearch,
  viewTab,
  workSlugOf,
} from "./-work-search";

// 주소 ↔ 화면 탭의 규칙. 라우터를 띄우는 seam(router.test.ts)에서는 **이것이 안 보인다** —
// 그쪽이 관찰하는 `location.search`는 주소에 적힌 것 그대로라, 모르는 값을 무엇으로 읽는지가
// 드러나지 않는다. 그 판정이 여기 두 함수에 있고 그래서 여기서 본다.

describe("주소에 적히는 것", () => {
  it("터미널만 적힌다", () => {
    expect(validateWorkSearch({ tab: "terminal" })).toEqual({ tab: "terminal" });
  });

  // 값이 없으면 spec이라는 규칙이 이미 있다. `tab=spec`은 같은 것을 두 번 적는 것이다.
  it("spec은 적지 않는다", () => {
    expect(validateWorkSearch({ tab: "spec" })).toEqual({});
    expect(validateWorkSearch({})).toEqual({});
  });

  // 결정 15가 막으려는 사고가 여기서도 난다 — 탭을 적으면서 문서를 지우면 안 된다.
  it("보던 문서와 함께 적힌다", () => {
    expect(validateWorkSearch({ file: "overview.md", tab: "terminal" })).toEqual({
      file: "overview.md",
      tab: "terminal",
    });
  });
});

describe("주소를 화면 탭으로 읽는 것", () => {
  it("terminal이면 터미널이다", () => {
    expect(viewTab({ tab: "terminal" })).toBe("terminal");
  });

  // 라우터가 모르는 키를 그대로 흘려보내므로 이 값들이 **실제로 온다.**
  it("없거나 모르는 값이면 spec이다", () => {
    for (const tab of [undefined, "", "spec", "zzz", "Terminal", "terminal "]) {
      expect(viewTab({ tab }), JSON.stringify(tab)).toBe("spec");
    }
  });
});

// 결정 77. work을 옮길 때 `file`은 떨어뜨리고 `tab`은 되살린다. 라우터 seam에서는 이것도
// 안 보인다 — 그쪽은 주소에 적힌 것만 보고, 「새 주소를 무엇으로 짓는가」는 여기 있다.
//
// **모듈 스코프 Map이라 이 파일 안에서 새어 나간다.** 검사마다 다른 슬러그를 쓴다 —
// 비우는 함수를 내보내면 생산 코드에 아무도 안 부르는 이름이 하나 생긴다.
// 주소에서 work을 읽는 자리. 읽는 쪽이 둘이라(사이드바 목록의 강조, 가지가 자기 화면인지
// 아는 것) 한 곳에 뒀다.
describe("주소가 가리키는 work", () => {
  it("`/works/…`가 아니면 없다", () => {
    expect(workSlugOf("/projects")).toBeNull();
    expect(workSlugOf("/terminal")).toBeNull();
  });

  it("슬러그를 그대로 준다", () => {
    expect(workSlugOf("/works/plain-work")).toBe("plain-work");
  });

  // **슬러그에 한글이 들어간다.** 디코드를 잊으면 한글 work에서만 조용히 어긋나 —
  // 화면으로는 「가끔 강조가 안 된다」로만 보인다. 이 저장소에 그런 work가 실제로 있다.
  it("한글 슬러그를 편다", () => {
    expect(workSlugOf(`/works/${encodeURIComponent("세션-내-에이전트")}`)).toBe("세션-내-에이전트");
  });
});

describe("work마다 마지막으로 보던 본문", () => {
  it("적어 두지 않은 work은 문서다", () => {
    expect(recallTab("처음-보는-work")).toBe("spec");
  });

  it("적어 둔 것을 그대로 돌려준다", () => {
    rememberTab("가", "terminal");
    expect(recallTab("가")).toBe("terminal");
    // 되돌아오는 것도 기억이다 — `terminal`만 적어 두면 문서로 돌아온 것을 못 적는다.
    rememberTab("가", "spec");
    expect(recallTab("가")).toBe("spec");
  });

  it("work마다 따로 센다", () => {
    rememberTab("나", "terminal");
    expect(recallTab("다")).toBe("spec");
  });

  // 주소를 짓는 짝이 이 둘이다. `tabSearch`에 **빈 객체를 얹으므로** 이전 주소가 통째로
  // 버려지고 `file`이 안 딸려간다 — 결정 77이 그대로 두기로 한 절반이다.
  it("빈 주소 위에 얹어 새 주소를 짓는다", () => {
    rememberTab("라", "terminal");
    expect(tabSearch({}, recallTab("라"))).toEqual({ tab: "terminal" });
    rememberTab("마", "spec");
    expect(tabSearch({}, recallTab("마"))).toEqual({ tab: undefined });
  });
});

// 배선. 주소를 짓는 자리가 둘이라(사이드바 행과 정규화) **한쪽만 고치면** 어느 길로
// 옮겼느냐에 따라 돌아온 화면이 갈린다 — 화면으로는 「가끔 그런다」로만 보인다.
describe("보던 본문을 되살리는 자리가 둘 다 배선돼 있다", () => {
  const read = (file: string) =>
    readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");

  it("주소 정규화로 옮겨 갈 때", () => {
    expect(read("./-works-view.tsx")).toContain("search: tabSearch({}, recallTab(next)),");
  });

  it("사이드바에서 작업 행을 눌렀을 때", () => {
    expect(read("../features/works/SidebarWorkList.tsx")).toContain(
      "search: tabSearch({}, recallTab(slug)),",
    );
  });

  it("도착한 주소를 적어 두는 자리가 하나다", () => {
    // 탭을 옮기는 길이 넷이다(`spec` 잎 · 셸 행 · ⌘1~9 · ⌃Tab). 넷이 전부 주소를 바꾸므로
    // 도착한 주소를 한 번 적으면 넷을 다 덮는다 — 길마다 적으면 한 길만 늙는다.
    const view = read("./-works-view.tsx");
    expect(view.split("rememberTab(").length - 1).toBe(1);
    expect(view).toContain("if (slug !== null && exists) rememberTab(slug, tab);");
  });
});

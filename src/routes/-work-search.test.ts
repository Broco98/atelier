/// <reference types="node" />
// 소스 스캔 한 건 때문에 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
// (되살리는 자리를 원문으로 세던 두 건은 `recallSearch`의 값 검사로 옮겼다 — 아래 describe.)
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import {
  bundleSearch,
  chatHome,
  chatSearch,
  codeSearch,
  columnSearch,
  forgetVanishedViews,
  openingSearch,
  recallSearch,
  recallView,
  rememberView,
  splitOf,
  fileSearch,
  splitSearch,
  tabSearch,
  validateWorkSearch,
  viewTab,
  workDoor,
} from "./-work-search";

// 주소 ↔ 화면 탭의 규칙. 라우터를 띄우는 seam(router.test.ts)에서는 **이것이 안 보인다** —
// 그쪽이 관찰하는 `location.search`는 주소에 적힌 것 그대로라, 모르는 값을 무엇으로 읽는지가
// 드러나지 않는다. 그 판정이 여기 두 함수에 있고 그래서 여기서 본다.

describe("주소에 적히는 것", () => {
  it("터미널이 적힌다", () => {
    expect(validateWorkSearch({ tab: "terminal" })).toEqual({ tab: "terminal" });
  });

  // restart 02a-4 — 채팅 탭은 `tab=chat`과 `thread=<id>`로 적힌다. 어느 채팅인지가 `thread`다.
  it("채팅 탭은 `chat`과 그 채팅으로 적힌다", () => {
    expect(validateWorkSearch({ tab: "chat", thread: "20261010-100000" })).toEqual({
      tab: "chat",
      thread: "20261010-100000",
    });
    expect(validateWorkSearch({ tab: "chat", thread: "" })).toEqual({ tab: "chat" });
  });

  // restart 02a-4 — **임시로** spec도 적는다(02a-13이 걷는다). 값이 없으면 이제 채팅이라, spec을 안 적으면 spec 탭을 켤 길이 없다.
  it("spec도 적힌다 — 값이 없는 것과 다르다", () => {
    expect(validateWorkSearch({ tab: "spec" })).toEqual({ tab: "spec" });
    expect(validateWorkSearch({})).toEqual({});
  });

  // 결정 15가 막으려는 사고가 여기서도 난다 — 탭을 적으면서 문서를 지우면 안 된다.
  it("보던 문서와 함께 적힌다", () => {
    expect(validateWorkSearch({ file: "overview.md", tab: "terminal" })).toEqual({
      file: "overview.md",
      tab: "terminal",
    });
  });

  // 결정 97. 분할만 주소 밖에 두면 「주소가 정본」 규칙이 둘이 된다.
  it("분할도 셋과 함께 적힌다", () => {
    expect(validateWorkSearch({ file: "overview.md", tab: "terminal", split: "rl" })).toEqual({
      file: "overview.md",
      tab: "terminal",
      split: "rl",
    });
  });

  it("단일 뷰는 적지 않는다", () => {
    expect(validateWorkSearch({ split: "zzz" })).toEqual({});
    expect(validateWorkSearch({})).toEqual({});
  });
});

describe("주소를 화면 탭으로 읽는 것", () => {
  it("terminal이면 터미널이고 spec이면 문서다", () => {
    expect(viewTab({ tab: "terminal" })).toBe("terminal");
    expect(viewTab({ tab: "spec" })).toBe("spec");
  });

  // 라우터가 모르는 키를 그대로 흘려보내므로 이 값들이 **실제로 온다.** restart 02a-4 — `spec`이 맡던 기본 값을 `chat`이 물려받았다.
  it("없거나 모르는 값이면 채팅이다", () => {
    for (const tab of [undefined, "", "chat", "zzz", "Terminal", "terminal "]) {
      expect(viewTab({ tab }), JSON.stringify(tab)).toBe("chat");
    }
  });

  it("가리키는 파일이 없는 `tab=code`도 채팅이다", () => {
    expect(viewTab({ tab: "code" })).toBe("chat");
    expect(viewTab({ tab: "code", code: "billing/src/a.ts" })).toBe("code");
  });
});

describe("주소를 분할로 읽는 것", () => {
  it("아는 값 둘만 분할이다", () => {
    expect(splitOf({ split: "lr" })).toBe("lr");
    expect(splitOf({ split: "rl" })).toBe("rl");
  });

  // `viewTab`이 이미 막고 있는 함정과 **같은 자리**다 — 루트에 검증기가 없어 이 값들이
  // 실제로 컴포넌트까지 온다. 눕히는 자리가 없으면 `?split=zzz`가 열 둘을 세운다.
  it("없거나 모르는 값이면 단일 뷰다", () => {
    for (const split of [undefined, "", "none", "zzz", "LR", "lr "]) {
      expect(splitOf({ split }), JSON.stringify(split)).toBeNull();
    }
  });
});

describe("주소를 고치는 짝", () => {
  // 축이 둘인 것이 요점이다 — 하나를 바꾸면서 다른 하나를 지우면 안 된다.
  it("탭을 바꿔도 분할이 남는다", () => {
    expect(tabSearch({ file: "a.md", split: "rl" as const }, "terminal")).toEqual({
      file: "a.md",
      split: "rl",
      tab: "terminal",
    });
  });

  it("분할을 꺼도 탭이 남는다", () => {
    expect(splitSearch({ file: "a.md", tab: "terminal" as const }, null)).toEqual({
      file: "a.md",
      tab: "terminal",
      split: undefined,
    });
  });

  // **축이 셋이다.** 문서를 바꾸는 자리가 오래 이 파일 밖에 있었고, 그래서 `tab`·`split`이
  // 생긴 뒤에도 객체를 통째로 주는 옛 모양이 남아 문서를 고르면 분할이 무너졌다(실측).
  it("문서를 바꿔도 분할이 남는다", () => {
    expect(fileSearch({ file: "a.md", split: "rl" as const, tab: "terminal" as const }, "b.md")).toEqual({
      file: "b.md",
      split: "rl",
      // 문서를 고르면 본문은 spec으로 돌아온다(결정 50) — `tab`은 **분할을 끄면 남는 쪽**이라
      // 이 갱신이 분할을 건드리지 않는다. restart 02a-4 — 임시로 `spec`을 적는다: 안 적으면 채팅으로 떨어진다.
      tab: "spec",
    });
  });

  // restart 02a-4 — 채팅에서 문서를 골라도 spec이 켜진다. `thread`는 채팅 탭이 서 있을 때만 뜻이 있어 함께 걷힌다.
  it("채팅에서 문서를 고르면 spec이 켜지고 채팅은 주소에서 걷힌다", () => {
    expect(fileSearch({ tab: "chat" as const, thread: "20261010-100000" }, "b.md")).toEqual({
      file: "b.md",
      tab: "spec",
      code: undefined,
      thread: undefined,
    });
  });
});

// restart 02a-4 — 채팅 탭의 축. `thread`는 `code`와 같은 성질이다: 본문(`tab=chat`)이나 분할의 묶음 열에 채팅이 설 때만 주소에 있다.
describe("채팅 탭의 주소", () => {
  const X = "20261010-100000";

  it("채팅으로 가면 `chat`과 그 채팅이 적히고 보던 파일 탭은 걷힌다 — 문서는 남는다", () => {
    expect(chatSearch({ file: "a.md", tab: "code" as const, code: "billing/src/a.ts" }, X)).toEqual({
      file: "a.md",
      tab: "chat",
      code: undefined,
      thread: X,
    });
  });

  it("셸 · 파일 탭 · 문서로 옮기면 채팅이 주소에서 걷힌다", () => {
    const here = { tab: "chat" as const, thread: X };
    expect(tabSearch(here, "terminal")).toEqual({ tab: "terminal", code: undefined, thread: undefined });
    expect(tabSearch(here, "spec")).toEqual({ tab: "spec", code: undefined, thread: undefined });
    expect(codeSearch(here, "billing/src/a.ts")).toEqual({ tab: "code", code: "billing/src/a.ts", thread: undefined });
  });

  // 분할의 `thread`는 **묶음 열**의 것이다 — `code`와 같다(git-integration 티켓 07). 문서 열에 포커스가 가도 옆 열은 그 채팅이다.
  it("분할에서는 문서 열로 가도 묶음 열의 채팅이 남고, 셸로 가면 걷힌다", () => {
    const here = { tab: "chat" as const, thread: X, split: "lr" as const };
    expect(tabSearch(here, "spec")).toEqual({ tab: "spec", thread: X, code: undefined, split: "lr" });
    expect(tabSearch(here, "terminal")).toEqual({ tab: "terminal", thread: undefined, code: undefined, split: "lr" });
  });

  it("묶음 쪽에서 채팅이 켜지면 본문이 따라간다 — 문서를 보는 단일 뷰는 그대로다", () => {
    expect(bundleSearch({ tab: "terminal" as const }, { kind: "chat", thread: X })).toEqual({
      tab: "chat",
      code: undefined,
      thread: X,
    });
    expect(bundleSearch({ tab: "chat" as const, thread: X }, { kind: "shell" })).toEqual({
      tab: "terminal",
      code: undefined,
      thread: undefined,
    });
    expect(bundleSearch({ tab: "spec" as const, file: "a.md" }, { kind: "chat", thread: X })).toEqual({
      tab: "spec",
      file: "a.md",
      code: undefined,
      thread: undefined,
    });
  });

  it("분할을 켜면 묶음 열에 지금 탭의 채팅이 서고, 끄고 문서를 남기면 걷힌다", () => {
    expect(columnSearch({ tab: "chat" as const, thread: X }, "lr", "terminal", { kind: "chat", thread: X })).toEqual({
      tab: "chat",
      split: "lr",
      code: undefined,
      thread: X,
    });
    expect(columnSearch({ tab: "spec" as const, thread: X, split: "lr" as const }, null, "spec", { kind: "chat", thread: X })).toEqual({
      tab: "spec",
      split: undefined,
      code: undefined,
      thread: undefined,
    });
  });

  // 작업공간을 처음 여는 규칙 — 가장 최근 채팅 탭 하나가 선다. 채팅이 없는 작업공간은 **임시로** spec이다(02a-8이 새 채팅 탭으로 바꾼다).
  it("처음 여는 주소는 가장 최근 채팅이고, 채팅이 없으면 임시로 spec이다", () => {
    expect(openingSearch({ file: "a.md" }, { kind: "thread", id: X })).toEqual({
      file: "a.md",
      tab: "chat",
      code: undefined,
      thread: X,
    });
    expect(openingSearch({}, { kind: "new", work: "가" })).toEqual({ tab: "spec", code: undefined, thread: undefined });
  });
});

// restart 02a-4 — **보내는 조건.** 작업공간이 살아 있는 채팅만 작업공간 화면에 선다. 판단은 코어가 주는 `gone`(`readOnly`)으로 한다 — 목록은 방금
// 만든 작업공간을 아직 모를 수 있다.
describe("채팅이 서는 작업공간", () => {
  it("작업공간에 이었고 그 작업공간이 살아 있으면 그 slug다", () => {
    expect(chatHome({ work: "가", readOnly: null })).toBe("가");
  });

  it("작업공간 밖 채팅 · 보관되거나 지워진 작업공간의 채팅은 없다", () => {
    expect(chatHome({ work: null, readOnly: null })).toBeNull();
    expect(chatHome({ work: "가", readOnly: "archived" })).toBeNull();
    expect(chatHome({ work: "가", readOnly: "removed" })).toBeNull();
  });
});

// 주소에서 항목을 읽는 자리는 이 파일에 없다 — `@/lib/path-prefix`의 `workSlugOf` 하나다. 답이 갈리는 파서
// 둘을 남겨 두면 다음 사람이 어느 쪽을 집는지가 우연이 되므로 하나만 둔다(항목 아래로 화면이 갈라지는 날 첫
// 칸만 slug여야 한다). 그물은 `path-prefix.test.ts`의 「주소에서 slug를 읽는다」가 든다.

// 결정 77. work을 옮길 때 떠나던 주소는 버리고 **그 work의 기억**을 되살린다. 라우터
// seam에서는 이것도 안 보인다 — 그쪽은 주소에 적힌 것만 보고, 「새 주소를 무엇으로
// 짓는가」는 여기 있다.
//
// **모듈 스코프 Map이라 이 파일 안에서 새어 나간다.** 검사마다 다른 슬러그를 쓴다 —
// 비우는 함수를 내보내면 생산 코드에 아무도 안 부르는 이름이 하나 생긴다.
describe("work마다 마지막으로 보던 화면", () => {
  it("적어 두지 않은 work은 어느 채팅인지 모르는 채팅 탭 단일 뷰다", () => {
    expect(recallView("처음-보는-work")).toEqual({ tab: "chat", split: null, file: null, code: null, thread: null });
  });

  it("적어 둔 것을 그대로 돌려준다", () => {
    rememberView("가", { tab: "terminal", split: "rl", file: "01-판/spec.md", code: null, thread: null });
    expect(recallView("가")).toEqual({ tab: "terminal", split: "rl", file: "01-판/spec.md", code: null, thread: null });
    // 되돌아오는 것도 기억이다 — 켠 것만 적어 두면 끈 것을 못 적는다.
    rememberView("가", { tab: "spec", split: null, file: null, code: null, thread: null });
    expect(recallView("가")).toEqual({ tab: "spec", split: null, file: null, code: null, thread: null });
  });

  it("work마다 따로 센다", () => {
    rememberView("나", { tab: "terminal", split: "lr", file: "01-판/spec.md", code: null, thread: null });
    expect(recallView("다")).toEqual({ tab: "chat", split: null, file: null, code: null, thread: null });
  });

  // **work을 여는 문이 전부 이 값을 쓴다** — `recallSearch`가 그 합성의 이름이다. 빈 객체
  // 위에 얹으므로 이전 주소가 통째로 버려진다: 실리는 것은 그 work의 기억뿐이라 **남의**
  // `file`이 딸려갈 자리가 없다. 아래 넷이 이 함수의 **값**을 재는 것이 문마다 원문을
  // 대조하는 것을 대신한다 — 문은 늘지만 값은 하나다.
  it("빈 주소 위에 얹어 새 주소를 짓는다", () => {
    rememberView("라", { tab: "terminal", split: "lr", file: "01-판/spec.md", code: null, thread: null });
    expect(recallSearch("라")).toEqual({
      tab: "terminal",
      split: "lr",
      file: "01-판/spec.md",
    });
    rememberView("마", { tab: "spec", split: null, file: null, code: null, thread: null });
    expect(recallSearch("마")).toEqual({
      tab: "spec",
      split: undefined,
      file: undefined,
    });
  });

  // **분할로 두고 떠난 work은 분할로 돌아온다**(판 05 수용 기준의 마지막 줄). `tab`만
  // 씨앗에 실으면 이 한 줄이 조용히 빠진다.
  it("분할로 두고 떠난 work은 분할로 돌아온다", () => {
    rememberView("바", { tab: "terminal", split: "rl", file: null, code: null, thread: null });
    rememberView("사", { tab: "spec", split: null, file: null, code: null, thread: null });
    expect(recallSearch("바")).toEqual({
      tab: "terminal",
      split: "rl",
      file: undefined,
    });
  });

  // **보던 문서도 씨앗에 실린다**(#156 수용 기준 2 — 「문서·탭·분할이 살아 있다」). `tab`과
  // `split`만 실으면 돌아온 work이 기본 문서로 열려, 축 셋 중 하나가 조용히 빠진다 —
  // 화면으로는 「가끔 다른 문서가 떠 있다」로만 보인다.
  it("문서를 보다 떠난 work은 그 문서로 돌아온다", () => {
    rememberView("아", { tab: "spec", split: null, file: "02-판/spec.md", code: null, thread: null });
    expect(recallSearch("아")).toEqual({
      tab: "spec",
      split: undefined,
      file: "02-판/spec.md",
    });
  });

  // **분할의 `code`는 포커스가 문서 열이어도 실린다**(git-integration 티켓 07 · 스토리 60). 분할에서 `code`는 묶음 열의 것이라
  // `tab`이 spec이어도 그 열은 그 파일이다. 「`tab`이 `code`일 때만 싣는다」로 거르면 돌아온 분할의 묶음 열이 셸로 선다.
  it("분할에서 문서 열에 포커스를 두고 떠난 work은 묶음 열의 파일과 함께 돌아온다", () => {
    rememberView("자", { tab: "spec", split: "lr", file: null, code: "billing/src/a.ts", thread: null });
    expect(recallSearch("자")).toEqual({
      tab: "spec",
      split: "lr",
      file: undefined,
      code: "billing/src/a.ts",
    });
  });

  // restart 02a-4 — 화면 기억이 `thread`를 든다. 채팅 탭을 보다 떠난 작업공간은 그 채팅 탭으로 돌아온다.
  it("채팅을 보다 떠난 work은 그 채팅으로 돌아온다", () => {
    rememberView("하", { tab: "chat", split: null, file: "02-판/spec.md", code: null, thread: "20261010-100000" });
    expect(recallSearch("하")).toEqual({
      tab: "chat",
      split: undefined,
      file: "02-판/spec.md",
      thread: "20261010-100000",
    });
  });

  // 어느 채팅인지 모르는 채팅 탭은 주소에 적지 않는다 — 값이 없는 주소에 닿으면 작업공간을 처음 여는 규칙이 탭을 세운다(`openingSearch`).
  it("아직 안 본 work의 씨앗에는 탭이 없다", () => {
    expect(recallSearch("처음-여는-work")).toEqual({ tab: undefined, split: undefined, file: undefined });
  });

  // git-integration 판 01 — **키가 slug라** 삭제로 풀린 slug에 새 work이 서면 지운 work의 기억이 그 work의 씨앗이 된다.
  // `code`가 실려 있으면 새 work의 묶음에 옛 파일 탭이 다시 열린다(스토리 60 — 주소가 가리키는 파일은 연다). 목록에서
  // 사라지면 걷는다. **이 describe의 마지막에 둔다** — 목록에 없는 slug를 모두 걷으므로 앞의 기억도 함께 걷힌다.
  it("목록에서 사라진 work의 기억은 걷히고, 목록에 남은 work의 것은 그대로다", () => {
    rememberView("차", { tab: "code", split: null, file: null, code: "billing/src/a.ts", thread: null });
    rememberView("카", { tab: "terminal", split: "lr", file: "01-판/spec.md", code: null, thread: null });
    forgetVanishedViews(["카"]);
    expect(recallView("차")).toEqual({ tab: "chat", split: null, file: null, code: null, thread: null });
    expect(recallView("카")).toEqual({ tab: "terminal", split: "lr", file: "01-판/spec.md", code: null, thread: null });
  });
});

// **`<Link>`로 work을 여는 문**(03 코드 리뷰 A1) — Service 상세의 「작업공간」 묶음 줄과 Project 제거 창의 Work 줄이다. 둘 다 처음에는 기억을
// 안 실어(`search={{}}` · `search` 없음) 그 문으로 들어간 work이 기본 화면으로 열렸고, 도착한 주소를 적는 effect가 그 기본값으로 기억을
// 덮어썼다 — `recallSearch` 머리말의 「빠뜨린 문 하나」가 Projects 문에 이어 다시 난 것이다. 문은 `workDoor`를 펼치고, 그 값을 여기서 잰다.
describe("Link로 work을 여는 문", () => {
  it("그 work의 마지막 화면을 싣는다 — 문서 · 탭 · 분할 셋 다", () => {
    rememberView("타", { tab: "terminal", split: "lr", file: "02-판/spec.md", code: null, thread: null });
    expect(workDoor("타")).toEqual({
      to: "/works/$slug",
      params: { slug: "타" },
      search: { tab: "terminal", split: "lr", file: "02-판/spec.md" },
    });
  });

  it("아직 안 본 work은 기본 화면으로 간다", () => {
    expect(workDoor("파")).toEqual({
      to: "/works/$slug",
      params: { slug: "파" },
      search: { tab: undefined, split: undefined, file: undefined },
    });
  });
});

// 배선. **되살리는 자리는 원문으로 세지 않는다.** 앞 판은 두 파일의 `search:` 줄을 문자열로
// 대조했는데, 그 사이 문이 다섯으로 늘도록 목록이 둘에 멈춰 있었다 — 늘어난 문 하나
// (Projects의 work 행)는 계약을 아예 안 탄 채로 그물이 초록이었다. 이제 다섯이 전부
// `recallSearch` 하나를 부르므로 그 값을 재는 위 검사들이 이 배선의 계약이고, 문이 여섯째로
// 늘어도 여기를 함께 고칠 일이 없다.
//
// 원문 대조가 여기 하나 남는 것은 **모양이 아니라 수**를 세기 때문이다 — 아래가 재는 것은
// 「적어 두는 자리가 몇이냐」이고, 그 수는 함수 하나로 옮길 수 있는 종류가 아니다.
describe("두 view의 배선", () => {
  const read = (file: string) =>
    readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");

  it("도착한 주소를 적어 두는 자리가 하나다", () => {
    // 화면을 옮기는 길이 여럿이다(`spec` 잎 · 셸 행 · ⌘1~9 · ⌃Tab · 분할 토글 · 드래그).
    // 전부 주소를 바꾸므로 도착한 주소를 한 번 적으면 다 덮는다 — 길마다 적으면 한 길만 늙는다.
    const view = read("./-works-view.tsx");
    expect(view.split("rememberView(").length - 1).toBe(1);
    expect(view).toContain(
      "if (slug !== null && exists) rememberView(slug, { tab, split, file, code, thread });",
    );
  });

  // **「열었다」를 적는 자리도 하나다**(결정 14) — 그리고 위와 **다른 effect**여야 한다.
  //
  // 세는 단위가 갈린다: 저쪽은 보던 **화면**(문서·탭·분할까지)이고 이쪽은 **work**이다
  // (결정 12). 위 effect에 얹으면 문서를 옮길 때마다 IPC와 파일 쓰기가 나가는데, 화면에는
  // 아무 티도 안 난다 — 그래서 의존성 배열을 **원문으로** 못 박는다.
  //
  // **소스 스캔만으로는 그 effect가 실제로 도는지 못 본다.** 짝이 L3에 있다
  // (`works-recent.spec.ts`: 화면이 서면 한 번 나가고, 문서·탭을 바꿔도 다시 안 나간다).
  it("work을 열었다고 적는 자리가 하나이고, 의존성이 work까지다", () => {
    const view = read("./-works-view.tsx");
    expect(view.split("touchRecent(").length - 1).toBe(1);
    expect(view.split("}, [slug, exists]);").length - 1).toBe(1);
  });
});

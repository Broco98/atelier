/// <reference types="node" />
// 소스 스캔 한 건 때문에 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
// (되살리는 자리를 원문으로 세던 두 건은 `recallSearch`의 값 검사로 옮겼다 — 아래 describe.)
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import {
  bundleSearch,
  cardDocSearch,
  chatHome,
  chatSearch,
  codeSearch,
  forgetVanishedViews,
  newChatDoor,
  newChatSearch,
  openingSearch,
  opensWork,
  recallSearch,
  recallView,
  rememberView,
  fileSearch,
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

  // restart 02a-13 — 문서 탭(`spec`)과 분할이 걷혔다(02a-4가 임시로 적던 `tab=spec`도). 옛 주소의 두 값은 모르는 값이라 읽지 않는다.
  it("spec 탭도 분할도 적히지 않는다", () => {
    expect(validateWorkSearch({ tab: "spec" })).toEqual({});
    expect(validateWorkSearch({ split: "lr" })).toEqual({});
    expect(validateWorkSearch({ file: "overview.md", tab: "terminal", split: "rl" })).toEqual({
      file: "overview.md",
      tab: "terminal",
    });
    expect(validateWorkSearch({})).toEqual({});
  });
});

describe("주소를 화면 탭으로 읽는 것", () => {
  it("terminal이면 터미널이다", () => {
    expect(viewTab({ tab: "terminal" })).toBe("terminal");
  });

  // 라우터가 모르는 키를 그대로 흘려보내므로 이 값들이 **실제로 온다.** restart 02a-4 — `spec`이 맡던 기본 값을 `chat`이 물려받았다. 옛 `spec`도
  // 이제 모르는 값이다(restart 02a-13 — 문서 탭이 걷혔다).
  it("없거나 모르는 값이면 채팅이다", () => {
    for (const tab of [undefined, "", "chat", "spec", "zzz", "Terminal", "terminal "]) {
      expect(viewTab({ tab }), JSON.stringify(tab)).toBe("chat");
    }
  });

  it("가리키는 파일이 없는 `tab=code`도 채팅이다", () => {
    expect(viewTab({ tab: "code" })).toBe("chat");
    expect(viewTab({ tab: "code", code: "billing/src/a.ts" })).toBe("code");
  });
});

// restart 02a-13 — **분할이 걷혔다.** 주소를 고치는 짝이 `split`을 적지 않는다 — 걷는 자리(`split: undefined`)도 남기지 않는다. 남으면 그 짝이 아직
// 분할을 아는 것이다.
describe("주소를 고치는 짝", () => {
  const X = "20261010-100000";

  it("어느 짝도 분할을 적지 않는다", () => {
    rememberView("분할-없는-기억", { tab: "terminal", file: null, code: null, thread: null });
    const made = {
      tabSearch: tabSearch({}, "terminal"),
      chatSearch: chatSearch({}, X),
      newChatSearch: newChatSearch({}),
      codeSearch: codeSearch({}, "billing/src/a.ts"),
      fileSearch: fileSearch({}, "a.md"),
      cardDocSearch: cardDocSearch({ tab: "terminal" }, "a.md", { kind: "new", work: "가" }),
      bundleSearch: bundleSearch({ tab: "terminal" }, { kind: "new-chat" }),
      openingSearch: openingSearch({}, { kind: "new", work: "가" }),
      recallSearch: recallSearch("분할-없는-기억"),
      newChatDoor: newChatDoor("분할-없는-기억").search,
    };
    for (const [name, search] of Object.entries(made)) expect(Object.keys(search), name).not.toContain("split");
  });
});

// restart 02a-4 — 채팅 탭의 축. `thread`는 `code`와 같은 성질이다: 본문(`tab=chat`)에 채팅이 설 때만 주소에 있다.
describe("채팅 탭의 주소", () => {
  const X = "20261010-100000";

  // restart 02a-12 — 한때 「문서는 남는다」였다. `file`은 이제 넓힌 카드의 문서라 파일 탭에서 온 주소에는 뜻이 없어 걷힌다(아래 「넓힌 카드의 문서 주소」).
  it("채팅으로 가면 `chat`과 그 채팅이 적히고 보던 파일 탭은 걷힌다", () => {
    expect(chatSearch({ file: "a.md", tab: "code" as const, code: "billing/src/a.ts" }, X)).toEqual({
      file: undefined,
      tab: "chat",
      code: undefined,
      thread: X,
    });
  });

  it("셸 · 파일 탭으로 옮기면 채팅이 주소에서 걷힌다", () => {
    const here = { tab: "chat" as const, thread: X };
    expect(tabSearch(here, "terminal")).toEqual({ tab: "terminal", code: undefined, thread: undefined });
    expect(codeSearch(here, "billing/src/a.ts")).toEqual({ tab: "code", code: "billing/src/a.ts", thread: undefined });
  });

  it("묶음 쪽에서 채팅이 켜지면 본문이 따라간다", () => {
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
  });

  // 작업공간을 처음 여는 규칙 — 가장 최근 채팅 탭 하나가 선다. 채팅이 없는 작업공간은 새 채팅 탭이 선다(restart 02a-8).
  it("처음 여는 주소는 가장 최근 채팅이고, 채팅이 없으면 새 채팅 탭이다", () => {
    expect(openingSearch({ file: "a.md" }, { kind: "thread", id: X })).toEqual({
      file: "a.md",
      tab: "chat",
      code: undefined,
      thread: X,
    });
    expect(openingSearch({ file: "a.md" }, { kind: "new", work: "가" })).toEqual({
      file: "a.md",
      tab: "chat",
      code: undefined,
      thread: undefined,
    });
  });
});

// restart 02a-8 — **새 채팅 탭의 주소.** `tab=chat`에 `thread`가 없다. 어느 새 채팅 탭인지는 셸 탭처럼 묶음이 쥔다. 값이 없는 주소(처음 여는 규칙)와
// 다른 주소다 — `tab=chat`을 적는다.
describe("새 채팅 탭의 주소", () => {
  const X = "20261010-100000";

  // restart 02a-12 — 한때 「문서는 남는다」였다. 채팅 탭의 넓힌 카드의 문서는 새 채팅 탭으로 따라가지 않는다(아래 「넓힌 카드의 문서 주소」).
  it("새 채팅 탭으로 가면 `chat`만 적히고 채팅 · 파일 탭은 걷힌다", () => {
    expect(newChatSearch({ file: "a.md", tab: "chat" as const, thread: X })).toEqual({
      file: undefined,
      tab: "chat",
      code: undefined,
      thread: undefined,
    });
    expect(newChatSearch({ tab: "code" as const, code: "billing/src/a.ts" })).toEqual({
      tab: "chat",
      code: undefined,
      thread: undefined,
    });
  });

  it("묶음 쪽에서 새 채팅 탭이 켜지면 본문이 따라간다", () => {
    expect(bundleSearch({ tab: "chat" as const, thread: X }, { kind: "new-chat" })).toEqual({
      tab: "chat",
      code: undefined,
      thread: undefined,
    });
    expect(bundleSearch({ tab: "terminal" as const }, { kind: "new-chat" })).toEqual({
      tab: "chat",
      code: undefined,
      thread: undefined,
    });
  });

  // 값이 없는 주소만 처음 여는 규칙을 탄다. `tab=chat`은 새 채팅 탭이라는 다른 뜻이다.
  it("처음 여는 주소는 탭 · 채팅이 없는 주소다 — `tab=chat`은 새 채팅 탭이다", () => {
    expect(opensWork({})).toBe(true);
    expect(opensWork({ tab: "zzz" })).toBe(true);
    // 가리키는 파일이 없는 `tab=code`도 기본 값이다 — 처음 여는 규칙을 탄다.
    expect(opensWork({ tab: "code" })).toBe(true);
    expect(opensWork({ tab: "chat" })).toBe(false);
    expect(opensWork({ thread: X })).toBe(false);
    expect(opensWork({ tab: "terminal" })).toBe(false);
    // 옛 문서 탭 주소도 처음 여는 주소다(restart 02a-13) — 기본 문서가 아니라 가장 최근 채팅 탭이 선다.
    expect(opensWork({ tab: "spec" })).toBe(true);
  });
});

// restart 02a-12 · 구현 스펙 「02a — `spec` 탭과 분할을 지운다」 — **`file`은 넓힌 카드의 문서다.** `tab`이 비었거나 `chat`일 때만 뜻이 있다. 셸 ·
// 파일 탭으로 가는 주소에는 남지 않는다 — 남으면 셸로 가는 주소가 채팅 탭과 넓힌 카드로 떨어진다.
describe("넓힌 카드의 문서 주소", () => {
  const X = "20261010-100000";
  const Y = "20261011-090000";

  it("셸 · 파일 탭으로 가면 `file`이 걷힌다", () => {
    const here = { tab: "chat" as const, thread: X, file: "a.md" };
    expect(tabSearch(here, "terminal").file).toBeUndefined();
    expect(tabSearch(here, "code").file).toBeUndefined();
    expect(codeSearch(here, "billing/src/a.ts").file).toBeUndefined();
  });

  // 문서를 적는 길(`fileSearch` — 검색 결과)은 채팅 탭 · 새 채팅 탭이면 그 탭에 문서를 얹는다.
  it("채팅 탭 · 새 채팅 탭에서 문서를 적으면 그 탭에 넓힌 카드의 문서가 얹힌다", () => {
    expect(fileSearch({ tab: "chat" as const, thread: X }, "b.md")).toEqual({ tab: "chat", thread: X, code: undefined, file: "b.md" });
    expect(fileSearch({ tab: "chat" as const }, "b.md")).toEqual({ tab: "chat", code: undefined, file: "b.md" });
  });

  // 셸 · 파일 탭이나 처음 여는 주소에서 적으면 `tab`을 비운다 — 처음 여는 규칙이 02a-10의 켤 탭 규칙(가장 최근에 켠 채팅 탭 → 가장 최근 채팅 →
  // 새 채팅 탭)으로 채팅 탭을 고르고 거기 넓힌 카드가 선다. `tab=chat`만 적으면 새 채팅 탭이라는 다른 뜻이다.
  it("셸 · 파일 탭에서 문서를 적으면 탭을 비워 처음 여는 규칙이 채팅 탭을 고른다", () => {
    for (const prev of [{ tab: "terminal" as const }, { tab: "code" as const, code: "billing/src/a.ts" }, {}]) {
      const next = fileSearch(prev, "b.md");
      expect(next, JSON.stringify(prev)).toEqual({ tab: undefined, code: undefined, thread: undefined, file: "b.md" });
      expect(opensWork(next)).toBe(true);
    }
  });

  // SummarySheet 표 「다른 채팅 탭을 켠다 → 넓힌 카드는 작은 카드로」 — 넓힌 카드의 문서는 그 탭의 것이라 다른 채팅 탭 · 새 채팅 탭으로 따라가지
  // 않는다. 따라가면 다른 작업공간에서 그 채팅으로 돌아올 때 넓힌 카드가 다시 선다. 같은 채팅 탭이면 그대로다.
  it("다른 채팅 탭 · 새 채팅 탭으로 가면 `file`이 걷히고, 같은 채팅 탭이면 남는다", () => {
    const onX = { tab: "chat" as const, thread: X, file: "a.md" };
    expect(chatSearch(onX, Y).file).toBeUndefined();
    expect(chatSearch(onX, X).file).toBe("a.md");
    expect(newChatSearch(onX).file).toBeUndefined();
    // 새 채팅 탭에서 채팅 탭으로 가는 것도 다른 탭이다. 새 채팅 탭에서 새 채팅 탭으로 가는 것은 주소로 못 가른다 — 남기고, 다른 탭이었으면
    // 화면의 탭 줄 규칙이 카드를 접어 주소에서 걷는다.
    const onNew = { tab: "chat" as const, file: "a.md" };
    expect(chatSearch(onNew, X).file).toBeUndefined();
    expect(newChatSearch(onNew).file).toBe("a.md");
  });

  // 처음 여는 주소에 닿은 문서는 고른 탭으로 따라간다 — 그 탭에 넓힌 카드가 선다(`?file=`).
  it("처음 여는 주소의 `file`은 처음 여는 규칙이 고른 탭으로 따라간다", () => {
    expect(openingSearch({ file: "a.md" }, { kind: "thread", id: X }).file).toBe("a.md");
    expect(openingSearch({ file: "a.md" }, { kind: "new", work: "가" }).file).toBe("a.md");
    expect(chatSearch({ file: "a.md" }, X).file).toBe("a.md");
  });

  // 묶음 쪽에서 지금 탭이 바뀌어 본문이 따라갈 때도 같다 — 셸 · 파일 탭 · 다른 채팅 탭이면 걷힌다. 새 채팅 탭이 첫 말로 채팅 탭이 된 것은 같은
  // 칸이라 남는다.
  it("묶음 쪽에서 셸 · 파일 탭 · 다른 채팅 탭이 켜지면 `file`이 걷히고, 새 채팅 탭이 채팅 탭이 된 것은 남는다", () => {
    const onX = { tab: "chat" as const, thread: X, file: "a.md" };
    expect(bundleSearch(onX, { kind: "shell" }).file).toBeUndefined();
    expect(bundleSearch(onX, { kind: "code", code: "billing/src/a.ts" }).file).toBeUndefined();
    expect(bundleSearch(onX, { kind: "chat", thread: Y }).file).toBeUndefined();
    expect(bundleSearch(onX, { kind: "new-chat" }).file).toBeUndefined();
    expect(bundleSearch({ tab: "chat" as const, file: "a.md" }, { kind: "chat", thread: X }).file).toBe("a.md");
  });

  // spec 패널의 문서 줄(작업공간 화면) — 켤 카드 탭을 화면이 골라(02a-10의 규칙) 한 번에 옮긴다. 카드 탭이 이미 본문이면(`null`) 그 탭에 얹거나
  // 걷는다 — 넓힌 카드가 다른 것을 보거나 닫히면 주소에서 걷힌다.
  it("문서 줄은 고른 채팅 탭 · 새 채팅 탭으로 옮기며 문서를 얹고, 본문이 카드 탭이면 그 탭에 얹거나 걷는다", () => {
    const shell = { tab: "terminal" as const };
    expect(cardDocSearch(shell, "b.md", { kind: "thread", id: X })).toMatchObject({ tab: "chat", thread: X, file: "b.md" });
    const fresh = cardDocSearch(shell, "b.md", { kind: "new", work: "가" });
    expect(fresh).toMatchObject({ tab: "chat", file: "b.md" });
    expect(fresh.thread).toBeUndefined();
    const onX = { tab: "chat" as const, thread: X, file: "a.md" };
    expect(cardDocSearch(onX, "b.md", null)).toEqual({ tab: "chat", thread: X, code: undefined, file: "b.md" });
    expect(cardDocSearch(onX, null, null)).toEqual({ tab: "chat", thread: X, file: undefined });
  });

  // 화면 기억도 같다 — 셸 · 파일 탭을 보다 떠난 작업공간의 씨앗에는 `file`이 없다.
  it("셸 · 파일 탭을 보다 떠난 기억에는 `file`이 실리지 않는다", () => {
    rememberView("넓힌-카드-셸", { tab: "terminal", file: "a.md", code: null, thread: null });
    rememberView("넓힌-카드-파일", { tab: "code", file: "a.md", code: "billing/src/a.ts", thread: null });
    rememberView("넓힌-카드-채팅", { tab: "chat", file: "a.md", code: null, thread: X });
    expect(recallSearch("넓힌-카드-셸").file).toBeUndefined();
    expect(recallSearch("넓힌-카드-파일").file).toBeUndefined();
    expect(recallSearch("넓힌-카드-채팅").file).toBe("a.md");
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
  // 탭이 `null`이면 주소에 탭을 적지 않는다 — 작업공간을 처음 여는 규칙이 탭을 세운다(restart 02a-8 — 「채팅 · `thread` 없음」은 이제 새 채팅 탭이다).
  it("적어 두지 않은 work은 처음 여는 규칙을 탄다", () => {
    expect(recallView("처음-보는-work")).toEqual({ tab: null, file: null, code: null, thread: null });
  });

  it("적어 둔 것을 그대로 돌려준다", () => {
    rememberView("가", { tab: "terminal", file: null, code: null, thread: null });
    expect(recallView("가")).toEqual({ tab: "terminal", file: null, code: null, thread: null });
    // 되돌아오는 것도 기억이다 — 켠 것만 적어 두면 끈 것을 못 적는다.
    rememberView("가", { tab: "chat", file: "01-판/spec.md", code: null, thread: "20261010-100000" });
    expect(recallView("가")).toEqual({ tab: "chat", file: "01-판/spec.md", code: null, thread: "20261010-100000" });
  });

  it("work마다 따로 센다", () => {
    rememberView("나", { tab: "terminal", file: null, code: null, thread: null });
    expect(recallView("다")).toEqual({ tab: null, file: null, code: null, thread: null });
  });

  // **work을 여는 문이 전부 이 값을 쓴다** — `recallSearch`가 그 합성의 이름이다. 빈 객체
  // 위에 얹으므로 이전 주소가 통째로 버려진다: 실리는 것은 그 work의 기억뿐이라 **남의**
  // `file`이 딸려갈 자리가 없다. 아래가 이 함수의 **값**을 재는 것이 문마다 원문을
  // 대조하는 것을 대신한다 — 문은 늘지만 값은 하나다.
  it("빈 주소 위에 얹어 새 주소를 짓는다", () => {
    rememberView("라", { tab: "terminal", file: null, code: null, thread: null });
    expect(recallSearch("라")).toEqual({ tab: "terminal" });
  });

  // **파일 탭을 보다 떠난 work은 그 파일 탭으로 돌아온다**(git-integration S12 · 스토리 60).
  it("파일 탭을 보다 떠난 work은 그 파일로 돌아온다", () => {
    rememberView("자", { tab: "code", file: null, code: "billing/src/a.ts", thread: null });
    expect(recallSearch("자")).toEqual({ tab: "code", code: "billing/src/a.ts" });
  });

  // restart 02a-4 — 화면 기억이 `thread`를 든다. 채팅 탭을 보다 떠난 작업공간은 그 채팅 탭으로 돌아온다. **넓힌 카드의 문서도 씨앗에 실린다**
  // (#156 수용 기준 2 — 「문서·탭이 살아 있다」 · restart 02a-12) — 빠지면 돌아온 채팅 탭에 넓힌 카드가 조용히 사라진다.
  it("채팅을 보다 떠난 work은 그 채팅과 넓힌 카드의 문서로 돌아온다", () => {
    rememberView("하", { tab: "chat", file: "02-판/spec.md", code: null, thread: "20261010-100000" });
    expect(recallSearch("하")).toEqual({
      tab: "chat",
      file: "02-판/spec.md",
      thread: "20261010-100000",
    });
  });

  // 아직 안 본 work은 주소에 탭을 적지 않는다 — 값이 없는 주소에 닿으면 작업공간을 처음 여는 규칙이 탭을 세운다(`openingSearch`).
  it("아직 안 본 work의 씨앗에는 탭이 없다", () => {
    expect(recallSearch("처음-여는-work")).toEqual({ tab: undefined, file: undefined });
  });

  // restart 02a-8 — 새 채팅 탭을 보다 떠난 작업공간은 새 채팅 탭으로 돌아온다. 처음 여는 규칙을 다시 타면 가장 최근 채팅으로 간다.
  it("새 채팅 탭을 보다 떠난 work은 새 채팅 탭으로 돌아온다", () => {
    rememberView("거", { tab: "chat", file: null, code: null, thread: null });
    expect(recallSearch("거")).toEqual({ tab: "chat", file: undefined });
  });

  // git-integration 판 01 — **키가 slug라** 삭제로 풀린 slug에 새 work이 서면 지운 work의 기억이 그 work의 씨앗이 된다.
  // `code`가 실려 있으면 새 work의 묶음에 옛 파일 탭이 다시 열린다(스토리 60 — 주소가 가리키는 파일은 연다). 목록에서
  // 사라지면 걷는다. **이 describe의 마지막에 둔다** — 목록에 없는 slug를 모두 걷으므로 앞의 기억도 함께 걷힌다.
  it("목록에서 사라진 work의 기억은 걷히고, 목록에 남은 work의 것은 그대로다", () => {
    rememberView("차", { tab: "code", file: null, code: "billing/src/a.ts", thread: null });
    rememberView("카", { tab: "chat", file: "01-판/spec.md", code: null, thread: "20261010-100000" });
    forgetVanishedViews(["카"]);
    expect(recallView("차")).toEqual({ tab: null, file: null, code: null, thread: null });
    expect(recallView("카")).toEqual({ tab: "chat", file: "01-판/spec.md", code: null, thread: "20261010-100000" });
  });
});

// **`<Link>`로 work을 여는 문**(03 코드 리뷰 A1) — Service 상세의 「작업공간」 묶음 줄과 Project 제거 창의 Work 줄이다. 둘 다 처음에는 기억을
// 안 실어(`search={{}}` · `search` 없음) 그 문으로 들어간 work이 기본 화면으로 열렸고, 도착한 주소를 적는 effect가 그 기본값으로 기억을
// 덮어썼다 — `recallSearch` 머리말의 「빠뜨린 문 하나」가 Projects 문에 이어 다시 난 것이다. 문은 `workDoor`를 펼치고, 그 값을 여기서 잰다.
describe("Link로 work을 여는 문", () => {
  it("그 work의 마지막 화면을 싣는다 — 탭 · 채팅 · 넓힌 카드의 문서", () => {
    rememberView("타", { tab: "chat", file: "02-판/spec.md", code: null, thread: "20261010-100000" });
    expect(workDoor("타")).toEqual({
      to: "/works/$slug",
      params: { slug: "타" },
      search: { tab: "chat", file: "02-판/spec.md", thread: "20261010-100000" },
    });
  });

  // restart 02a-8 — **그 작업공간의 새 채팅 탭으로 가는 문.** 요약 카드 ⋯의 「이 작업공간에서 새 채팅」 · 채팅이 없는 작업공간 줄 · `?work=` 씨앗이
  // 지난다. 기억을 씨앗으로 삼고 `tab=chat`만 적는다 — 어느 새 채팅 탭인지는 묶음이 쥔다. 채팅 탭의 넓힌 카드의 문서는 따라오지 않고(restart 02a-12),
  // 새 채팅 탭을 보다 떠난 기억의 문서는 따라온다.
  it("새 채팅 탭으로 가는 문은 그 work의 기억 위에 `tab=chat`만 적는다", () => {
    rememberView("하나", { tab: "chat", file: "02-판/spec.md", code: null, thread: "20261010-100000" });
    expect(newChatDoor("하나")).toEqual({
      to: "/works/$slug",
      params: { slug: "하나" },
      search: { tab: "chat", file: undefined, code: undefined, thread: undefined },
    });
    rememberView("하나둘", { tab: "chat", file: "02-판/spec.md", code: null, thread: null });
    expect(newChatDoor("하나둘").search.file).toBe("02-판/spec.md");
    expect(newChatDoor("처음-여는-곳").search).toEqual({
      tab: "chat",
      file: undefined,
      code: undefined,
      thread: undefined,
    });
  });

  it("아직 안 본 work은 기본 화면으로 간다", () => {
    expect(workDoor("파")).toEqual({
      to: "/works/$slug",
      params: { slug: "파" },
      search: { tab: undefined, file: undefined },
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
    // 화면을 옮기는 길이 여럿이다(탭 줄 · ⌘1~9 · ⌃Tab · 드래그 · 넓힌 카드).
    // 전부 주소를 바꾸므로 도착한 주소를 한 번 적으면 다 덮는다 — 길마다 적으면 한 길만 늙는다.
    const view = read("./-works-view.tsx");
    expect(view.split("rememberView(").length - 1).toBe(1);
    // 처음 여는 주소(`opening`)는 탭 없음으로 적는다(restart 02a-8) — 그 주소의 `chat`은 기본 값이라, 적어 두면 돌아올 때 새 채팅 탭이 된다.
    expect(view).toContain(
      "if (slug !== null && exists) rememberView(slug, { tab: opening ? null : tab, file, code, thread });",
    );
  });

  // restart 02a-8 — `/?work=<slug>`는 그 작업공간의 새 채팅 탭으로 가는 문이다. 어느 새 채팅 탭인지는 묶음이 쥐어 `tab=chat`이 가리킬 그
  // 탭을 먼저 세우고(`showNewChatTab`), 입력 글(`?say=`)은 그 탭의 열쇠에 채운다 — 홈의 열쇠(`NEW_THREAD`)에 채우면 그 글이 홈에 선다. 옮기는
  // 것은 화면의 효과라 라우터 seam(`router.test.ts`)에 안 보여 원문으로 못박는다.
  it("`/?work=`는 새 채팅 탭으로 옮기고, 입력 글은 그 탭의 열쇠에 채운다", () => {
    const home = read("./index.tsx");
    expect(home).toContain('if (seed.link?.kind === "work") return <WorkSeed slug={seed.link.slug} say={seed.say} />;');
    expect(home).toContain(`const tab = showNewChatTab(ownerOf(slug));
      if (tab !== null) fillDraft(newChatKey(tab), say);`);
    expect(home).toContain("void navigate({ ...newChatDoor(slug), replace: true });");
  });

  // restart 02a-12 — `?file=`에 닿은 처음 여는 주소(검색 결과 · 셸 · 파일 탭에서 적은 문서)는 02a-10의 켤 탭 규칙으로 채팅 탭을 고른다 — 가장
  // 최근에 켠 채팅 탭부터다(`cardTabOf`). 문서가 없는 처음 여는 주소는 그대로 가장 최근 채팅이다. 문서는 고른 탭으로 따라간다(`openingSearch`).
  // 문서 줄 · 넓힌 카드가 주소를 고치는 길은 `cardDocSearch` 하나다.
  it("`?file=`에 닿은 처음 여는 주소는 켤 탭 규칙으로 채팅 탭을 고르고, 넓힌 카드가 주소를 고치는 길은 하나다", () => {
    const view = read("./-works-view.tsx");
    expect(view).toContain(
      "const landing = file === null ? latest : cardTabOf(workSeat(slug), bundleOf(terminalStore.state, ownerOf(slug)), latest);",
    );
    expect(view).toContain("search: (prev: object) => openingSearch(prev, landing),");
    expect(view).toContain("search: (prev: object) => cardDocSearch(prev, path, landing),");
  });

  // restart 02a-13 — 문서 탭 · 분할의 옛 입구(`specTabSearch` · 분할을 고치는 `columnSearch`)가 걷혔다. 문서를 옮기는 길은 넓힌 카드 하나다.
  it("문서 탭 · 분할로 가는 길이 없다", () => {
    const view = read("./-works-view.tsx");
    expect(view).not.toContain("specTabSearch");
    expect(view).not.toContain("columnSearch");
    // 문자열 자르기(`.split(`)는 다른 말이다 — 분할의 값 · 콜백 이름만 잰다.
    expect(view).not.toMatch(/\bsplit\b(?!\()/);
  });

  // **「열었다」를 적는 자리도 하나다**(결정 14) — 그리고 위와 **다른 effect**여야 한다.
  //
  // 세는 단위가 갈린다: 저쪽은 보던 **화면**(탭 · 넓힌 카드의 문서까지)이고 이쪽은 **work**이다
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

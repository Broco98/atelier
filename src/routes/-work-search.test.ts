/// <reference types="node" />
// 소스 스캔 한 건 때문에 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
// (되살리는 자리를 원문으로 세던 두 건은 `recallSearch`의 값 검사로 옮겼다 — 아래 describe.)
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import {
  recallSearch,
  recallView,
  rememberView,
  splitOf,
  fileSearch,
  splitSearch,
  tabSearch,
  validateWorkSearch,
  viewTab,
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
      // 이 갱신이 분할을 건드리지 않는다.
      tab: undefined,
    });
  });
});

// 주소에서 항목을 읽는 자리는 이 파일에 없다. `/works/`를 박아 두던 `workSlugOf`가 여기
// 살았는데, #183이 마지막 호출부(사이드바 목록의 강조)를 `@/mode`의 `slugOf`로 옮기면서
// 호출부가 0이 됐다 — 두 세계의 목록 주소를 다 읽어야 하고 항목 아래로 화면이 갈라지는 날
// 첫 칸만 slug여야 하는데, 그쪽은 `/works/a/b`를 통째로 `"a/b"`라고 답했다. 답이 갈리는
// 파서 둘을 남겨 두면 다음 사람이 어느 쪽을 집는지가 우연이 되므로 함께 걷었다.
// 그물은 `mode.test.ts`의 「주소에서 slug를 읽는다」가 두 세계에서 더 촘촘하게 든다.

// 결정 77. work을 옮길 때 떠나던 주소는 버리고 **그 work의 기억**을 되살린다. 라우터
// seam에서는 이것도 안 보인다 — 그쪽은 주소에 적힌 것만 보고, 「새 주소를 무엇으로
// 짓는가」는 여기 있다.
//
// **모듈 스코프 Map이라 이 파일 안에서 새어 나간다.** 검사마다 다른 슬러그를 쓴다 —
// 비우는 함수를 내보내면 생산 코드에 아무도 안 부르는 이름이 하나 생긴다.
describe("work마다 마지막으로 보던 화면", () => {
  it("적어 두지 않은 work은 기본 문서 단일 뷰다", () => {
    expect(recallView("atelier", "처음-보는-work")).toEqual({ tab: "spec", split: null, file: null });
  });

  it("적어 둔 것을 그대로 돌려준다", () => {
    rememberView("atelier", "가", { tab: "terminal", split: "rl", file: "01-판/spec.md" });
    expect(recallView("atelier", "가")).toEqual({ tab: "terminal", split: "rl", file: "01-판/spec.md" });
    // 되돌아오는 것도 기억이다 — 켠 것만 적어 두면 끈 것을 못 적는다.
    rememberView("atelier", "가", { tab: "spec", split: null, file: null });
    expect(recallView("atelier", "가")).toEqual({ tab: "spec", split: null, file: null });
  });

  it("work마다 따로 센다", () => {
    rememberView("atelier", "나", { tab: "terminal", split: "lr", file: "01-판/spec.md" });
    expect(recallView("atelier", "다")).toEqual({ tab: "spec", split: null, file: null });
  });

  // **두 세계에 같은 이름이 설 수 있다**(결정 10). slug 하나로 키를 잡으면 이 검사가
  // 빨개진다 — Room을 적어 두는 순간 같은 이름 work의 기억이 통째로 덮인다.
  it("같은 이름의 work과 Room이 서로를 안 덮어쓴다", () => {
    rememberView("atelier", "겹친이름", { tab: "terminal", split: "rl", file: "작업/spec.md" });
    rememberView("maison", "겹친이름", { tab: "spec", split: null, file: "방/기록.md" });

    expect(recallView("atelier", "겹친이름")).toEqual({
      tab: "terminal",
      split: "rl",
      file: "작업/spec.md",
    });
    expect(recallView("maison", "겹친이름")).toEqual({
      tab: "spec",
      split: null,
      file: "방/기록.md",
    });
  });

  // 문을 여는 값도 갈려야 한다 — `recallView`만 갈리고 `recallSearch`가 한 세계를 굳게 잡고
  // 있으면, 기억은 맞는데 **열리는 주소가 저쪽 세계의 화면**이 된다.
  it("여는 주소의 씨앗도 세계별로 갈린다", () => {
    rememberView("atelier", "같은이름", { tab: "terminal", split: null, file: null });
    expect(recallSearch("maison", "같은이름")).toEqual({
      tab: undefined,
      split: undefined,
      file: undefined,
    });
    expect(recallSearch("atelier", "같은이름")).toEqual({
      tab: "terminal",
      split: undefined,
      file: undefined,
    });
  });

  // **work을 여는 문이 전부 이 값을 쓴다** — `recallSearch`가 그 합성의 이름이다. 빈 객체
  // 위에 얹으므로 이전 주소가 통째로 버려진다: 실리는 것은 그 work의 기억뿐이라 **남의**
  // `file`이 딸려갈 자리가 없다. 아래 넷이 이 함수의 **값**을 재는 것이 문마다 원문을
  // 대조하는 것을 대신한다 — 문은 늘지만 값은 하나다.
  it("빈 주소 위에 얹어 새 주소를 짓는다", () => {
    rememberView("atelier", "라", { tab: "terminal", split: "lr", file: "01-판/spec.md" });
    expect(recallSearch("atelier", "라")).toEqual({
      tab: "terminal",
      split: "lr",
      file: "01-판/spec.md",
    });
    rememberView("atelier", "마", { tab: "spec", split: null, file: null });
    expect(recallSearch("atelier", "마")).toEqual({
      tab: undefined,
      split: undefined,
      file: undefined,
    });
  });

  // **분할로 두고 떠난 work은 분할로 돌아온다**(판 05 수용 기준의 마지막 줄). `tab`만
  // 씨앗에 실으면 이 한 줄이 조용히 빠진다.
  it("분할로 두고 떠난 work은 분할로 돌아온다", () => {
    rememberView("atelier", "바", { tab: "terminal", split: "rl", file: null });
    rememberView("atelier", "사", { tab: "spec", split: null, file: null });
    expect(recallSearch("atelier", "바")).toEqual({
      tab: "terminal",
      split: "rl",
      file: undefined,
    });
  });

  // **보던 문서도 씨앗에 실린다**(#156 수용 기준 2 — 「문서·탭·분할이 살아 있다」). `tab`과
  // `split`만 실으면 돌아온 work이 기본 문서로 열려, 축 셋 중 하나가 조용히 빠진다 —
  // 화면으로는 「가끔 다른 문서가 떠 있다」로만 보인다.
  it("문서를 보다 떠난 work은 그 문서로 돌아온다", () => {
    rememberView("atelier", "아", { tab: "spec", split: null, file: "02-판/spec.md" });
    expect(recallSearch("atelier", "아")).toEqual({
      tab: undefined,
      split: undefined,
      file: "02-판/spec.md",
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
      "if (slug !== null && exists) rememberView(mode, slug, { tab, split, file });",
    );
  });

  // **배선 층에는 박힌 세계가 한 자리도 없어야 한다.** 두 view가 모드를 넘기는 자리는 넷씩이다
  // (목록 훅 · 씨앗 합성 `recallSearch` · 세션 기억 `selectWork`/`selectArchive` · 정규화가
  // 읽는 칸). 그중 하나를 `"atelier"`로 되돌려도 **타입은 맞고**(둘 다 `Mode` 리터럴이다) 이
  // 두 파일을 렌더하는 테스트가 저장소에 없어 L2가 전부 초록이다 — 그래서 이 층에만 그물이
  // 비어 있었다.
  //
  // 실제로 어긋나는 모습: Maison에서 보던 Room이 사라져 복구 이동이 돌면 같은 이름 Atelier
  // work의 탭·분할·문서 기억이 씨앗으로 실려 엉뚱한 분할·문서로 열리고(기준 3), 기억이 저쪽
  // 칸에 적히면 다음 `/maison/rooms` 정규화가 저 세계의 slug를 고른다(기준 2).
  //
  // 세는 것이 인자의 뜻이 아니라 **리터럴의 유무**라 파서가 샐 자리가 없다 — 어느 인자가
  // 어디로 가는지 읽지 않고 「이 파일에 박힌 세계가 하나도 없다」만 본다. 모드는 언제나 위에서
  // 내려온다는 것이 이 층의 규칙이므로, 새 자리가 늘어도 이 검사는 그대로 산다.
  it.each(["./-works-view.tsx", "./-archive-view.tsx"])("%s에는 박힌 세계가 없다", (file) => {
    expect(read(file).match(/["'](?:atelier|maison)["']/g) ?? []).toEqual([]);
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
    expect(view.split("}, [mode, slug, exists]);").length - 1).toBe(1);
  });
});

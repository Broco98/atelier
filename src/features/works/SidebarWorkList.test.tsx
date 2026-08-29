/// <reference types="node" />
// 소스 스캔 때문에 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunningMarks, WorkSectionList } from "./SidebarWorkList";
import { splitWorkSections, type SectionsOpen } from "./work-sections";
import type { WorkView } from "./types";

// 사이드바 목록이 **그리는 것**을 본다. 어느 구역에 무엇이 놓이는지는 work-sections.test.ts가
// 이미 보므로 여기서 보는 것은 그 결과가 화면으로 나오는 자리뿐이다 — 구획이 서는 조건
// (결정 82), 빈 `작업` 구획이 하는 말(결정 108), 핀의 생김새(결정 85), 접힘과 개수.
//
// 훅을 부르지 않는 `WorkSectionList`를 렌더한다. 구독하는 자리(useWorks·라우터·localStorage)는
// 위에 남아 있고, 여기로는 상태와 콜백만 들어온다 — `ShellTabs`와 같은 모양이다.

// 이 화면이 행에서 읽는 것은 slug·title·status·pinned뿐이다. work-sections.test.ts와 같은
// 접두사 규칙을 쓴다: "pin:"이면 고정, "draft:"면 초안. 제목은 slug를 그대로 쓴다.
const works = (...raws: string[]) =>
  raws.map((raw) => {
    const pinned = raw.startsWith("pin:");
    const rest = pinned ? raw.slice("pin:".length) : raw;
    const draft = rest.startsWith("draft:");
    const slug = draft ? rest.slice("draft:".length) : rest;
    return { slug, title: slug, status: draft ? "draft" : "active", pinned };
  }) as WorkView[];

const ALL: SectionsOpen = { pinned: true, works: true, drafts: true };

// 기본값은 **아무 work도 안 고른 상태**다 — 아래 구획 검사들이 그 위에서 돈다.
function render(
  list: WorkView[],
  open: SectionsOpen = ALL,
  {
    selectedSlug = null,
    shellCounts = {},
    // 둘째 줄의 로고는 슬롯으로 온다 — 값을 고르는 자리가 Sidebar라서다(RunningMarks 머리말).
    renderRunning = (work: WorkView) => <i data-running={work.slug} />,
  }: {
    selectedSlug?: string | null;
    shellCounts?: Record<string, number>;
    renderRunning?: (work: WorkView) => ReactNode;
  } = {},
): string {
  return renderToStaticMarkup(
    <WorkSectionList
      sections={splitWorkSections(list, open)}
      open={open}
      selectedSlug={selectedSlug}
      shellCounts={shellCounts}
      onToggleSection={() => {}}
      onOpen={() => {}}
      onHover={() => {}}
      onLeave={() => {}}
      onTogglePin={() => {}}
      renderRunning={renderRunning}
    />,
  );
}

// 구획 헤더는 **표식으로** 집는다 — 모양(클래스 문자열)으로 가르면 규격을 손보는 날 검사가
// 조용히 샌다. 판 04가 가지를 걷으면서 `aria-expanded`를 가진 버튼이 구획 헤더 하나로
// 줄었지만, 표식은 그대로 둔다: 「접히는 버튼이 하나뿐이다」가 곧 아래 검사의 대상이라,
// 그 사실을 집는 방법으로 삼으면 검사가 자기 자신을 확인하게 된다.
const buttonsOf = (markup: string, marker: string) =>
  markup.match(new RegExp(`<button[^>]*${marker}[^>]*>[\\s\\S]*?</button>`, "g")) ?? [];
const spansOf = (button: string) =>
  [...button.matchAll(/<span[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);

// 라벨·펼침·개수를 **한 헤더 안에서** 함께 읽는다. 마크업 전체에서 문자열만 찾으면
// "고정"이 핀 버튼의 aria-label에도 있어서, 고정 구획이 통째로 사라져도 초록이 된다.
const headersOf = (markup: string) =>
  buttonsOf(markup, 'data-section=""').map((button) => {
    const spans = spansOf(button);
    return {
      open: /aria-expanded="true"/.test(button),
      label: spans[0],
      count: spans[spans.length - 1],
    };
  });

// 접기 상자들 — 헤더와 같은 순서로 나온다. 접힌 것은 grid-template-rows가 0fr이고 inert다.
const bodiesOf = (markup: string) => markup.match(/<div (?:inert="" )?class="grid shrink-0[^"]*">/g) ?? [];

// 핀 버튼 하나를 통째로 잘라낸다 — aria-pressed를 가진 버튼은 이것뿐이고 안에 svg만 있어
// 첫 </button>까지가 그 버튼이다. 행의 상태 아이콘도 fill을 갖고 있어서, 버튼 밖에서
// fill을 세면 채운 핀이 사라져도 걸리지 않는다.
const pinsOf = (markup: string) =>
  markup.match(/<button[^>]*aria-pressed="(?:true|false)"[\s\S]*?<\/button>/g) ?? [];

// 헤더에서 다음 헤더 전까지가 한 구획이다. 행은 핀의 접근성 이름으로 센다 — 행마다 하나뿐이고
// 제목이 거기 그대로 들어간다. 어느 구획에 놓였는지는 **구획별로** 봐야 뜻이 있다:
// 마크업 전체에서 제목을 세면 고정된 것이 두 구획에 겹쳐 나와도 걸리지 않는다.
const rowsBySection = (markup: string) =>
  markup
    .split(/(?=<button[^>]*data-section="")/)
    .filter((chunk) => /^<button[^>]*data-section=""/.test(chunk))
    .map((chunk) => ({
      label: spansOf(chunk.slice(0, chunk.indexOf("</button>")))[0],
      rows: [...chunk.matchAll(/aria-label="(.*?) 고정"/g)].map((m) => m[1]),
    }));

// 행의 **둘째 줄**만 잘라낸다(결정 2). 「행 안에서」 봐야 뜻이 있다 — 마크업 전체에서 숫자를
// 세면 다른 행의 줄이나 구획 개수와 섞여, 줄이 엉뚱한 work에 서도 초록이 된다.
// 이 줄 안에는 `<div>`가 없어(글리프와 span뿐) 첫 `</div>`까지가 그 줄 전부다.
const subrowsOf = (markup: string) =>
  [...markup.matchAll(/<div[^>]*data-subrow="(.*?)"[\s\S]*?<\/div>/g)].map((m) => ({
    slug: m[1],
    html: m[0],
  }));

describe("`고정` 구획은 고정된 것이 있을 때만 선다", () => {
  // 결정 82. `초안`과 같은 규칙이다 — 아무것도 없는 구획의 헤더는 자리만 먹는다.
  it("고정된 것이 없으면 헤더가 아예 없다", () => {
    expect(headersOf(render(works("가", "draft:나"))).map((one) => one.label)).toEqual([
      "작업",
      "초안",
    ]);
  });

  it("고정된 것이 있으면 `작업` 위에 선다", () => {
    expect(headersOf(render(works("pin:가", "나", "draft:다"))).map((one) => one.label)).toEqual([
      "고정",
      "작업",
      "초안",
    ]);
  });

  it("개수는 그 구획의 것을 적는다", () => {
    const headers = headersOf(render(works("pin:가", "pin:draft:나", "다", "draft:라")));
    expect(headers.map((one) => `${one.label} ${one.count}`)).toEqual(["고정 2", "작업 1", "초안 1"]);
  });
});

describe("고정된 work은 한 구획에만 있다", () => {
  // 결정 82. 고정하면 원래 구획에서 **빠진다**. 양쪽에 다 보이면 숫자 단축키가 같은 작업을
  // 두 번 세고, 어느 쪽을 눌렀는지가 뜻을 갖게 된다.
  it("고정된 작업은 `작업`에서 빠진다", () => {
    expect(rowsBySection(render(works("pin:가", "나")))).toEqual([
      { label: "고정", rows: ["가"] },
      { label: "작업", rows: ["나"] },
    ]);
  });

  it("고정된 초안은 `초안`에서 빠진다", () => {
    // 결정 83 — 초안도 고정할 수 있고, 고정되면 `초안`이 아니라 `고정`에 선다.
    expect(rowsBySection(render(works("pin:draft:가", "draft:나")))).toEqual([
      { label: "고정", rows: ["가"] },
      { label: "작업", rows: [] },
      { label: "초안", rows: ["나"] },
    ]);
  });
});

describe("빈 `작업` 구획이 하는 말", () => {
  // 결정 108. 화면에 작업이 버젓이 서 있는데 「Claude Code에서 시작돼요」라고 하면 거짓말이다.
  // emptyMainNotice 자체는 work-sections.test.ts가 보고, 여기서는 **호출부**를 본다 —
  // 화면이 그 함수를 실제로 부르는지.
  it("고정 때문에 비었으면 「전부 고정돼 있어요」다", () => {
    expect(render(works("pin:가"))).toContain("전부 고정돼 있어요.");
  });

  it("아무것도 없으면 「Claude Code에서 시작돼요」다", () => {
    expect(render([])).toContain("작업은 Claude Code에서 시작돼요.");
  });

  it("초안만 있으면 「진행 중인 작업이 없어요」다", () => {
    expect(render(works("draft:가"))).toContain("진행 중인 작업이 없어요.");
  });

  it("작업이 있으면 아무 말도 하지 않는다", () => {
    const markup = render(works("가"));
    expect(markup).not.toContain("고정돼 있어요");
    expect(markup).not.toContain("Claude Code에서 시작돼요");
  });
});

describe("핀 버튼", () => {
  // 결정 85. 상시 노출하지 않는 것은 고정 여부를 **구획이 이미 말하기** 때문이다.
  it("평소엔 숨어 있고 hover에만 뜬다", () => {
    for (const pin of pinsOf(render(works("pin:가", "나", "draft:다")))) {
      expect(pin).toContain("opacity-0");
      // 이 한 줄이 없으면 opacity-0으로 **영영** 안 보인다.
      expect(pin).toContain("group-hover:opacity-100");
      // Tab으로 도달은 하는데 보이지 않는 자리가 되지 않게.
      expect(pin).toContain("focus-visible:opacity-100");
    }
  });

  it("고정된 행은 채운 핀, 안 된 행은 빈 핀이다", () => {
    const [pinnedRow, plainRow] = pinsOf(render(works("pin:가", "나")));
    expect(pinnedRow).toContain('aria-pressed="true"');
    expect(pinnedRow).toContain('fill="currentColor"');
    expect(plainRow).toContain('aria-pressed="false"');
    expect(plainRow).toContain('fill="none"');
  });

  it("행마다 하나씩 있다 — 초안 행에도 있다", () => {
    // 결정 83. 초안도 고정할 수 있다.
    expect(pinsOf(render(works("pin:가", "나", "draft:다")))).toHaveLength(3);
  });
});

describe("구획 접기", () => {
  // 결정 108의 마지막 줄 — `고정` 구획도 `초안`과 같은 규칙으로 접힌다.
  it("접힌 구획은 헤더가 그렇다고 말하고 높이만 0이 된다", () => {
    const markup = render(works("pin:가", "나", "draft:다"), { ...ALL, pinned: false });
    expect(headersOf(markup).map((one) => `${one.label} ${one.open}`)).toEqual([
      "고정 false",
      "작업 true",
      "초안 true",
    ]);
    const [pinnedBody, mainBody] = bodiesOf(markup);
    // 접혀도 항목은 DOM에 남는다 — 그래야 펴는 쪽도 애니메이션된다. 대신 inert다.
    expect(pinnedBody).toContain("grid-rows-[0fr]");
    expect(pinnedBody).toContain('inert=""');
    expect(mainBody).toContain("grid-rows-[1fr]");
    expect(mainBody).not.toContain("inert");
  });

  it("접혀도 개수와 행은 그대로다", () => {
    const markup = render(works("pin:가", "pin:나", "다"), { ...ALL, pinned: false });
    expect(headersOf(markup)[0].count).toBe("2");
    expect(pinsOf(markup)).toHaveLength(3);
  });
});

// 결정 2~5. **이 work의 절반이 이 물음 하나를 위한 것이다: 목록만 훑고도 어느 work에서
// 무엇이 돌고 있는지 안다.** 그래서 이 줄의 주인공은 지금 보고 있지 **않은** work다 —
// 보고 있는 work에서 뭐가 도는지는 본문의 탭 줄이 이미 말한다.
describe("work 행의 둘째 줄", () => {
  it("셸이 하나라도 있는 행에만 선다 — 높이가 곧 신호다", () => {
    // 결정 3. 셸이 0개인 work는 한 줄로 남아 **행 높이 자체가 「여기서 일이 돌고 있다」**가 된다.
    const markup = render(works("가", "나", "draft:다"), ALL, { shellCounts: { 가: 2, 다: 1 } });
    expect(subrowsOf(markup).map((one) => one.slug)).toEqual(["가", "다"]);
  });

  it("그 work의 셸 수를 적는다", () => {
    const markup = render(works("가", "나"), ALL, { shellCounts: { 가: 3, 나: 1 } });
    expect(subrowsOf(markup).map((one) => spansOf(one.html)[0])).toEqual(["3", "1"]);
  });

  it("도는 것이 없어도 줄은 그대로 선다", () => {
    // **결정 3의 전부가 이 한 줄이다.** 「명령이 도는 동안만 선다」는 기각됐다 — 그 값은 매
    // 순간 바뀌어서(pty.rs가 1초마다 잰다) 행 높이에 매면 claude가 답을 마칠 때마다 목록이
    // 접혔다 펴지고 아래 work들이 계속 밀린다. 줄이 서는 조건은 **안 변하는 값**(셸을
    // 포함하는가)이고 변하는 것은 줄 **안에서** 변한다 — 그래서 슬롯이 아무것도 안 그려도
    // 줄은 선다. 조건을 `runningKinds.length > 0` 꼴로 바꾸면 여기가 빨개진다.
    const markup = render(works("가"), ALL, { shellCounts: { 가: 1 }, renderRunning: () => null });
    expect(subrowsOf(markup)).toHaveLength(1);
  });

  it("로고는 그 줄 **안에** 있고, 셸이 없는 행에는 아예 안 붙는다", () => {
    // 슬롯을 셸이 없는 행에서도 부르면 그 행마다 터미널 스토어 구독이 하나씩 붙는다 —
    // 「행마다 자기 것만 구독한다」가 「모든 행이 구독한다」가 된다(Sidebar.test.tsx).
    const markup = render(works("가", "나"), ALL, { shellCounts: { 가: 1 } });
    const [가] = subrowsOf(markup);
    expect(가.html).toContain('data-running="가"');
    expect(markup).not.toContain('data-running="나"');
  });

  it("아무것도 눌리지 않는다", () => {
    // 결정 5. 로고가 **종류만** 말하므로(결정 4) 로고와 셸이 1:1이 아니다 — 누르면 어느
    // 셸로 갈지 정해지지 않는다. 행을 누르는 것은 위 줄의 이름 버튼이 받아 그 work로 간다.
    const [가] = subrowsOf(render(works("가"), ALL, { shellCounts: { 가: 2 } }));
    expect(가.html).not.toContain("<button");
    expect(가.html).not.toContain("<a ");
  });
});

// 결정 4·15. **표는 agent-mark 하나다** — 탭 칸과 이 줄이 각자 표를 들면 둘이 갈린다.
// **세는 일이 여기다**(결정 28) — 값 쪽은 중복을 그대로 둔다(shell-registry.test.ts).
describe("둘째 줄의 로고", () => {
  const marks = (running: string[]) => renderToStaticMarkup(<RunningMarks running={running} />);
  const labelsOf = (html: string) => [...html.matchAll(/aria-label="(.*?)"/g)].map((m) => m[1]);

  it("종류마다 하나씩, 받은 순서 그대로다", () => {
    expect(labelsOf(marks(["codex", "claude"]))).toEqual(["codex 1개", "claude 1개"]);
  });

  it("같은 것이 여럿이면 로고 하나에 **수**가 붙는다", () => {
    // 결정 28. 한 줄 안에서 셸에만 수가 붙고 에이전트에는 안 붙으면 세는 단위가 둘로 갈린다.
    const html = marks(["claude", "codex", "claude"]);
    expect(labelsOf(html)).toEqual(["claude 2개", "codex 1개"]);
    expect(html).toContain(">2<");
    expect(html).toContain("tabular-nums");
  });

  it("모르는 것에는 아무것도 안 띄운다", () => {
    // 셸에서 도는 것의 대부분(`node`·`cargo`·`vim`)이 그 자리에 온다 — 그때마다 무엇인가
    // 뜨면 줄이 시끄러워져 「어느 work에서 에이전트가 도나」가 오히려 안 보인다.
    expect(marks(["node", "cargo"])).toBe("");
    expect(marks([])).toBe("");
  });

  it("줄보다 한 단 진하다 — 대비 바닥이 그 이유다", () => {
    // 결정 15가 로고를 `currentColor`로 칠한 근거가 「대비 바닥 4.5를 저절로 넘는다」인데,
    // 이 줄의 색(tertiary)은 사이드바 배경에서 그 아래다(≈2.9). 줄 색을 그대로 물려받으면
    // 결정 15의 근거가 이 자리에서만 거짓이 된다.
    expect(marks(["claude"])).toContain("text-muted-foreground");
  });

  it("이름은 눈이 아니라 접근성으로만 읽는다 — 누를 수도 없다", () => {
    const html = marks(["claude"]);
    // 좁은 사이드바에서 이름까지 적으면 종류가 둘일 때 제목보다 그 줄이 길어진다.
    expect(html).not.toContain(">claude<");
    // `title`을 안 다는 것은 이 행에 머물면 호버 카드가 떠서 OS 툴팁이 그 위로 겹치기 때문이다.
    expect(html).not.toContain("title=");
    expect(html).not.toContain("<button");
  });
});

describe("행 아래에 아무것도 딸리지 않는다", () => {
  // 결정 6. 같은 것을 두 자리에서 고르게 두면 어느 쪽이 지금인지가 화면마다 갈린다 —
  // 셸을 고르는 자리가 탭 줄로 돌아갔으므로(결정 7·8) 사이드바에서 그 길을 걷는다.
  // 여기서 보는 것은 **자리가 정말 없는가**다: 접히는 버튼도, 잎도, 가지의 속도.
  const shut = () => render(works("가", "나"), ALL, { selectedSlug: "가", shellCounts: { 가: 2 } });

  it("접히는 것은 구획 헤더뿐이다", () => {
    // 목록에서 `aria-expanded`를 가진 버튼이 구획 셋 말고 하나도 없어야 한다. 표식으로
    // 좁혀 세지 않고 **전부 세서** 구획의 것과 대는 것은, 표식을 안 단 새 토글이 생기는
    // 경우를 그 그물이 통째로 놓치기 때문이다.
    const markup = shut();
    const all = (markup.match(/aria-expanded=/g) ?? []).length;
    expect(all).toBe(buttonsOf(markup, 'data-section=""').length);
  });

  it("잎도 가지도 없다", () => {
    const markup = shut();
    expect(markup).not.toContain("data-leaf");
    expect(markup).not.toContain("data-branch");
  });
});


// **여기서 세는 것은 그림이 아니라 import다.** 아래 둘은 `ShellBranch.test.ts`가 지고 있던
// 계약인데, 그 파일이 판 04에서 가지와 함께 사라졌다 — 계약이 겨누는 것(`SidebarWorkList.tsx`)은
// 그대로라 자리를 옮겨 살린다. 겨누는 파일 옆이 원래 있어야 할 자리이기도 하다.
describe("사이드바 목록은 터미널을 모른다", () => {
  const source = readFileSync(
    fileURLToPath(new URL("./SidebarWorkList.tsx", import.meta.url)),
    "utf8",
  );
  // 리터럴로 센다 — 정규식으로 import 블록을 잘라내는 판정은 다른 곳에서 출발해 남의
  // 코드를 읽고도 초록이었다(판 02·03 리뷰가 잡은 것). 리터럴은 파서가 샐 자리가 없다.
  const countOf = (literal: string) => source.split(literal).length - 1;

  it("terminal feature를 import하지 않는다", () => {
    // 이 계약이 깨지면 `@xterm/*`와 그 CSS가 여기로 따라 들어와 **위 검사 전부가**
    // 서지 못한다 — 이 파일의 seam은 DOM 없는 환경의 정적 마크업이다. 셸 수와 도는 것의
    // 로고가 값이 아니라 슬롯으로 내려오는(`shellCounts`·`renderRunning`) 이유가 그것이고,
    // `components/ui/agent-mark`가 `features/terminal`이 아니라 거기 사는 이유도 같다.
    //
    // **주석에 적어도 빨개진다.** 세는 것이 import가 아니라 리터럴이라 그렇고, 그 성질은
    // 일부러 그대로 둔다: 「여기서는 그 모듈을 부를 수 없다」를 가장 싸게 지키는 방법이다.
    expect(countOf("@/features/terminal")).toBe(0);
    expect(countOf("./terminal-store")).toBe(0);
  });

  it("window에서 키를 듣지 않는다", () => {
    // 결정 78. ⌘1~9가 **한 화면 안에서 본문을 옮기는** 키가 됐다(지금은 탭 줄의 칸을
    // 고른다). 사이드바가 계속 듣고 있으면 한 번 눌러 둘이 일어나고, 본문을 옮기려던
    // 사람이 다른 work으로 끌려간다. 지운 자리라 「없다」를 세는 것 말고 볼 방법이 없다.
    expect(countOf('window.addEventListener("keydown"')).toBe(0);
  });
});

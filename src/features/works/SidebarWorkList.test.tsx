/// <reference types="node" />
// 소스 스캔 때문에 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ShellSignal } from "@/components/shell/shell-signal";
import type { StatusMarkKind } from "@/components/shell/status-mark";
import { WorkSectionList } from "./WorkSectionList";
import { emptyMainNotice, splitWorkSections, type SectionsOpen } from "./work-sections";
import type { WorkView } from "./types";

// 사이드바 목록이 **그리는 것**을 본다. 어느 구역에 무엇이 놓이는지는 work-sections.test.ts가
// 이미 보므로 여기서 보는 것은 그 결과가 화면으로 나오는 자리뿐이다 — 구획이 서는 조건
// (결정 82), 빈 `Work` 구획이 하는 말(결정 108), 핀의 생김새(결정 85), 접힘과 개수.
//
// 훅을 부르지 않는 `WorkSectionList`를 렌더한다. 구독하는 자리(useWorks·라우터·localStorage)는
// 위에 남아 있고, 여기로는 상태와 콜백만 들어온다 — `ShellTabs`와 같은 모양이다.

// 이 화면이 행에서 읽는 것은 slug·title·status·pinned·projects다. work-sections.test.ts와 같은
// 접두사 규칙을 쓴다: "pin:"이면 고정, "draft:"면 초안. 제목은 slug를 그대로 쓴다.
//
// **프로젝트는 `@`로 뒤에 붙인다**(`"가@billing,ledger"`). 행이 두 줄이던 동안 셸 없는 행의
// 둘째 줄이 그것을 실었고, 한 줄 행은 **안 싣는다**(결정 14 — 호버 카드가 싣는다). 그 「안
// 싣는다」를 재려면 프로젝트가 있는 work가 있어야 해서 표기가 남는다. 안 붙이면 빈 목록이다.
const works = (...raws: string[]) =>
  raws.map((raw) => {
    const pinned = raw.startsWith("pin:");
    const rest = pinned ? raw.slice("pin:".length) : raw;
    const draft = rest.startsWith("draft:");
    const named = draft ? rest.slice("draft:".length) : rest;
    const [slug, projects = ""] = named.split("@");
    return {
      slug,
      title: slug,
      status: draft ? "draft" : "active",
      pinned,
      projects: projects === "" ? [] : projects.split(","),
    };
  }) as WorkView[];

const ALL: SectionsOpen = { pinned: true, works: true };

// 기본값은 **아무 work도 안 고른 상태**다 — 아래 구획 검사들이 그 위에서 돈다.
function render(
  list: WorkView[],
  open: SectionsOpen = ALL,
  {
    selectedSlug = null,
    shellCounts = {},
    // 화면값은 **문자열 Record**로 내려온다(#203) — 값을 고르는 자리는 Sidebar이고 이
    // 목록은 터미널을 모른다(아래 계약). 여기서 보는 것은 그 값이 상태 표시와 이름에 닿는가다(02 S8).
    signals = {},
    draggedSlug = null,
    lineY = null,
    litEmptySlot = null,
    menuTarget = null,
    renaming = null,
    // v1 티켓 37 — Work마다 이은 Thread 수 · 펼친 Work · 펼친 Work 아래에 설 Thread 줄(슬롯). 슬롯이 무엇을 그리는지는 이 파일의 관심
    // 밖이다(Thread 줄은 `SidebarThreads.test.tsx`가 본다) — 여기서는 **어느 행 아래에 서는가**만 본다.
    threadCounts = {},
    // 02 티켓 05 — Work마다 그 Thread들이 그리는 상태 표시(`markOf`). Work 줄은 이것과 셸 신호에서 표시 하나를 고른다(`workMark`).
    threadMarks = {},
    expanded = [],
    renderThreads = (work: WorkView) => <i data-threads-of={work.slug} />,
  }: {
    selectedSlug?: string | null;
    shellCounts?: Record<string, number>;
    signals?: Record<string, ShellSignal>;
    draggedSlug?: string | null;
    lineY?: number | null;
    litEmptySlot?: keyof SectionsOpen | null;
    menuTarget?: string | null;
    renaming?: string | null;
    threadCounts?: Record<string, number>;
    threadMarks?: Record<string, readonly (StatusMarkKind | null)[]>;
    expanded?: string[];
    renderThreads?: (work: WorkView) => ReactNode;
  } = {},
): string {
  return renderToStaticMarkup(
    <WorkSectionList
      sections={splitWorkSections(list, open)}
      open={open}
      selectedSlug={selectedSlug}
      // 정류장을 고르는 것은 위(`SidebarWorkList`의 `useRoving`)다 — 여기서는 고른 행을 그대로 건넨다.
      stop={selectedSlug}
      shells={{
        shellCounts,
        signals,
        // 부르는 셸의 말(결정 14)은 이 파일의 관심 밖이다 — 이름 버튼의 설명만 바꾸고 행의
        // 구획·레인·이름은 안 건드린다. 설명이 서는 것은 L3가 잰다(`works-sidebar.spec.ts`).
        notes: {},
      }}
      threads={{ counts: threadCounts, marks: threadMarks, expanded, onToggle: () => {}, renderThreads }}
      onToggleSection={() => {}}
      onNewWork={() => {}}
      onOpen={() => {}}
      onHover={() => {}}
      onLeave={() => {}}
      onTogglePin={() => {}}
      draggedSlug={draggedSlug}
      lineY={lineY}
      litEmptySlot={litEmptySlot}
      onArmDrag={() => {}}
      menuTarget={menuTarget}
      renaming={renaming}
      onRename={() => {}}
      onRenameCommit={() => {}}
      onRenameEnd={() => {}}
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
      // 따옴표 안에서만 센다 — 머리 줄의 「새 Work」처럼 앞에 다른 이름이 서도 그 이름을 넘어 이어 붙지 않게.
      rows: [...chunk.matchAll(/aria-label="([^"]*?) 고정"/g)].map((m) => m[1]),
    }));

// **상태 표시** 칸들 — 표시가 있는 행마다 하나씩이다(02 구현 스펙 §4). 표식이 슬러그를 들고 있어야 「어느 행의 표시인가」가 나온다: 마크업
// 전체에서 글자를 세면 다른 행의 표시와 섞여, 표시가 엉뚱한 work에 서도 초록이 된다. 칸 안의 표시는 `StatusMark` 하나이고 그 표식
// (`data-mark`)이 무엇이 섰는지 말한다. 칸 안에 `<div>`가 없어 첫 `</div>`까지가 그 칸 전부다.
const marksOf = (markup: string) =>
  [...markup.matchAll(/<div[^>]*data-row-mark="(.*?)"[\s\S]*?<\/div>/g)].map((m) => ({
    slug: m[1],
    mark: /data-mark="([^"]*)"/.exec(m[0])?.[1] ?? null,
    html: m[0],
  }));

// 행 왼쪽의 **레인** — 여는 태그만 본다(안에 드는 것을 함께 보는 것은 아래 `lanesOf`다).
const laneOf = (markup: string) => /<span data-lane=""[^>]*>/.exec(markup)?.[0] ?? "";

// 이름 버튼의 **접근성 이름**. 화면값이 있는 행만 `aria-label`을 든다(#203) — 없으면
// `null`이고, 그때 이름은 안에 든 제목 글자다. 값이 없을 때까지 함께 세지 않으면
// 「모든 행에 말이 붙는다」도 초록이 된다.
const namesOf = (markup: string) =>
  [...markup.matchAll(/<button type="button"(?: aria-label="([^"]*)")? class="col-start-1 row-start-1/g)].map(
    (found) => found[1] ?? null,
  );

// **레인 안에 실제로 선 것**까지 본다(#203). 여는 태그만 보면 점이 아이콘을 밀어냈는지
// 아이콘이 그대로인지가 안 갈린다 — 이 판이 그 자리를 처음 갈라 쓴다.
const lanesOf = (markup: string) =>
  [...markup.matchAll(/<span data-lane=""[^>]*>([\s\S]*?)<\/span><span data-title/g)].map(
    (found) => found[1],
  );

// v1 티켓 37 — Work 줄의 **펼침 단추**(표식 `data-expander`는 그 Work의 slug)와 **Thread 수**(표식 `data-thread-count`). 펼친 상태와
// 이름을 함께 읽는다.
const expandersOf = (markup: string) =>
  [...markup.matchAll(/<button[^>]*data-expander="([^"]*)"[^>]*>/g)].map((m) => ({
    slug: m[1],
    open: /aria-expanded="true"/.test(m[0]),
    label: /aria-label="([^"]*)"/.exec(m[0])?.[1] ?? null,
  }));
const countsOf = (markup: string) =>
  [...markup.matchAll(/<span[^>]*data-thread-count="([^"]*)"[^>]*>([^<]*)<\/span>/g)].map((m) => ({ slug: m[1], text: m[2] }));
/** 그 Work 줄부터 다음 Work 줄 앞까지 — 줄과 그 아래 딸린 것. */
const chunkOf = (markup: string, slug: string) =>
  markup
    .split(/(?=<div data-work-row=")/)
    .find((chunk) => chunk.startsWith(`<div data-work-row="${slug}"`)) ?? "";

describe("`고정` 구획은 고정된 것이 있을 때만 선다", () => {
  // 결정 82. 아무것도 없는 구획의 헤더는 자리만 먹는다.
  it("고정된 것이 없으면 헤더가 아예 없다", () => {
    expect(headersOf(render(works("가", "draft:나"))).map((one) => one.label)).toEqual(["Work"]);
  });

  it("고정된 것이 있으면 `Work` 위에 선다", () => {
    expect(headersOf(render(works("pin:가", "나", "draft:다"))).map((one) => one.label)).toEqual([
      "고정",
      "Work",
    ]);
  });

  it("개수는 그 구획의 것을 적는다 — 초안도 `Work`의 수에 든다", () => {
    const headers = headersOf(render(works("pin:가", "pin:draft:나", "다", "draft:라")));
    expect(headers.map((one) => `${one.label} ${one.count}`)).toEqual(["고정 2", "Work 2"]);
  });
});

// UI개선 결정 5. 초안은 따로 접힌 구역이 아니라 **다른 항목들 사이에** 서고, 상태 아이콘으로만 갈린다.
describe("초안은 `Work` 구획 안에 선다", () => {
  it("`초안` 머리가 없고 초안 행이 받은 자리 그대로 `Work`에 선다", () => {
    const markup = render(works("draft:가", "나", "draft:다"));
    expect(rowsBySection(markup)).toEqual([{ label: "Work", rows: ["가", "나", "다"] }]);
    // 머리 목록만 보면 초안 머리가 **표식 없이** 되살아나도 초록이다 — 글자로도 센다.
    expect(markup).not.toMatch(/>초안</);
  });

  it("모든 항목이 초안이어도 빈 문구가 아니라 그 초안들이 보인다", () => {
    const markup = render(works("draft:가", "draft:나"));
    expect(rowsBySection(markup)).toEqual([{ label: "Work", rows: ["가", "나"] }]);
    // 빈 구획이 낼 수 있는 두 말을 **판정 함수에서** 받아 댄다 — 글자 조각으로 대면 문구가
    // 바뀌는 날 이 두 줄이 아무것도 안 재는 채 초록으로 남는다.
    const notices = [
      emptyMainNotice(splitWorkSections([], ALL)),
      emptyMainNotice(splitWorkSections(works("pin:가"), ALL)),
    ];
    expect(new Set(notices).size).toBe(2);
    for (const notice of notices) expect(markup).not.toContain(notice);
  });
});

describe("고정된 work은 한 구획에만 있다", () => {
  // 결정 82. 고정하면 원래 구획에서 **빠진다**. 양쪽에 다 보이면 같은 작업이
  // 두 줄로 서고, 어느 쪽을 눌렀는지가 뜻을 갖게 된다.
  it("고정된 작업은 `Work`에서 빠진다", () => {
    expect(rowsBySection(render(works("pin:가", "나")))).toEqual([
      { label: "고정", rows: ["가"] },
      { label: "Work", rows: ["나"] },
    ]);
  });

  it("고정된 초안은 `Work`에서 빠진다", () => {
    // 결정 83 — 초안도 고정할 수 있고, 고정되면 `고정`에 선다.
    expect(rowsBySection(render(works("pin:draft:가", "draft:나")))).toEqual([
      { label: "고정", rows: ["가"] },
      { label: "Work", rows: ["나"] },
    ]);
  });
});

describe("빈 `Work` 구획이 하는 말", () => {
  // 결정 108. 화면에 작업이 버젓이 서 있는데 「아직 Work가 없어요」라고 하면 거짓말이다.
  // emptyMainNotice 자체는 work-sections.test.ts가 보고, 여기서는 **호출부**를 본다 —
  // 화면이 그 함수를 실제로 부르는지.
  it("고정 때문에 비었으면 「전부 고정돼 있어요」다", () => {
    expect(render(works("pin:가"))).toContain("전부 고정돼 있어요.");
  });

  it("아무것도 없으면 「말로 시작하면 Host가 Work로 묶어 줘요」다(02 S6)", () => {
    expect(render([])).toContain("아직 Work가 없어요. 말로 시작하면 Host가 Work로 묶어 줘요.");
  });

  it("고정된 것이 초안뿐이어도 「전부 고정돼 있어요」다", () => {
    expect(render(works("pin:draft:가"))).toContain("전부 고정돼 있어요.");
  });

  it("작업이 있으면 아무 말도 하지 않는다", () => {
    const markup = render(works("가"));
    expect(markup).not.toContain("고정돼 있어요");
    expect(markup).not.toContain("아직 Work가 없어요");
  });
});

// 목록의 이름. 문구 자체는 어휘 표라 `work-sections.test.ts`가 글자까지 붙들고 있고, **여기서
// 보는 것은 호출부다** — 화면이 그 표를 실제로 부르는가.
describe("상주 목록의 이름", () => {
  it("머리가 `Work`이고 형제 머리는 `고정`이다", () => {
    const labels = headersOf(render(works("pin:가", "나", "draft:다"))).map((one) => one.label);
    expect(labels).toEqual(["고정", "Work"]);
  });

  // 글자까지의 계약은 `work-sections.test.ts`가 진다.
  it("Work가 없으면 말로 시작하면 된다고 한다", () => {
    expect(render([])).toContain("아직 Work가 없어요.");
  });
});

describe("핀 버튼", () => {
  // 결정 85. 상시 노출하지 않는 것은 고정 여부를 **구획이 이미 말하기** 때문이다.
  it("평소엔 숨어 있고 hover에만 뜬다", () => {
    for (const pin of pinsOf(render(works("pin:가", "나", "draft:다")))) {
      expect(pin).toContain("opacity-0");
      // 이 한 줄이 없으면 opacity-0으로 **영영** 안 보인다.
      expect(pin).toContain("group-hover:opacity-100");
    }
  });
  // 핀은 Tab 정류장이 아니고(codex-ds 스펙 S10), 키보드로 고정하는 길은 행의 work 메뉴(⇧F10)의 「고정」이다 — Tab 차례에 핀이
  // 없는 것은 L3 `keyboard.spec.ts`가 잰다. 그래도 포커스는 받으므로(보조 기술 · 코드, WebKit 밖의 누름) 그때 앱의 링이고 포커스만으로는
  // 뜨지 않는 것은 칠한 값으로 L3 `primitives.spec.ts` 「키보드 포커스는 … 행 안 버튼에서 같은 링이다」가 잰다(클래스 문자열은 재지 않는다).

  it("고정된 행은 채운 핀, 안 된 행은 빈 핀이다", () => {
    const [pinnedRow, plainRow] = pinsOf(render(works("pin:가", "나")));
    expect(pinnedRow).toContain('aria-pressed="true"');
    expect(pinnedRow).toContain('fill="currentColor"');
    expect(plainRow).toContain('aria-pressed="false"');
    expect(plainRow).toContain('fill="none"');
  });

  // 결정 31 — **행 안에 사는 버튼은 자기 배경을 안 켠다.** 행이 이미 hover 배경을 갖고
  // 있어서, 버튼까지 켜면 포인터 하나에 상자 둘이 뜬다. 눈으로는 「좀 진하네」로 지나가는
  // 종류라 여기서 못박는다.
  it("hover에 배경이 아니라 색만 바뀐다", () => {
    for (const pin of pinsOf(render(works("pin:가", "나")))) {
      expect(pin).toContain("icon-button-tint");
      expect(pin).not.toContain("icon-button-quiet");
    }
  });

  it("행마다 하나씩 있다 — 초안 행에도 있다", () => {
    // 결정 83. 초안도 고정할 수 있다.
    expect(pinsOf(render(works("pin:가", "나", "draft:다")))).toHaveLength(3);
  });

  // 결정 1·2·5 — **핀은 끝 칸에 상태 표시와 겹쳐 서고, 폭은 hover에만 갖는다.**
  //
  // 사람이 실물 앱에서 고른 모양이다: 「호버하면, 자동으로 아이콘 위치만큼 text의 최대
  // 크기가 조정되지? 이런걸 원하는거임. (안겹치게)」 그러려면 칸이 핀의 폭을 **알아야**
  // 하므로 핀이 격자 안에 있어야 하고, 그러면서도 안 뜬 동안은 폭이 **0**이어야 한다.
  //
  // 한때 `absolute right-1`로 격자 밖에 세운 적이 있다. 그때는 hover 밀림이 0.00px이었지만
  // 칸이 핀을 몰라 **핀이 제목 글자 위에 얹혔다** — 페이드 띠와 글리프가 둘 다 250~262px에
  // 섰다(실측). 그 겹침을 없애는 값이 hover의 24px 뜀이다.
  //
  // **폭을 걷는 것이 `max-w-0`인 것은** `w-0`이 `icon-button`의 `width: 24px`과 같은 레이어라 승자가 Tailwind의 정렬
  // 순서에 걸려서다. (한때 핀이 포커스에도 떠서(결정 7) `display:none`도 막혔다 — 요소를 지우면 포커스가 안 들어간다.
  // 핀이 Tab에서 빠진 지금도 꼴은 그대로다.) 실제 폭과 겹침은 e2e가 실측으로 잰다.
  it("끝 칸(상태 표시 칸)에 서고, 폭은 hover에만 갖는다", () => {
    for (const pin of pinsOf(render(works("pin:가", "나", "draft:다")))) {
      // 칸이 핀의 폭을 세려면 격자 안이어야 한다. 끝 칸이 상태 표시와 겹쳐 서는 칸이다 — 앞은 이름이다(02 S9가 Thread 수 칸을 걷었다).
      // 펼침 단추는 칸이 아니라 레인 위에 겹쳐 선다(v1 티켓 46).
      expect(pin).toContain("col-start-2");
      expect(pin).toContain("row-start-1");
      expect(pin).not.toContain("absolute");
      // 쉴 때 트랙 기여가 0 — 그리고 뜰 때 되돌아온다.
      expect(pin).toContain("max-w-0");
      expect(pin).toContain("group-hover:max-w-6");
      // 0폭 상자 밖으로 글리프가 새지 않게.
      expect(pin).toContain("overflow-hidden");
      // 칸이 핀보다 넓을 때(메타가 선 행) stretch되면 글리프가 가운데로 밀린다.
      expect(pin).toContain("justify-self-end");
    }
    // 핀은 격자 안이다(위 `absolute`가 없다). 행의 위치 기준(`relative`)은 핀이 아니라 레인 위에 겹쳐 서는 펼침 단추의
    // 것이다(v1 티켓 46 — 아래 「Work 줄이 그 Work의 Thread를 품는다」).
    expect(render(works("가"))).toContain("group relative grid");
  });
});

describe("구획 접기", () => {
  // 결정 108의 마지막 줄 — `고정` 구획도 `Work`과 같은 규칙으로 접힌다.
  it("접힌 구획은 헤더가 그렇다고 말하고 높이만 0이 된다", () => {
    const markup = render(works("pin:가", "나", "draft:다"), { ...ALL, pinned: false });
    expect(headersOf(markup).map((one) => `${one.label} ${one.open}`)).toEqual([
      "고정 false",
      "Work true",
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

// **오른쪽 끝은 상태 표시 하나다**(02 구현 스펙 §4 · S8 · S9 · 티켓 05). 한때 이 칸은 셸의 메타(조용하면 `⌨ N`, 부르면 경과)였고 그 앞에
// Thread 수가 섰다. 이제 줄마다 표시가 하나뿐이다 — 그 Work의 Thread들 가운데 가장 센 상태, 조용하면 그 Work 셸의 신호(`workMark` — 표는
// `work-mark.test.ts`). 셸 수 · Thread 수는 호버 카드가 말한다(`WorkPeek`). 높이와 자리는 e2e와 시안 비교가 실측으로 재고, 여기서 보는 것은
// **마크업이 무엇을 말하는가**다.
describe("work 행은 한 줄이고, 오른쪽 끝에 상태 표시 하나가 핀과 끝 칸 하나에 겹친다", () => {
  it("**둘째 줄이 없다** — 그 표식이 어느 행에도 안 선다", () => {
    // 결정 14. 옛 표식(`data-subrow`)이 남아 있으면 그 이름이 곧 거짓이다. 셸이 있는 행 · 없는
    // 행 · 부르는 행을 함께 그린다 — 두 줄 행은 셋 모두에 줄을 세웠다.
    const markup = render(works("가@billing", "나@billing", "다"), ALL, {
      shellCounts: { 가: 1, 다: 1 },
      signals: { 다: "waiting" },
    });
    expect(markup).not.toContain("data-subrow");
  });

  it("표시가 있는 행에만 그 칸이 서고, 칸마다 표시는 하나다 — Thread의 가장 센 상태, 조용하면 셸 신호", () => {
    const markup = render(works("가", "나", "다", "라"), ALL, {
      threadMarks: { 가: ["new", "working"], 다: [null] },
      signals: { 나: "waiting", 라: "working" },
    });
    expect(marksOf(markup).map(({ slug, mark }) => [slug, mark])).toEqual([
      ["가", "working"],
      ["나", "mine"],
    ]);
    for (const one of marksOf(markup)) expect(one.html.match(/data-mark=/g)).toHaveLength(1);
  });

  it("**셸 수도 Thread 수도 줄에 없다** — 오른쪽 끝은 상태 표시의 자리다(S9)", () => {
    // 셸 수(`⌨ N`)와 부른 셸의 경과는 옛 오른쪽 메타였다 — 셸 수는 호버 카드로, 경과는 알림 띠로 갔다. Thread 수도 호버 카드다.
    const markup = render(works("가", "나"), ALL, { shellCounts: { 가: 3 }, threadCounts: { 가: 2 }, signals: { 나: "done" } });
    expect(markup).not.toContain("data-row-meta");
    expect(markup).not.toContain("data-shells");
    expect(markup).not.toContain("data-thread-count");
    expect(markup).not.toContain("data-elapsed");
  });

  it("표시는 눌리지 않는다 — 그 자리의 누름은 행이 받는다", () => {
    const [가] = marksOf(render(works("가"), ALL, { threadMarks: { 가: ["failed"] } }));
    expect(가.html).not.toContain("<button");
    expect(가.html).not.toContain("<a ");
  });

  it("이름 버튼은 여전히 **행 상자의 직계 자식**이다", () => {
    // 행을 상자로 한 겹 싸면 이름 버튼의 부모가 그 상자가 되어, 그것으로 배경 상자를
    // 집는 자리가 조용히 어긋난다 — e2e가 이름 버튼의 `parentElement`로 호버 카드 자리를
    // 잰다. 핀과 표시는 이름 버튼의 **형제로** 서므로 그 계약이 안 깨진다.
    const markup = render(works("가"), ALL, { threadMarks: { 가: ["new"] } });
    // 행 상자는 끌기 표식(`data-work-row`)을 클래스 앞에 든다 — 여는 태그를 통째로 넘긴다.
    const row = /<div data-work-row="[^"]*" class="group relative grid[^"]*">(<button|<div)/.exec(markup);
    expect(row?.[1]).toBe("<button");
  });

  it("**레인은 행 왼쪽에 서고 폭을 안 내준다**", () => {
    // 행 왼쪽 16px 한 칸(Codex 사이드바의 폴더 칸 — v1 티켓 46). 폭을 실제로 지키는 것은 제목 상자다 — 그쪽이 `min-width: 0`이라
    // 좁아지는 값을 전부 흡수한다. 그래도 적어 두는 것은 제목 쪽 규칙이 바뀌는 날 이 자리가 **먼저** 찌그러지는 것을 막기 위해서다.
    const lane = laneOf(render(works("가")));
    expect(lane).toContain("size-4");
    expect(lane).toContain("shrink-0");
  });

  it("**상태 표시가 있는 행은 이름에 그 말이 붙는다**", () => {
    // 스토리 33 — 색만이 신호여선 안 된다. 표시 칸은 이름 버튼 밖의 형제라(`aria-hidden`) 상태를 말하는 자리는 이 이름 하나다. 말은
    // 표시의 말(`STATUS_MARK_LABEL`)이다 — 셸이 불러 선 알약도 「내 차례」다(S8).
    const markup = render(works("가", "나", "다", "라"), ALL, {
      signals: { 가: "waiting", 나: "done", 다: "working" },
      threadMarks: { 라: ["failed", "new"] },
    });
    expect(namesOf(markup)).toEqual(["가 — 내 차례", "나 — 새 결과", null, "라 — 실패"]);
    for (const one of marksOf(markup)) expect(one.html).toContain('aria-hidden="true"');
  });

  it("상태 표시가 없으면 이름은 제목뿐이다", () => {
    // 조용한 행에까지 말이 붙으면 「상태가 붙었다」가 아무 뜻도 없어진다. 그리고 이름으로
    // 행을 집는 e2e 전부가 그 순간 갈린다.
    expect(namesOf(render(works("가"), ALL, { threadMarks: { 가: [null] } }))).toEqual([null]);
  });

  it("**행은 평평하다** — 채움은 고른 행 하나뿐이다", () => {
    // 결정 5(스토리 29). 카드 채움(목업의 F·G)은 열여덟 행에 전부 무게를 줘 목록이
    // 게시판이 된다. 테두리도 배경도 고른 행의 `selected-row` 말고는 없다. 카드 채움은 Codex 이름(`bg-surface` · `bg-surface-under` …)과
    // shadcn 이름(`bg-background`) 둘 다로 센다 — 행은 Codex 이름으로 적히므로 shadcn 이름만 세면 이 지킴이 조용히 빈다.
    const markup = render(works("가", "나"), ALL, { selectedSlug: "나" });
    const rows = [...markup.matchAll(/<div data-work-row="[^"]*" class="(group relative grid[^"]*)">/g)].map(
      (m) => m[1],
    );
    expect(rows).toHaveLength(2);
    expect(rows.filter((one) => one.includes("selected-row"))).toHaveLength(1);
    for (const row of rows) {
      expect(row).not.toContain("border");
      expect(row).not.toContain("bg-surface");
      expect(row).not.toContain("bg-background");
      expect(row).not.toContain("shadow");
    }
  });
});

// **레인은 늘 폴더다**(02 구현 스펙 §4 · S7). 한때 레인은 화면값이 있으면 셸의 점 · 스피너, 없으면 work 상태 아이콘(draft · active · review ·
// done)이었다 — 줄의 상태가 왼쪽 레인과 오른쪽 메타 두 자리에 흩어져 있었다. 이제 상태는 오른쪽 표시 하나이고, Work 상태는 호버 카드와 Work
// 화면이 말한다. 그래서 레인은 무엇이 오든 같은 글리프다.
describe("레인은 늘 폴더다", () => {
  it("Work 상태도 셸 신호도 Thread 상태도 레인을 바꾸지 않는다", () => {
    const markup = render(works("가", "draft:나", "다", "라"), ALL, {
      shellCounts: { 다: 1 },
      signals: { 다: "waiting" },
      threadMarks: { 라: ["working"] },
    });
    const lanes = lanesOf(markup);
    expect(lanes).toHaveLength(4);
    expect(new Set(lanes).size).toBe(1);
    expect(lanes[0]).toContain("<svg");
    expect(lanes[0]).not.toContain("data-signal");
  });
});

// 결정 9~12 — **제목이 `…` 대신 오른쪽 끝 페이드로 끝나고, 마우스를 올리면 흘러 끝까지
// 읽힌다.** 폭으로는 이 문제를 못 푼다: 핀을 띄워도 +24px, 이름 버튼 여백을 없애도 +6px,
// 기본 사이드바 폭 조정은 저장된 폭이 이겨 0px이다 — 다 합쳐도 두 글자다.
//
// **여기서 보는 것은 마크업이 그 자리를 만들어 두는가뿐이다.** 페이드가 실제로 걸리는지도,
// 글자가 흐르는지도 진짜 CSS가 있어야 나므로 e2e가 그쪽의 유일한 그물이다(결정 15).
describe("제목은 페이드로 끝나고 hover에 흐른다", () => {
  // 상자와 그 **안쪽 글자**를 함께 집는다. 둘이 갈려 있는 것이 이 판의 구조 전부다 —
  // 상자가 컨테이너이자 마스크이고, 흐르는 것은 그 안의 글자다(결정 10).
  const titleOf = (markup: string) => {
    const found = /<span data-title="" class="([^"]*)"><span>([^<]*)<\/span><\/span>/.exec(markup);
    return found && { box: found[1], title: found[2] };
  };

  it("제목이 상자 **안쪽 글자**로 서고, 말줄임이 아니다", () => {
    // `…`을 그리던 `truncate`가 사라진 자리다(결정 9). 흐르는 것이 글자라 상자와 갈려야
    // 하고, 상자에 걸린 마스크가 그 끝을 흐린다 — 그 둘은 e2e가 실측으로 본다.
    //
    // **안쪽 글자에 클래스가 없는 것이 계약이다**(결정 10) — 규격은 `index.css`가 든다.
    // 그래서 이 층이 아는 것은 `titleOf`의 정규식이 이미 잡는 **자식 span이 있는가**와 상자에
    // `truncate`가 없는가뿐이고, 그 글자가 `max-content`로 서는지는 e2e의 넘침이 잰다.
    const one = titleOf(render(works("가")))!;
    expect(one.title).toBe("가");
    expect(one.box).not.toContain("truncate");
  });

  it("상자는 폭을 **밖에서** 받는다", () => {
    // 결정 10의 딸린 조정이다. `container-type: inline-size`는 「내 폭이 내용에 안
    // 달렸다」는 선언이라, 내용 기반 flex-basis로 두면 상자가 **0으로 무너져** 제목이
    // 통째로 사라진다. `flex-1`(basis 0)과 `min-w-0`이 함께 가야 한다.
    const one = titleOf(render(works("가")))!;
    expect(one.box).toContain("flex-1");
    expect(one.box).toContain("min-w-0");
  });

  it("**관찰자를 새로 달지 않는다** — 흐르는 거리는 CSS가 정한다", () => {
    // 결정 10. `100cqw`가 상자 폭을 되읽으므로 사이드바 폭을 드래그해도 CSS가 스스로 다시
    // 푼다 — 폭이 바뀌는 이 화면에서 그게 결정적이다. 재는 것은 **속도 하나**이고 그 자리는
    // 호버 카드 타이머를 이미 거는 핸들러다(결정 12): 쉴 때 계측도, 관찰자도 없다.
    // 두 파일을 이어 센다 — 행은 구획 목록 파일로 떨어져 나갔고(아래 「훅을 안 부른다」), 끄는
    // 동안 기하를 재는 자리는 사이드바 목록에 남았다. 한쪽만 세면 다른 쪽에 관찰자가 붙어도 초록이다.
    const source = ["./SidebarWorkList.tsx", "./WorkSectionList.tsx"]
      .map((file) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8"))
      .join("\n");
    expect(source).not.toContain("ResizeObserver");
    // **재는 자리도 하나다** — hover 진입 핸들러의 그 한 줄이고, 쉴 때는 아무것도 안 잰다.
    expect(source.split("scrollWidth").length - 1).toBe(1);
  });

  // 페이드 폭은 **한 값인데 두 언어에 적혀 있다** — `calc()`가 길이를 시간으로 못 바꾸는 것이
  // 그 이유 전부다(결정 12). 정본은 `index.css`이고(결정 10) `TITLE_FADE`는 그것을 시간으로
  // 바꾸려고 옮겨 적은 쪽이다. 옮겨 적은 쪽이 뒤처져도 타입 검사도 화면도 조용하다:
  // 어긋남은 마퀴 **속도**로만 나타나고(넘침 100px에서 12↔24로 갈리면 10%쯤) e2e의 속도 밴드
  // (`MARQUEE_SPEED * [0.88, 1.12]`) 안에 숨는다. e2e가 이미 묶는 짝은 CSS↔e2e 하나뿐이라
  // 이 짝은 여기서 본다 — `theme-tokens.test.ts`가 앱 팔레트↔터미널에 하는 것과 같다.
  it("`TITLE_FADE`가 `index.css`의 `--title-fade`와 같은 수다", () => {
    // 못 찾으면 던진다 — 어느 쪽 이름이 바뀌면 조용히 통과하는 대신 여기가 깨져야 한다.
    const px = (source: string, pattern: RegExp, where: string) => {
      const found = pattern.exec(source);
      if (!found) throw new Error(`${where}에서 페이드 폭을 찾지 못했다`);
      return found[1];
    };
    const css = readFileSync(fileURLToPath(new URL("../../index.css", import.meta.url)), "utf8");
    // 행과 함께 구획 목록 파일로 옮겨 갔다 — 마퀴 거리를 시간으로 바꾸는 자리가 행의 hover 핸들러다.
    const source = readFileSync(
      fileURLToPath(new URL("./WorkSectionList.tsx", import.meta.url)),
      "utf8",
    );
    expect(px(source, /const TITLE_FADE = (\d+);/, "WorkSectionList.tsx")).toBe(
      px(css, /--title-fade:\s*(\d+)px;/, "index.css"),
    );
  });
});

describe("행 아래에 셸이 딸리지 않는다", () => {
  // 결정 6. 같은 것을 두 자리에서 고르게 두면 어느 쪽이 지금인지가 화면마다 갈린다 —
  // 셸을 고르는 자리가 탭 줄로 돌아갔으므로(결정 7·8) 사이드바에서 그 길을 걷는다.
  // 여기서 보는 것은 **셸의 자리가 정말 없는가**다: 셸을 펴는 버튼도, 잎도, 가지의 속도. 행 아래에 서는 것은 그 Work의 Thread뿐이다(v1
  // 티켓 37 — 아래 「Work 줄이 그 Work의 Thread를 품는다」).
  const shut = () => render(works("가", "나"), ALL, { selectedSlug: "가", shellCounts: { 가: 2 } });

  it("접히는 것은 구획 헤더와 Thread가 있는 Work 줄의 펼침뿐이다", () => {
    // 목록에서 `aria-expanded`를 가진 버튼이 구획 셋과 펼침 단추 말고 하나도 없어야 한다. 표식으로
    // 좁혀 세지 않고 **전부 세서** 그 둘의 것과 대는 것은, 표식을 안 단 새 토글이 생기는
    // 경우를 그 그물이 통째로 놓치기 때문이다. 셸만 있고 Thread가 없는 행에는 펼칠 것이 없다.
    const markup = shut();
    const all = (markup.match(/aria-expanded=/g) ?? []).length;
    expect(all).toBe(buttonsOf(markup, 'data-section=""').length);
    const threaded = render(works("가", "나"), ALL, { shellCounts: { 가: 2 }, threadCounts: { 나: 1 } });
    expect((threaded.match(/aria-expanded=/g) ?? []).length).toBe(
      buttonsOf(threaded, 'data-section=""').length + expandersOf(threaded).length,
    );
    expect(expandersOf(threaded).map((one) => one.slug)).toEqual(["나"]);
  });

  it("잎도 가지도 없다", () => {
    const markup = shut();
    expect(markup).not.toContain("data-leaf");
    expect(markup).not.toContain("data-branch");
  });
});

// 끄는 동안 이 그림이 받는 것 둘(UI개선 스펙 §4) — 끌리는 행과 틈 선의 자리. 선이 **실제로** 틈에
// 서는지는 레이아웃이 있어야 해서 L3(`work-row-drag.spec.ts`)가 재고, 여기서는 받은 값이 한 행과 한
// 선에만 닿는지를 본다.
describe("끄는 동안의 그림", () => {
  const rowClasses = (markup: string) =>
    new Map(
      [...markup.matchAll(/<div data-work-row="([^"]*)" class="([^"]*)"/g)].map((m) => [m[1], m[2]]),
    );

  it("끌리는 행 **하나만** 흐려진다", () => {
    const rows = rowClasses(render(works("pin:가", "나", "다"), ALL, { draggedSlug: "나" }));
    expect(rows.size).toBe(3);
    expect([...rows].filter(([, cls]) => cls.includes("opacity-40")).map(([slug]) => slug)).toEqual(["나"]);
  });

  it("안 끌 때는 아무 행도 안 흐려지고 선도 없다", () => {
    const markup = render(works("pin:가", "나"));
    expect(rowClasses(markup).size).toBe(2);
    expect([...rowClasses(markup).values()].some((cls) => cls.includes("opacity-40"))).toBe(false);
    expect(markup).not.toContain("data-drop-line");
  });

  it("틈 선은 받은 내용 좌표에 **하나** 서고, 누를 수 없다", () => {
    const markup = render(works("pin:가", "나"), ALL, { draggedSlug: "나", lineY: 41.5 });
    const lines = markup.match(/<div data-drop-line=""[^>]*>/g) ?? [];
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("top:41.5px");
    expect(lines[0]).toContain("pointer-events-none");
    expect(lines[0]).toContain("absolute");
  });

  it("구획 머리가 어느 구획인지 말한다 — 기하를 재는 자리가 이것으로 집는다", () => {
    const heads = [...render(works("pin:가", "나")).matchAll(/data-drop-head="([^"]*)"/g)].map((m) => m[1]);
    expect(heads).toEqual(["pinned", "works"]);
  });
});

// **우클릭 메뉴의 대상**(codex-ds 결정 7 · 11). 메뉴 상태는 위(`SidebarWorkList`의 `WorkContextMenu`)가 쥐고 행은 「내가 대상인가」만
// 받는다 — 표식이 서는 것은 받은 그 행의 이름 버튼 하나이고, 고름과 따로다. 표식이 칠하는 테두리 · 여닫음은 L3가 잰다
// (`work-context-menu.spec.ts`).
describe("우클릭 메뉴의 대상", () => {
  const targets = (markup: string) =>
    [...markup.matchAll(/<div data-work-row="([^"]*)"[^>]*><button[^>]*data-menu-target=""/g)].map((m) => m[1]);

  it("받은 행 **하나의** 이름 버튼에만 표식이 선다", () => {
    expect(targets(render(works("pin:가", "나", "다"), ALL, { menuTarget: "나" }))).toEqual(["나"]);
  });

  it("고른 행과 따로다 — 대상이 아닌 고른 행은 고른 채 표식이 없다", () => {
    const markup = render(works("pin:가", "나", "다"), ALL, { selectedSlug: "가", menuTarget: "다" });
    expect(targets(markup)).toEqual(["다"]);
    expect(markup).toMatch(/<div data-work-row="가" class="[^"]*selected-row/);
  });

  it("메뉴가 닫혔으면 어느 행에도 없다", () => {
    expect(render(works("pin:가", "나"))).not.toContain("data-menu-target");
  });
});

// **이름을 그 자리에서 고치는 행**(codex-ds 스펙 §9). 고치는 상태는 위(`Sidebar`)가 쥐고 행은 「내가 고치는 행인가」만 받는다 — 받은
// 행 하나의 이름 버튼 자리에 레인과 입력칸이 서고, 다른 행은 그대로 이름 버튼이다. 들어가는 길(F2 · 메뉴)과 저장 · 취소 · 포커스는
// L3가 잰다(`inline-rename.spec.ts`).
describe("이름을 고치는 행", () => {
  // 행 상자 하나씩 — 여는 태그에서 다음 행 상자 앞까지다.
  const rowsOf = (markup: string) =>
    markup
      .split(/(?=<div data-work-row=")/)
      .filter((chunk) => chunk.startsWith("<div data-work-row="))
      .map((chunk) => ({ slug: /^<div data-work-row="([^"]*)"/.exec(chunk)![1], html: chunk }));
  const inputOf = (row: string) => /<input[^>]*>/.exec(row)?.[0] ?? null;

  it("받은 행 **하나만** 이름 버튼 자리에 레인과 지금 이름을 든 입력칸이 선다", () => {
    const rows = rowsOf(render(works("pin:가", "나", "다"), ALL, { renaming: "나" }));
    expect(rows.map((row) => row.slug)).toEqual(["가", "나", "다"]);
    const editing = rows.find((row) => row.slug === "나")!.html;
    const input = inputOf(editing);
    expect(input).toContain('aria-label="작업 이름"');
    expect(input).toContain('value="나"');
    // 이름 버튼은 없다 — 버튼 안에는 입력칸을 둘 수 없어 버튼이 아닌 상자로 갈아 끼운다. 레인은 그 상자의 첫 칸으로 남는다.
    expect(editing).toMatch(/^<div data-work-row="나"[^>]*><div[^>]*><span data-lane=""/);
    for (const row of rows.filter((one) => one.slug !== "나")) {
      expect(inputOf(row.html), row.slug).toBeNull();
      expect(row.html, row.slug).toMatch(/^<div data-work-row="[^"]*"[^>]*><button/);
    }
  });

  it("고치는 행이 없으면 어느 행에도 입력칸이 없다", () => {
    expect(render(works("pin:가", "나"))).not.toContain("<input");
  });
});

// **빈 받침**(UI개선 티켓 06 · 스펙 S7). 행이 하나도 없는 구획에 **끄는 동안만** 선다 — 첫 고정도(`고정` 0개),
// 마지막 고정 해제도(모두 고정이라 `Work` 0개) 같은 손짓이게. 「모두 고정」은 L3 fixture로 못 지어
// (`list_works`를 테스트마다 못 덮는다) 여기가 그 갈래를 재는 유일한 자리다.
describe("빈 받침", () => {
  const slotsOf = (markup: string) => [...markup.matchAll(/data-empty-slot="([^"]*)"/g)].map((m) => m[1]);

  it("끄는 중이고 `Work`이 비었으면(모두 고정) `Work`에 받침이 선다", () => {
    const markup = render(works("pin:가", "pin:나"), ALL, { draggedSlug: "가" });
    expect(slotsOf(markup)).toEqual(["works"]);
    // `Work` 머리 **아래**다 — 머리보다 앞에 서면 `고정` 구획에 붙은 것으로 읽힌다.
    expect(markup.indexOf('data-empty-slot="works"')).toBeGreaterThan(markup.indexOf('data-drop-head="works"'));
  });

  it("끄는 중이 아니면 모두 고정이어도 받침이 없다", () => {
    expect(slotsOf(render(works("pin:가", "pin:나")))).toEqual([]);
  });

  it("끄는 중이고 `고정`이 비었으면 `고정` 받침이 `Work` 머리 위에 선다", () => {
    const markup = render(works("가", "나"), ALL, { draggedSlug: "가" });
    expect(slotsOf(markup)).toEqual(["pinned"]);
    expect(markup.indexOf('data-empty-slot="pinned"')).toBeLessThan(markup.indexOf('data-drop-head="works"'));
    // 받침은 머리를 되살리지 않는다 — 결정 82의 「빈 `고정`엔 머리가 없다」는 끄는 동안에도 그대로다.
    expect(headersOf(markup).map((one) => one.label)).toEqual(["Work"]);
  });

  it("끄는 중이 아니면 `고정`이 비어도 받침이 없다", () => {
    expect(slotsOf(render(works("가", "나")))).toEqual([]);
  });

  it("두 구획이 다 차 있으면 끄는 중이어도 받침이 없다", () => {
    expect(slotsOf(render(works("pin:가", "나"), ALL, { draggedSlug: "나" }))).toEqual([]);
  });

  // 틈이 받침에 떨어지면 선 대신 받침이 밝아진다(`gapMark`가 받침 구획엔 선 대신 받침을 준다).
  it("받은 구획의 받침만 밝아진다", () => {
    const slotTag = (markup: string) => markup.match(/<div data-empty-slot="pinned"[^>]*>/)?.[0] ?? "";
    const idle = slotTag(render(works("가"), ALL, { draggedSlug: "가" }));
    const lit = slotTag(render(works("가"), ALL, { draggedSlug: "가", litEmptySlot: "pinned" }));
    expect(idle).not.toBe("");
    expect(idle).not.toContain("data-lit");
    expect(lit).toContain('data-lit=""');
  });
});

// **그림과 상태의 경계**(UI개선 스펙 §4). 끄는 동안의 틈·끌리는 slug는 사이드바 목록이 구독해
// prop으로 내리고, 구획 목록은 받은 것만 그린다 — 이 파일의 seam이 DOM 없는 정적 마크업이라
// 훅을 부르는 순간 위 검사 전부가 서지 못한다. 그래서 구획 목록을 **제 파일로 떼어** 파일 단위로
// 센다(컴포넌트 단위로 자르는 파서는 샌다).
//
// 세는 모양은 「`use` + 대문자 + 여는 괄호 **또는 타입 인자의 `<`**」다. 주석에 적어도 빨개진다 —
// 이웃 검사들과 같은 성질이고, 넓게 잡는 쪽으로 틀리는 것은 일부러다(닫힌 쪽으로 실패한다).
describe("구획 목록 파일은 훅을 안 부른다", () => {
  const hookCalls = (file: string) =>
    readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8").match(/\buse[A-Z]\w*\s*[<(]/g) ?? [];

  // **알려진 양성.** 세는 방법이 새면(정규식이 안 맞으면) 아래 0이 빈 초록이다 — 훅을 부르는 것이
  // 확실한 옆 파일에서 같은 모양이 잡혀야 한다.
  it("사이드바 목록 파일에서는 잡힌다", () => {
    expect(hookCalls("./SidebarWorkList.tsx")).toEqual(expect.arrayContaining(["useWorks(", "useState("]));
  });

  // 타입 인자가 이름과 괄호 사이에 끼는 호출(`useRef<HTMLDivElement>(`)도 잡혀야 한다. 판 05가 구획
  // 목록에서 걷어 낸 것이 바로 그 모양이다 — 「대문자 + 여는 괄호」로만 세면 그것을 되돌려도 초록이다.
  it("타입 인자를 단 호출도 잡힌다", () => {
    expect(hookCalls("./SidebarWorkList.tsx")).toContain("useRef<");
  });

  it("구획 목록 파일에서 0개다", () => {
    expect(hookCalls("./WorkSectionList.tsx")).toEqual([]);
  });
});

// **여기서 세는 것은 그림이 아니라 import다.** 아래 둘은 `ShellBranch.test.ts`가 지고 있던
// 계약인데, 그 파일이 판 04에서 가지와 함께 사라졌다 — 계약이 겨누는 파일(사이드바 목록과, 판 05에서
// 거기서 떨어져 나간 구획 목록)은 그대로라 자리를 옮겨 살린다. 겨누는 파일 옆이 원래 있어야 할 자리다.
describe("사이드바 목록은 터미널을 모른다", () => {
  // **두 파일을 이어 센다.** 구획 목록이 제 파일로 떨어져 나가면서(위 검사) 그림의 절반이 그리로
  // 갔다 — 한 파일만 세면 떨어져 나간 쪽이 터미널을 불러도 초록이다.
  const source = ["./SidebarWorkList.tsx", "./WorkSectionList.tsx"]
    .map((file) => readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8"))
    .join("\n");
  // 리터럴로 센다 — 정규식으로 import 블록을 잘라내는 판정은 다른 곳에서 출발해 남의
  // 코드를 읽고도 초록이었다(판 02·03 리뷰가 잡은 것). 리터럴은 파서가 샐 자리가 없다.
  const countOf = (literal: string) => source.split(literal).length - 1;

  it("terminal feature를 import하지 않는다", () => {
    // 이 계약이 깨지면 `@xterm/*`와 그 CSS가 여기로 따라 들어와 **위 검사 전부가**
    // 서지 못한다 — 이 파일의 seam은 DOM 없는 환경의 정적 마크업이다. 셸 수와 신호가
    // 위(`Sidebar`)에서 값으로 내려오는(`shellCounts`·`signals`) 이유가 그것이다.
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

// v1 티켓 37 · 구현 스펙 §13 · 캔버스 「Thread 목록과 아바타」 보드 — Work 줄 왼쪽에 ▸(펼치면 ⌄), 오른쪽에 그 Work에 이은 Thread 수가 서고,
// 펼친 Work 아래에 그 Thread 줄들이 선다. 누르면 무엇이 일어나는지(최근 Thread로 가기 · 펼침 뒤집기)는 정적 렌더에 없다 — 갈 곳은
// `work-threads.test.ts`, 펼침 기억은 `work-sections.test.ts`가 보고, 실제 누름은 시안 비교 캡처와 L3(40)가 본다.
describe("Work 줄이 그 Work의 Thread를 품는다", () => {
  it("Thread가 있는 줄에만 펼침 단추가 서고, Thread 수는 줄에 없다(S9)", () => {
    const markup = render(works("pin:가", "나", "다"), ALL, { threadCounts: { 가: 2, 다: 1 } });
    expect(expandersOf(markup).map((one) => one.slug)).toEqual(["가", "다"]);
    expect(countsOf(markup)).toEqual([]);
    // 펼침 단추는 레인 위에 겹쳐 서서 폭을 안 갖는다 — 그래서 단추가 없는 줄도 빈 자리 없이 제목이 줄마다 같은 x에서
    // 시작한다(v1 티켓 46 · Codex 사이드바). 겹친 단추는 hover에 서고 그동안 레인이 비킨다.
    const expander = /<button[^>]*data-expander="가"[^>]*>/.exec(chunkOf(markup, "가"))?.[0] ?? "";
    expect(expander).toMatch(/class="absolute [^"]*opacity-0[^"]*group-hover:opacity-100/);
    expect(chunkOf(markup, "나")).not.toContain("data-expander");
  });

  it("펼침 단추는 접혔으면 「펼치기」, 폈으면 「접기」이고 펼친 상태를 말한다", () => {
    const markup = render(works("가", "나"), ALL, { threadCounts: { 가: 2, 나: 1 }, expanded: ["나"] });
    expect(expandersOf(markup)).toEqual([
      { slug: "가", open: false, label: "가의 Thread 펼치기" },
      { slug: "나", open: true, label: "나의 Thread 접기" },
    ]);
  });

  it("펼친 Work 아래에만 그 Work의 Thread 줄이 선다", () => {
    const markup = render(works("pin:가", "나", "다"), ALL, { threadCounts: { 가: 1, 나: 1, 다: 1 }, expanded: ["가", "다"] });
    expect([...markup.matchAll(/data-threads-of="([^"]*)"/g)].map((m) => m[1])).toEqual(["가", "다"]);
    // 줄 바로 뒤, 그 Work의 자리에 선다 — 다음 Work 줄 앞이다.
    expect(chunkOf(markup, "가")).toContain('data-threads-of="가"');
    expect(chunkOf(markup, "다")).toContain('data-threads-of="다"');
    expect(chunkOf(markup, "나")).not.toContain("data-threads-of");
  });

  it("Thread가 없는 Work는 펼친 것으로 적혀 있어도 아래에 아무것도 서지 않는다", () => {
    const markup = render(works("가"), ALL, { expanded: ["가"] });
    expect(markup).not.toContain("data-threads-of");
    expect(expandersOf(markup)).toEqual([]);
  });

  it("펼침 단추는 Tab 정류장이 아니고, 행의 첫 요소는 그대로 이름 버튼이다", () => {
    const markup = render(works("가"), ALL, { threadCounts: { 가: 1 }, selectedSlug: "가" });
    // 행의 첫 버튼이 대상 메뉴 · 이름 고치기가 돌아올 자리다(`rowTarget` · `returnFocus`) — 펼침 단추가 앞에 끼면 그 자리가 갈린다.
    expect(chunkOf(markup, "가")).toMatch(/^<div data-work-row="가"[^>]*><button type="button" class="[^"]*focus-ring" tabindex="0"/);
    for (const expander of markup.match(/<button[^>]*data-expander="[^"]*"[^>]*>/g) ?? []) {
      expect(expander).toContain('tabindex="-1"');
    }
  });

  it("펼침 단추의 꺾쇠는 폴더 자리에 선다 — 가리키면 폴더가 비키고 꺾쇠가 선다(S10)", () => {
    const markup = render(works("가", "나"), ALL, { threadCounts: { 가: 1 } });
    // Thread가 있는 줄의 폴더만 가리킬 때 비킨다 — 펼칠 것이 없는 줄은 폴더 그대로다.
    expect(laneOf(chunkOf(markup, "가"))).toContain("group-hover:opacity-0");
    expect(laneOf(chunkOf(markup, "나"))).not.toContain("group-hover:opacity-0");
  });
});

// **Work 묶음 머리의 +는 「새 Work」다**(02 구현 스펙 §4 · S5 · 캔버스 F2-Work `.sec .ib`) — 새 Thread를 열고 Work 칩을 「새 Work」로 둔다. 누르면
// 어디로 가는지는 위(`SidebarWorkList`)의 일이고(`/?new=work` — `router.test.ts`), 여기서 보는 것은 단추가 어디에 어떻게 서는가다.
describe("Work 묶음 머리의 「새 Work」", () => {
  const plusOf = (markup: string) => markup.match(/<button[^>]*aria-label="새 Work"[^>]*>/g) ?? [];

  it("Work 묶음에 하나만 서고, 고정 묶음에는 없다", () => {
    expect(plusOf(render(works("pin:가", "나")))).toHaveLength(1);
    // Work가 하나도 없어도 선다 — 빈 사이드바에서 시작하는 길이다.
    expect(plusOf(render([]))).toHaveLength(1);
  });

  it("머리 단추 **밖의 형제**다 — 단추 안에 단추를 두지 않는다", () => {
    const markup = render(works("가"));
    for (const head of buttonsOf(markup, 'data-section=""')) expect(head).not.toContain("새 Work");
    // 접기 머리 바로 뒤에 선다 — 머리 줄의 오른쪽 끝이다.
    expect(markup.indexOf('aria-label="새 Work"')).toBeGreaterThan(markup.indexOf('data-drop-head="works"'));
    expect(markup.indexOf('aria-label="새 Work"')).toBeLessThan(markup.indexOf("data-work-row="));
  });

  it("목록의 Tab 정류장이 아니다 — 목록은 Tab 한 번이고, 키보드의 길은 ⌘N 뒤의 Work 칩이다", () => {
    expect(plusOf(render(works("가")))[0]).toContain('tabindex="-1"');
  });
});

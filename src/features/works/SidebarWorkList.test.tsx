/// <reference types="node" />
// 소스 스캔 때문에 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Mode } from "@/mode";
import type { ShellSignal } from "@/components/shell/shell-signal";
import { WorkSectionList } from "./WorkSectionList";
import { emptyMainNotice, splitWorkSections, type SectionsOpen } from "./work-sections";
import type { WorkView } from "./types";

// 사이드바 목록이 **그리는 것**을 본다. 어느 구역에 무엇이 놓이는지는 work-sections.test.ts가
// 이미 보므로 여기서 보는 것은 그 결과가 화면으로 나오는 자리뿐이다 — 구획이 서는 조건
// (결정 82), 빈 `작업` 구획이 하는 말(결정 108), 핀의 생김새(결정 85), 접힘과 개수.
//
// 훅을 부르지 않는 `WorkSectionList`를 렌더한다. 구독하는 자리(useWorks·라우터·localStorage)는
// 위에 남아 있고, 여기로는 상태와 콜백만 들어온다 — `ShellTabs`와 같은 모양이다.

// 이 화면이 행에서 읽는 것은 slug·title·status·pinned·projects다. work-sections.test.ts와 같은
// 접두사 규칙을 쓴다: "pin:"이면 고정, "draft:"면 초안. 제목은 slug를 그대로 쓴다.
//
// **프로젝트는 `@`로 뒤에 붙인다**(`"가@billing,ledger"`) — 셸이 없는 행의 둘째 줄이 그것을
// 싣기 때문이다(이 판 결정 5). 안 붙이면 빈 목록이고, 그 행의 둘째 줄은 빈 채로 선다.
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
// 세계도 기본값이 있다(Atelier): 구획이 서는 조건과 핀의 생김새는 세계를 안 타므로 그 검사들이
// 세계를 말하지 않아도 뜻이 온전하다. 세계가 갈리는 것만 아래 마지막 describe가 둘 다 잰다.
function render(
  list: WorkView[],
  open: SectionsOpen = ALL,
  {
    mode = "atelier",
    selectedSlug = null,
    shellCounts = {},
    // 화면값은 **문자열 Record**로 내려온다(#203) — 값을 고르는 자리는 Sidebar이고 이
    // 목록은 터미널을 모른다(아래 계약). 여기서 보는 것은 그 값이 레인과 이름에 닿는가다.
    signals = {},
    // 셸이 있는 행의 둘째 줄은 슬롯으로 온다 — 그리는 것은 `components/shell`의 `ShellMeta`
    // 나 `SignalLine`이고(#203) 값을 고르는 자리는 Sidebar다(결정 13). 여기서 보는 것은
    // **슬롯이 서는가**뿐이라 안에 무엇이 오는지는 이 파일의 관심이 아니다.
    renderSubrow = (work: WorkView) => <i data-meta={work.slug} />,
    draggedSlug = null,
    gapLineY = null,
  }: {
    mode?: Mode;
    selectedSlug?: string | null;
    shellCounts?: Record<string, number>;
    signals?: Record<string, ShellSignal>;
    renderSubrow?: (work: WorkView) => ReactNode;
    draggedSlug?: string | null;
    gapLineY?: number | null;
  } = {},
): string {
  return renderToStaticMarkup(
    <WorkSectionList
      sections={splitWorkSections(list, open)}
      mode={mode}
      open={open}
      selectedSlug={selectedSlug}
      shellCounts={shellCounts}
      signals={signals}
      onToggleSection={() => {}}
      onOpen={() => {}}
      onHover={() => {}}
      onLeave={() => {}}
      onTogglePin={() => {}}
      renderSubrow={renderSubrow}
      draggedSlug={draggedSlug}
      gapLineY={gapLineY}
      onDragStart={() => {}}
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

// **둘째 줄** 상자들 — 행마다 하나씩이다(이 판 결정 4). 표식이 슬러그를 들고 있어야
// 「어느 행의 줄인가」가 나온다: 마크업 전체에서 글자를 세면 다른 행의 줄과 섞여, 줄이
// 엉뚱한 work에 서도 초록이 된다.
//
// **이 하나만 자리로 이름 붙는다.** 아래 `data-shells`가 적는 규칙은 「표식은 그 자리에
// 있는 것의 이름이다」인데(`data-branch`·`data-section`), 이 줄은 **싣는 것이 갈린다** —
// 셸이 있으면 종류·수, 없으면 프로젝트 이름, 셸이 스스로 말했으면 그 마지막 말과 경과. 있는
// 것으로 이름을 붙이면 그 이름이 세 갈래 중 둘에게 거짓이 되므로, 여기서만 **자리**가
// 이름이다. 판 05가 걷은 옛 `data-subrow`와 글자가 같지만 가리키는 것이 다르다: 그때는
// 행 아래에 딸리던 별개의 줄이었고, 지금은 행 안의 둘째 트랙이다.
//
// **끝을 세어서 자른다.** 이 상자 안에는 `<div>`가 하나 더 들 수 있어(셸 메타 상자) 첫
// `</div>`로 끊으면 셸이 있는 행에서 절반만 잘린다 — 그런 검사는 조용히 샌다.
const subrowsOf = (markup: string) =>
  [...markup.matchAll(/<div[^>]*data-subrow="(.*?)"/g)].map((m) => {
    const from = m.index!;
    let depth = 0;
    for (const tag of markup.slice(from).matchAll(/<(\/?)div\b/g)) {
      depth += tag[1] === "/" ? -1 : 1;
      if (depth === 0) {
        const html = markup.slice(from, from + tag.index! + "</div>".length);
        return { slug: m[1], html, text: html.replace(/<[^>]*>/g, "") };
      }
    }
    throw new Error(`둘째 줄 상자가 안 닫혔다: ${m[1]}`);
  });

// 그 안의 **셸 메타 상자**만 잘라낸다(결정 14). 표식이 자리 설명이 아니라 **그 자리에 있는
// 것**의 이름인 것은 이 저장소의 다른 표식들과 같은 규칙이다(`data-branch`·`data-section`).
// 이 상자 안에는 `<div>`가 없어(글리프와 span뿐) 첫 `</div>`까지가 그 상자 전부다.
const shellBoxesOf = (markup: string) =>
  [...markup.matchAll(/<div[^>]*data-shells="(.*?)"[\s\S]*?<\/div>/g)].map((m) => ({
    slug: m[1],
    html: m[0],
  }));

// 첫 줄 왼쪽의 **레인** — 여는 태그만 본다(안에 드는 것을 함께 보는 것은 아래 `lanesOf`다).
const laneOf = (markup: string) => /<span data-lane=""[^>]*>/.exec(markup)?.[0] ?? "";

// 이름 버튼의 **접근성 이름**. 화면값이 있는 행만 `aria-label`을 든다(#203) — 없으면
// `null`이고, 그때 이름은 안에 든 제목 글자다. 값이 없을 때까지 함께 세지 않으면
// 「모든 행에 말이 붙는다」도 초록이 된다.
const namesOf = (markup: string) =>
  [...markup.matchAll(/<button type="button"(?: aria-label="([^"]*)")? class="col-start-1/g)].map(
    (found) => found[1] ?? null,
  );

// **레인 안에 실제로 선 것**까지 본다(#203). 여는 태그만 보면 점이 아이콘을 밀어냈는지
// 아이콘이 그대로인지가 안 갈린다 — 이 판이 그 자리를 처음 갈라 쓴다.
const lanesOf = (markup: string) =>
  [...markup.matchAll(/<span data-lane=""[^>]*>([\s\S]*?)<\/span><span data-title/g)].map(
    (found) => found[1],
  );

describe("`고정` 구획은 고정된 것이 있을 때만 선다", () => {
  // 결정 82. 아무것도 없는 구획의 헤더는 자리만 먹는다.
  it("고정된 것이 없으면 헤더가 아예 없다", () => {
    expect(headersOf(render(works("가", "draft:나"))).map((one) => one.label)).toEqual(["작업"]);
  });

  it("고정된 것이 있으면 `작업` 위에 선다", () => {
    expect(headersOf(render(works("pin:가", "나", "draft:다"))).map((one) => one.label)).toEqual([
      "고정",
      "작업",
    ]);
  });

  it("개수는 그 구획의 것을 적는다 — 초안도 `작업`의 수에 든다", () => {
    const headers = headersOf(render(works("pin:가", "pin:draft:나", "다", "draft:라")));
    expect(headers.map((one) => `${one.label} ${one.count}`)).toEqual(["고정 2", "작업 2"]);
  });
});

// UI개선 결정 5. 초안은 따로 접힌 구역이 아니라 **다른 항목들 사이에** 서고, 상태 아이콘으로만 갈린다.
describe("초안은 `작업` 구획 안에 선다", () => {
  it("`초안` 머리가 없고 초안 행이 받은 자리 그대로 `작업`에 선다", () => {
    const markup = render(works("draft:가", "나", "draft:다"));
    expect(rowsBySection(markup)).toEqual([{ label: "작업", rows: ["가", "나", "다"] }]);
    // 머리 목록만 보면 초안 머리가 **표식 없이** 되살아나도 초록이다 — 글자로도 센다.
    expect(markup).not.toMatch(/>초안</);
  });

  it("모든 항목이 초안이어도 빈 문구가 아니라 그 초안들이 보인다", () => {
    const markup = render(works("draft:가", "draft:나"));
    expect(rowsBySection(markup)).toEqual([{ label: "작업", rows: ["가", "나"] }]);
    // 빈 구획이 낼 수 있는 두 말을 **판정 함수에서** 받아 댄다 — 글자 조각으로 대면 문구가
    // 바뀌는 날 이 두 줄이 아무것도 안 재는 채 초록으로 남는다.
    const notices = [
      emptyMainNotice(splitWorkSections([], ALL), "atelier"),
      emptyMainNotice(splitWorkSections(works("pin:가"), ALL), "atelier"),
    ];
    expect(new Set(notices).size).toBe(2);
    for (const notice of notices) expect(markup).not.toContain(notice);
  });
});

describe("고정된 work은 한 구획에만 있다", () => {
  // 결정 82. 고정하면 원래 구획에서 **빠진다**. 양쪽에 다 보이면 같은 작업이
  // 두 줄로 서고, 어느 쪽을 눌렀는지가 뜻을 갖게 된다.
  it("고정된 작업은 `작업`에서 빠진다", () => {
    expect(rowsBySection(render(works("pin:가", "나")))).toEqual([
      { label: "고정", rows: ["가"] },
      { label: "작업", rows: ["나"] },
    ]);
  });

  it("고정된 초안은 `작업`에서 빠진다", () => {
    // 결정 83 — 초안도 고정할 수 있고, 고정되면 `고정`에 선다.
    expect(rowsBySection(render(works("pin:draft:가", "draft:나")))).toEqual([
      { label: "고정", rows: ["가"] },
      { label: "작업", rows: ["나"] },
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

  it("고정된 것이 초안뿐이어도 「전부 고정돼 있어요」다", () => {
    expect(render(works("pin:draft:가"))).toContain("전부 고정돼 있어요.");
  });

  it("작업이 있으면 아무 말도 하지 않는다", () => {
    const markup = render(works("가"));
    expect(markup).not.toContain("고정돼 있어요");
    expect(markup).not.toContain("Claude Code에서 시작돼요");
  });
});

// 같은 목록이 세계마다 다른 이름으로 선다(#183, US 17). 문구 자체는 순수 함수라
// `work-sections.test.ts`가 글자까지 붙들고 있고, **여기서 보는 것은 호출부다** — 화면이
// 그 함수들에 지금 세계를 실제로 넘기는가.
//
// **두 세계를 함께 잰다.** 한쪽만 재면 「모드를 안 보고 Atelier로 눕히는」 변형이 그 검사에서
// 초록이다 — 화면으로는 Maison에 갔는데 목록 머리만 `작업`인 모양으로만 보인다.
describe("상주 목록이 세계를 따라 이름을 바꾼다", () => {
  it("머리가 Atelier `작업` · Maison `Rooms`다", () => {
    const labels = (mode: Mode) =>
      headersOf(render(works("가"), ALL, { mode })).map((one) => one.label);
    expect(labels("atelier")).toEqual(["작업"]);
    expect(labels("maison")).toEqual(["Rooms"]);
  });

  // 형제 머리는 **상태의 이름**이라 안 갈린다 — 갈리는 것은 「무엇의 목록인가」 하나뿐이고,
  // 여기가 함께 갈리면 L3가 접근성 이름(`고정 1`)으로 집는 자리가 세계마다 달라진다.
  it("`고정`은 두 세계에서 같다", () => {
    const siblings = (mode: Mode) =>
      headersOf(render(works("pin:가", "나", "draft:다"), ALL, { mode }))
        .map((one) => one.label)
        .filter((label) => label !== "작업" && label !== "Rooms");
    expect(siblings("atelier")).toEqual(["고정"]);
    expect(siblings("maison")).toEqual(["고정"]);
  });

  // 따옴표가 `&quot;`로 이스케이프돼 나오므로 문장 전체를 리터럴로 붙들지 않는다 — 글자까지의
  // 계약은 `work-sections.test.ts`가 지고, 여기서는 **어느 세계의 말이 나왔는가**만 본다.
  it("Room이 없으면 Terminal에서 만들라고 하고, Atelier 문구는 그대로다", () => {
    const maison = render([], ALL, { mode: "maison" });
    expect(maison).toContain("새 Room 만들어줘");
    expect(maison).not.toContain("Claude Code에서 시작돼요");

    const atelier = render([], ALL, { mode: "atelier" });
    expect(atelier).toContain("작업은 Claude Code에서 시작돼요.");
    expect(atelier).not.toContain("새 Room 만들어줘");
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

  // 결정 1·2·5 — **핀은 2열에 메타와 겹쳐 서고, 폭은 hover에만 갖는다.**
  //
  // 사람이 실물 앱에서 고른 모양이다: 「호버하면, 자동으로 아이콘 위치만큼 text의 최대
  // 크기가 조정되지? 이런걸 원하는거임. (안겹치게)」 그러려면 칸이 핀의 폭을 **알아야**
  // 하므로 핀이 격자 안에 있어야 하고, 그러면서도 안 뜬 동안은 폭이 **0**이어야 한다.
  //
  // 한때 `absolute right-1`로 격자 밖에 세운 적이 있다. 그때는 hover 밀림이 0.00px이었지만
  // 칸이 핀을 몰라 **핀이 제목 글자 위에 얹혔다** — 페이드 띠와 글리프가 둘 다 250~262px에
  // 섰다(실측). 그 겹침을 없애는 값이 hover의 24px 뜀이다.
  //
  // **폭을 걷는 것이 `max-w-0`인 것은 두 이유가 겹쳐서다.** `w-0`은 `icon-button`의
  // `width: 24px`과 같은 레이어라 승자가 Tailwind의 정렬 순서에 걸리고, `display:none`은
  // 요소를 지워 **포커스가 안 들어간다** — 이 핀은 포커스에도 떠야 하므로(결정 7, 바로 위
  // 검사) 그 길이 막힌다. 실제 폭과 겹침은 e2e가 실측으로 잰다.
  it("2열에 서고, 폭은 hover·포커스에만 갖는다", () => {
    for (const pin of pinsOf(render(works("pin:가", "나", "draft:다")))) {
      // 칸이 핀의 폭을 세려면 격자 안이어야 한다.
      expect(pin).toContain("col-start-2");
      expect(pin).toContain("row-start-1");
      expect(pin).not.toContain("absolute");
      // 쉴 때 트랙 기여가 0 — 그리고 뜰 때 되돌아온다.
      expect(pin).toContain("max-w-0");
      expect(pin).toContain("group-hover:max-w-6");
      expect(pin).toContain("focus-visible:max-w-6");
      // 0폭 상자 밖으로 글리프가 새지 않게.
      expect(pin).toContain("overflow-hidden");
      // 칸이 핀보다 넓을 때(메타가 선 행) stretch되면 글리프가 가운데로 밀린다.
      expect(pin).toContain("justify-self-end");
    }
    // 핀이 격자로 돌아왔으므로 행에 위치 기준이 필요 없다 — 남으면 죽은 클래스다.
    expect(render(works("가"))).toContain("group grid");
    expect(render(works("가"))).not.toContain("group relative grid");
  });
});

describe("구획 접기", () => {
  // 결정 108의 마지막 줄 — `고정` 구획도 `작업`과 같은 규칙으로 접힌다.
  it("접힌 구획은 헤더가 그렇다고 말하고 높이만 0이 된다", () => {
    const markup = render(works("pin:가", "나", "draft:다"), { ...ALL, pinned: false });
    expect(headersOf(markup).map((one) => `${one.label} ${one.open}`)).toEqual([
      "고정 false",
      "작업 true",
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
// 무엇이 돌고 있는지 안다.** 그래서 이 자리의 주인공은 지금 보고 있지 **않은** work다 —
// 보고 있는 work에서 뭐가 도는지는 본문의 탭 줄이 이미 말한다.
//
// **자리가 세 번째로 옮겼다.** 판 04까지 둘째 줄 → 판 05가 행 오른쪽 끝(결정 0) → 이 판이
// 다시 둘째 줄. 되돌린 것이 아니라 **조건이 바뀌었다**: 판 05가 걷은 것은 「줄이 셸이 있는
// 행에만 서서 행 높이가 곧 신호였다」이고, 이 판은 **모든 행에** 줄을 세워 그 병 없이 둘째
// 줄을 되찾는다(이 판 결정 4). 높이와 자리는 e2e가 실측으로 재고, 여기서 보는 것은
// **마크업이 무엇을 말하는가**다.
describe("행은 두 줄이고, 둘째 줄이 셸이나 프로젝트를 싣는다", () => {
  it("둘째 줄은 **모든 행에** 선다 — 셸이 있든 없든", () => {
    // **이 한 줄이 판 05와의 갈림 전부다.** 셸 유무로 줄이 서고 안 서면 행 높이가 다시
    // 신호가 된다 — 판 05 결정 0이 걷은 그 병이고, 이 판은 줄을 되살리되 조건을 없앤다.
    const markup = render(works("가", "나", "draft:다"), ALL, { shellCounts: { 가: 2 } });
    expect(subrowsOf(markup).map((one) => one.slug)).toEqual(["가", "나", "다"]);
  });

  it("셸이 하나라도 있는 행에만 **종류·수**가 선다", () => {
    // 셸이 0개인 행에는 숫자가 안 선다 — 「없음」은 숫자로 말하지 않는다. 줄 자체는 선다.
    const markup = render(works("가", "나", "draft:다"), ALL, { shellCounts: { 가: 2, 다: 1 } });
    expect(shellBoxesOf(markup).map((one) => one.slug)).toEqual(["가", "다"]);
  });

  it("셸이 없으면 **프로젝트 이름**이 서고, 여럿이면 ` · `로 잇는다", () => {
    // 이 판 결정 5. 둘째 줄이 빈 채로 서지 않게 하는 것이 이 갈래의 전부다 — 모든 행이
    // 두 줄이라 빈 줄은 「여기엔 아무 일도 없다」가 아니라 그냥 구멍으로 읽힌다.
    // 구분자가 호버 카드(`, `)와 갈리는 것은 거기가 문장 안이고 여기가 한 줄 메타라서다.
    const markup = render(works("가@billing", "나@billing,ledger", "다"), ALL, {
      shellCounts: { 가: 1 },
    });
    const 줄 = new Map(subrowsOf(markup).map((one) => [one.slug, one.text]));
    // 셸이 있는 행은 프로젝트가 있어도 종류·수가 이긴다 — 슬롯이 그 자리를 가져간다.
    expect(줄.get("가")).toBe("");
    expect(줄.get("나")).toBe("billing · ledger");
    // 프로젝트가 하나도 없는 work(초안이 흔하다)은 여기가 비고, 그래도 줄은 선다.
    expect(줄.get("다")).toBe("");
  });

  it("도는 것이 없어도 자리는 그대로 선다", () => {
    // **결정 3의 전부가 이 한 줄이다.** 「명령이 도는 동안만 선다」는 기각됐다 — 그 값은 매
    // 순간 바뀌어서(pty.rs가 1초마다 잰다) 자리에 매면 claude가 답을 마칠 때마다 이 칸이
    // 생겼다 사라진다. 자리가 서는 조건은 **안 변하는 값**(셸을 포함하는가)이고 변하는
    // 것은 그 **안에서** 변한다 — 그래서 슬롯이 아무것도 안 그려도 자리는 선다.
    // 조건을 `runningKinds.length > 0` 꼴로 바꾸면 여기가 빨개진다.
    const markup = render(works("가"), ALL, { shellCounts: { 가: 1 }, renderSubrow: () => null });
    expect(shellBoxesOf(markup)).toHaveLength(1);
  });

  it("메타는 그 상자 **안에** 있고, 셸이 없는 행에는 슬롯이 안 선다", () => {
    // 슬롯을 **부르는** 것은 `SidebarWorkList.tsx`가 모든 work에서 한다 — 여기서 재는 것은
    // 그것이 **서는가**다. 엘리먼트 객체만 만들고 버리면 `SubrowFor`의 몸통이 안 돌아
    // 구독도 안 붙는다: 「행마다 자기 것만 구독한다」가 「모든 행이 구독한다」로 뒤집히는
    // 자리는 마운트다(Sidebar.test.tsx).
    const markup = render(works("가", "나"), ALL, { shellCounts: { 가: 1 } });
    const [가] = shellBoxesOf(markup);
    expect(가.html).toContain('data-meta="가"');
    expect(markup).not.toContain('data-meta="나"');
  });

  it("셸 수도 무리도 **이 파일이 적지 않는다** — 든 것은 슬롯 하나뿐이다", () => {
    // 결정 3·13. 「그 밖의 셸」의 수는 셸 수와 도는 것을 둘 다 아는 자리에서만 나오므로
    // 두 값이 `ShellMeta` 하나로 합쳐졌다. 여기가 셸 수를 다시 적으면 그 수가 무리들의
    // 합과 겹쳐 **같은 셸을 두 번 세던 그 화면**으로 되돌아간다. 자리가 둘째 줄로 옮겨
    // 와도 「합 = 셸 수」 불변조건은 `ShellMeta` 하나가 들고, 그것을 재는 검사도 그 파일에
    // 그대로 산다(shell-meta.test.tsx).
    const [가] = shellBoxesOf(render(works("가"), ALL, { shellCounts: { 가: 3 } }));
    expect(가.html).not.toContain(">3<");
    expect(spansOf(가.html)).toEqual([]);
  });

  it("아무것도 눌리지 않는다", () => {
    // 결정 5. 무리 하나가 셸 **여럿**을 접으므로(결정 3) 무리와 셸이 1:1이 아니다 — 누르면
    // 어느 셸로 갈지 정해지지 않는다. 행을 누르는 것은 첫 줄의 이름 버튼이 받는다.
    const markup = render(works("가@billing"), ALL, { shellCounts: { 가: 2 } });
    const [가] = subrowsOf(markup);
    expect(가.html).not.toContain("<button");
    expect(가.html).not.toContain("<a ");
  });

  it("**행 오른쪽 끝에는 핀뿐이다** — 2열에 메타가 없다", () => {
    // 판 05 결정 13의 「두 자리」가 **한 자리가 된다**: 셸 메타 규격은 nav `Terminal`에만
    // 남는다. 메타가 2열에 남아 있으면 핀과 다시 겹쳐 서고, 그러면 「hover에 메타가
    // 물러난다」(판 05 결정 6)가 함께 따라 돌아온다 — 이 판이 뒤집은 바로 그 규칙이다.
    const markup = render(works("가"), ALL, { shellCounts: { 가: 1 } });
    expect(shellBoxesOf(markup)[0].html).not.toContain("col-start-2");
    // 2열 1행에 서는 것은 핀 하나뿐이다.
    expect([...markup.matchAll(/col-start-2/g)]).toHaveLength(pinsOf(markup).length);
  });

  it("**둘째 줄과 레인은 hover에 안 물러난다** — 판 05 결정 6을 뒤집는다", () => {
    // 판 05에서는 메타와 핀이 2열 한 칸에 겹쳐 서서, 핀이 뜨면 메타가 투명해지는 것이
    // 유일한 답이었다(`group-hover:opacity-0` · `peer-focus-visible:opacity-0`). 이 판은
    // 겹침 자체를 없앴으므로 그 두 규칙이 남아 있을 이유가 없다 — 남아 있으면 상태 축이
    // 들어온 지금(#203) **띄우려는 것이 마우스 위치에 따라 지워진다.**
    const markup = render(works("가"), ALL, { shellCounts: { 가: 1 } });
    for (const 줄 of subrowsOf(markup)) {
      expect(줄.html).not.toContain("group-hover:opacity-0");
      expect(줄.html).not.toContain("peer-focus-visible:opacity-0");
    }
    expect(laneOf(markup)).not.toContain("group-hover:opacity-0");
  });

  it("둘째 줄 기본색은 `muted-foreground`다 — 판 05의 `tertiary`가 아니다", () => {
    // 이 판이 시작된 사람의 말이 「이 한 줄이 가독성이 안 좋다」였다. 판 05의 오른쪽 메타는
    // `tertiary`(사이드바 배경에서 대비 ≈ 3.0)였고, 그것을 그대로 내리는 것은 **자리만
    // 옮기고 읽기 어려움은 그대로 두는 것**이다. 실제 대비는 e2e가 계산해 잰다 — 여기서
    // 보는 것은 「무엇을 바닥으로 골랐는가」다.
    const [가] = subrowsOf(render(works("가@billing")));
    expect(가.html).toContain("text-muted-foreground");
    expect(가.html).not.toContain("text-tertiary");
  });

  it("둘째 줄은 **두 칸을 다 쓴다**(`col-span-2`) — 핀이 떠도 폭이 안 변한다", () => {
    // 2열에는 핀이 서지만 그것은 1행뿐이라, 두 칸을 다 쓰는 이 줄은 **핀 아래를 지나간다.**
    // 1열에만 두면(`col-start-1`) 핀이 뜰 때마다 이 줄이 24px 좁아져 프로젝트 이름이
    // hover마다 잘렸다 폈다 한다. 실측은 L3가 하지만(hover 전후의 폭) 그 층이 없는
    // 자리에서도 이 불변조건이 값싸게 고정돼 있어야 한다 — 클래스 하나로 뒤집히는 값이다.
    for (const 줄 of subrowsOf(render(works("가@billing", "나"), ALL, { shellCounts: { 가: 1 } }))) {
      expect(줄.html).toContain("col-span-2");
      expect(줄.html).not.toContain("col-start-1");
    }
  });

  it("이름 버튼은 여전히 **행 상자의 직계 자식**이다", () => {
    // 첫 줄을 상자로 한 겹 싸면 이름 버튼의 부모가 그 상자가 되어, 그것으로 배경 상자를
    // 집는 자리가 조용히 어긋난다 — e2e가 이름 버튼의 `parentElement`로 호버 카드 자리를
    // 잰다. 둘째 줄이 돌아와도 그 계약은 안 깨진다: 줄이 **형제로** 서기 때문이다.
    const markup = render(works("가"), ALL, { shellCounts: { 가: 1 } });
    // 행 상자는 끌기 표식(`data-work-row`)을 클래스 앞에 든다 — 여는 태그를 통째로 넘긴다.
    const row = /<div data-work-row="[^"]*" class="group grid[^"]*">(<button|<div)/.exec(markup);
    expect(row?.[1]).toBe("<button");
  });

  it("**잘리는 쪽은 둘째 줄 글자다** — 상자가 넘침을 물고, 글자가 말줄임된다", () => {
    // 사이드바를 좁히면 레인은 그대로고 글자가 먼저 잘린다(이 판 결정 5). 폭이 실제로
    // 어떻게 나뉘는지는 L3의 드래그 검사가 재고, 여기서 보는 것은 **넘친 글자가 상자 밖으로
    // 새지 않는가**다 — 그것이 없으면 긴 프로젝트 이름이 행 밖으로 흘러 사이드바 경계를
    // 넘는다. fixture의 프로젝트 이름이 짧아 L3에서는 그 순간이 안 나므로 이 자리가 유일한
    // 그물이다.
    const [가] = subrowsOf(render(works("가@billing,ledger,payments")));
    expect(가.html).toContain("overflow-hidden");
    expect(가.html).toContain("min-w-0");
    expect(가.html).toContain("truncate");
  });

  it("**레인은 첫 줄에 서고 폭을 안 내준다**", () => {
    // 이 판 결정 5 — 첫 줄 왼쪽 14px 한 칸. 화면값이 없는 행에는 work 상태 아이콘이 서고,
    // 있으면 점·링이 그 자리를 가져간다(#203, 바로 위 검사).
    //
    // **폭을 실제로 지키는 것은 제목 상자다** — 그쪽이 `min-width: 0`이라 좁아지는 값을
    // 전부 흡수하므로 첫 줄이 넘칠 일이 없고, 그래서 `shrink-0`을 지워도 화면은 안 바뀐다
    // (L3 실측). 그래도 적어 두는 것은 제목 쪽 규칙이 바뀌는 날 이 자리가 **먼저** 찌그러지는
    // 것이 이 판에서 가장 나쁜 회귀라서다: 8px 점은 12px만 줄어도 사라진다. 그 화면이
    // 실제로 났을 때 빨개지는 그물은 L3의 폭 드래그 검사가 든다.
    const lane = laneOf(render(works("가")));
    expect(lane).toContain("size-3.5");
    expect(lane).toContain("shrink-0");
  });

  it("**화면값이 있으면 레인이 점·링으로 갈리고, 없으면 work 상태 아이콘이 되돌아온다**", () => {
    // **이 판이 처음 눈에 보이는 자리다**(#203). 티켓 02가 이름만 붙여 둔 레인에 화면값이
    // 들어선다 — 그리고 **없을 때 되돌아오는 것**을 함께 세는 것이 요점이다: 점만 재면
    // draft·review·done을 가르던 아이콘이 통째로 사라져도 초록이 된다(스토리 19).
    const markup = render(works("가", "나", "다"), ALL, {
      shellCounts: { 가: 1, 나: 1, 다: 1 },
      signals: { 가: "waiting", 나: "working" },
    });
    const [가, 나, 다] = lanesOf(markup);
    expect(가).toContain('data-signal="waiting"');
    expect(나).toContain("signal-ring");
    // 화면값이 없는 행에만 아이콘이 선다. 부르는 행에 둘이 함께 서면 레인이 두 말을 한다.
    expect(가).not.toContain("<svg");
    expect(나).not.toContain("<svg");
    expect(다).toContain("<svg");
    expect(다).not.toContain("data-signal");
  });

  it("**화면값이 있는 행은 이름에 그 말이 붙는다**", () => {
    // 스토리 33 — 색만이 신호여선 안 된다. 점·링은 `aria-hidden`이므로(shell-signal.tsx)
    // 상태를 말하는 자리는 이 이름 하나다. 말은 결정 8의 것이고 탭·띠가 같은 표를 읽는다.
    const markup = render(works("가", "나", "다"), ALL, {
      signals: { 가: "waiting", 나: "done", 다: "working" },
    });
    expect(namesOf(markup)).toEqual([
      "가 — 나를 기다림",
      "나 — 확인할 것",
      "다 — 도는 중",
    ]);
  });

  it("화면값이 없으면 이름은 제목뿐이다", () => {
    // 조용한 행에까지 말이 붙으면 「상태가 붙었다」가 아무 뜻도 없어진다. 그리고 이름으로
    // 행을 집는 e2e 전부가 그 순간 갈린다.
    expect(namesOf(render(works("가")))).toEqual([null]);
  });

  it("**행은 평평하다** — 채움은 고른 행 하나뿐이다", () => {
    // 이 판 결정 5(스토리 29). 카드 채움(목업의 F·G)은 열여덟 행에 전부 무게를 줘 목록이
    // 게시판이 된다. 행이 두 줄이 되면서 그 유혹이 커진 자리라 검사로 못박는다 —
    // 테두리도 배경도 고른 행의 `selected-row` 말고는 없다.
    const markup = render(works("가", "나"), ALL, { selectedSlug: "나" });
    const rows = [...markup.matchAll(/<div data-work-row="[^"]*" class="(group grid[^"]*)">/g)].map(
      (m) => m[1],
    );
    expect(rows).toHaveLength(2);
    expect(rows.filter((one) => one.includes("selected-row"))).toHaveLength(1);
    for (const row of rows) {
      expect(row).not.toContain("border");
      expect(row).not.toContain("bg-background");
      expect(row).not.toContain("shadow");
    }
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
// **그림과 상태의 경계**(UI개선 스펙 §4). 끄는 동안의 틈·끌리는 slug는 사이드바 목록이 구독해
// prop으로 내리고, 구획 목록은 받은 것만 그린다 — 이 파일의 seam이 DOM 없는 정적 마크업이라
// 훅을 부르는 순간 위 검사 전부가 서지 못한다. 그래서 구획 목록을 **제 파일로 떼어** 파일 단위로
// 센다(컴포넌트 단위로 자르는 파서는 샌다).
//
// 세는 모양은 「`use` + 대문자 + 여는 괄호」다. 주석에 적어도 빨개진다 — 이웃 검사들과 같은 성질이다.
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
    const markup = render(works("pin:가", "나"), ALL, { draggedSlug: "나", gapLineY: 41.5 });
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

describe("구획 목록 파일은 훅을 안 부른다", () => {
  const hookCalls = (file: string) =>
    readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8").match(/\buse[A-Z]\w*\(/g) ?? [];

  // **알려진 양성.** 세는 방법이 새면(정규식이 안 맞으면) 아래 0이 빈 초록이다 — 훅을 부르는 것이
  // 확실한 옆 파일에서 같은 모양이 잡혀야 한다.
  it("사이드바 목록 파일에서는 잡힌다", () => {
    expect(hookCalls("./SidebarWorkList.tsx")).toEqual(expect.arrayContaining(["useWorks(", "useState("]));
  });

  it("구획 목록 파일에서 0개다", () => {
    expect(hookCalls("./WorkSectionList.tsx")).toEqual([]);
  });
});

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
    // 서지 못한다 — 이 파일의 seam은 DOM 없는 환경의 정적 마크업이다. 셸 수와 도는 것의
    // 메타가 값이 아니라 슬롯으로 내려오는(`shellCounts`·`renderSubrow`) 이유가 그것이고,
    // `components/ui/agent-mark`가 `features/terminal`이 아니라 거기 사는 이유도 같다.
    //
    // **주석에 적어도 빨개진다.** 세는 것이 import가 아니라 리터럴이라 그렇고, 그 성질은
    // 일부러 그대로 둔다: 「여기서는 그 모듈을 부를 수 없다」를 가장 싸게 지키는 방법이다.
    expect(countOf("@/features/terminal")).toBe(0);
    expect(countOf("./terminal-store")).toBe(0);
  });

  it("읽는 곳도 가는 곳도 한 세계로 눕지 않는다", () => {
    // **이 파일에 세계의 이름이 리터럴로 박히면 안 된다**(#183). 목록이 읽는 루트
    // (`useWorks`·`useSetWorkPinned`)와 행이 가는 주소(`routesOf`·`recallSearch`)가 전부
    // 같은 `mode` 하나에서 나와야 한다 — 데이터만 모드로 갈면 Maison에서 목록은 Room인데
    // 행을 누르면 Atelier로 튀고, 반대면 목록만 낡는다. 둘 다 훅과 라우터를 타서 이 저장소의
    // 정적 마크업 seam에는 안 걸리고, 화면에서도 저쪽 세계에 건너가 봐야만 드러난다.
    expect(countOf('"atelier"')).toBe(0);
    expect(countOf('"maison"')).toBe(0);
    // **주소도 센다.** 위 두 줄은 모드의 낱말만 보므로 `routes.item`을 `/works/$slug`로
    // 되돌리는 변형이 그대로 빠져나간다 — 그 리터럴에는 세계의 이름이 안 들어 있고, L0는
    // 그 필드의 타입이 두 주소의 유니온이라 통과하며, 이 파일의 마크업 seam은 행의 `onOpen`이
    // 목업이라 목적지를 아예 안 본다(실측으로 확인했다: L0·L2 940건이 전부 초록이었다).
    expect(countOf('"/works/')).toBe(0);
    expect(countOf('"/maison/rooms/')).toBe(0);
  });

  it("window에서 키를 듣지 않는다", () => {
    // 결정 78. ⌘1~9가 **한 화면 안에서 본문을 옮기는** 키가 됐다(지금은 탭 줄의 칸을
    // 고른다). 사이드바가 계속 듣고 있으면 한 번 눌러 둘이 일어나고, 본문을 옮기려던
    // 사람이 다른 work으로 끌려간다. 지운 자리라 「없다」를 세는 것 말고 볼 방법이 없다.
    expect(countOf('window.addEventListener("keydown"')).toBe(0);
  });
});

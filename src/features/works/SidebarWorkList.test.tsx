import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkSectionList } from "./SidebarWorkList";
import { splitWorkSections, type SectionsOpen } from "./work-sections";
import type { ViewTab } from "@/routes/-work-search";
import type { WorkView } from "./types";

// 사이드바 목록이 **그리는 것**을 본다. 어느 구역에 무엇이 놓이는지는 work-sections.test.ts가
// 이미 보므로 여기서 보는 것은 그 결과가 화면으로 나오는 자리뿐이다 — 구획이 서는 조건
// (결정 82), 빈 `작업` 구획이 하는 말(결정 108), 핀의 생김새(결정 85), 접힘과 개수.
//
// 훅을 부르지 않는 `WorkSectionList`를 렌더한다. 구독하는 자리(useWorks·라우터·localStorage)는
// 위에 남아 있고, 여기로는 상태와 콜백만 들어온다 — ShellList와 같은 모양이다.

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

// 트리(결정 71·73·107)를 함께 본다. 기본값은 **가지가 하나도 안 서는 상태**다 — 고른 work도
// 셸도 없으면 목록은 판 03까지의 모습 그대로이고, 아래 구획 검사들이 그 위에서 돈다.
function render(
  list: WorkView[],
  open: SectionsOpen = ALL,
  {
    selectedSlug = null,
    tab = "spec" as ViewTab,
    shellCounts = {},
    branchOpen = () => false,
    renderShells = (work: WorkView) => <i data-shells={work.slug} />,
  }: {
    selectedSlug?: string | null;
    tab?: ViewTab;
    shellCounts?: Record<string, number>;
    branchOpen?: (slug: string) => boolean;
    renderShells?: (work: WorkView) => ReactNode;
  } = {},
): string {
  return renderToStaticMarkup(
    <WorkSectionList
      sections={splitWorkSections(list, open)}
      open={open}
      selectedSlug={selectedSlug}
      tab={tab}
      shellCounts={shellCounts}
      branchOpen={branchOpen}
      onToggleSection={() => {}}
      onOpen={() => {}}
      onHover={() => {}}
      onLeave={() => {}}
      onTogglePin={() => {}}
      onToggleBranch={() => {}}
      onOpenSpec={() => {}}
      renderShells={renderShells}
    />,
  );
}

// 구획 헤더와 가지 머리행은 **표식으로** 가른다 — 둘 다 `aria-expanded`를 가진 버튼이라
// 「접히는 버튼」이라는 자리만으로는 갈리지 않는다. 모양(클래스 문자열)으로 가르면 규격을
// 손보는 날 검사가 조용히 새므로, 각자 `data-section` / `data-branch`를 달고 있다.
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
// 가지도 같은 상자를 쓰므로(공용 SectionBody) 가지가 서면 여기 함께 잡힌다.
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

describe("work 아래 트리", () => {
  // 결정 71~73·107. 셸을 고르는 자리가 패널에서 사이드바로 오면서 목록이 **트리**가 됐다.
  // 여기서 보는 것은 「어디에 무엇이 서는가」뿐이다 — 셸 행의 모양은 ShellList.test.tsx가 보고,
  // 그 목록이 실제로 스토어를 읽는 자리(ShellBranch)는 이 파일에 오지 않는다.
  const branchesOf = (markup: string) => buttonsOf(markup, 'data-branch=""');
  const countOf = (button: string) => spansOf(button).slice(-1)[0];

  it("가지는 고른 work **또는** 셸이 있는 work에 선다", () => {
    // 결정 73. 합집합이라야 「다른 work에서 `claude`가 돌고 있다」가 화면에서 사라지지 않는다.
    const markup = render(works("가", "나", "다"), ALL, {
      selectedSlug: "나",
      shellCounts: { 가: 2 },
    });
    expect(branchesOf(markup)).toHaveLength(2);
    // 셸도 없고 고르지도 않은 `다`에는 안 선다 — 가지의 속을 만드는 슬롯도 안 불린다.
    expect(markup).toContain('data-shells="가"');
    expect(markup).toContain('data-shells="나"');
    expect(markup).not.toContain('data-shells="다"');
  });

  it("`spec` 잎은 고른 work에만 선다", () => {
    // 남의 work의 문서는 그 work로 가야 뜻이 있다. work마다 서면 트리가 목록이 아니라 벽이 된다.
    const markup = render(works("가", "나"), ALL, { selectedSlug: "나", shellCounts: { 가: 1 } });
    expect(markup.match(/data-leaf="spec"/g)).toHaveLength(1);
  });

  it("`spec` 잎은 본문이 문서일 때만 켜진다", () => {
    // 헤더의 `spec｜terminal` 토글이 하던 말을 이 잎이 물려받는다(결정 70).
    const leaf = (tab: ViewTab) =>
      buttonsOf(render(works("가"), ALL, { selectedSlug: "가", tab }), 'data-leaf="spec"')[0];
    expect(leaf("spec")).toContain("selected-row");
    expect(leaf("terminal")).not.toContain("selected-row");
  });

  it("가지 머리행이 그 work의 셸 개수를 적는다", () => {
    // 「안 골랐지만 셸이 산다」를 말하는 것이 이 숫자다.
    const markup = render(works("가", "나"), ALL, { shellCounts: { 가: 3, 나: 1 } });
    expect(branchesOf(markup).map(countOf)).toEqual(["3", "1"]);
  });

  it("접힌 가지는 그렇다고 말하고 속이 잠긴다", () => {
    // 결정 107. 접혀도 속은 DOM에 남는다 — 그래야 펴는 쪽도 애니메이션된다. 대신 inert다.
    // 구획 셋이 전부 펼쳐진 상태라 0fr 상자는 이 가지의 것 하나뿐이다.
    const shut = render(works("가"), ALL, { selectedSlug: "가", branchOpen: () => false });
    expect(branchesOf(shut)[0]).toContain('aria-expanded="false"');
    expect(bodiesOf(shut).filter((body) => body.includes("grid-rows-[0fr]"))).toHaveLength(1);

    const open = render(works("가"), ALL, { selectedSlug: "가", branchOpen: () => true });
    expect(branchesOf(open)[0]).toContain('aria-expanded="true"');
    expect(bodiesOf(open).filter((body) => body.includes("grid-rows-[0fr]"))).toHaveLength(0);
  });
});

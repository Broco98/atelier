/// <reference types="node" />
// 소스 스캔 한 건 때문에 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { openBranchOnSelect, RunningMarks, WorkSectionList } from "./SidebarWorkList";
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
    // 블럭이 **자리를 잡았는가**와 **펼쳐졌는가**는 다른 값이다(SidebarWorkList의
    // `blockOpen` 표). 검사 기본값은 「고른 work은 자리를 잡았다」이고, 셸이 도는 work은
    // 그와 무관하게 선다 — 생산 쪽 판정과 같게 둔다.
    nodeStands = (slug: string) => slug === selectedSlug,
    nodeOpen = () => true,
    renderShells = (work: WorkView) => <i data-shells={work.slug} />,
    // 둘째 줄의 로고도 슬롯으로 온다 — 값을 고르는 자리가 Sidebar라서다(RunningMarks 머리말).
    renderRunning = (work: WorkView) => <i data-running={work.slug} />,
  }: {
    selectedSlug?: string | null;
    tab?: ViewTab;
    shellCounts?: Record<string, number>;
    branchOpen?: (slug: string) => boolean;
    nodeStands?: (slug: string) => boolean;
    nodeOpen?: (slug: string) => boolean;
    renderShells?: (work: WorkView) => ReactNode;
    renderRunning?: (work: WorkView) => ReactNode;
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
      nodeStands={nodeStands}
      nodeOpen={nodeOpen}
      onToggleSection={() => {}}
      onOpen={() => {}}
      onHover={() => {}}
      onLeave={() => {}}
      onTogglePin={() => {}}
      onToggleBranch={() => {}}
      onToggleNode={() => {}}
      onOpenSpec={() => {}}
      renderShells={renderShells}
      renderRunning={renderRunning}
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
// 중복 제거는 `runningKindsOf`가 이미 했고(shell-registry.test.ts) 여기서 다시 가르지 않는다.
describe("둘째 줄의 로고", () => {
  const marks = (kinds: string[]) => renderToStaticMarkup(<RunningMarks kinds={kinds} />);
  const labelsOf = (html: string) => [...html.matchAll(/aria-label="(.*?)"/g)].map((m) => m[1]);

  it("종류마다 하나씩, 받은 순서 그대로다", () => {
    expect(labelsOf(marks(["codex", "claude"]))).toEqual(["codex", "claude"]);
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

describe("work 아래 트리", () => {
  // 결정 71~73·107. 셸을 고르는 자리가 패널에서 사이드바로 오면서 목록이 **트리**가 됐다.
  // 여기서 보는 것은 「어디에 무엇이 서는가」뿐이다 — 셸 행의 모양은 ShellList.test.tsx가 보고,
  // 그 목록이 실제로 스토어를 읽는 자리(ShellBranch)는 이 파일에 오지 않는다.
  // **표식에 값이 실린다** — 한 화면에 가지가 여럿이라(work 블럭 · 그 안의 `terminal`)
  // 빈 값이면 어느 것을 집었는지 모른다.
  const branchesOf = (markup: string) => buttonsOf(markup, 'data-branch="terminal"');
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

  it("`spec` 잎은 **블럭이 선 work마다** 선다", () => {
    // 한때 고른 work에만 섰는데, 그러면 옆 work을 잠깐 들여다보는 동안 방금까지 읽던
    // work의 문서가 트리에서 사라졌다 — 셸이 도는 work은 블럭이 서 있는데 그 안에
    // `terminal`만 남았다. 블럭이 서는 조건(고름 **또는** 셸이 있음)과 같아졌다.
    const markup = render(works("가", "나", "다"), ALL, {
      selectedSlug: "나",
      shellCounts: { 가: 1 },
    });
    expect(markup.match(/data-leaf="spec"/g)).toHaveLength(2);
    // 셸도 없고 고르지도 않은 `다`에는 블럭이 없으므로 잎도 없다 — 트리가 벽이 되지 않는다.
    expect(markup).not.toContain('data-shells="다"');
  });

  // 남의 work의 잎까지 강조하면 「지금 보고 있는 것」이 한 화면에 둘이 된다.
  it("켜진 잎은 고른 work의 것 하나다", () => {
    const markup = render(works("가", "나"), ALL, { selectedSlug: "나", shellCounts: { 가: 1 } });
    const leaves = buttonsOf(markup, 'data-leaf="spec"');
    expect(leaves).toHaveLength(2);
    expect(leaves.filter((leaf) => leaf.includes("selected-row"))).toHaveLength(1);
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

describe("가지의 자동 펼침", () => {
  // 결정 107. 「처음 고를 때 한 번」과 「고를 때마다」는 화면으로 구별이 어렵다 — 접었다가
  // 다른 work을 거쳐 돌아와야 갈리고, 그 왕복은 이 seam에 없다. 그래서 판정만 뗐다.
  it("기록에 없는 work은 펼친다", () => {
    expect(openBranchOnSelect({}, "가")).toEqual({ 가: true });
  });

  // **이 한 줄이 결정 107의 전부다.** 값을 보는 판정(`prev[slug] ?? true`)으로 바꾸면
  // 여기가 빨개진다 — 사람이 접어 둔 `false`와 기록이 아예 없는 것이 같아지기 때문이다.
  it("사람이 접어 둔 work은 다시 골라도 접힌 채다", () => {
    expect(openBranchOnSelect({ 가: false }, "가")).toEqual({ 가: false });
  });

  it("사람이 펴 둔 work도 그대로다 — 같은 객체를 돌려준다", () => {
    // 새 객체를 만들면 그 work을 다시 고를 때마다 목록이 통째로 다시 그려진다.
    const open = { 가: true };
    expect(openBranchOnSelect(open, "가")).toBe(open);
  });

  it("남의 기록은 안 건드린다", () => {
    expect(openBranchOnSelect({ 가: false }, "나")).toEqual({ 가: false, 나: true });
  });

  // **판정을 꺼내 놓는 것만으로는 모자라다.** 이펙트가 옛 식을 그대로 갖고 있으면 위
  // 검사들이 전부 초록인 채로 화면 동작만 뒤집힌다 — 실측으로 그랬다(뮤테이션 F3).
  it("이펙트가 그 판정을 딛는다", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./SidebarWorkList.tsx", import.meta.url)),
      "utf8",
    );
    // **접히는 것이 둘이고 규칙은 하나다** — `terminal` 가지와 work 블럭. 판정을 한 자리에
    // 두고 둘이 그것을 딛는다: 「기록에 없으면 펼치고, 사람이 접어 둔 `false`는 유지한다」.
    expect(source).toContain("setBranchOpen((prev) => openBranchOnSelect(prev, selectedSlug));");
    expect(source).toContain("setBlockOpen((prev) => openBranchOnSelect(prev, selectedSlug));");
    // 정의 하나 + 부르는 자리 둘. 늘면 판정을 딛는 자리가 셋이 되어 한쪽만 늙는다.
    expect(source.split("openBranchOnSelect(").length - 1).toBe(3);
  });
});

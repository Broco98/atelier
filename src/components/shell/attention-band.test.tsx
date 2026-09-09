import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AttentionBand, BAND_LABEL, BAND_LIMIT } from "./attention-band";
import type { BandItem } from "./attention-band";

// 정적 마크업 seam — 「확인할 것」 띠의 그림을 여기서 본다(#204). `shell-signal.tsx`와 같은
// 조건으로 산다: props만 받는 순수 컴포넌트라 터미널 스토어도 DOM도 안 물고, 값을 고르는
// 자리는 `Sidebar.tsx`에 따로 있다.
//
// 여기서 재는 것은 **마크업이 무엇을 말하는가**다 — 몇 줄이 서는가, 헤더가 무엇을 세는가,
// 이름에 상태가 붙는가, 좁아질 때 무엇이 먼저 줄어드는가. 누르면 어디로 가는가는 이 층에
// 없다(정적 렌더에는 이벤트가 없다) — L3가 그쪽의 유일한 그물이다.

const 줄 = (over: Partial<BandItem> = {}): BandItem => ({
  id: 1,
  owner: "plain",
  title: "그냥 일",
  shellName: null,
  kind: "waiting",
  running: "claude",
  since: 0,
  ...over,
});

/** 줄 `n`개. 제목을 번호로 갈라 두어 「어느 줄이 잘렸나」가 글자로 보인다. */
const 줄들 = (n: number): BandItem[] =>
  Array.from({ length: n }, (_, index) => 줄({ id: index + 1, title: `일 ${index + 1}` }));

const band = (
  items: BandItem[],
  over: { expanded?: boolean; now?: number } = {},
) =>
  renderToStaticMarkup(
    <AttentionBand
      items={items}
      now={over.now ?? 0}
      expanded={over.expanded ?? false}
      onToggle={() => {}}
      onOpen={() => {}}
    />,
  );

/** 글자만 — 태그를 걷어 낸다. */
const textOf = (markup: string) => markup.replace(/<[^>]*>/g, "");

/**
 * 줄 **버튼**들의 접근성 이름. 이 띠에서 「어느 줄이 섰나」를 정직하게 세는 자리다.
 *
 * `<button`으로 좁히는 것은 마크 때문이다 — 에이전트 글리프도 `aria-label`을 다는
 * `role="img"` 상자라(판 04 결정 15의 그 규칙), 속성만 훑으면 줄 하나가 둘로 세어져
 * 상한을 재는 검사가 통째로 거짓이 된다. 토글(`+N 더`·`접기`)은 이름이 글자에 있어
 * 여기 안 걸린다 — 그것도 이 좁힘이 지키는 것이다.
 */
const 이름들 = (markup: string) =>
  [...markup.matchAll(/<button[^>]*?aria-label="([^"]*)"/g)].map((m) => m[1]);

describe("부르는 것이 없으면 띠 자체가 없다", () => {
  // 결정 5·8 — 「평소 화면이 지금과 같다」가 이 한 줄이다. 헤더만 남기거나 빈 상자를
  // 그리면 목록이 그만큼 밀리고, 그것이 스토리 38이 막으려는 것이다.
  it("줄이 하나도 없으면 아무것도 안 그린다", () => {
    expect(band([])).toBe("");
  });
});

describe("헤더는 접힌 것까지 센다", () => {
  it("보이는 줄이 아니라 전체 수다", () => {
    const markup = band(줄들(5));
    // **먼저 실제로 접혔는가** — 이것이 없으면 아래 「5」가 「안 접힌 채 다섯 줄」로도 초록이다.
    expect(이름들(markup)).toHaveLength(BAND_LIMIT);
    expect(textOf(markup)).toContain(`${BAND_LABEL}5`);
  });

  it("상한 안쪽이면 보이는 수와 같다", () => {
    expect(textOf(band(줄들(2)))).toContain(`${BAND_LABEL}2`);
  });
});

describe("상한 셋과 `+N 더`", () => {
  it("넷이면 셋만 보이고 나머지가 접힌다", () => {
    const markup = band(줄들(4));
    expect(이름들(markup)).toHaveLength(3);
    expect(textOf(markup)).toContain("+1 더");
    expect(textOf(markup)).not.toContain("일 4");
  });

  it("펼치면 전부 서고 같은 자리가 `접기`가 된다", () => {
    const markup = band(줄들(5), { expanded: true });
    expect(이름들(markup)).toHaveLength(5);
    expect(textOf(markup)).toContain("일 5");
    expect(textOf(markup)).toContain("접기");
    expect(textOf(markup)).not.toContain("더");
  });

  // 셋 이하면 접을 것이 없다 — 그때도 토글이 서면 눌러도 아무 일이 없는 줄이 하나 는다.
  it("셋 이하면 토글이 아예 없다", () => {
    for (const n of [1, 2, 3]) {
      const markup = band(줄들(n));
      expect(이름들(markup), `${n}줄`).toHaveLength(n);
      expect(textOf(markup), `${n}줄`).not.toContain("더");
      expect(textOf(markup), `${n}줄`).not.toContain("접기");
    }
  });
});

describe("줄 하나", () => {
  // 결정 8 — 말은 `SIGNAL_LABEL` 하나에서 온다. 행(#203)·탭(#205)이 같은 표를 읽는다.
  it.each([
    ["waiting", "나를 기다림"],
    ["done", "확인할 것"],
  ] as const)("%s 줄의 이름에 상태가 붙는다", (kind, 말) => {
    expect(이름들(band([줄({ kind })]))).toEqual([`그냥 일 — ${말}`]);
  });

  // 한 work에서 부르는 셸이 둘 이상일 때만 붙는다(결정 5). 붙일지는 `bandRows`가 정하므로
  // 여기서는 **받은 것을 그리는가**만 본다.
  it("셸 이름이 있으면 제목 뒤에 서고, 없으면 안 선다", () => {
    expect(textOf(band([줄({ shellName: "vite" })]))).toContain("그냥 일 vite");
    expect(textOf(band([줄({ shellName: null })]))).not.toContain("vite");
  });

  it("마크와 경과가 함께 선다", () => {
    const markup = band([줄({ running: "codex", since: 0 })], { now: 125_000 });
    expect(markup).toContain('aria-label="codex"');
    expect(textOf(markup)).toContain("2m");
  });

  // 마크가 없는 줄도 선다 — 훅도 벨도 누가 말했는지 모를 때가 있다(`bandRows`의 셋째 갈래).
  it("도는 것도 말한 에이전트도 없으면 마크만 빠진다", () => {
    const markup = band([줄({ running: null })]);
    expect(이름들(markup)).toEqual(["그냥 일 — 나를 기다림"]);
    expect(markup).not.toContain('role="img"');
  });
});

// **스토리 34** — 사이드바를 좁혀도 띠가 먼저 죽지 않는다. 실제로 무엇이 줄어드는지는
// 진짜 레이아웃이 있어야 나므로 L3가 재고, 여기서는 그것을 가능하게 하는 **규격**을 본다:
// 글자 상자만 줄어들 수 있고 점·마크·경과는 안 줄어든다.
describe("좁아지면 글자가 먼저 잘린다", () => {
  const 여는태그 = (markup: string, 표식: string) => {
    const found = new RegExp(`<[a-z]+[^>]*${표식}[^>]*>`).exec(markup);
    if (!found) throw new Error(`${표식} 상자를 못 찾았다`);
    return found[0];
  };

  it("말 상자만 줄어들고 경과는 안 줄어든다", () => {
    const markup = band([줄({ since: 0 })], { now: 1000 });
    expect(여는태그(markup, "data-fade")).toContain("min-w-0");
    // 경과는 표식으로 집는다 — `tabular-nums`는 헤더의 수도 들어서 그것으로 집으면
    // 마크업에 먼저 서는 그쪽이 잡힌다(줄이 아니라 헤더를 재게 된다).
    expect(여는태그(markup, "data-elapsed")).toContain("shrink-0");
  });
});

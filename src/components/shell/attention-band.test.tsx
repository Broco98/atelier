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

/**
 * 표식이 붙은 상자의 **여는 태그**. 겉모습 클래스가 아니라 이름으로 집는다.
 *
 * 못 찾으면 던진다 — 표식이 떨어진 날 검사가 「아무것도 못 봤다」로 조용히 초록이 되면
 * 그물이 아니라 장식이다.
 */
const 여는태그 = (markup: string, 표식: string) => {
  const found = new RegExp(`<[a-z]+[^>]*${표식}[^>]*>`).exec(markup);
  if (!found) throw new Error(`${표식} 상자를 못 찾았다`);
  return found[0];
};

/** 표식이 붙은 상자가 **품은 글자**. 「어느 상자가 그 수를 말하나」를 자리가 아니라 이름으로 집는다. */
const 표식글자 = (markup: string, 표식: string) => {
  const found = new RegExp(`<[a-z]+[^>]*${표식}[^>]*>([^<]*)<`).exec(markup);
  if (!found) throw new Error(`${표식} 상자를 못 찾았다`);
  return found[1];
};

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

  // **그 수를 표식으로 집을 수 있다.** 이 층은 글자로 견주면 되지만 L3는 상자를 집어야
  // 하는데, 자리(`.first()`)나 겉모습 클래스(`tabular-nums`)로 고르면 헤더와 줄의 순서가
  // 바뀌거나 그 클래스가 떨어지는 날 **엉뚱한 것을 재거나** 조용히 깨진다.
  it("수는 표식이 붙은 상자에 선다", () => {
    expect(표식글자(band(줄들(5)), "data-band-count")).toBe("5");
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

  // **눈으로 가르라고 넣은 글자가 이름에도 간다.** 셸 이름이 붙는 경우가 곧 「한 work에서
  // 둘이 부른다」이므로(결정 5), 이름에서 그것을 빼면 그 두 줄의 접근성 이름이 **완전히
  // 같아진다** — 점이 `aria-hidden`이라 이름이 유일한 말인데, 그 말이 둘을 못 가른다.
  it("셸 이름이 있으면 이름에도 실린다", () => {
    expect(이름들(band([줄({ shellName: "vite" })])))
      .toEqual(["그냥 일 vite — 나를 기다림"]);
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

// **목업이 정본인 자리**(decisions.md 머리말 — 「눈으로 고른 것은 목업/행-신호-세-안.html이
// 정본이다」). 결정 5는 띠의 위치·구성·치수만 다시 적었으므로 색과 상자는 여전히 목업이
// 정한다. 그 목업에서 띠는 **한 덩어리 상자**(`background: var(--state-1)`)이고 줄은
// 종류로 무게가 갈린다(`.it`은 foreground, `.it.d`만 muted) — 바로 아래 목록 행이 통째로
// muted라, 이 둘이 없으면 띠가 목록과 **같은 무게**로 읽혀 「열여덟 행을 훑지 않고 거기만
// 본다」(스토리 36)가 점 색 하나에만 매달린다.
describe("띠는 목록 위에 뜬 상자다", () => {
  it("상자가 바닥색과 반지름을 든다", () => {
    const 상자 = 여는태그(band(줄들(1)), "data-band");
    expect(상자).toContain("bg-state-1");
    expect(상자).toContain("rounded-[10px]");
  });

  // 결정 3의 우선순위(기다림 › 안 본 완료)가 띠 **안에서도** 글자로 남는다. 점 색으로만
  // 남기면 색을 못 가르는 사람에게 그 순서가 사라진다.
  it("기다림 줄과 완료 줄의 무게가 갈린다", () => {
    const 줄태그 = (kind: "waiting" | "done") =>
      /<button[^>]*aria-label[^>]*>/.exec(band([줄({ kind })]))![0];
    expect(줄태그("waiting")).not.toContain("text-muted-foreground");
    expect(줄태그("done")).toContain("text-muted-foreground");
  });

  // **hover가 바닥에 안 묻는다.** 상자가 이미 state-1이라 줄의 hover도 state-1이면 눌러도
  // 되는 줄이라는 것을 화면이 안 말한다 — 목업이 안 만난 충돌이라 여기서 한 단 올렸다.
  it("hover는 상자 바닥보다 한 단 위다", () => {
    const markup = band(줄들(4));
    expect(markup).not.toContain("hover:bg-state-1");
    expect(markup).toContain("hover:bg-state-2");
  });
});

// **스토리 34** — 사이드바를 좁혀도 띠가 먼저 죽지 않는다. 실제로 무엇이 줄어드는지는
// 진짜 레이아웃이 있어야 나므로 L3가 재고, 여기서는 그것을 가능하게 하는 **규격**을 본다:
// 글자 상자만 줄어들 수 있고 점·마크·경과는 안 줄어든다.
describe("좁아지면 글자가 먼저 잘린다", () => {
  it("말 상자만 줄어들고 경과는 안 줄어든다", () => {
    const markup = band([줄({ since: 0 })], { now: 1000 });
    expect(여는태그(markup, "data-fade")).toContain("min-w-0");
    // 경과는 표식으로 집는다 — `tabular-nums`는 헤더의 수도 들어서 그것으로 집으면
    // 마크업에 먼저 서는 그쪽이 잡힌다(줄이 아니라 헤더를 재게 된다).
    expect(여는태그(markup, "data-elapsed")).toContain("shrink-0");
  });
});

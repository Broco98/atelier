/// <reference types="node" />
// 소스 스캔 한 건 때문에 Node 타입을 끌어온다 — 근거는 shell-meta.test.tsx 이웃들과 같다.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SIGNAL_LABEL, SignalLane, SignalLine, formatElapsed } from "./shell-signal";
import type { ShellSignal } from "./shell-signal";

// 정적 마크업 seam — 상태 축이 **처음 눈에 보이는 자리**의 그림을 여기서 본다(#203).
// `ShellMeta`와 같은 조건으로 산다: props만 받는 순수 컴포넌트라 터미널 스토어도 DOM도
// 안 물고, 값을 고르는 자리는 `Sidebar.tsx`에 따로 있다.
//
// 여기서 재는 것은 **마크업이 무엇을 말하는가**다. 점이 실제로 앰버로 칠해지는지, 스피너가
// 정말 도는지, 대비가 얼마인지는 진짜 CSS가 있어야 나므로 L3가 그쪽의 유일한 그물이다.

const lane = (kind: ShellSignal) => renderToStaticMarkup(<SignalLane kind={kind} />);

/**
 * 레인 조각의 **겉 상자** — 맨 앞 여는 태그 하나. 점은 상자 하나라 그것이 전부이고, 스피너는
 * 안에 svg 둘을 품는다. 속성을 겉에서 재는 것은 lucide가 안쪽 svg에 `aria-hidden`을 **스스로**
 * 달기 때문이다 — 마크업 전체에서 찾으면 겉 상자가 `role="status"`를 드러낸 채여도 초록이 된다.
 */
const 겉태그 = (markup: string) => /^<[^>]*>/.exec(markup)?.[0] ?? "";

const line = (over: Partial<Parameters<typeof SignalLine>[0]> = {}) =>
  renderToStaticMarkup(
    <SignalLine
      kind="waiting"
      message="커밋할까요?"
      running="claude"
      since={0}
      now={0}
      {...over}
    />,
  );

/** 글자만 — 태그를 걷어 낸다. 무엇이 적히는가를 보는 자리들이 함께 쓴다. */
const textOf = (markup: string) => markup.replace(/<[^>]*>/g, "");

/** **말** 하나만 — 경과가 같은 줄에 서므로 통째로 읽으면 둘이 붙어 나온다. */
const 말of = (markup: string) => {
  const found = /<span[^>]*data-fade[^>]*>[\s\S]*?<\/span>/.exec(markup);
  if (!found) throw new Error("말 상자를 못 찾았다");
  return textOf(found[0]);
};

/**
 * 말 상자에 **붙은 클래스만**. 색을 재는 자리가 이것으로 갈리는 것은 말 자체에 `text-`가
 * 들어 있을 수 있기 때문이다(사람이 친 프롬프트가 그대로 오는 자리다) — 마크업 전체에서
 * 글자를 찾으면 그 말이 검사를 통과시키거나 떨어뜨린다.
 */
const 말클래스 = (markup: string) => {
  const 여는태그 = /<span[^>]*data-fade[^>]*>/.exec(markup);
  if (!여는태그) throw new Error("말 상자를 못 찾았다");
  const found = /class="([^"]*)"/.exec(여는태그[0]);
  if (!found) throw new Error("말 상자에 클래스가 없다");
  return found[1];
};

describe("레인 — 화면값 셋이 갈린다", () => {
  // 결정 3·5. 기다림은 앰버 점, 안 본 완료는 초록 점, 도는 중은 스피너다. **셋이 갈리는
  // 것부터** 세지 않으면 아래 규격 검사들이 「어차피 다 같은 것」을 재게 된다.
  it("셋이 서로 다른 것을 그린다", () => {
    const 그림 = (["waiting", "done", "working"] as const).map(lane);
    expect(new Set(그림).size).toBe(3);
  });

  it.each([
    ["waiting", "wait"],
    ["done", "done"],
  ] as const)("%s는 8px 점 + 3px 후광이다", (kind, tone) => {
    const markup = lane(kind);
    // 점 8px(`size-2`)에 3px 후광 — 후광은 `ring`이라 **자리를 안 먹는다**. 그림자로
    // 그리는 것이 목업의 `box-shadow: 0 0 0 3px`와 같은 모양이고, 레인 폭 14px 안에서
    // 점이 커지지 않는 유일한 길이다.
    expect(markup).toContain("size-2");
    expect(markup).toContain("rounded-full");
    expect(markup).toContain(`bg-${tone}`);
    expect(markup).toContain(`ring-${tone}-soft`);
    expect(markup).toContain("ring-[3px]");
  });

  it("도는 중은 앱의 Spinner이고, 표식을 겉 상자가 든다", () => {
    // **레인이 스피너를 따로 그리지 않는다**(`sidebar-active-band` 결정 4·5). 회전(linear
    // 1초)과 동작 줄이기의 원은 부품 파일(`components/ui/spinner.tsx`)의 CSS가 전부 든다 —
    // 스피너는 앱에 한 가지만 있다(스토리 92). 검사와 레인 갈림이 집는 표식(`data-signal`)은
    // 점과 같이 **겉 상자**에 선다. 실제로 도는지·무슨 색인지·멈추면 무엇이 서는지는 L3가 잰다.
    const 겉 = 겉태그(lane("working"));
    expect(겉).toContain('data-slot="spinner"');
    expect(겉).toContain('data-signal="working"');
  });

  it("점도 스피너도 스크린리더에는 없다 — 겉 상자가 가린다", () => {
    // 색만이 신호여선 안 된다(스토리 33) — 상태를 말하는 자리는 행 버튼의 **이름**이고,
    // 이 글리프가 거기 한 번 더 끼면 같은 사실을 두 번 읽는다. Spinner는 겉 상자에
    // `role="status"`와 「Loading」을 들고 오므로(스토리 43) 가리는 것도 **겉 상자**여야 한다.
    for (const kind of ["waiting", "done", "working"] as const) {
      expect(겉태그(lane(kind))).toContain('aria-hidden="true"');
    }
  });
});

describe("접근성 이름에 붙는 상태 말", () => {
  // 결정 8이 정한 말이다. 「확인할 것」은 띠의 이름이자 **안 본 완료**의 이름이고, 행·탭이
  // 같은 말을 쓴다 — 자리마다 다른 말을 쓰면 스크린리더로 듣는 사람이 셋을 따로 외운다.
  it("셋의 말이 정해져 있다", () => {
    expect(SIGNAL_LABEL).toEqual({
      waiting: "나를 기다림",
      done: "확인할 것",
      working: "도는 중",
    });
  });
});

describe("경과", () => {
  it.each([
    [0, "0s"],
    [59_000, "59s"],
    [60_000, "1m"],
    [119_000, "1m"],
    [3_599_000, "59m"],
    [3_600_000, "1h"],
    [7_400_000, "2h"],
  ])("%ims → %s", (ms, text) => {
    expect(formatElapsed(ms)).toBe(text);
  });

  // 훅이 적은 시각이 이 앱의 시계보다 앞설 수 있다(파일을 쓴 쪽과 읽는 쪽이 다른 프로세스다).
  // 음수를 그대로 흘리면 행에 `-3s`가 앉는다.
  it("앞선 시각은 0으로 눕는다", () => {
    expect(formatElapsed(-5_000)).toBe("0s");
  });
});

describe("둘째 줄 — 마크 · 말 · 경과", () => {
  it("기다림은 마크와 말과 경과를 낸다", () => {
    const markup = line({ kind: "waiting", since: 0, now: 125_000 });
    expect(markup).toContain('aria-label="claude"');
    expect(textOf(markup)).toBe("커밋할까요?2m");
  });

  it("안 본 완료도 같은 셋이다", () => {
    const markup = line({ kind: "done", message: "PR 열었다", running: "codex", now: 540_000 });
    expect(markup).toContain('aria-label="codex"');
    expect(textOf(markup)).toBe("PR 열었다9m");
  });

  // **결정 13의 셋째 줄이다.** 레인의 링이 「지금 돈다」를 이미 말하니 둘째 줄은 맥락을
  // 지킨다 — 직전 말을 흐리게 남기고 **경과는 안 붙인다.** 경과가 붙으면 「3분째 기다린다」로
  // 읽히는데 그 셸은 기다리는 게 아니라 일하는 중이다.
  it("도는 중은 직전 말을 흐리게 남기고 경과를 안 붙인다", () => {
    const markup = line({ kind: "working", message: "커밋할까요?", now: 540_000 });
    expect(textOf(markup)).toBe("커밋할까요?");
    // **흐림은 색을 더 내려서가 아니라 이 줄이 바닥에 그대로 있어서 난다.** 둘째 줄의
    // 바닥은 `muted-foreground`이고(구현-스펙.md의 「대비 ≥ 4.5」) 앰버·초록만
    // `font-medium` + 상태색으로 그 위로 올라온다 — 도는 중은 안 올라오므로 옆 행의
    // 부름보다 흐리다. `tertiary`(≈3.0)로 한 단 더 내리는 것은 이 판이 고치려던 그
    // 수치(오른쪽 메타의 3.0)를 **말**에서 다시 만드는 일이라 스펙이 토큰 이름까지 적어
    // 막았다: 「지금의 `tertiary`를 그대로 내리지 않는다 — 경과 시간·종류 수 숫자는
    // `tertiary`여도 된다」. 도는 중의 message는 경과도 숫자도 아니다.
    expect(말클래스(markup), "도는 중의 말이 자기 색을 든다").not.toContain("text-");
    expect(말클래스(markup), "도는 중의 말이 굵어졌다").not.toContain("font-medium");
  });

  // 훅이 말은 못 실어도 「그 이벤트가 났다」는 남긴다(페이로드 없는 `PermissionRequest`가
  // 그렇다). 그때 줄이 통째로 비면 행은 부르는데 둘째 줄만 조용하다.
  it.each([
    ["waiting", "나를 기다림"],
    ["done", "확인할 것"],
    ["working", "도는 중"],
  ] as const)("%s에 말이 없으면 상태 말이 바닥이다", (kind, text) => {
    expect(말of(line({ kind, message: null, running: null, now: 0 }))).toBe(text);
  });

  // 마크 표에 없는 명령이 도는 셸(`npm run dev`에 벨을 물린 경우)에는 마크가 없다 —
  // 물음표를 띄우지 않는 것이 `agentMarkOf`의 규칙이다(판 04 결정 15).
  it("모르는 명령에는 마크가 없다", () => {
    expect(line({ running: "vim" })).not.toContain("aria-label");
  });

  it("말은 `…`이 아니라 페이드로 끝난다", () => {
    // 스펙 구현 결정 4 — 제목과 같은 페이드를 쓰고 마퀴는 없다. 폭이 모자랄 때 잘리는
    // 쪽이 이 글자다.
    const markup = line();
    expect(markup).toContain("data-fade");
    expect(markup).not.toContain("truncate");
  });
});

describe("마크는 상태색을 안 받는다", () => {
  // **판 04 결정 15 · 스토리 32.** 마크는 늘 「누구」이고 색은 늘 「어떤 상태」다. 마크가
  // 상태색으로 물들면 그 둘이 한 글리프에 겹쳐, claude 로고가 앰버로 뜨는 화면을 사람이
  // 「claude가 앰버색이다」로 읽는다.
  //
  // **글리프를 품은 상자에 상태색이 없는가**로 잰다 — 클래스가 있고 없고를 따로 세면
  // 상자가 바뀌는 날 조용히 샌다. 상태색이 붙은 상자를 잘라 내고, 그 안에 svg가 없음을 본다.
  const 색상자 = (markup: string, tone: string) => {
    const found = new RegExp(`<span[^>]*text-${tone}-ink[^>]*>[\\s\\S]*?</span>`).exec(markup);
    if (!found) throw new Error(`상태색 상자를 못 찾았다: text-${tone}-ink`);
    return found[0];
  };

  // **글자색 토큰이 점 색과 갈려 있다**(`-ink`). 점은 결정 3이 못박은 `amber-600`이고
  // 라이트 사이드바에서 대비가 2.98인데, 그 색을 **글자**에 그대로 쓰면 이 판이 고치려던
  // 3.0짜리 오른쪽 메타를 둘째 줄에서 다시 만든다(스토리 24) — 그래서 라이트의 말만 한 단
  // 어둡게 갈랐다. 이 이름을 여기서 리터럴로 세는 것은 두 토큰이 다시 붙는 날 이 검사가
  // 먼저 말하게 하려는 것이다.
  it.each([
    ["waiting", "wait"],
    ["done", "done"],
  ] as const)("%s에서 상태색은 말에만 붙는다", (kind, tone) => {
    const markup = line({ kind });
    // 먼저 마크가 실제로 서 있는가 — 없으면 아래가 「원래 없는 것」으로 초록이 된다.
    expect(markup).toContain("<svg");
    const 상자 = 색상자(markup, tone);
    expect(상자).not.toContain("<svg");
    expect(textOf(상자)).toBe("커밋할까요?");
  });
});

describe("도는 레인은 자바스크립트로 안 돈다", () => {
  // 스토리 30. **레인의 글리프를 고르는 파일은 이 하나뿐이라** 여기만 본다 — 사이드바 쪽은 호버
  // 카드 타이머를 이미 들고 있어(`HOVER_DELAY_MS`) 같은 스캔을 걸면 스피너와 무관한 이유로 빨개진다.
  //
  // 이 스캔이 잡는 것은 「이 조각이 스스로 각도를 돌리기 시작했다」 하나이고, **회전이 실제로
  // CSS의 일인가**는 L3가 계산된 스타일로 잰다(호의 `linear` 1초와 `prefers-reduced-motion`의 원).
  // 소스를 **문자열로만** 본다(shell-attention.test.ts와 같은 방식): 자르거나 파싱하는
  // 정규식은 파서가 새는 순간 조용히 통과한다.
  it("shell-signal.tsx에 시계도 타이머도 없다", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./shell-signal.tsx", import.meta.url)),
      "utf8",
    );
    for (const forbidden of ["setInterval", "requestAnimationFrame", "setTimeout", "Date.now"]) {
      expect(source, `${forbidden} — 스피너를 돌리는 것은 CSS다`).not.toContain(forbidden);
    }
  });
});

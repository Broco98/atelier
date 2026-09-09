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
// 여기서 재는 것은 **마크업이 무엇을 말하는가**다. 점이 실제로 앰버로 칠해지는지, 링이
// 정말 도는지, 대비가 얼마인지는 진짜 CSS가 있어야 나므로 L3가 그쪽의 유일한 그물이다.

const lane = (kind: ShellSignal) => renderToStaticMarkup(<SignalLane kind={kind} />);

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

describe("레인 — 화면값 셋이 갈린다", () => {
  // 결정 3·5. 기다림은 앰버 점, 안 본 완료는 초록 점, 도는 중은 링이다. **셋이 갈리는
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

  it("도는 중은 링이고, 회전을 CSS가 든다", () => {
    // **자바스크립트 타이머가 아니다**(스토리 30). 링 열셋이 같이 돌아도 입력이 안 버벅이는
    // 것은 회전이 합성기의 일이기 때문이고, 「움직임을 끈 사람에게는 정지한 완전한 링」도
    // 같은 규칙 안에서 미디어 쿼리 한 줄로 갈린다 — 자바스크립트로 돌리면 그 갈래를
    // 손으로 다시 물어야 한다. 실제로 도는지와 멈추는지는 L3가 잰다.
    expect(lane("working")).toContain("signal-ring");
    expect(lane("working")).toContain("size-3");
  });

  it("점도 링도 스크린리더에는 없다", () => {
    // 색만이 신호여선 안 된다(스토리 33) — 상태를 말하는 자리는 행 버튼의 **이름**이고,
    // 이 글리프가 거기 한 번 더 끼면 같은 사실을 두 번 읽는다.
    for (const kind of ["waiting", "done", "working"] as const) {
      expect(lane(kind)).toContain('aria-hidden="true"');
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
    expect(markup).toContain("text-tertiary");
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
    const found = new RegExp(`<span[^>]*text-${tone}[^>]*>[\\s\\S]*?</span>`).exec(markup);
    if (!found) throw new Error(`상태색 상자를 못 찾았다: text-${tone}`);
    return found[0];
  };

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

describe("링은 자바스크립트로 안 돈다", () => {
  // 스토리 30. **링을 그리는 파일은 이 하나뿐이라** 여기만 본다 — 사이드바 쪽은 호버 카드
  // 타이머를 이미 들고 있어(`HOVER_DELAY_MS`) 같은 스캔을 걸면 링과 무관한 이유로 빨개진다.
  //
  // 이 스캔이 잡는 것은 「이 조각이 스스로 각도를 돌리기 시작했다」 하나이고, **회전이 실제로
  // CSS의 일인가**는 L3가 계산된 스타일로 잰다(`steps(12`와 `prefers-reduced-motion`).
  // 소스를 **문자열로만** 본다(shell-attention.test.ts와 같은 방식): 자르거나 파싱하는
  // 정규식은 파서가 새는 순간 조용히 통과한다.
  it("shell-signal.tsx에 시계도 타이머도 없다", () => {
    const source = readFileSync(
      fileURLToPath(new URL("./shell-signal.tsx", import.meta.url)),
      "utf8",
    );
    for (const forbidden of ["setInterval", "requestAnimationFrame", "setTimeout", "Date.now"]) {
      expect(source, `${forbidden} — 링을 도는 것은 CSS다`).not.toContain(forbidden);
    }
  });
});

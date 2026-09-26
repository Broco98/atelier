/// <reference types="node" />
// 소스 스캔 한 건 때문에 Node 타입을 끌어온다 — 근거는 shell-meta.test.tsx 이웃들과 같다.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SIGNAL_LABEL, SignalLane, formatElapsed } from "./shell-signal";
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

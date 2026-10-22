import { beforeEach, describe, expect, it, vi } from "vitest";
import { dropBrokenMouseReports, traceDroppedMouseReports } from "./mouse-report";

// 셸로 가는 출구(`onData`)에서 **좌표가 수가 아닌 SGR 마우스 보고**만 걸러 낸다(terminal-nan-grid-guard 결정 10 · 15).
// 순수 모듈 하나라 기본 환경(node)에서 돈다(shell-osc.test.ts가 선례다). 그 함수가 출구에 붙었는지는 L3
// (`e2e/shell-mouse-report.spec.ts`)가 잰다.
//
// **재는 것은 넣은 덩어리와 나온 덩어리 · 잘라 낸 수뿐이다.** 망가진 보고의 꼴은 지어낸 것이 아니다 — 판 01이 실물 앱
// 0.18.0에서 셸 쪽 프로브로 받은 그대로다(끌기 `ESC[<32;NaN;NaNM` 15줄 + 놓음 `ESC[<0;NaN;NaNm` 1줄).

const DRAG = "\x1b[<32;NaN;NaNM";
const RELEASE = "\x1b[<0;NaN;NaNm";
/** xterm의 응답 — 장치 속성(DA)과 커서 위치(CPR). p10k가 프롬프트마다 묻는 것이라 덩어리에 잘 섞인다. */
const DA = "\x1b[?1;2c";
const CPR = "\x1b[12;5R";

describe("좌표가 수가 아닌 보고는 잘린다", () => {
  it.each([
    ["끌기", DRAG],
    ["놓음", RELEASE],
    ["x만 NaN", "\x1b[<32;NaN;5M"],
    ["y만 NaN", "\x1b[<32;12;NaNM"],
    // 픽셀 좌표 모드(`?1016h`)는 칸 대신 픽셀을 싣되 꼴이 같다 — 떼어진 요소에서는 그 픽셀도 NaN이다.
    ["픽셀 좌표 모드의 끌기", "\x1b[<32;1216;NaNM"],
    ["픽셀 좌표 모드의 움직임(누른 버튼 없음)", "\x1b[<35;NaN;NaNM"],
  ])("%s %j", (_, report) => {
    expect(dropBrokenMouseReports(report)).toEqual({ data: "", dropped: 1 });
  });
});

// 셸 안의 앱이 받는 마우스 동작이 하나도 줄면 안 된다. 「수」는 S2의 `-?\d+`다 — `claude`의 SGR 파서가 받는 꼴과 같다.
describe("좌표가 수인 보고는 그대로 지난다", () => {
  it.each([
    ["끌기", "\x1b[<32;12;5M"],
    ["놓음", "\x1b[<0;1;1m"],
    ["휠", "\x1b[<64;3;4M"],
    ["픽셀 좌표 모드", "\x1b[<32;1216;388M"],
    ["음수 좌표", "\x1b[<32;-1;5M"],
  ])("%s %j", (_, report) => {
    expect(dropBrokenMouseReports(report)).toEqual({ data: report, dropped: 0 });
  });
});

describe("섞인 덩어리에서는 망가진 보고만 빠진다", () => {
  it("키 입력 · 응답 · 정상 보고 사이의 망가진 보고만 빠지고 나머지는 순서 그대로다", () => {
    const normal = "\x1b[<32;12;5M";
    expect(dropBrokenMouseReports(`a${DA}${DRAG}${CPR}${normal}${RELEASE}b`)).toEqual({
      data: `a${DA}${CPR}${normal}b`,
      dropped: 2,
    });
  });

  it("여럿 이어지면 모두 빠지고 잘라 낸 수가 그만큼이다", () => {
    expect(dropBrokenMouseReports(DRAG.repeat(15) + RELEASE)).toEqual({ data: "", dropped: 16 });
  });

  it("사이사이 낀 것도 모두 빠진다", () => {
    expect(dropBrokenMouseReports(`x${DRAG}y${DRAG}z`)).toEqual({ data: "xyz", dropped: 2 });
  });

  // **좌표 자리는 `ESC`를 넘어 읽지 않는다**(S2). 넘으면 끝나지 않은 꼴이 뒤에 오는 키(↑ `ESC[A`)와 글자 `m`까지
  // 「좌표 NaN…」 한 보고로 읽혀 셋이 함께 사라진다.
  it("끝나지 않은 꼴 뒤의 바이트를 삼키지 않는다", () => {
    const data = "\x1b[<32;NaN;NaN\x1b[Am";
    expect(dropBrokenMouseReports(data)).toEqual({ data, dropped: 0 });
  });
});

describe("마우스와 무관한 덩어리는 받은 그대로다", () => {
  it.each([
    ["글자", "ls -la\r"],
    ["붙여넣기", "\x1b[200~echo 'M;m NaN'\n\x1b[201~"],
    ["한글", "안녕하세요"],
    ["xterm의 응답", `${DA}${CPR}\x1b[I`],
  ])("%s", (_, data) => {
    expect(dropBrokenMouseReports(data)).toEqual({ data, dropped: 0 });
  });
});

// 조용히 버리면 xterm이 다른 길로 NaN을 또 만들어도 아무도 모른다(terminal-nan-grid-guard 결정 11). 릴리스 빌드의 웹뷰
// 콘솔은 조용해야 한다 — 로그는 dev 가드 한 곳을 지난다(`traceDrag`와 같은 꼴, pointer-drag.test.ts가 선례다).
describe("잘라 낸 것을 dev 빌드에서만 한 줄 남긴다", () => {
  let lines: unknown[][];

  beforeEach(() => {
    lines = [];
    vi.spyOn(console, "debug").mockImplementation((...args: unknown[]) => void lines.push(args));
    return () => {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    };
  });

  it("어느 셸에서 몇 개를 안 보냈는지 말한다", () => {
    vi.stubEnv("DEV", true);
    traceDroppedMouseReports(7, 16);
    expect(lines).toEqual([["atelier: 망가진 마우스 보고 16개를 셸 7에 안 보냈다"]]);
  });

  it("릴리스 빌드에서는 아무것도 안 남긴다", () => {
    vi.stubEnv("DEV", false);
    traceDroppedMouseReports(7, 16);
    expect(lines).toEqual([]);
  });
});

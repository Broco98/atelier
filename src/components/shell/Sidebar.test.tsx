/// <reference types="node" />
// 소스 스캔이라 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { shallow } from "@tanstack/react-store";
import { describe, expect, it } from "vitest";
import {
  NO_SHELLS,
  openShell,
  runningKindsOf,
  setRunning,
  setTitle,
  shellCountsOf,
  type ShellsState,
} from "@/features/terminal/shell-registry";

// **사이드바가 터미널 상태를 읽어 내리는 자리**를 본다(결정 2). `Sidebar.tsx`를 여기로
// 들일 수는 없다 — 그 파일은 `terminal-store`를 import하고 그 사슬에 `@xterm/*`와 그 CSS가
// 달려 있어, 이 저장소의 유일한 컴포넌트 seam인 정적 마크업이 닿지 않는다(ShellTabs와
// SidebarWorkList가 그 seam에 사는 이유가 그것이다). 그래서 둘로 나눠 본다:
//
// 1. **값** — 한 셸이 흔들릴 때 남의 work의 셀렉터가 같은 값을 주는가. 순수 함수라 정직하게 잰다.
// 2. **배선** — 사이드바가 실제로 그 셀렉터를 그 모양으로 구독하는가. 리터럴로 못박는다.
//
// 1만 있으면 「좋은 셀렉터가 있다」까지이고 화면이 그것을 안 쓸 수 있다. 2만 있으면 그 줄이
// 무엇을 막는지 아무도 안 적은 change-detector다.
const read = (file: string) =>
  readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), "utf8");
const countOf = (text: string, literal: string) => text.split(literal).length - 1;

// work 둘에 셸 하나씩. 흔드는 것은 늘 `나`의 셸이고, 보는 것은 `가`의 행이다.
function twoWorks(): { state: ShellsState; 나: number } {
  const 가 = openShell(NO_SHELLS, { owner: "가", project: null, cwd: null });
  const 나 = openShell(가!.state, { owner: "나", project: null, cwd: null });
  return { state: 나!.state, 나: 나!.id };
}

/**
 * **셸 하나가 흔들리는 동안 남의 work 행이 다시 안 그려진다**(판 04의 핵심 위험).
 *
 * `ShellBranch`가 터미널 스토어를 구독하는 유일한 자리였던 것은 값이 자주 흔들려서다 —
 * 셸은 프롬프트마다 OSC 타이틀을 쏘고 claude는 도는 동안 계속 갈아 끼운다. 목록이 통째로
 * 구독하면 **모든 work 행이** 그때마다 다시 그려진다.
 *
 * 재는 것은 「리렌더 횟수」가 아니라 **셀렉터가 주는 값**이다. `useStore`는 얕은 비교로
 * 같으면 다시 그리지 않으므로, 「안 바뀐 work에 대해 같은 값을 준다」가 곧 「그 행은 안
 * 그려진다」이고 — 이 seam에 리렌더가 없는 이상 그것이 정직하게 잴 수 있는 전부다.
 * **여기서 못 보는 것**: 행 컴포넌트가 그 값 말고 다른 것을 더 구독하는 경우. 그쪽은
 * 아래 「배선」이 리터럴로 막는다.
 */
describe("한 셸이 흔들려도 남의 work 행은 그대로다", () => {
  it("타이틀은 아무 행도 흔들지 않는다", () => {
    const { state, 나 } = twoWorks();
    const 뒤 = setTitle(state, 나, "~/atelier — nvim");
    for (const slug of ["가", "나"]) {
      expect(shallow(runningKindsOf(뒤, slug), runningKindsOf(state, slug))).toBe(true);
    }
    expect(shallow(shellCountsOf(뒤), shellCountsOf(state))).toBe(true);
  });

  it("명령이 시작되면 그 work의 행만 달라진다", () => {
    const { state, 나 } = twoWorks();
    const 뒤 = setRunning(state, 나, "claude");
    expect(shallow(runningKindsOf(뒤, "가"), runningKindsOf(state, "가"))).toBe(true);
    expect(shallow(runningKindsOf(뒤, "나"), runningKindsOf(state, "나"))).toBe(false);
  });

  it("명령이 끝나도 **줄이 서는 조건**은 안 바뀐다", () => {
    // 결정 3. 행 높이를 정하는 값(셸 수)이 초마다 흔들리면 claude가 답을 마칠 때마다
    // 목록이 접혔다 펴진다. 도는 것이 붙었다 떨어지는 동안 이 값은 같은 값이어야 한다.
    const { state, 나 } = twoWorks();
    const 도는중 = setRunning(state, 나, "claude");
    const 끝난뒤 = setRunning(도는중, 나, null);
    expect(shallow(shellCountsOf(도는중), shellCountsOf(state))).toBe(true);
    expect(shallow(shellCountsOf(끝난뒤), shellCountsOf(state))).toBe(true);
  });
});

describe("사이드바가 그 값을 그 모양으로 읽는다", () => {
  const sidebar = read("Sidebar.tsx");

  it("종류는 **행마다 자기 것만** 구독한다", () => {
    // 얕은 비교가 빠지면 셀렉터가 회차마다 새 배열을 돌려주므로 위 검사들이 전부 초록인
    // 채로 모든 행이 초마다 다시 그려진다 — 값과 배선을 함께 봐야 하는 이유가 이것이다.
    expect(sidebar).toContain(
      "useStore(terminalStore, (state) => runningKindsOf(state, slug), shallow)",
    );
  });

  it("종류를 Record로 한 번에 읽지 않는다", () => {
    // `shellCountsOf`처럼 Record로 주면 안쪽 배열이 회차마다 새 객체라 얕은 비교가 늘
    // 어긋나고, work 하나에서 명령이 시작될 때마다 **목록 전체**가 다시 그려진다
    // (`runningKindsOf` 머리말이 그 근거를 든다). 부르는 자리가 하나뿐임을 세어 못박는다.
    // 이름이 아니라 **부르는 자리**를 센다 — 이름만 세면 import 줄과 주석의 산문까지
    // 걸려, 자리가 늘었는지 글이 늘었는지가 갈리지 않는다.
    expect(countOf(sidebar, "runningKindsOf(")).toBe(1);
  });

  it("그 값이 work 행의 둘째 줄로 내려간다", () => {
    // 슬롯이 없으면 위 구독은 화면 어디에도 안 닿는다. 개수(`shellCounts`)가 이미 쓰는
    // 그 우회와 같은 길이다 — `SidebarWorkList`는 터미널을 한 번도 참조하지 않는다.
    expect(sidebar).toContain("renderRunning={(work) => <RowRunning slug={work.slug} />}");
  });
});

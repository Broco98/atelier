/// <reference types="node" />
// 소스 스캔이라 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { shallow } from "@tanstack/react-store";
import { describe, expect, it } from "vitest";
import {
  NO_SHELLS,
  openShell,
  runningAgentsOf,
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
 * 이 값은 자주 흔들린다 — 셸은 프롬프트마다 OSC 타이틀을 쏘고 claude는 도는 동안 계속
 * 갈아 끼운다. 목록이 통째로 구독하면 **모든 work 행이** 그때마다 다시 그려진다.
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
      expect(shallow(runningAgentsOf(뒤, slug), runningAgentsOf(state, slug))).toBe(true);
    }
    expect(shallow(shellCountsOf(뒤), shellCountsOf(state))).toBe(true);
  });

  it("명령이 시작되면 그 work의 행만 달라진다", () => {
    const { state, 나 } = twoWorks();
    const 뒤 = setRunning(state, 나, "claude");
    expect(shallow(runningAgentsOf(뒤, "가"), runningAgentsOf(state, "가"))).toBe(true);
    expect(shallow(runningAgentsOf(뒤, "나"), runningAgentsOf(state, "나"))).toBe(false);
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

  it("종류는 **자리마다 자기 것만** 구독한다", () => {
    // 얕은 비교가 빠지면 셀렉터가 회차마다 새 배열을 돌려주므로 위 검사들이 전부 초록인
    // 채로 모든 행이 초마다 다시 그려진다 — 값과 배선을 함께 봐야 하는 이유가 이것이다.
    //
    // 인자가 슬러그가 아니라 `owner`인 것은 nav `Terminal`이 같은 컴포넌트를 쓰기 때문이다
    // (결정 4·13) — `null`이 최상위다.
    expect(sidebar).toContain(
      "useStore(terminalStore, (state) => runningAgentsOf(state, owner), shallow)",
    );
  });

  it("종류를 Record로 한 번에 읽지 않고, 부르는 자리도 하나다", () => {
    // `shellCountsOf`처럼 Record로 주면 안쪽 배열이 회차마다 새 객체라 얕은 비교가 늘
    // 어긋나고, work 하나에서 명령이 시작될 때마다 **목록 전체**가 다시 그려진다
    // (`runningAgentsOf` 머리말이 그 근거를 든다). 부르는 자리가 하나뿐임을 세어 못박는다.
    // 이름이 아니라 **부르는 자리**를 센다 — 이름만 세면 import 줄과 주석의 산문까지
    // 걸려, 자리가 늘었는지 글이 늘었는지가 갈리지 않는다.
    //
    // **nav `Terminal`이 같은 어휘를 쓰게 되면서 이 검사가 하나를 더 막는다**(결정 4·13):
    // 「nav를 위해 구독을 하나 더 판다」. 구독 컴포넌트 하나를 work 행과 nav가 함께 쓰므로
    // 부르는 자리는 여전히 하나여야 한다.
    expect(countOf(sidebar, "runningAgentsOf(")).toBe(1);
  });

  it("그 값이 work 행 오른쪽 끝의 메타로 내려간다", () => {
    // 슬롯이 없으면 위 구독은 화면 어디에도 안 닿는다. 개수(`shellCounts`)가 이미 쓰는
    // 그 우회와 같은 길이다 — `SidebarWorkList`는 터미널을 한 번도 참조하지 않는다.
    //
    // **셸 수는 구독하지 않고 위에서 읽은 Record에서 꺼내 내려준다**(결정 8). 그 값이
    // 함께 가야 하는 것은 「그 밖의 셸」의 수가 셸 수와 도는 것을 **둘 다 아는 자리**에서만
    // 나오기 때문이고(결정 3), 그 자리가 `ShellMeta` 하나다.
    expect(sidebar).toContain(
      "<ShellMetaFor owner={work.slug} shellCount={shellCounts[work.slug] ?? 0} />",
    );
  });
});

// 결정 6. nav `Terminal` 아래의 셸 가지가 걷혔다 — 셸을 고르는 자리가 화면 안 탭 줄로
// 되돌아갔으므로(adr-03) 사이드바에 남은 것은 「누르면 간다」뿐이다.
//
// **접히는 것이 정말 없는가는 여기서만 볼 수 있다.** 이 화면은 정적 마크업 seam이 닿지
// 않고(위 머리말), 접힘은 e2e에서도 「구획 헤더의 것」과 「nav의 것」이 같은 속성으로
// 보인다. 지운 자리라 「없다」를 세는 것 말고 볼 방법이 없다 — 판 04 직전 이 파일에는
// `aria-expanded`가 둘, `SectionBody`가 셋 있었다.
describe("nav 항목은 더 갈라지지 않는다", () => {
  const sidebar = read("Sidebar.tsx");

  it("접히는 자리가 하나도 없다", () => {
    expect(countOf(sidebar, "aria-expanded")).toBe(0);
    expect(countOf(sidebar, "SectionBody")).toBe(0);
  });

  it("셸 가지 컴포넌트가 저장소에 없다", () => {
    // 티켓 #146의 수용 기준 「셸 가지 컴포넌트와 그것을 부르던 자리가 남아 있지 않다
    // (소스 스캔으로 건다)」. **부르던 자리는 타입 검사가 든다** — 없는 모듈을 import하면
    // L0가 깨진다. 여기서 세는 것은 그 앞의 것, 파일 자체가 돌아오지 않았는가다.
    //
    // **이름을 리터럴로 세지 않는다.** 이 저장소의 주석은 내력을 이름으로 남기고(「한때
    // `ShellBranch`가 …」) 실제로 여러 파일에 그렇게 적혀 있다 — 그것까지 세면 계약이
    // 「역사를 지워라」가 된다. 파일의 있고 없음은 그 함정이 없다.
    const at = (name: string) =>
      fileURLToPath(new URL(`../../features/terminal/${name}`, import.meta.url));
    // **경로가 맞는지 먼저 센다.** 오타 하나면 아래 「없다」가 읽은 것 없이 초록이 된다.
    expect(existsSync(at("ShellTabs.tsx"))).toBe(true);
    for (const gone of ["ShellBranch.tsx", "ShellList.tsx"]) {
      expect(existsSync(at(gone)), gone).toBe(false);
    }
  });

  it("`Terminal`이 안고 있는 셸 수는 남되, work 행과 **같은 어휘**로 선다", () => {
    // 걷은 것은 펼침이지 이 숫자가 아니다 — 여기서 빠지면 최상위 셸이 몇 개 도는지가
    // 사이드바 어디에도 안 남는다(work 행은 오른쪽 끝의 메타가 그 몫을 한다 — 결정 2·3).
    //
    // **개수 prop이 메타 슬롯이 됐다**(결정 4·13). 그 계약은 그대로 이어진다: 여전히
    // 최상위 셸 수가 이 행에 서고, 이제 그 셸에서 claude가 돌면 로고까지 뜬다. 무리가
    // 하나뿐이라 숫자가 하나로 서는 것이고 규칙은 일반화될 뿐 안 깨진다.
    expect(sidebar).toContain(
      'item.key === "terminal" ? <ShellMetaFor owner={null} shellCount={topShells} /> : null',
    );
  });
});

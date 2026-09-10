/// <reference types="node" />
// 소스 스캔이라 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
import { existsSync, readFileSync } from "fs";
import { fileURLToPath } from "url";
import { shallow } from "@tanstack/react-store";
import { describe, expect, it } from "vitest";
import {
  NO_SHELLS,
  openShell,
  ownerOf,
  runningAgentsOf,
  setAttention,
  setRunning,
  setTitle,
  shellCountsOf,
  type ShellsState,
} from "@/features/terminal/shell-registry";
import { signalsOf } from "@/features/terminal/shell-attention";

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
// **소유자는 `ownerOf`가 짓는다**(결정 10) — 사이드바가 조회하는 것과 같은 함수여야 여기서
// 재는 값이 그 화면이 읽는 값이다.
const ownerFor = (slug: string) => ownerOf("atelier", slug);
const seat = (slug: string) => ({
  mode: "atelier" as const,
  cwd: null,
  owner: ownerFor(slug),
  project: null,
});
function twoWorks(): { state: ShellsState; 나: number } {
  const 가 = openShell(NO_SHELLS, seat("가"));
  const 나 = openShell(가!.state, seat("나"));
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
      const owner = ownerFor(slug);
      expect(shallow(runningAgentsOf(뒤, owner), runningAgentsOf(state, owner))).toBe(true);
    }
    expect(shallow(shellCountsOf(뒤, "atelier"), shellCountsOf(state, "atelier"))).toBe(true);
  });

  it("명령이 시작되면 그 work의 행만 달라진다", () => {
    const { state, 나 } = twoWorks();
    const 뒤 = setRunning(state, 나, "claude");
    expect(shallow(runningAgentsOf(뒤, ownerFor("가")), runningAgentsOf(state, ownerFor("가")))).toBe(
      true,
    );
    expect(shallow(runningAgentsOf(뒤, ownerFor("나")), runningAgentsOf(state, ownerFor("나")))).toBe(
      false,
    );
  });

  // **화면값도 같은 규칙 위에 선다**(#203). 이 Record가 문자열만 담는 것이 그 이유 전부라,
  // 「안 바뀐 work에는 같은 값」이 여기서도 성립해야 목록이 초마다 다시 안 그려진다.
  it("타이틀은 화면값도 안 흔든다", () => {
    const { state, 나 } = twoWorks();
    const 뒤 = setTitle(state, 나, "~/atelier — nvim");
    expect(shallow(signalsOf(뒤, "atelier"), signalsOf(state, "atelier"))).toBe(true);
  });

  it("셸이 말하면 그 work의 화면값만 달라진다", () => {
    const { state, 나 } = twoWorks();
    const 뒤 = setAttention(state, 나, {
      kind: "waiting",
      message: "커밋할까요?",
      since: 100,
      seen: false,
      source: "hook",
      agent: "claude",
    });
    // **먼저 실제로 달라졌는가** — 이것이 없으면 아래 「같다」가 「아무 일도 안 났다」로도 초록이다.
    expect(signalsOf(뒤, "atelier")).toEqual({ 나: "waiting" });
    expect(shallow(signalsOf(뒤, "atelier"), signalsOf(state, "atelier"))).toBe(false);
    // 남의 work은 키가 없는 채 그대로다.
    expect(signalsOf(뒤, "atelier")["가"]).toBeUndefined();
  });

  it("명령이 끝나도 **메타가 서는 조건**은 안 바뀐다", () => {
    // 결정 3. 메타가 서는 조건(셸 수)이 초마다 흔들리면 claude가 답을 마칠 때마다 그 칸이
    // 생겼다 사라져 제목이 끊기는 자리가 좌우로 뛴다. 도는 것이 붙었다 떨어지는 동안 이
    // 값은 같은 값이어야 한다.
    const { state, 나 } = twoWorks();
    const 도는중 = setRunning(state, 나, "claude");
    const 끝난뒤 = setRunning(도는중, 나, null);
    expect(shallow(shellCountsOf(도는중, "atelier"), shellCountsOf(state, "atelier"))).toBe(true);
    expect(shallow(shellCountsOf(끝난뒤, "atelier"), shellCountsOf(state, "atelier"))).toBe(true);
  });
});

describe("사이드바가 그 값을 그 모양으로 읽는다", () => {
  const sidebar = read("Sidebar.tsx");

  it("종류는 **자리마다 자기 것만** 구독한다", () => {
    // 얕은 비교가 빠지면 셀렉터가 회차마다 새 배열을 돌려주므로 위 검사들이 전부 초록인
    // 채로 모든 행이 초마다 다시 그려진다 — 값과 배선을 함께 봐야 하는 이유가 이것이다.
    //
    // 인자가 슬러그가 아니라 `owner`인 것은 nav `Terminal`이 같은 컴포넌트를 쓰기 때문이다
    // (결정 4·13) — 뒤가 빈 키가 그 세계의 최상위다(결정 10).
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

  it("화면값은 **한 번에** 읽어 목록으로 내린다", () => {
    // 이쪽은 위와 반대다(#203) — 값이 문자열이라 Record 하나로 읽는 것이 맞다. 행마다
    // 구독하면 열여덟 개가 같은 셀렉터를 각자 돌면서 얻는 것이 없다. 값을 고르는 자리가
    // 여기 하나라는 것을 리터럴로 못박는다.
    expect(sidebar).toContain("signals={signals}");
    // **부르는 자리를 센다 — 이름이 아니다.** 이름만 세면 import 줄과 주석의 산문까지
    // 걸려, 자리가 늘었는지 글이 늘었는지가 갈리지 않는다(위 검사와 같은 근거).
    expect(countOf(sidebar, "(state) => signalsOf(state, mode)")).toBe(1);
  });

  it("둘째 줄의 **말·시각·마크**는 행마다 자기 것만 구독한다", () => {
    // 이 셋은 문자열 하나로 안 접히므로 위 Record에 못 태운다 — 객체를 담으면 회차마다
    // 새것이라 얕은 비교가 늘 어긋나고 목록 전체가 다시 그려진다(`runningAgentsOf` 머리말).
    // 그래서 종류·수와 **같은 구독 컴포넌트 안**에서 자기 것만 고른다: 자리가 하나여야
    // 레인과 둘째 줄이 같은 셸을 고른다(스토리 79).
    expect(sidebar).toContain("useStore(terminalStore, (state) => rowSignalOf(state, owner), shallow)");
    expect(countOf(sidebar, "topSignalView(")).toBe(1);
    // **최상위 셸은 그 셀렉터가 아무것도 안 준다.** 스펙의 Out of Scope가 nav `Terminal`을
    // 이 판에서 뺐는데 같은 컴포넌트를 쓰므로 그 가름이 빠지기 쉽다 — 화면에서 그것이 실제로
    // 어떻게 나는지는 L3가 잡고(`nav Terminal`에 셸의 말이 앉는다), 여기서는 가름이 셀렉터
    // 안에 있음을 못박는다: 밖에 두면 nav가 안 쓰는 값을 계속 구독한다.
    expect(sidebar).toContain("slugOfOwner(owner) === null ? null : topSignalView(shellsOf(state, owner))");
  });

  it("띠의 줄들은 **한 겹 더 벗긴 비교**로 구독한다", () => {
    // 여기만 `shallow`가 아니다(#204). `bandRows`는 객체 배열을 새로 지어 돌려주므로
    // 기본 얕은 비교는 **한 번도 안 걸리고**, 그러면 셸이 프롬프트마다 쏘는 타이틀 하나에
    // 띠가 통째로 다시 그려진다 — 위 두 검사가 목록에서 막는 그 함정이 띠에서 되살아난다.
    // 비교가 갈리는 자리라 리터럴로 못박는다: `shallow`로 되돌려도 화면은 멀쩡하고
    // (값은 맞다) 값싼 그림이 초마다 도는 것만 남아 어느 층에서도 안 보인다.
    expect(sidebar).toContain("(state) => bandRows(state, mode)");
    // 자르는 자리가 그리는 쪽 하나여야 헤더의 `N`이 셀 것이 남는다(결정 8) — 값을 내는
    // 쪽에서 미리 자르면 「접힌 것까지 센다」가 어디서도 성립할 수 없다.
    expect(sidebar).not.toContain("BAND_LIMIT");
  });

  it("그 값이 work 행 둘째 줄의 메타로 내려간다", () => {
    // 슬롯이 없으면 위 구독은 화면 어디에도 안 닿는다. 개수(`shellCounts`)가 이미 쓰는
    // 그 우회와 같은 길이다 — `SidebarWorkList`는 터미널을 한 번도 참조하지 않는다.
    //
    // **셸 수는 구독하지 않고 위에서 읽은 Record에서 꺼내 내려준다**(결정 8). 그 값이
    // 함께 가야 하는 것은 「그 밖의 셸」의 수가 셸 수와 도는 것을 **둘 다 아는 자리**에서만
    // 나오기 때문이고(결정 3), 그 자리가 `ShellMeta` 하나다.
    // **한 줄에 안 들어가 두 조각으로 잡는다.** 조각마다 지키는 것이 다르다: 앞은 소유자에
    // 세계가 실렸는가(결정 10 — `work.slug`로 되돌리면 두 루트의 같은 slug가 한 행을 나눠
    // 써서 저쪽 세계의 claude 로고가 여기 뜬다), 뒤는 개수의 키가 slug인가(그 Record를 받는
    // 목록이 터미널을 모른다 — `shellCountsOf` 머리말). 두 어휘가 한 자리에 함께 서는 것이
    // 그 사정 때문이다.
    expect(sidebar).toContain("owner={ownerOf(mode, work.slug)}");
    expect(sidebar).toContain("shellCount={shellCounts[work.slug] ?? 0}");
    // **조각이 같은 컴포넌트에 붙어 있는지는 자리 수로 든다** — 이 파일에 `SubrowFor`가
    // 서는 곳은 둘뿐이다(nav `Terminal` 하나, work 행 하나). 늘어나면 위 두 조각이 어느
    // 것의 것인지가 갈리지 않는다.
    expect(countOf(sidebar, "<SubrowFor")).toBe(2);
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

  // **띠와 알림이 같은 이름을 말한다**(#204·#206 · 결정 13의 다섯째). 둘이 같은 값을 내야
  // 하는 것은 우연이 아니라 계약이다 — 띠 줄을 눌러 가는 곳과 알림이 가리키는 곳이 같은
  // 화면이다. 한때 이 규칙이 스무 줄 사이에 **글자 그대로 두 벌**로 있었고(두 티켓이 서로
  // 못 본 채 각자 넣었다), 그때 「지워진 work을 뭐라 적나」를 한쪽만 고치면 같은 셸이 띠에서와
  // 알림에서 다른 이름을 갖는다 — 알림은 화면 밖에서 오는 것이라 대조할 것이 없어 사람은
  // 어느 쪽이 틀렸는지도 못 본다. 그 어긋남은 마크업으로도 e2e로도 안 잡혀서(양쪽 다 오늘은
  // 같은 글자를 낸다) **규칙이 한 번만 적혀 있다**를 소스로 센다.
  it("슬러그를 이름으로 바꾸는 규칙이 이 파일에 한 벌뿐이다", () => {
    // **셋을 함께 센다.** 하나만 보면 규칙을 반쯤 베낀 사본이 통과한다 — 그리고 0이 아니라
    // 1인지를 보므로, 이름이 바뀌어 스캔이 헛돌면 그것도 여기서 터진다(fail-closed).
    expect(countOf(sidebar, "new Map(works.map(")).toBe(1);
    expect(countOf(sidebar, "titles.get(")).toBe(1);
    // 주석에 이름이 나오는 것까지 세지 않으려고 코드 모양 그대로 집는다. 소유자가
    // `<모드>:<slug>`가 된 뒤로 삼항이 아니라 이른 반환이다 — 최상위 판정이 `slugOfOwner`를
    // 한 번 지나야 해서 한 식으로 안 접힌다.
    expect(countOf(sidebar, "return TERMINAL_LABEL;")).toBe(1);
  });

  it("`Terminal`이 안고 있는 셸 수는 남되, work 행과 **같은 어휘**로 선다", () => {
    // 걷은 것은 펼침이지 이 숫자가 아니다 — 여기서 빠지면 최상위 셸이 몇 개 도는지가
    // 사이드바 어디에도 안 남는다(work 행은 둘째 줄의 메타가 그 몫을 한다 — 결정 2·3).
    //
    // **개수 prop이 메타 슬롯이 됐다**(결정 4·13). 그 계약은 그대로 이어진다: 여전히
    // 최상위 셸 수가 이 행에 서고, 이제 그 셸에서 claude가 돌면 로고까지 뜬다. 무리가
    // 하나뿐이라 숫자가 하나로 서는 것이고 규칙은 일반화될 뿐 안 깨진다.
    // **최상위도 세계마다다**(결정 10) — 화면이 `/terminal`과 `/maison/terminal` 둘이라
    // 한 값으로 두면 두 세계의 셸 수가 한 숫자로 합쳐진다.
    expect(sidebar).toContain("<SubrowFor owner={ownerOf(mode)} shellCount={topShells} />");
  });
});

// 세그먼트가 **어디에 서고 무엇을 바꾸는가**. 그림 자체는 `ModeSwitch.test.tsx`가 정적
// 마크업으로 보고(그래서 세그먼트가 순수 컴포넌트로 갈려 있다), 여기서 보는 것은 이 파일이
// 그것을 **어느 자리에 꽂았는가**다 — 자리는 렌더가 아니라 소스에서만 보인다.
describe("세계를 고르는 두 칸이 사이드바 최상단에 선다", () => {
  const sidebar = read("Sidebar.tsx");

  it("신호등 띠 **아래**, nav **위**다", () => {
    // US 6이 정한 자리 그대로다. 순서가 뒤집히면 「어느 세계인가」가 nav 아래로 내려가
    // 목적지 하나처럼 읽힌다.
    const strip = sidebar.indexOf("data-tauri-drag-region");
    const segment = sidebar.indexOf("<ModeSwitch");
    const nav = sidebar.indexOf("<nav");
    // **셋이 다 있는지부터 센다** — 하나가 없으면 indexOf가 -1이고, 그러면 아래 두 줄이
    // 읽은 것 없이 통과하거나 엉뚱한 이유로 빨개진다.
    expect([strip, segment, nav].every((at) => at > -1)).toBe(true);
    expect(segment).toBeGreaterThan(strip);
    expect(nav).toBeGreaterThan(segment);
  });

  it("nav가 **그 세계의 배열**을 돈다", () => {
    // Atelier 배열을 두 세계에 그리면 Maison에 `Projects`가 서는데(결정 17이 없다고 한
    // 것이다), 활성 판정은 이미 모드 배열을 보고 있어서 그 항목은 영영 안 켜진다.
    expect(sidebar).toContain("navItemsOf(mode).map(");
  });

  it("어느 자리도 한 세계로 눕지 않는다", () => {
    // **이 파일에 세계의 이름이 리터럴로 박히면 안 된다.** 목록·nav·세그먼트가 받는 값이
    // 전부 하나(`mode`)에서 나와야 세 자리가 함께 움직이는데, 그 어긋남은 화면에서
    // 「Maison인데 목록만 Atelier」처럼 **한 자리만** 틀린 모양으로 나타나 눈에 안 띈다.
    expect(sidebar).not.toContain('"atelier"');
    expect(sidebar).not.toContain('"maison"');
  });
});

/// <reference types="node" />
// 소스를 문자열로 읽는다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

// 이 셸의 리렌더 최적화는 **구독을 나눠 둔 모양 자체**다: 활성 nav 항목·설정 활성·지금 세계
// 셋을 각각 원시값으로 구독해서, 주소의 slug가 바뀌어도(작업을 고를 때마다다) 셸이 다시
// 그려지지 않는다. 셋을 한 select로 묶어 객체를 돌려주면 값이 매번 새 객체라 걸러지지 않고,
// 그 순간 이 최적화가 통째로 죽는다 — 화면으로는 「좀 무겁다」로만 보인다.
//
// 렌더로는 못 잰다(이 저장소의 L2에는 DOM이 없고, 정적 마크업에는 리렌더가 없다). 그래서
// **모양이 아니라 수와 금지된 한 조각**을 센다: 파싱이 없어 파서가 샐 자리도 없다.
const source = readFileSync(fileURLToPath(new URL("./AppShell.tsx", import.meta.url)), "utf8");
const countOf = (text: string, literal: string) => text.split(literal).length - 1;

describe("앱 셸의 라우터 구독", () => {
  // **구독 수와 select 수를 함께 센다.** 개수만 세면 `useRouterState()`를 select 없이 부르는
  // 변형이 그대로 통과하는데, 그 순간 셸이 라우터 상태 **전체**를 구독해 작업을 하나 고를
  // 때마다(주소의 slug가 바뀔 때마다) 통째로 리렌더한다 — 이 파일이 지키려는 그 최적화가
  // 정확히 죽고, 화면으로는 「좀 무겁다」로만 보인다. 둘이 함께 3이어야 셋이 전부 좁혀져
  // 있다는 뜻이 된다.
  it("셋으로 갈리고 셋 다 좁혀져 있다", () => {
    expect(countOf(source, "useRouterState(")).toBe(3);
    expect(countOf(source, "select:")).toBe(3);
  });

  // `=> ({ … })`도 `=> { … }`도 걸린다. 뒤쪽은 원시값을 돌려주는 블록일 수도 있지만, 그때는
  // 이 검사를 통과하도록 식으로 고쳐 쓰면 된다 — 틀리는 방향이 **빨간 쪽**이어야 한다.
  //
  // 매개변수 괄호는 **선택이다.** 이 저장소에는 prettier도 eslint도 없어(package.json의
  // scripts가 전부다) 괄호를 강제하는 것이 아무것도 없는데, 괄호를 필수로 요구하면
  // `select: state => ({ … })` 한 모양이 조용히 통과한다 — 괄호 하나 차이로 셋이 한 객체로
  // 합쳐져 최적화가 통째로 죽는 그 변형이다. 메서드 축약형(`select(state) { … }`)은 `select:`가
  // 아예 없어 위 개수 검사에도 안 걸리므로 여기서 따로 막는다.
  it("어느 select도 객체를 새로 짓지 않는다", () => {
    expect(source).not.toMatch(
      /select:\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)(?::[^=]+)?\s*=>\s*\(?\s*\{/,
    );
    expect(source).not.toMatch(/select\s*\(/);
  });
});

// 셸이 드는 모드의 **배선**. 값을 어디서 읽어 어디로 내리는지는 렌더가 필요해 여기서도 소스로 잰다(위
// 머리말과 같은 근거) — `Sidebar`는 `terminal-store` 사슬 때문에 이 저장소의 마크업 seam에서 아예 안 선다.
describe("셸이 모드를 내려 준다", () => {
  it("셸이 그 모드를 사이드바에만 내려 준다", () => {
    // 이 값에서 nav 배열이 나온다. 작업 목록 · 팔레트 · 주인 확인은 모드를 받지 않는다.
    expect(countOf(source, "mode={mode}")).toBe(1);
    expect(source).toContain("<SearchPalette open=");
    expect(source).toContain("<ShellOwners />");
  });

  it("그 모드를 `/settings`가 눕히지 않는 쪽에서 읽는다", () => {
    // `/settings`는 모드를 안 싣는다. 마지막 모드를 얹는 합성이 `shellMode`이고, 그것이 여기 서야
    // 그 화면에서 떠나온 모드를 든다.
    expect(source).toContain("shellMode(state.location.pathname)");
    expect(source).not.toContain("modeOf(");
  });
});

// 설정의 문(UI개선 S18). ⌘,와 바닥 버튼은 클릭·이벤트 핸들러라 렌더가 필요해 여기서도 소스로 잰다.
// 켜진 항목·돌아가기 목적지는 행동으로 재는 층이 따로 있다(`router.test.ts` · L3 `settings-nav`).
describe("설정의 문", () => {
  // 설정 안에서 `/settings`로 가는 문이 무동작인 가드는 **이동 함수 한 자리**에 산다. 문이 그
  // 함수를 안 지나고 곧장 `navigate`하면 그 문만 보던 항목을 떠나 칸을 쌓는다.
  //
  // **입구 상수가 서는 자리를 전부 센다** — 금지 문자열 하나만 보면 `navigate({ to: SETTINGS_ENTRY })`
  // 처럼 다르게 적은 새 문이 그대로 샌다. 이 파일에서 그 상수는 import 한 번과 가드를 지나는 문
  // 둘(⌘,의 네이티브 메뉴 · 사이드바 바닥)에만 서야 한다: 가드 없이 쓰는 자리가 하나라도 생기면
  // 앞의 수가 뒤의 수보다 커져 빨개진다. 리터럴로 적은 문은 셋째 줄이 문다.
  it("설정으로 가는 문이 가드를 지난다", () => {
    const guarded = "navigateGuardingSettings(router, { to: SETTINGS_ENTRY })";
    expect(countOf(source, guarded)).toBe(2);
    expect(countOf(source, "SETTINGS_ENTRY")).toBe(countOf(source, guarded) + 1);
    expect(source).not.toMatch(/["']\/settings["']/);
  });
});

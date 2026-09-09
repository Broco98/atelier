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

describe("앱 셸의 라우터 구독", () => {
  // **구독 수와 select 수를 함께 센다.** 개수만 세면 `useRouterState()`를 select 없이 부르는
  // 변형이 그대로 통과하는데, 그 순간 셸이 라우터 상태 **전체**를 구독해 작업을 하나 고를
  // 때마다(주소의 slug가 바뀔 때마다) 통째로 리렌더한다 — 이 파일이 지키려는 그 최적화가
  // 정확히 죽고, 화면으로는 「좀 무겁다」로만 보인다. 둘이 함께 3이어야 셋이 전부 좁혀져
  // 있다는 뜻이 된다.
  it("셋으로 갈리고 셋 다 좁혀져 있다", () => {
    expect(source.split("useRouterState(").length - 1).toBe(3);
    expect(source.split("select:").length - 1).toBe(3);
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

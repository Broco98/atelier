import type { TerminalSettings } from "./types";

// 검사가 짓는 터미널 구획 하나. **`TerminalSettings`를 리터럴로 짓는 자리를 여기 하나로 모았다** — 칸이 하나 늘 때마다(프로세스
// 결정 5의 `processExceptions`) L2 · L3의 여섯 자리를 손으로 고쳤고, 타입이 안 걸린 자리는 고쳐야 하는 줄도 몰랐다. 각 검사는
// 제가 재는 칸만 덮어쓴다.
//
// 기본은 **아무것도 안 고른 구획**이다 — 설정 파일이 없을 때 백엔드가 주는 모양 그대로다(`settings.rs`의 `read`: 고르지 않은
// 값은 `null`, 테마만 어둡게로 정해져 온다). L3의 고정 답(`e2e/fixtures.ts`의 `read_settings`)도 이것이다.
//
// 테스트 파일이 아니다 — `*.test.ts`면 vitest가 이것을 테스트로 돌린다. 앱 코드는 이것을 부르지 않는다(`work-fixture.ts`와 같다).
export function terminalSettings(overrides: Partial<TerminalSettings> = {}): TerminalSettings {
  return { fontFamily: null, fontSize: null, theme: "dark", processExceptions: null, ...overrides };
}

import { describe, expectTypeOf, it } from "vitest";
import type { CleanupReason, CloseReason } from "./types";

// 닫기 IPC(`pty_kill`)의 까닭과 정리 기록의 까닭은 **한 낱말 집합**이다 — 닫기가 끝낸 것이 그 까닭 그대로 정리 기록에 적힌다
// (티켓 11, Rust `impl From<CloseReason> for Reason`). 둘을 따로 적으면 한쪽 글자가 바뀌어도 갈린 줄 모른다. 이 검사는 **타입
// 층에서 운다**(L0 `tsc --noEmit`이 테스트 파일도 읽는다) — 실행 때는 아무것도 안 한다.
describe("닫기의 까닭", () => {
  it("정리 기록의 까닭 가운데 프런트가 고르는 셋이다", () => {
    // **두 까닭의 관계를 지키는 것은 이 줄이다.** `Extract`는 정리 기록에 없는 글자를 조용히 버린다 — 정리 기록 쪽 글자 하나가
    // 바뀌면 닫기의 까닭이 소리 없이 줄어든다. 셋 그대로인지 본다. 셋은 Rust `cleanup_log::CloseReason`의 글자다.
    expectTypeOf<CloseReason>().toEqualTypeOf<"shellClose" | "archive" | "mcpArchive">();
    // 정리 기록의 까닭 가운데다. **지금 정의(`Extract<CleanupReason, …>`)에서는 늘 참이다** — `Extract`의 답은 늘 첫 인자에 든다.
    // 이 줄이 우는 것은 닫기의 까닭을 `Extract` 없이 글자로 따로 적은 날 그 글자가 정리 기록에 없을 때뿐이라, 위 줄을 대신하지 않는다.
    expectTypeOf<CloseReason>().toExtend<CleanupReason>();
  });
});

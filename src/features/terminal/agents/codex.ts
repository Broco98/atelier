import type { ShellHookState } from "../types";
import { firstLine, permissionLine, stringAt } from "./payload";
import type { AgentAdapter, AgentSignal } from "./types";

/**
 * codex가 훅으로 말한 것을 정규 이벤트로 접는다. claude와 이름 셋이 같고(`UserPromptSubmit`
 * ·`PermissionRequest`·`Stop`) 넷째가 다르다 — codex에는 `Elicitation`이 없고 `Interrupt`가
 * 있다. 그 차이가 파일을 가르는 이유다.
 *
 * **`notify`는 여기 없다.** 그 자리는 사용자의 것이라 앱이 안 건드린다(결정 11).
 */
export const codex: AgentAdapter = {
  fold(state: ShellHookState): AgentSignal | null {
    const { event, payload } = state;
    switch (event) {
      case "UserPromptSubmit":
        return { event: "start", message: null };
      case "PermissionRequest":
        return { event: "waiting", message: permissionLine(payload) };
      case "Stop":
        return { event: "stop", message: firstLine(stringAt(payload, "last_assistant_message")) };
      case "Interrupt":
        // 사람이 끊었다. 멈춘 것은 맞으니 「나를 기다림」이 되지만, 방금까지 하던 말이
        // 그대로 맥락이라 message는 직전 것을 둔다(전이 표).
        return { event: "stop", message: null };
      case "SessionEnd":
        // **이유를 안 묻는다** — 스펙 전이 표의 `clear` 줄은 claude 전용이고, 연구도 codex
        // `SessionEnd`의 고유 페이로드 필드를 `—`(없음)로 적는다(B-1 표). 물을 것이 없는
        // 자리에서 물으면, 언젠가 codex가 다른 뜻으로 `reason`을 실었을 때 그것이 조용히
        // 「세션이 이어진다」로 읽힌다. claude 쪽 규칙은 `payload.ts`의 `sessionEnd`다.
        return { event: "end", message: null };
      default:
        return null;
    }
  },
};

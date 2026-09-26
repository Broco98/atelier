import type { ShellHookState } from "../types";
import { firstLine, permissionDialog, permissionLine, stringAt } from "./payload";
import type { AgentAdapter, AgentSignal } from "./types";

/**
 * codex가 훅으로 말한 것을 정규 이벤트로 접는다. 스펙 전이 표(프로세스 결정 13)의 codex 칸 그대로다. claude와
 * 이름이 여럿 겹치고(`UserPromptSubmit`·`PermissionRequest`·`Stop`·도구 둘·서브에이전트 둘) 몇이 다르다 —
 * codex에는 `Elicitation` · `StopFailure` · `PostToolUseFailure`가 없고 `Interrupt`가 있다. 그 차이가 파일을
 * 가르는 이유다. 이름 검사의 규칙(`case` 이름 = `hooks.rs`의 `CODEX_EVENTS`)은 `claude.ts` 머리말과 같다.
 *
 * **`notify`는 여기 없다.** 그 자리는 사용자의 것이라 앱이 안 건드린다(결정 11).
 */
export const codex: AgentAdapter = {
  fold(state: ShellHookState): AgentSignal | null {
    const { event, payload } = state;
    switch (event) {
      case "UserPromptSubmit":
        return { event: "start", message: null };
      case "PreToolUse":
      case "PostToolUse":
        // 도구가 돈다. **`AskUserQuestion` 줄은 claude 것이다**(전이 표의 `waiting` 칸) — codex 도구는 이름이
        // 같아도 도구로 접는다. 말을 안 싣는 이유는 claude 쪽과 같다.
        return { event: "tool", message: null };
      case "PermissionRequest":
        return { event: "waiting", message: permissionLine(payload), dialog: permissionDialog(payload) };
      case "Stop":
        return { event: "stop", message: firstLine(stringAt(payload, "last_assistant_message")) };
      case "SubagentStart":
      case "SubagentStop":
        // 수는 처리기가 `agent_id` 집합으로 접는다 — codex 스키마도 같은 칸 이름이다(티켓 19가 바이너리로 읽음).
        return { event: "subagent", message: null };
      case "Interrupt":
        // **사람이 끊었다 — 중단이다.** 옛 표는 「멈추되 직전 말을 둔다」(`stop` → 나를 기다림)였다. 프로세스 결정
        // 13이 이렇게 고쳤다: 끊은 사람은 이미 그 자리에 있으므로 부를 것이 없고, 상태가 **없어진다**.
        return { event: "interrupt", message: null };
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

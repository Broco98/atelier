import type { ShellHookState } from "../types";
import {
  firstLine,
  flagAt,
  permissionDialog,
  permissionLine,
  questionLine,
  sessionEnd,
  stopFailureLine,
  stringAt,
} from "./payload";
import type { AgentAdapter, AgentSignal } from "./types";

/**
 * 그 도구가 **사람에게 묻는 도구**(`AskUserQuestion`)인가. PreToolUse와 PermissionRequest 둘이 읽는다 — 그 도구는 권한 흐름을
 * 지나(`checkPermissions`가 `ask`를 돌려준다 — 2.1.283 소스) PermissionRequest 훅도 그 도구 이름으로 돈다.
 */
function asksQuestion(payload: unknown): boolean {
  return stringAt(payload, "tool_name") === "AskUserQuestion";
}

/**
 * 그 도구가 선 기다림 — 물음 창이고 말은 첫 물음이다(`questionLine`). PreToolUse와 PermissionRequest가 **같은 신호**를 낸다:
 * 말이 갈리면 PreToolUse가 세운 물음이 몇 ms 뒤의 PermissionRequest에 다른 줄로 갈아 끼워진다(티켓 25 리뷰 반영).
 */
function questionSignal(payload: unknown): AgentSignal {
  return { event: "waiting", message: questionLine(payload), dialog: "question" };
}

/**
 * claude가 훅으로 말한 것을 정규 이벤트로 접는다. 스펙 전이 표(프로세스 결정 13)의 claude 칸 그대로다.
 *
 * **이름은 앱이 넘긴 것이다.** 훅 처리기는 argv로 받은 이벤트 이름을 그대로 적으므로
 * (`atelier-hook.py` · `atelier-hook.zsh`), 여기 `case`로 적힌 문자열은 설치가 거는 이름과 짝이다 —
 * `hooks.rs`의 `CLAUDE_EVENTS`와 **양방향으로 정확히** 같아야 하고 검사가 그것을 글자로 잰다
 * (`shell-attention.test.ts`의 「훅이 나르는 어휘」). 그 검사는 이 파일 **전체**의 `case` 글자를 훅 이름으로 읽으므로
 * 훅이 아닌 이름(도구 이름 `AskUserQuestion`)은 `case`로 쓰지 않는다. 페이로드에도 이름이 있지만 그 키가
 * 에이전트마다 달라서 읽지 않는다.
 *
 * **모르는 이벤트는 `null`이다.** 사용자가 자기 훅을 더 걸어 두었을 때 그것이 우리 스크립트를
 * 타고 올 길은 없지만, 앱이 거는 이름이 늘어나는 동안 낡은 설치가 남아 있을 수는 있다.
 */
export const claude: AgentAdapter = {
  fold(state: ShellHookState): AgentSignal | null {
    const { event, payload } = state;
    switch (event) {
      case "UserPromptSubmit":
        // 사람이 말을 넣었다 — 「도는 중」. message는 직전 것을 그대로 둔다(전이 표).
        return { event: "start", message: null };
      case "PreToolUse":
        // **`AskUserQuestion`은 훅이 아니라 도구다** — 사람이 답해야 하는 도구라 기다림이다. 도구 이름으로
        // **`if`로** 가른다(파일 머리말: 안쪽 `switch`의 `case`로 써도 이름 검사가 훅 이름으로 읽는다).
        if (asksQuestion(payload)) return questionSignal(payload);
        return { event: "tool", message: null };
      case "PostToolUse":
        // 도구가 돌았다. **말은 안 싣는다** — 도는 중의 둘째 줄은 직전 맥락이고, 도구마다 두 번 오는 사건이 그
        // 줄을 도구 이름으로 갈아 끼우면 사람이 읽을 말이 도구가 돌 때마다 튄다.
        return { event: "tool", message: null };
      case "PostToolUseFailure":
        // **중단으로 닿은 실패만 중단이다**(프로세스 결정 12의 사실 쪽). 도구가 스스로 실패한 것은 턴이 계속
        // 돈다 — 도구다(S56).
        return flagAt(payload, "is_interrupt")
          ? { event: "interrupt", message: null }
          : { event: "tool", message: null };
      case "PermissionRequest":
        // **`AskUserQuestion`의 요청은 물음 창이다**(티켓 25 리뷰 반영) — 권한 흐름을 지날 뿐 창의 첫째가 `Yes`가 아니다.
        // 말도 PreToolUse와 같게 첫 물음이다(`questionSignal` 한 자리): 도구 이름으로 갈아 끼우면 PreToolUse가 세운 물음이 몇 ms
        // 만에 `AskUserQuestion`이 된다.
        if (asksQuestion(payload)) return questionSignal(payload);
        return { event: "waiting", message: permissionLine(payload), dialog: permissionDialog(payload) };
      case "Elicitation":
        // 물음 자체가 페이로드에 한 줄로 온다. 요약할 것이 없다. 창은 MCP 서버가 지은 양식이라 물음이다.
        return { event: "waiting", message: firstLine(stringAt(payload, "message")), dialog: "question" };
      case "Stop":
        return { event: "stop", message: firstLine(stringAt(payload, "last_assistant_message")) };
      case "StopFailure":
        // API 오류로 끝난 턴. 「오류로 끝남」은 상태 기계가 앞에 붙이고, 여기서는 상세 한 줄만 낸다(S57).
        return { event: "stopFailure", message: stopFailureLine(payload) };
      case "SubagentStart":
      case "SubagentStop":
        // **수는 여기서 안 센다** — 처리기가 `agent_id` 집합으로 접어 상태 파일에 싣는다(S51). 사건을 세면
        // 디바운스에 합쳐진 사건만큼 수가 샌다.
        return { event: "subagent", message: null };
      case "SessionEnd":
        // **`clear`만은 끝이 아니다** — `/clear`는 세션을 갈아 끼울 뿐 사람이 그 셸에 그대로
        // 앉아 있다. 끝(`end`)과 지움(`clear`)이 무엇이 되는지는 상태 기계가 가른다.
        return { event: sessionEnd(payload), message: null };
      default:
        return null;
    }
  },
};

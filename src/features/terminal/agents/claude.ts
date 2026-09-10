import type { ShellHookState } from "../types";
import { firstLine, permissionLine, sessionEnd, stringAt } from "./payload";
import type { AgentAdapter, AgentSignal } from "./types";

/**
 * claude가 훅으로 말한 것을 정규 이벤트로 접는다.
 *
 * **이름은 앱이 넘긴 것이다.** 훅 스크립트는 argv로 받은 이벤트 이름을 그대로 적으므로
 * (`atelier-hook.py`), 여기 적힌 문자열은 설치가 거는 이름과 짝이다(#207). 페이로드에도
 * 이름이 있지만 그 키가 에이전트마다 달라서 읽지 않는다.
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
      case "PermissionRequest":
        return { event: "waiting", message: permissionLine(payload) };
      case "Elicitation":
        // 물음 자체가 페이로드에 한 줄로 온다. 요약할 것이 없다.
        return { event: "waiting", message: firstLine(stringAt(payload, "message")) };
      case "Stop":
        return { event: "stop", message: firstLine(stringAt(payload, "last_assistant_message")) };
      case "SessionEnd":
        // **`clear`만은 끝이 아니다** — `/clear`는 세션을 갈아 끼울 뿐 사람이 그 셸에 그대로
        // 앉아 있다. 여기서 「끝났는데 안 봄」을 세우면 방금 지운 화면에 초록이 뜬다.
        return { event: sessionEnd(payload), message: null };
      default:
        return null;
    }
  },
};

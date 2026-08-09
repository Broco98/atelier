export interface StartPoint {
  kind: "project";
  slug: string;
}

export interface SessionView {
  /** 아틀리에가 만든 id. 세션 폴더 이름이다. */
  id: string;
  /** 에이전트가 준 세션 id. 재개에 쓴다. */
  agentSessionId: string;
  /** 어댑터 키 (예: codex) */
  agent: string;
  startPoint: StartPoint;
  cwd: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  /** 런타임의 사실이라 신원 파일에 없다 — 새로 켠 앱에서는 전부 false다. */
  alive: boolean;
}

/**
 * `updates.jsonl` 한 줄. 재생으로 읽는 값과 라이브 이벤트로 오는 값이 **같은 모양**이라
 * 둘이 화면에서 같은 렌더러를 탄다.
 */
export interface Envelope {
  /**
   * 알려진 것은 `user_prompt`·`session_update`이고 뒤 판이 더한다. **문자열 유니온으로 좁히지
   * 않는다** — 이 값은 남이 쓴 기록에서 오고, 지난 판이 남긴 종류나 우리가 모르는 종류가
   * 섞여 있을 수 있다. 좁히면 타입이 "이게 전부다"라고 거짓말을 한다.
   */
  kind: string;
  at: string;
  /** kind가 `user_prompt`일 때 — 내가 친 말 */
  text?: string;
  /** kind가 `turn_failed`일 때 — 답을 얻지 못한 이유 */
  message?: string;
  /** kind가 `session_update`일 때 — ACP 알림 파라미터 원본 */
  payload?: { update?: AgentUpdate };
}

/** 그리려고 꺼내 보는 자리만 적는다. 나머지는 봉투 안에 손대지 않은 채 그대로 있다. */
interface AgentUpdate {
  sessionUpdate?: string;
  content?: { type?: string; text?: string };
  title?: string;
}

/** 화면에 그려지는 한 덩이. */
export type Line =
  | { kind: "user"; text: string }
  | { kind: "agent"; text: string }
  | { kind: "tool"; text: string }
  | { kind: "failed"; text: string };

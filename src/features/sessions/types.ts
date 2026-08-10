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
  /** 답을 기다리는 권한 요청이 있는가. 살아있음과 같은 이유로 런타임에서만 온다. */
  awaitingPermission: boolean;
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
  /** kind가 `permission_request`·`permission_response`일 때 — 둘을 잇는 번호 */
  requestId?: string;
  /** kind가 `permission_response`일 때 — 실제로 고른 선택지와, 그것을 줄인 말 */
  optionId?: string;
  outcome?: string;
  /** kind가 `session_update`면 알림 파라미터, `permission_request`면 요청 파라미터 — 둘 다 원본 */
  payload?: { update?: AgentUpdate; toolCall?: ToolCall; options?: PermissionOption[] };
}

/** 그리려고 꺼내 보는 자리만 적는다. 나머지는 봉투 안에 손대지 않은 채 그대로 있다. */
interface AgentUpdate {
  sessionUpdate?: string;
  /** 갱신 종류마다 모양이 다르다 — 말 조각은 블록 하나, 도구 호출은 블록의 배열이다. */
  content?: unknown;
  title?: string;
  /** `tool_call`일 때 — 권한 요청이 이 번호로 자기가 어느 도구인지 가리킨다 */
  toolCallId?: string;
  rawInput?: unknown;
}

/**
 * 에이전트가 쓰려는 도구. ACP에서 이 자리는 **갱신**이라 앞서 보낸 것은 다시 오지 않는다 —
 * 비어 있는 자리는 같은 `toolCallId`의 지난 `tool_call`에서 메운다.
 *
 * 이 판은 이름과 원시 입력까지만 본다. diff와 도구별 렌더링은 판 04다.
 */
export interface ToolCall {
  toolCallId?: string;
  title?: string;
  kind?: string;
  rawInput?: unknown;
  /** 입력이 `rawInput`으로 오지 않는 도구도 있다 — 실물 Codex의 편집은 여기 diff를 싣는다 */
  content?: unknown;
}

/** 에이전트가 준 선택지 하나. **아틀리에가 만들어 내는 선택지는 없다.** */
export interface PermissionOption {
  optionId: string;
  name: string;
  /** allow_once · allow_always · reject_once · reject_always */
  kind: string;
}

/** 화면에 그려지는 한 덩이. */
export type Line =
  | { kind: "user"; text: string }
  | { kind: "agent"; text: string }
  | { kind: "tool"; text: string }
  | { kind: "failed"; text: string }
  | PermissionLine;

/** 권한 카드 한 장. 아직 답하지 않았으면 `answered`가 null이다. */
export interface PermissionLine {
  kind: "permission";
  requestId: string;
  /** 어떤 도구를 */
  title: string;
  /** 어떤 입력으로 — 에이전트가 보낸 그대로 읽을 수 있게 편 것 */
  input: string;
  options: PermissionOption[];
  answered: { optionId: string; outcome: string } | null;
}

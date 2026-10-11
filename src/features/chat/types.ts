// 대화창이 대화 호스트와 주고받는 값(three-axes 티켓 05 · 07 · 08 · 09). 모양의 정본은 크레이트 `atelier-acp`의 serde이고, 여기는 그
// 말을 옮겨 적는다 — 칸 이름이 어긋나면 tsc도 IPC 검사도 못 보므로, Rust 쪽 검사가 그 꼴을 글자로 못박는다
// (`engine_check.rs`의 「화면이 읽는 꼴」 · `chat.rs`의 이벤트 꼴).

/** 대화마다 고르는 에이전트 — 기록과 화면에 이 글자로 적힌다. */
export type Agent = "claude" | "codex";

/** 대화 목록의 한 줄 — 대화 탭 하나(`atelier_acp::Conversation`). 닫은 대화는 오지 않는다. */
export interface Conversation {
  id: string;
  agent: Agent;
  /** 에이전트 이름으로 저절로 붙는다 — `Codex`, `Codex 2` … */
  name: string;
  /** 사람이 고른 값. 고르지 않았으면 `null`(엔진 기본값)이다. */
  model: string | null;
  mode: string | null;
  plan: boolean | null;
  /** 기록에 마지막으로 적힌 줄의 seq. 화면은 이 다음부터 기록 줄 이벤트로 잇는다. */
  lastSeq: number;
  /** 대기 줄 — 호스트 메모리에만 있어 앱을 다시 켠 뒤와 에이전트가 떠 있지 않은 대화에서는 비어 있다. */
  queue: QueuedMessage[];
  /**
   * 에이전트가 지금 이 앱에 떠 있고 살아 있나(three-axes 티켓 23). 앱을 다시 켠 뒤에는 말을 보내기 전까지 거짓이다 — 앱을 끄면
   * 턴 끝도 죽음 줄도 없이 끝나므로, 거짓이면 기록이 `lastSeq`까지 그린 열린 턴 · 물음은 끝난 프로세스의 것이다(`fold.ts`).
   */
  live: boolean;
}

/**
 * 앱 종료 확인 창의 대화 셈(three-axes 티켓 23 · S13, `atelier_acp::QuitCounts`) — 앱 전체(지금 열지 않은 work 포함)에서, 끄면
 * 잃는 것들이다.
 */
export interface ChatQuitCounts {
  /** 턴이 도는 대화 수. */
  running: number;
  /** 대기 중인 말 수 — 대기 줄은 호스트 메모리에만 있어 앱을 끄면 사라진다. */
  queued: number;
  /** 답하지 않은 권한 요청 수. */
  approvals: number;
}

/** 대기 줄의 말 하나 — 턴이 도는 동안 보낸 말이다(`atelier_acp::QueuedMessage`). 입력창 위 「대기 중」에 선다. */
export interface QueuedMessage {
  /** 대기 id — 고치기 · 지우기 · 지금 보내기가 이것으로 고른다. */
  id: string;
  text: string;
  /** 「지금 보내기」를 눌러 도는 턴의 멈춤을 기다리는 말이다. 그런 말은 늘 맨 앞에 하나뿐이다. */
  sendNow: boolean;
}

/**
 * 기록 줄의 종류.
 *
 * - `changes`는 고친 곳 — 턴 앞뒤로 spec 폴더를 견준 바뀐 파일들이고, `turn-end` 바로 앞에 서며 바뀐 것이 없는 턴에는 없다
 *   (three-axes 결정 22).
 * - `permission`은 권한 — payload의 `state`로 가르고 같은 요청의 줄들은 `requestId`로 잇는다(three-axes 티켓 08).
 *   `asked`{requestId, request(요청 원문 — 선택지는 `request.options` 그대로), toolCall(빈 칸을 앞선 도구 줄로 채운 도구 요지)}
 *   뒤에 같은 `requestId`로 `answered`{optionId}나 `withdrawn`{reason: `stopped`(우리가 멈춤) | `agent`(에이전트가 답을 기다리지
 *   않고 턴을 끝냄) | `died`(에이전트가 죽음 — 죽음 줄 앞에 선다, 티켓 10)}이 선다. 뒤따르는 줄이 없는 물음이 답할 권한이다(승인 카드 — 21).
 * - `session`의 열림(`opened`) 줄은 `how`로 어느 길로 열렸는지 말한다(티켓 10) — `new`(새 대화) · `resumed` · `loaded`(되살려 맥락을
 *   이음) · `fresh`(되살리려 했지만 새 세션으로 열림 — 「새로 시작함」 상태 줄, 23).
 * - `config`는 사람이 바꾼 것 — 바꾼 칸과 새 값. 에이전트(`{agent}`, 13)와 모델 · 모드 · 계획(`{model}` · `{mode}` · `{plan}`,
 *   three-axes 티켓 09). 모델 · 모드 · 계획은 떠 있는 에이전트에 넣은 바꾸기만 선다 — 띄우지 않은 대화에서 바꾼 값은 대화 목록에만 있다.
 */
export type RecordKind = "sent" | "update" | "turn-end" | "session" | "stderr" | "changes" | "permission" | "config";

/**
 * 기록 줄 하나 — `agents/<id>.jsonl`의 한 줄과 기록 줄 이벤트가 같은 값이다. payload의 갈래는 종류마다 다르고 ACP 원문을
 * 그대로 싣기도 해서(`update`) 여기서 좁히지 않는다 — 대화 접기(17)가 읽으며 좁힌다.
 */
export interface RecordLine {
  /** 대화마다 1부터 는다. */
  seq: number;
  at: string;
  kind: RecordKind;
  payload: unknown;
}

/**
 * 인용(three-axes 티켓 27, `atelier_acp::Quote`) — 스펙 창에서 고른 자리. 보내기 명령에 실려 가면 호스트가 사람의 글 앞에 인용
 * 블록(실제 경로 + 줄 범위 참조와 마크다운 인용 글, S12)을 두고, `sent` 줄에 이 값이 그대로 남아 보낸 말 위에 선다.
 */
export interface Quote {
  /** spec 폴더 기준 경로(`drafts/idea.md`). */
  file: string;
  /** 원문 줄 범위(1부터, 끝 포함) — 렌더 보기면 고른 글이 걸친 첫 블록의 시작 줄부터 마지막 블록의 끝 줄까지, 원문 보기면 고른 줄 그대로다. */
  start: number;
  end: number;
  /** 고른 글. */
  text: string;
}

/**
 * 엔진 목록(`atelier_acp::EngineLists`, S16) — 그 엔진의 세션이 마지막으로 열릴 때 본 목록. 항목은 엔진이 준 원문 그대로이고,
 * 세션을 연 적 없는 엔진은 둘 다 빈 목록이다.
 */
export interface EngineLists {
  /** 모델 — 열림 줄 configOptions `model`의 선택지. */
  models: { value: string; name: string; description?: string | null }[];
  /** 모드 — 열림 줄 `modes.availableModes`. */
  modes: { id: string; name: string; description?: string | null }[];
}

/** 기록 줄 이벤트가 싣는 것 — 어느 work의 어느 대화에 몇째 줄이 적혔나. `seq`는 `line.seq`와 같다. */
export interface ChatRecordEvent {
  work: string;
  conversation: string;
  seq: number;
  line: RecordLine;
}

/** 대기 줄 바뀜 이벤트가 싣는 것 — 그 대화의 대기 줄 전체다. */
export interface ChatQueueEvent {
  work: string;
  conversation: string;
  queue: QueuedMessage[];
}

/**
 * 엔진 확인의 답. 못 찾았으면 빠진 것마다 이름과 설치 명령이 실리고, 찾았으면 로그인돼 있는지가 실린다(안내 카드,
 * three-axes 티켓 12).
 */
export type EngineCheck =
  | { state: "found"; programs: { name: string; path: string }[]; loggedIn: boolean }
  | { state: "missing"; missing: MissingProgram[] };

/** 로그인 셸의 PATH에서 못 찾은 실행 파일 하나 — 이름과 설치 명령(안내 카드의 「명령 복사」가 이것을 넣는다). */
export interface MissingProgram {
  name: string;
  install: string;
}

/**
 * 로그인 명령의 진행(`atelier_acp::LoginProgress`). 도는 중이면 명령이 찍은 첫 `https://` URL(「링크 복사」의 값 — 찍기 전에는
 * `null`), 끝났으면 사람이 취소했는지와 exit code(시그널로 끝났으면 `null`)다.
 */
export type LoginProgress =
  | { state: "running"; url: string | null }
  | { state: "ended"; cancelled: boolean; exitCode: number | null };

/**
 * 엔진 상태 이벤트가 싣는 것(`atelier_acp::EngineState`). `loggedIn`이 `null`이면 모른다 — 못 찾았거나 로그인 명령이 도는
 * 중이다. 「끝남」과 함께 온 `loggedIn`이 끝난 뒤 저절로 다시 돈 확인의 답이다.
 */
export interface ChatEngineEvent {
  agent: Agent;
  found: boolean;
  loggedIn: boolean | null;
  login: LoginProgress | null;
}

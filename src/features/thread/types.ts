// Thread 화면이 Thread 엔진과 주고받는 값(v1 티켓 05 · 구현 스펙 §4 · §18). 모양의 정본은 크레이트 `atelier-core`(`threads.rs`의
// `ThreadFile` · `Participant` · `ThreadSummary`)와 `atelier-acp`(`host/thread.rs`의 `ThreadView` · `ThreadLink`, `login.rs`의
// `EngineState`)의 serde이고, 여기는 그 말을 옮겨 적는다 — 칸 이름이 어긋나면 tsc도 IPC 검사도 못 보므로, Rust 쪽 검사가 그 꼴을
// 글자로 못박는다(`engine_check.rs`의 「화면이 읽는 꼴」 · `thread.rs`의 이벤트 꼴). three-axes 대화의 값(`chat/types.ts`)은 v1
// 티켓 08이 걷으며 Thread가 쓰는 것만 여기로 옮겼다.

import type { Avatar } from "./faces";

/** 대기 줄의 말 하나 — 턴이 도는 동안 보낸 말이다(`atelier_acp::QueuedMessage`). 입력창 위 「대기 중」에 선다. */
export interface QueuedMessage {
  /** 대기 id — 고치기 · 지우기 · 지금 보내기가 이것으로 고른다. */
  id: string;
  text: string;
  /** 「지금 보내기」를 눌러 도는 턴의 멈춤을 기다리는 말이다. 그런 말은 늘 맨 앞에 하나뿐이다. */
  sendNow: boolean;
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
 * 중이다. 「끝남」과 함께 온 `loggedIn`이 끝난 뒤 저절로 다시 돈 확인의 답이다. 엔진은 Claude Code뿐이다(S3).
 */
export interface EngineState {
  agent: "claude" | "codex";
  found: boolean;
  loggedIn: boolean | null;
  login: LoginProgress | null;
}

/**
 * 앱 종료 확인 창의 셈(three-axes 티켓 23 · S40, `atelier_acp::QuitCounts`) — 앱 전체에서, 끄면 잃는 것들이다.
 */
export interface QuitCounts {
  /** 턴이 도는 Session 수. */
  running: number;
  /** 대기 중인 말 수 — 대기 줄은 엔진 메모리에만 있어 앱을 끄면 사라진다. */
  queued: number;
  /** 답하지 않은 권한 요청 수. */
  approvals: number;
}

/** Thread의 참여자 하나(`atelier_core::Participant`). handle 밖의 칸은 Session이 열리며 채워진다. */
export interface Participant {
  handle: string;
  /** 정의가 온 곳 — `"library"` 또는 `{ project: slug }`. */
  from: DefinitionSource | null;
  joinedAt: string;
  /** Runtime 이름(`claude-code`). */
  runtime: string;
  sessionId: string | null;
  cwd: string | null;
  additionalDirectories: string[];
  /** 사람이 고른 모델 — 고르지 않았으면 정의 파일의 값이거나 `null`(Runtime 기본값)이다. */
  model: string | null;
  /** 생각 깊이(`claude --effort`의 값). `null`이면 Runtime 기본값이다. */
  effort: string | null;
}

/** Thread 하나의 지금(`atelier_acp::ThreadView`) — `thread.json`에 기록의 끝과 엔진의 살아 있는 상태를 더한 것. */
export interface ThreadView {
  id: string;
  title: string;
  createdAt: string;
  /** 이어진 Work의 slug. 없으면 `null`이다. */
  work: string | null;
  /** `thread.json`에 적힌 물어보는 정도 — Work가 없을 때만 쓴다(S18). 화면은 지금 정도(`askLevel`)를 읽는다. */
  mode: string | null;
  participants: Participant[];
  /** 사람이 마지막으로 본 줄의 seq. */
  lastRead: number;
  /** 기록에 마지막으로 적힌 줄의 seq. 화면은 이 다음부터 기록 줄 이벤트로 잇는다. */
  lastSeq: number;
  /** 지금 물어보는 정도(v1 티켓 23) — Work에 이은 Thread면 그 Work의 것, 아니면 이 Thread의 것이다. 입력창 아래 칩이 그린다. */
  askLevel: AskLevel;
  /**
   * 참여자의 Session 가운데 하나라도 지금 이 앱에 떠 있고 살아 있나. 거짓이면 기록이 `lastSeq`까지 그린 열린 턴 · 물음은 끝난
   * 프로세스의 것이다(`fold.ts`의 `goneThrough`).
   */
  live: boolean;
  /** 참여자마다의 대기 줄(handle → 그 Session의 대기 줄, 대기 말이 있는 참여자만) — 메모리에만 있어 다시 켠 뒤에는 비어 있다. */
  queues: Record<string, QueuedMessage[]>;
  /** 이은 Work가 보관됐거나 지워졌으면 그 까닭 — 읽기만 된 Thread다(v1 티켓 38). 열린 화면은 목록 요약 이벤트가 고친다(`putSummary`). */
  readOnly: WorkGone | null;
  /**
   * 입력창 Work 칩에서 「새 Work」로 시작했나(`thread.json`의 `newWork`, 03 S3) — 아니면 칸째 빠진다. Work가 서기 전까지 잠긴 Work 칩이
   * 흐린 「새 Work」다(`lockedWork`).
   */
  newWork?: boolean;
  /**
   * 이 Thread가 이은 Space의 slug(`thread.json`의 `space`, 03 §9) — Work 없는 Thread만 적고 없으면 칸째 빠진다. Work에 이은 Thread는 그 Work의
   * Space를 따른다(`WorkView.space`). 읽는 범위는 이 칸으로 세지 않고 범위 명령이 준다(`reading_scope`).
   */
  space?: string;
}

/**
 * Thread가 이은 Work가 진행 중이 아닌 까닭(`atelier_core::WorkGone`, v1 티켓 38) — 보관됨 · 지워짐. 그 Thread는 읽기만이다: 엔진은 말을
 * 거절하고 Session을 지금 턴 뒤에 끄며, 화면은 입력창 자리에 그 까닭을 보이고 사이드바에서 뺀다(S43).
 */
export type WorkGone = "archived" | "removed";

/**
 * 물어보는 정도(`atelier_acp::AskLevel`, 스토리 84 · S18) — 매번 묻기 · 편집은 허용 · 계획만 · 알아서. 저장 글자 그대로다. 이름 · 설명은
 * `chips.ts`의 `ASK_LEVELS`다.
 */
export type AskLevel = "always" | "edits" | "plan" | "auto";

/** Thread 목록의 한 줄(`atelier_core::ThreadSummary`) — 새것이 먼저다. 깨진 Thread는 `broken`에 까닭만 있다. */
export interface ThreadSummary {
  id: string;
  title: string;
  createdAt: string;
  work: string | null;
  handles: string[];
  /** 사람이 마지막으로 본 줄의 seq(S38) — 사이드바가 「새 결과」를 가른다(v1 티켓 41). 깨진 Thread는 0이다. */
  lastRead: number;
  /** 이은 Work가 보관됐거나 지워졌으면 그 까닭(v1 티켓 38) — 사이드바에서 빠지고 ⌘K로 찾는다(S43). */
  readOnly: WorkGone | null;
  broken: string | null;
}

/**
 * 보낸 말에 붙인 파일 · 폴더 하나(`atelier_core::Attachment`, v1 티켓 06 · S30) — 입력창의 칩과 `sent` 줄의 `attachments`가 같은 꼴이다.
 * Agent에게는 `path`만 간다(내용은 넘기지 않는다).
 */
export interface Attachment {
  /** 절대 경로. */
  path: string;
  /** 파일의 크기(바이트) — 잰 그때의 값. 폴더면 `null`이다. */
  size: number | null;
  folder: boolean;
}

/**
 * 질문 카드에서 물음 하나에 준 답(`atelier_acp::QuestionAnswer`, v1 티켓 26) — 고른 선택지의 이름, 여럿 고르면 쉼표로 이은 것, 또는
 * 직접 쓴 말. 질문 답 명령이 싣고, `question` 줄의 답(`answers`)이 같은 꼴로 온다.
 */
export interface QuestionAnswer {
  question: string;
  answer: string;
}

/**
 * 새 Thread를 어디에 잇나(`atelier_acp::ThreadLink`) — 첫 말과 함께 간다. 입력창 Work 칩이 고른다(v1 티켓 31): Work 없이 · 새 Work로
 * 시작(첫 머리말이 Work 만들기 제안을 먼저 하라고 한다) · 이 Work(Thread가 처음부터 그 Work에 이어진다).
 */
export type ThreadLink = { kind: "no-work" } | { kind: "new-work" } | { kind: "work"; slug: string };

/** 새 Thread의 첫 말 전에 입력창 칩에서 고른 것(`atelier_acp::StartPicks`) — 고르지 않은 칸은 `null`이다. */
export interface StartPicks {
  mode: AskLevel | null;
  /** 첫 Session의 모델 — claude `--model`이 받는 값. */
  model: string | null;
  /** 첫 Session의 생각 깊이 — claude `--effort`가 받는 값. */
  effort: string | null;
  /**
   * 트레이 Space 칩에서 고른 Space(03 §5) — 첫 말의 범위다. Work 없는 Thread면 그 Thread의 Space로 서고, 이은 Work면 그 Work의 Space가 된다
   * (S4). `null`은 고르지 않음(이은 Work의 Space를 건드리지 않는다)이다.
   */
  space: SpacePick | null;
}

/** Space 칩에서 고른 것(`atelier_acp::SpacePick`) — `slug`가 `null`이면 「Space 없음」을 고른 것이다(고르지 않음과 가른다). */
export interface SpacePick {
  slug: string | null;
}

/** Work 밖 Project 카드의 답(v1 티켓 32 · S22) — 붙이고 고치기 · 읽기만 하기 · 아니요. */
export type ProjectAnswer = "attach" | "read" | "decline";

/** Space 질문 카드의 답(03 티켓 08) — 그 Space · Space 없이 · 나중에(esc — 아무것도 바꾸지 않는다). */
export type SpaceAnswer = { kind: "space"; slug: string } | { kind: "none" } | { kind: "later" };

/**
 * 기록 줄의 종류(`atelier_core::RecordKind`) — three-axes 대화 기록의 갈래에 v1이 더한 것(`question` · `joined` · `left` · `work` ·
 * `title` · `mode` · `call` · `pr` · `library`)에 03이 `space`(Space 줄)를 더했다. Thread Session에는 `changes`가 서지 않는다.
 */
export type RecordKind =
  | "sent"
  | "update"
  | "turn-end"
  | "session"
  | "stderr"
  | "changes"
  | "permission"
  | "config"
  | "question"
  | "joined"
  | "left"
  | "work"
  | "title"
  | "mode"
  | "call"
  | "pr"
  | "library"
  | "space";

/**
 * 기록 줄 하나 — `threads/<id>/events.jsonl`의 한 줄과 기록 줄 이벤트가 같은 값이다. `who`는 그 줄을 낸 참여자의 handle이고,
 * 사람의 말(`sent`)과 Thread의 일(`title` …)에는 없다. payload는 종류마다 다르고 ACP 원문을 그대로 싣기도 해서 접기(`fold.ts`)가
 * 읽으며 좁힌다.
 */
export interface RecordLine {
  seq: number;
  at: string;
  kind: RecordKind;
  who?: string;
  payload: unknown;
}

/** 기록 줄 이벤트(`thread:record`)가 싣는 것. `seq`는 `line.seq`와 같다. */
export interface ThreadRecordEvent {
  thread: string;
  seq: number;
  line: RecordLine;
}

/** 대기 줄 바뀜 이벤트(`thread:queue`)가 싣는 것 — 그 참여자 Session의 대기 줄 전체다. */
export interface ThreadQueueEvent {
  thread: string;
  who: string;
  queue: QueuedMessage[];
}

/** 정의가 온 곳(`atelier_core::DefinitionSource`) — Library 또는 Work에 붙은 Project. */
export type DefinitionSource = "library" | { project: string };

/** Library와 Project에서 찾은 Agent 하나(`atelier_core::FoundAgent`) — 화면이 읽는 칸만 적는다. */
export interface FoundAgent {
  /** 부르는 이름 — `reviewer`, Project 둘이 같은 handle이면 `api/reviewer`. @ 메뉴가 `@<call> `으로 넣는다. */
  call: string;
  from: DefinitionSource;
  /** 읽은 파일의 절대 경로 — Library 화면의 경로 복사 · 블록 복사가 쓴다(v1 티켓 19). */
  path: string;
  definition: {
    handle: string;
    name: string;
    description: string;
    /** 얼굴(S36) — 적은 글자 그대로다. 푸는 일은 `faces.ts`가 한다. */
    avatar: Avatar | null;
    model: { prefer: string | null; effort: string | null };
    /** 묻는 일 · 막는 일(S19 규칙 이름) — 「결정은 내가 합니다」 카드가 Host의 `askBefore`를 읽는다. */
    policy: { askBefore: string[]; forbid: string[] };
  };
}

/** 깨진 Agent 파일의 까닭(`atelier_core::AgentProblem`, v1 티켓 03 · 11). */
export type AgentProblem =
  | { kind: "unreadable"; message: string }
  | { kind: "unknownTool"; tool: string }
  | { kind: "runtimeNotAccepted" }
  | { kind: "hostOutsideLibrary" };

/** 깨진 Agent 파일 하나(`atelier_core::BrokenAgent`) — @ 메뉴에 흐리게, 까닭과 함께 선다. */
export interface BrokenAgent {
  call: string;
  handle: string;
  from: DefinitionSource;
  path: string;
  problem: AgentProblem;
}

/** 부를 수 있는 Agent 목록(`atelier_core::AgentRoster`) — 둘 다 부르는 이름 순이다. */
export interface AgentRoster {
  agents: FoundAgent[];
  broken: BrokenAgent[];
}

/**
 * 문서 하나를 쓰는 중(`atelier_acp::DocWriting`, v1 티켓 34) — Work의 spec 폴더 안 파일에 편집 도구가 도는 동안이다. 요약 카드 소스의 문서 줄이
 * 파란 점과 「Host가 쓰는 중」을 세운다.
 */
export interface DocWriting {
  /** spec 폴더 기준 경로 — spec 트리의 `path`와 같은 꼴. */
  path: string;
  /** 쓰는 Agent의 handle. */
  who: string;
  /** 쓰는 Agent의 이름(Host는 「Host」). */
  name: string;
  /** 그 Agent가 앉은 Thread. */
  thread: string;
}

/** `work:writing` 이벤트 — Work 하나의 지금 쓰는 중 목록 전체. 빈 목록이면 아무도 쓰지 않는다. */
export interface WorkWritingEvent {
  work: string;
  writing: DocWriting[];
}

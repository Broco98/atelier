// Thread 화면이 Thread 엔진과 주고받는 값(v1 티켓 05 · 구현 스펙 §4 · §18). 모양의 정본은 크레이트 `atelier-core`(`threads.rs`의
// `ThreadFile` · `Participant` · `ThreadSummary`)와 `atelier-acp`(`host/thread.rs`의 `ThreadView` · `ThreadLink`)의 serde이고, 여기는
// 그 말을 옮겨 적는다. three-axes 대화의 `chat/types.ts`와 같은 자리다 — 옛 대화가 걷히면(08) 이 파일만 남는다.

import type { QueuedMessage } from "@/features/chat/types";

export type { EngineCheck, LoginProgress, MissingProgram, QueuedMessage } from "@/features/chat/types";

/** Thread의 참여자 하나(`atelier_core::Participant`). handle 밖의 칸은 Session이 열리며 채워진다. */
export interface Participant {
  handle: string;
  /** 정의가 온 곳 — `"library"` 또는 `{ project: slug }`. */
  from: "library" | { project: string } | null;
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
  /** 물어보는 정도. Work가 없을 때만 쓴다(v1 티켓 23). */
  mode: string | null;
  participants: Participant[];
  /** 사람이 마지막으로 본 줄의 seq. */
  lastRead: number;
  /** 기록에 마지막으로 적힌 줄의 seq. 화면은 이 다음부터 기록 줄 이벤트로 잇는다. */
  lastSeq: number;
  /**
   * 참여자의 Session 가운데 하나라도 지금 이 앱에 떠 있고 살아 있나. 거짓이면 기록이 `lastSeq`까지 그린 열린 턴 · 물음은 끝난
   * 프로세스의 것이다(`fold.ts`의 `goneThrough`).
   */
  live: boolean;
  /** 참여자마다의 대기 줄(handle → 그 Session의 대기 줄, 대기 말이 있는 참여자만) — 메모리에만 있어 다시 켠 뒤에는 비어 있다. */
  queues: Record<string, QueuedMessage[]>;
}

/** Thread 목록의 한 줄(`atelier_core::ThreadSummary`) — 새것이 먼저다. 깨진 Thread는 `broken`에 까닭만 있다. */
export interface ThreadSummary {
  id: string;
  title: string;
  createdAt: string;
  work: string | null;
  handles: string[];
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

/** 새 Thread를 어디에 잇나(`atelier_acp::ThreadLink`) — 첫 말과 함께 간다. Work 칩(31)이 고르기 전까지는 늘 `no-work`다. */
export type ThreadLink = { kind: "no-work" } | { kind: "new-work" } | { kind: "work"; slug: string };

/**
 * 기록 줄의 종류(`atelier_core::RecordKind`) — three-axes 대화 기록의 갈래에 v1이 더한 것(`question` · `joined` · `left` · `work` ·
 * `title` · `mode` · `call` · `pr`). Thread Session에는 `changes`가 서지 않는다.
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
  | "pr";

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

/** Library와 Project에서 찾은 Agent 하나(`atelier_core::FoundAgent`) — 화면이 읽는 칸만 적는다. */
export interface FoundAgent {
  call: string;
  definition: {
    handle: string;
    name: string;
    description: string;
    model: { prefer: string | null; effort: string | null };
  };
}

/** 부를 수 있는 Agent 목록(`atelier_core::AgentRoster`) — 깨진 파일은 화면이 아직 쓰지 않는다. */
export interface AgentRoster {
  agents: FoundAgent[];
}

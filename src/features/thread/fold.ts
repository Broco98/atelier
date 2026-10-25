import { askLevelOf } from "./chips";
import type { Avatar } from "./faces";
import { isObject, nonEmpty, text, type Json } from "./json";
import type { Quote } from "@/features/works/QuotePick";
import { prLineOf, type PrLine } from "./pr";
import type { Attachment, QuestionAnswer, RecordLine } from "./types";

// Thread 접기(v1 티켓 05 · 구현 스펙 §14) — Thread 기록 줄을 받아 화면 모델(턴 · 말한 이 · 메시지 · 생각 · 도구 줄 · 시스템 줄 ·
// 도는가)로 접는 **순수 함수**다. Thread 화면은 Thread를 이것 하나로 그린다: 처음 그릴 때 읽은 기록도, 흐르는 기록 줄 이벤트도 같은
// 줄이라 이 함수는 어디서 온 줄인지 모른다.
//
// three-axes 대화 접기(`chat/fold.ts`)를 옮겨 왔다 — 턴 · 멈춘 뒤의 도구 줄 · 스스로 이어 간 턴 · 계획 카드 · 상태 줄의 규칙은 그대로이고
// (그쪽 머리말이 근거를 든다), Thread에서 달라진 것은 셋이다.
// - **줄의 `who`로 말한 이를 가른다.** 턴은 그 턴에 답한 참여자의 handle을 들고, 같은 Agent가 사람 말 없이 이어 말하면 이름 줄을 다시
//   쓰지 않는다(`namesWho`). Host의 턴은 이름 줄이 아예 없다(02 구현 스펙 §8). 사람의 말(`sent`)은 `who`가 없고 받는 이를 `to`에 싣는다.
//   **열린 턴은 참여자마다 하나다**(v1 티켓 14) — 참여자마다 Session이 따로라(§5) Host가 도는 동안 리뷰어에게 보낸 말은 리뷰어의 턴으로
//   함께 돈다. 줄은 그 `who`의 열린 턴에 들고, 한 Session이 죽거나 닫히면 그 참여자의 턴 · 물음만 끝난다. 앱을 다시 켠 것(`goneThrough`)은
//   모두의 끝이다. 참여자의 이름 · 얼굴은 들어옴 줄(`joined`)이 정본이다(`cast`) — 처음 불린 정의 그대로다(S4).
// - **Thread의 일은 흐름 가운데의 시스템 줄이다**(캔버스 Messages 보드 「시스템 줄」) — 이름 바꾸기(`title`), 참여자가 들고 남(`joined` ·
//   `left`), 물어보는 정도 바꿈(`mode` — 「Policy를 편집은 허용으로 바꿈 · 이 Work에만」, v1 티켓 23). 모든 Thread가 Host의 `joined`로
//   시작하므로 Host가 들어온 줄은 세우지 않는다. Work · PR 줄은 그 장(30 · 31 · 40)이 더한다.
// - **Agent 부르기는 호출 줄이다**(v1 티켓 17 · 구현 스펙 §8 · 캔버스 WorkLog 보드 「Agent 호출 줄」) — `call` 시작 · 끝 줄 둘을
//   `payload.id`로 이어 부른 Agent(`who`)의 열린 턴에 한 줄로 세운다. 그 부르기를 낸 Thread 도구 줄(`atelier-thread.call_agent`)은
//   호출 줄이 그 자리를 대신한다 — 같은 일이 두 줄로 서지 않게. 부른 Agent의 턴이 돌지 않을 때 선 부르기(사람의 「다시 맡기기」)는 턴
//   사이에 선다. 시작 줄은 불린 Agent에게 맡긴 일이 실제로 간 자리라 그 Agent의 **맡은 턴**을 연다(사람의 말 대신 맡긴 말) — 그 Agent의
//   줄은 그 턴에 들고, 호출 줄은 그 턴의 줄들을 들고 「지금 도구」 · 펼침의 도구 줄을 보인다. 전해지기 전에 막힌 부르기는 끝 줄
//   하나로 서고 맡은 턴이 없다.
// - **도구 줄은 시작과 끝의 시각을 든다** — 작업 로그가 마우스를 올린 줄에 걸린 시간을 말한다(캔버스 WorkLog 보드). 사람이 거절한
//   물음의 도구 줄은 「실행하지 않음 · 내가 거절함」이라 거절을 든다(`denied`). 판정이 묻지 않고 허용한 도구 줄은 그 까닭을 든다
//   (`allowed` — 방패 줄 「자동으로 허용함」, v1 티켓 23 · 구현 스펙 §9). 판정 줄(`decided`)의 고른 선택지가 허용 갈래일 때다 — 엔진의
//   거절도 같은 줄로 온다. 답하지 않은 물음의 도구 줄은 「승인을 기다리는 중」이다(`asking`, v1 티켓 24).
// - **사람이 승인 카드에서 고른 것은 결정 줄이다**(v1 티켓 24 · 캔버스 Cards · Approval 보드 「결정한 뒤」) — 답 줄(`answered`)이 오면
//   카드가 걷히고 물은 참여자의 열린 턴에 결정 줄이 선다(허락인지 · 다시 묻지 않기로 준 허락 · 거절하며 남긴 말). 판정이 묻지 않고
//   닫은 요청(`decided`)은 결정 줄이 아니다 — 그쪽은 위의 방패 줄이다.
// - **Work 만들기 카드는 `question` 줄(`card: work`)이다**(v1 티켓 30 · 캔버스 Cards 보드 「Work 만들기」) — 제안 줄이 오면 카드가 권한
//   요청과 같은 물음 차례에 서고(`asks`), 답 줄이 오면 걷히며 그 제안을 낸 Thread 도구 줄(`atelier-thread.propose_work`) 자리에 결정 줄이
//   선다(「✓ Work 만들기 · api-server · fix/refund-api」 · 「→ Work 없이 계속함」 — 화면 2 보드). 만들었으면 `work` 줄이 시스템 줄
//   「Work … 을 만들고 이 Thread에 연결함」이 된다. 두 줄(도구 줄 · 제안 줄)은 다른 길로 적혀 엇갈릴 수 있다 — 먼저 온 쪽이 나중 것을
//   기다린다.
// - **Agent의 질문은 질문 줄이다**(v1 티켓 26 · 캔버스 Cards 보드 「Agent의 질문」) — `question` 줄(`card: question`)이 오면 승인 ·
//   Work 만들기 카드와 같은 물음 차례(`asks`)에 질문으로 서고, 그 질문을 낸 도구 줄 자리를 질문 줄이 대신한다. 답하면 그 자리에
//   답한 카드가 남고, 거둬지면 아무것도 남지 않는다.
// Thread Session에는 고친 곳(`changes`) 줄이 없다 — 바뀐 파일 알약은 마지막 턴의 편집 도구가 낸 diff에서 센다(`log.ts`).
//
// 모르는 줄은 버리지 않고 지나간다 — 기록은 원문 그대로라 스키마에 없는 갈래도 오고, 그것이 화면을 멈추면 안 된다.

/** 턴이 끝난 모양 — `turn-end` 줄, 또는 그 줄 없이 Session이 사라진 것(죽음 · 닫힘 · 앱을 다시 켬). */
export interface TurnEnd {
  /** Runtime이 준 끝 까닭(`end_turn` · `cancelled` · `max_tokens` …). 말을 받지 않았거나 사라졌으면 null이다. */
  stopReason: string | null;
  /** 말을 보낸 때부터 끝날 때까지. */
  durationMs: number;
  /** 우리가 멈췄나 — `cancelled`가 사람의 멈춤인지 Runtime의 거부인지를 가른다. */
  cancelledByUs: boolean;
  /** 말을 받지 않은 오류나 사라진 까닭. */
  error: string | null;
  /** 끝난 때 — 턴 끝 줄(또는 Session이 사라진 줄)의 시각. 함께 돈 턴들의 말한 차례를 가른다(사이드바의 마지막 말). */
  at: string;
}

/** 턴 안의 한 줄. 같은 메시지의 조각들은 한 줄로 이어 붙는다. */
export type Entry =
  | { kind: "message"; key: string; messageId: string | null; text: string }
  | { kind: "thought"; key: string; messageId: string | null; text: string }
  | ToolEntry
  | CallEntry
  | PlanEntry
  | ChecklistEntry
  | DecisionEntry
  | WorkChoiceEntry
  | QuestionEntry
  | ProjectChoiceEntry;

/**
 * Work 만들기 카드에서 사람이 고른 것(v1 티켓 30) — 「Work 만들기 · api-server · fix/refund-api」 또는 「Work 없이 계속함」. 그 제안을 낸
 * Thread 도구 줄의 자리를 대신한다.
 */
export interface WorkChoiceEntry {
  kind: "work-choice";
  key: string;
  /** Work를 만들었나 — 아니면 「Work 없이 계속」이다. */
  created: boolean;
  /** 만든 Work의 Project들(카드에서 고친 것)과 브랜치. 「Work 없이 계속」이면 비었다. */
  projects: string[];
  branch: string | null;
  /** 이 결정의 제안을 낸 Thread 도구 줄의 id — 아직 짝을 찾지 못했으면 null이다. */
  toolCallId: string | null;
}

/**
 * 질문 줄(v1 티켓 26) — Agent가 낸 질문 하나. 답을 기다리는 동안은 흐름에 그리지 않고(입력창 자리의 질문 카드가 말한다), 답하면
 * 답한 카드(물은 것 · 고른 답), 나중에 답하기로 하면 「나중에 답하기로 함」이다(`question.ts`의 `answeredCards`).
 */
export interface QuestionEntry {
  kind: "question";
  key: string;
  /** 고른 것 — 답했다 · 나중에. 아직 답을 기다리면 null이다. */
  choice: "answer" | "later" | null;
  /** 물음마다의 답 — 나중에 · 기다리는 중이면 빈 목록이다. */
  answers: QuestionAnswer[];
}

/** 질문 카드의 물음 하나 — 엔진이 Runtime을 가리지 않는 꼴로 실은 것(`question` 줄의 `questions`). */
export interface AskedQuestion {
  question: string;
  /** 물음 아래 한 줄. 없으면 null이다. */
  description: string | null;
  /** 여럿 고르기 — 고른 이름들을 쉼표로 이어 답한다. */
  multiSelect: boolean;
  /** 고를 답 — 비면 직접 쓰는 물음이다. */
  options: { label: string; description: string | null }[];
}

/**
 * Work 밖 Project 카드에서 사람이 고른 것(v1 티켓 32 · S22) — 「web-app을 이 Work에 붙임」 · 「web-app을 읽기만 하기로 함」 · 「web-app을
 * 고치지 않기로 함」. 그 카드를 낸 Thread 도구(「Project 고치기 시작」) 줄의 자리를 대신한다.
 */
export interface ProjectChoiceEntry {
  kind: "project-choice";
  key: string;
  /** 붙이고 고치기 · 읽기만 하기 · 아니요. */
  choice: "attach" | "read" | "decline";
  /** 고르게 한 Project의 slug. */
  project: string;
  /** 이 결정의 카드를 낸 Thread 도구 줄의 id — 아직 짝을 찾지 못했으면 null이다. */
  toolCallId: string | null;
}

/**
 * 결정 줄(v1 티켓 24) — 사람이 승인 카드에서 고른 것. 문구는 `approval.ts`의 `decisionText`가 짓는다(「명령 실행을 승인함 · 이 Work에서는
 * 다시 묻지 않음」).
 */
export interface DecisionEntry {
  kind: "decision";
  key: string;
  /** 허락했나(고른 선택지의 `kind`가 `allow…`). */
  allowed: boolean;
  /** 「다시 묻지 않기」로 준 허락과 둔 자리 — 없으면 null이다. */
  granted: { rules: string[]; work: string | null } | null;
  /** 거절하며 남긴 말 — 없으면 null이다. */
  words: string | null;
  /** 물음의 도구 요지 — 무엇을 결정했는지(명령 · 파일 · 계획)가 여기서 나온다. */
  toolCall: Json;
  /** 계획 승인이었나. */
  planReview: boolean;
}

/** 부르기가 끝난 꼴(`call` 끝 줄) — 받은 말이거나, 답하지 못한 까닭이거나, 사람이 멈췄다. */
export interface CallEnd {
  outcome: "answered" | "failed" | "stopped";
  /** 받은 말 — 불린 Agent가 맡은 턴을 끝낸 마지막 메시지. 받지 못했으면 null이다. */
  answer: string | null;
  /** 답하지 못한 까닭(멈춤이면 「사람이 멈춤」). 받았으면 null이다. */
  reason: string | null;
  /** 도구가 불린 때부터 끝날 때까지(대기 줄에서 기다린 시간 포함). */
  durationMs: number;
}

/** 호출 줄(v1 티켓 17) — Agent가 Thread 도구로 다른 Agent에게 일을 맡긴 부르기 하나. 시작 · 끝 줄 둘이 `id`로 이어진다. */
export interface CallEntry {
  kind: "call";
  key: string;
  id: string;
  /** 부른 Agent · 불린 Agent의 handle. */
  from: string;
  to: string;
  /** 맡긴 말. */
  text: string;
  /** 처음 온 `call` 줄의 시각 — 하는 중의 경과가 여기서 센다. */
  startedAt: string;
  /** 불린 Agent의 맡은 턴의 줄들 — 그 턴의 `entries` 그대로다. 맡긴 일이 전해지기 전에 막혔으면 null이다. */
  work: Entry[] | null;
  /** 끝났으면 그 꼴, 아직이면 null. */
  end: CallEnd | null;
  /** 끝 줄을 받기 전에 앱이 꺼졌다 — 더 올 줄이 없다. 하는 중으로 보이지 않는다. */
  cut: boolean;
  /** 이 부르기를 낸 Thread 도구 줄의 id — 호출 줄이 그 자리를 대신한다. 아직 짝을 찾지 못했으면 null이다. */
  toolCallId: string | null;
}

/** 계획 카드 — Runtime의 마크다운 계획, 또는 계획 승인 요청의 계획 본문. Thread에 하나라 다음 계획이 오면 같은 카드가 바뀐다. */
export interface PlanEntry {
  kind: "plan";
  key: string;
  text: string;
}

/** 계획 체크리스트의 항목 하나 — ACP `PlanEntry`. */
export interface ChecklistItem {
  content: string;
  status: string;
}

/** 계획 체크리스트 — ACP `plan`의 항목들. Runtime이 보낼 때만 서고, Thread에 하나다. 빈 목록이 오면 걷힌다. */
export interface ChecklistEntry {
  kind: "checklist";
  key: string;
  items: ChecklistItem[];
}

/** 우리가 멈춘 턴에서 그 도구 줄이 어떻게 됐나 — 멈춘 뒤에도 돈다(돌았다) · 멈춤과 함께 닫혔다. 멈춘 턴의 줄이 아니면 null이다. */
export type ToolStop = "ran-on" | "stopped";

export interface ToolEntry {
  kind: "tool";
  key: string;
  toolCallId: string;
  /** 처음 온 `tool_call`에 뒤의 `tool_call_update`를 덮어 합친 값. 문구 · 안의 것은 `tool-view.ts`가 짓는다. */
  call: Json;
  /** 명령이 낸 출력 조각(`_meta.terminal_output_delta.data`)을 이어 붙인 것. */
  output: string;
  stop: ToolStop | null;
  /** 끝을 알리기 전에 그 Session이 사라졌나 — 더 올 update가 없다. 도는 것으로 보이지 않는다. */
  cut: boolean;
  /** 이 도구가 물은 권한을 사람이 거절했나(거절 갈래의 선택지로 답했다). */
  denied: boolean;
  /** 판정이 묻지 않고 허용했으면 그 까닭(「편집은 허용」 · 「이 Work에서는 다시 묻지 않기」 …), 아니면 null이다. */
  allowed: string | null;
  /** 이 도구가 물은 권한이 아직 답을 기다리나 — 「승인을 기다리는 중」(v1 티켓 24). */
  asking: boolean;
  /** `tool_call` 줄의 시각. */
  startedAt: string;
  /** 끝(`completed` · `failed`)을 알린 줄의 시각. 끝나지 않았으면 null이다. */
  endedAt: string | null;
}

export interface Turn {
  /** 턴의 정체 — 접고 펴기를 기억하는 열쇠다. 보낸 말의 seq에서 나온다. */
  key: string;
  /** 그 턴에 답한 참여자의 handle — 보낸 말의 받는 이(`to`), 그 뒤 답한 줄의 `who`. 모르면 null이다. */
  who: string | null;
  /**
   * 이름 줄(「이름 · @handle」)을 쓰나 — Host의 턴은 쓰지 않는다(02 구현 스펙 §8 — Host의 답은 본문으로 바로 시작한다). 다른 Agent도
   * 사람 말 없이 이어 말하면 쓰지 않는다(구현 스펙 §14). 그 밖의 턴(사람이 말한 턴 · 말한 이가 바뀐 턴)은 쓴다.
   */
  namesWho: boolean;
  /** 사람이 보낸 말의 화면 글(기록의 `sent`). 머리말은 기록의 `prompt`에만 있다. 스스로 이어 간 턴은 null이다. */
  sent: string | null;
  /** 그 말에 붙인 파일 · 폴더(`sent`의 `attachments`, v1 티켓 06) — 말풍선 위 칩이다. 없으면 빈 목록이다. */
  attachments: Attachment[];
  /** 그 말에 붙인 인용(`sent`의 `quote`, v1 티켓 35 · S41) — 넓힌 카드의 문서에서 고른 글이고 말풍선 위에 선다. 없으면 null이다. */
  quote: Quote | null;
  /** Agent가 스스로 이어 간 턴인가 — 보낸 말 없이 시작했거나 턴 밖 끝만 온 턴이다. */
  selfContinued: boolean;
  /** 턴이 선 시각(보낸 말 · 처음 온 줄). */
  startedAt: string;
  /** 답한 이의 첫 줄 시각. 아직 답이 없으면 null이다(이름 줄은 02 티켓 08부터 시각을 그리지 않는다). */
  answeredAt: string | null;
  entries: Entry[];
  /** 끝났으면 그 모양, 도는 중이면 null. */
  end: TurnEnd | null;
  /** 다른 Agent가 맡긴 일을 받은 턴이면 그 부르기(v1 티켓 17) — 사람의 말 대신 맡긴 말로 선 턴이다. */
  assigned: CallEntry | null;
}

/**
 * 흐름 안의 상태 줄(three-axes 티켓 23) — 되살리기가 새 Session으로 끝남 · 프로세스 죽음 · 판 경고. 턴에 들지 않고 턴 사이에 선다.
 */
export interface Notice {
  key: string;
  kind: "fresh" | "died" | "version";
  text: string;
  /** 그 Session의 참여자 handle — Session 보기(S37)가 그 참여자의 상태 줄만 남긴다. */
  handle: string;
  /** 이 줄보다 먼저 선 턴의 수 — 흐름에서 그 턴들 뒤, 다음 턴 앞에 선다. */
  turnsBefore: number;
}

/**
 * 시스템 줄(캔버스 Messages 보드) — 가운데에 회색 한 줄, 굵게 쓰는 것은 이름(`name`)뿐이다. 문장은 `before` · `name` · `after`를 잇는다
 * (「Thread 이름을 」 · 「환불 API 버그」 · 「로 바꿈」). 끝에 고정폭 조각(`code` — 브랜치)이 붙을 수 있다(「api-server에 worktree를 만듦
 * · `fix/refund-api`」).
 */
export interface SystemLine {
  key: string;
  kind: "title" | "joined" | "left" | "library" | "mode" | "work" | "worktree";
  /** 들고 난 참여자 · Library에 저장한 Agent의 handle — 그 얼굴이 이름 앞에 선다. Thread의 일(이름 바꾸기 · 정도 바꿈)은 `null`이다. */
  handle: string | null;
  /**
   * Library에 저장한 Agent의 얼굴 — 저장한 정의의 것이다(그 Agent는 이 Thread의 참여자가 아니라 `cast`에 없다). 들고 난 줄은 적지
   * 않는다 — 참여자의 얼굴(`cast`)을 쓴다.
   */
  avatar?: Avatar | null;
  before: string;
  name: string;
  after: string;
  /** 문장 끝의 고정폭 조각 — 없으면 칸째 없거나 null이다. */
  code?: string | null;
  turnsBefore: number;
  /**
   * 턴 사이가 아니라 이 턴(열쇠)의 머리 — 사람 말 뒤, Agent의 줄 앞 — 에 선다. worktree를 만든 줄이 그 Project를 고치기 시작한 턴에
   * 선다(화면 2 보드). 없으면 `turnsBefore`의 턴 사이다.
   */
  turn?: string;
}

/**
 * PR 카드 하나(v1 티켓 36 · 스토리 124) — 엔진이 그 Work의 PR이 처음 보였을 때와 상태가 바뀔 때 남긴 `pr` 줄이다. 시스템 줄처럼 턴 사이에
 * 선다. 같은 PR(Project · 번호)의 마지막 카드만 `latest`다 — 지금의 상태라 「Host에게 고쳐 달라고 하기」가 그 카드에만 선다.
 */
export interface PrCardEntry {
  key: string;
  pr: PrLine;
  latest: boolean;
  turnsBefore: number;
}

/** 턴 밖의 호출 줄 하나 — 이 줄보다 먼저 선 턴의 수(`turnsBefore`) 뒤에 선다. */
export interface LooseCall {
  entry: CallEntry;
  turnsBefore: number;
}

/** 참여자 한 사람의 이름 · 얼굴 — 들어옴 줄(`joined`)의 `name` · `avatar`. */
export interface CastMember {
  name: string;
  avatar: Avatar | null;
}

export interface ThreadModel {
  turns: Turn[];
  /** 도는 턴이 하나라도 있나 — 참여자마다 하나씩 돌 수 있다. */
  running: boolean;
  /** 도는 턴의 참여자 handle — 턴이 선 차례다. */
  answering: string[];
  /** Session을 띄우거나 되살리는 중인가 — 띄우는 중 줄 뒤로 열림 · 죽음 · 닫힘 · 로그인 필요가 아직 오지 않았다. */
  connecting: boolean;
  /** 참여자 handle → 이름 · 얼굴(들어옴 줄). Host는 줄이 없어도 「Host」다. */
  cast: Record<string, CastMember>;
  notices: Notice[];
  system: SystemLine[];
  /** 부른 Agent의 턴 밖에서 선 호출 줄(사람의 「다시 맡기기」) — 시스템 줄처럼 턴 사이에 선다. */
  calls: LooseCall[];
  /** PR 카드(v1 티켓 36) — 줄이 온 차례다. */
  prs: PrCardEntry[];
  /** 답하지 않은 권한 요청 — 물은 차례다. 입력창 자리의 차례는 Work 만들기 카드까지 든 `asks`가 정한다(`asks.ts`). */
  pending: PendingPermission[];
  /**
   * 걸린 물음 모두 — 권한 요청과 Work 만들기 카드(v1 티켓 30) · Agent의 질문(v1 티켓 26)이 온 차례로 선다(§9 「같은 자리, 같은
   * 차례」). 맨 앞의 것이 입력창 자리에 선다(`askTurn`).
   */
  asks: PendingAsk[];
  /**
   * 지금 물음 묶음에서 이미 닫힌 물음의 수(v1 티켓 25) — 「2 / 2」의 앞수를 짓는다. 묶음은 걸린 물음이 하나라도 있는 동안 이어지고, 다
   * 닫히면 0으로 돌아간다. 사람이 답한 것도, 엔진이 닫은 것도, Session과 함께 사라진 것도 닫힌 것이다.
   */
  settled: number;
}

/** Work 만들기 카드의 Project 한 줄 — 등록된 Project마다 하나다. Host가 추천한 것이 먼저다. */
export interface WorkProjectChoice {
  slug: string;
  name: string;
  /** Project의 설명 — 추천하지 않은 줄의 오른쪽 글이다(「환불 버튼 화면」). 없으면 null이다. */
  description: string | null;
  /** Host가 고칠 Project로 추천했나 — 처음부터 골라 둔다. */
  recommended: boolean;
  /** Host가 고른 까닭(「refund.service.ts가 여기 있어요」). 추천하지 않았으면 null이다. */
  reason: string | null;
  /** 그 저장소에 이미 있는 브랜치들 — 브랜치 칸이 이름 규칙을 말한다. */
  branches: string[];
}

/** 답하지 않은 Work 만들기 카드 하나(기록의 `question` `asked`, `card: work`). */
export interface PendingWork {
  /** 물음 차례에서 권한 요청(`PendingPermission.card`)과 가르는 표다. */
  card: "work";
  /** 카드의 답 명령이 싣는 요청 id. */
  requestId: string;
  /** 제안한 참여자의 handle. */
  who: string;
  title: string;
  /** Work 폴더 이름 — 카드에서 고치지 않는다. */
  slug: string;
  /** 왜 Work로 묶는지 — 제목 옆에 선다. */
  reason: string;
  /** Host가 고른 브랜치 — Project가 없는 제안이면 null이다. */
  branch: string | null;
  projects: WorkProjectChoice[];
}

/**
 * 답하지 않은 Work 밖 Project 카드 하나(기록의 `question` `asked`, `card: project` — v1 티켓 32 · S22). Agent가 이 Work에 없는 Project를
 * 고치려 한다.
 */
export interface PendingProject {
  card: "project";
  /** 카드의 답 명령이 싣는 요청 id. */
  requestId: string;
  /** 물은 참여자의 handle. */
  who: string;
  /** 고치려는 Project의 slug와 이름. */
  project: string;
  name: string;
  /** 왜 그 Project를 고치려는지 — 물음 아래 줄. 없으면 null이다. */
  reason: string | null;
  /** 이 Thread가 이은 Work의 slug와 그 Project들 — 「아니요, api-server에서만 고쳐 주세요」. */
  work: string;
  workProjects: string[];
}

/** 입력창 자리에 서는 물음 하나 — 권한 요청이거나 Work 만들기 카드 · Agent의 질문 · Work 밖 Project 카드다(`card`로 가른다). */
export type PendingAsk = PendingPermission | PendingWork | PendingQuestion | PendingProject;

/** `question` 줄로 선 카드(Work 만들기 · Agent의 질문 · Work 밖 Project)인가 — 아니면 권한 요청이다. */
export function isCardAsk(ask: Pick<PendingAsk, "card">): ask is PendingWork | PendingQuestion | PendingProject {
  return ask.card === "work" || ask.card === "question" || ask.card === "project";
}

/** 권한 요청의 선택지 하나 — Runtime이 준 그대로(ACP `PermissionOption`). */
export interface PermissionOption {
  optionId: string;
  name: string;
  /** `allow_once` · `allow_always` · `reject_once` · `reject_always`. */
  kind: string;
}

/** 답하지 않은 질문 하나(기록의 `question` `asked`, `card: question` — v1 티켓 26). */
export interface PendingQuestion {
  /** 물음 차례에서 권한 요청 · Work 만들기 카드와 가르는 표다. */
  card: "question";
  /** 질문 답 명령이 싣는 요청 id — 권한 요청과 같은 대기 표에서 나와 Session마다 따로 센다. */
  requestId: string;
  /** 물은 참여자의 handle. */
  who: string;
  /** 그 질문을 낸 도구 요지. */
  toolCall: Json;
  questions: AskedQuestion[];
}

/** 답하지 않은 권한 요청 하나(기록의 `permission` `asked`). */
export interface PendingPermission {
  /** 권한 답 명령이 싣는 요청 id. */
  requestId: string;
  /** 물은 참여자의 handle — 권한 답 명령이 함께 싣는다. */
  who: string;
  options: PermissionOption[];
  /** 엔진이 채운 도구 요지(`toolCall`) — 없으면 요청 원문의 `toolCall`이다. */
  toolCall: Json;
  /** 그 요청의 도구 줄 — 흐름에 있으면(물음보다 먼저 온 `tool_call`) 그것이다. */
  tool: ToolEntry | null;
  /** 계획 승인 요청인가 — ACP 도구 kind `switch_mode`. */
  planReview: boolean;
  /** 판정이 세운 카드 종류(v1 티켓 22) — 판정 없이 물은 옛 기록이면 null이다. */
  card: "command" | "edit" | "plan" | null;
  /** 왜 묻는지 — Policy 이름(「매번 묻기」 · 「「prisma migrate」 실행 전에 묻기」). 없으면 null이다. */
  policy: string | null;
  /** 「다시 묻지 않기」를 고르면 줄 허락(규칙 이름들) — 비었으면 카드에 그 선택지가 없다(`ask_before`가 물었다 · 계획 · 그 밖의 도구). */
  grant: string[];
}

/** 턴 안의 줄이 되는 `session/update` 갈래. */
const TURN_UPDATES = new Set(["agent_message_chunk", "agent_thought_chunk", "tool_call", "plan_update", "plan"]);

/** Thread를 만드는 Agent — 모든 Thread가 이 참여자의 `joined`로 시작한다. */
const HOST = "host";

/** Agent 부르기 Thread 도구의 이름(v1 티켓 16) — 이 도구 줄은 호출 줄이 대신한다. */
const CALL_TOOL = "mcp__atelier-thread__call_agent";

/**
 * 사람에게 카드로 묻는 Thread 도구의 이름 — 카드 종류(`question` 줄의 `card`)마다 하나다. 답한 뒤 이 도구 줄은 결정 줄이 대신한다. Work
 * 만들기 제안(v1 티켓 30) · Project 고치기 시작(v1 티켓 32 — Work에 없는 Project면 묻는다).
 */
const CARD_TOOLS: Readonly<Record<"work" | "project", string>> = {
  work: "mcp__atelier-thread__propose_work",
  project: "mcp__atelier-thread__start_editing",
};

/**
 * 미뤄 실린 도구(Thread 도구 · 사용자 MCP)를 들이는 Claude Code 도구(v1 티켓 20) — 일이 아니라 도구 싣기라 작업 로그에 세우지 않는다.
 * 진짜 claude 2.1.309는 Thread 도구를 부르기 전에 늘 이것(`select:mcp__atelier-thread__…`)을 먼저 부른다.
 */
const TOOL_SEARCH = "ToolSearch";

/**
 * Claude Code가 계획 모드에서 제 계획을 적는 파일(`~/.claude/plans/<이름>.md`, v1 티켓 27) — 진짜 claude 2.1.309는 계획을 이 파일에
 * 묻지 않고 쓴 뒤 `ExitPlanMode`로 묻는다. 계획은 계획 넘어가기 카드가 보이므로 작업 로그 · 바뀐 파일에 세우지 않는다 — 「계획만」인데
 * 「파일 1개 바꿈」이 서지 않게.
 */
const PLAN_FILE = /\/\.claude\/plans\/[^/]+\.md$/;

/**
 * 기록 줄을 화면 모델로 접는다. `goneThrough`는 Thread가 「떠 있는 Session이 없다」고 말할 때의 마지막 seq다 — 그 seq까지의 줄을
 * 적던 프로세스는 이미 없다(앱을 다시 켬). 그 뒤의 줄(되살린 뒤)은 여느 때처럼 접는다. 떠 있으면 `null`이다.
 */
export function foldThread(lines: readonly RecordLine[], goneThrough: number | null = null): ThreadModel {
  const turns: Turn[] = [];
  // 참여자마다 열린 턴 — 열쇠는 `who`(받는 이를 모르는 옛 `sent`는 빈 글자다, `openFor`).
  const open = new Map<string, Turn>();
  // 도는 턴에서 `failed`로 닫힌 뒤 아무 일도 이어지지 않은 도구 줄들(턴마다) — 그 턴이 우리의 멈춤으로 끝나면 멈춤이다.
  const closedLast = new Map<Turn, ToolEntry[]>();
  // 권한 요청(`askKey`) → 그 요청의 도구 줄 id · 물음, 그리고 멈추기로 요청이 거둬진 도구 줄 id들.
  const askedFor = new Map<string, { tool: string | null; request: Omit<PendingPermission, "tool"> }>();
  const withdrawnByStop = new Set<string>();
  const deniedTools = new Set<string>();
  // 판정이 묻지 않고 허용한 도구 줄 id → 까닭 — 도구 줄이 판정 줄보다 늦게 와도 든다.
  const allowedTools = new Map<string, string>();
  // 답하지 않은 물음 — 온 차례다(`askKey`, v1 티켓 25). 닫히면 지금 묶음의 닫힌 수가 오르고, 다 닫히면 묶음이 끝난다. Work 만들기
  // 카드(v1 티켓 30 · 32) · 질문(v1 티켓 26)도 같은 차례에 선다.
  const pending = new Map<string, Omit<PendingPermission, "tool"> | PendingWork | PendingQuestion | PendingProject>();
  // 질문(`askKey`) → 그 질문 줄, 그리고 질문 줄이 대신한 도구 줄 id들.
  const questions = new Map<string, QuestionEntry>();
  const questionTools = new Set<string>();
  let settled = 0;
  const dropAsk = (key: string) => {
    if (!pending.delete(key)) return;
    settled = pending.size === 0 ? 0 : settled + 1;
  };
  // 카드(`askKey`) → 그 카드를 낸 도구 줄 id(짝을 찾았으면) — Work 만들기 · Work 밖 Project.
  const proposedBy = new Map<string, string | null>();
  let planCard: Held<PlanEntry> | null = null;
  let checklist: Held<ChecklistEntry> | null = null;
  const planReviews = new Set<string>();
  const cast: Record<string, CastMember> = { [HOST]: { name: "Host", avatar: null } };
  const start = (
    key: string,
    sent: string | null,
    at: string,
    who: string | null,
    attachments: Attachment[] = [],
    assigned: CallEntry | null = null,
    quote: Quote | null = null,
  ): Turn => {
    const previous = turns[turns.length - 1];
    const turn: Turn = {
      key,
      who,
      namesWho: true,
      sent,
      attachments,
      quote,
      selfContinued: sent === null && assigned === null,
      startedAt: at,
      answeredAt: null,
      entries: [],
      end: null,
      assigned,
    };
    // 사람 말 없이 이어진 턴 — 앞 턴과 같은 이면 이름 줄을 다시 쓰지 않는다. 맡은 턴은 맡긴 말로 선 턴이다.
    if (turn.selfContinued && previous && previous.who === who) turn.namesWho = false;
    turns.push(turn);
    open.set(who ?? "", turn);
    return turn;
  };
  // 그 참여자의 열린 턴 — 없고 받는 이를 모르는 열린 턴이 있으면 그 턴이 이 참여자의 것이다(`to` 없는 옛 `sent`).
  const openFor = (who: string | null): Turn | null => {
    const own = open.get(who ?? "");
    if (own || who === null) return own ?? null;
    const anonymous = open.get("");
    if (!anonymous) return null;
    open.delete("");
    open.set(who, anonymous);
    return anonymous;
  };
  const close = (turn: Turn) => {
    for (const [key, one] of open) if (one === turn) open.delete(key);
    closedLast.delete(turn);
  };
  // 답한 이를 턴에 적는다 — 보낸 말의 받는 이보다 실제로 답한 줄이 이긴다.
  const answer = (turn: Turn, line: RecordLine) => {
    if (line.who) turn.who = line.who;
    if (turn.answeredAt === null) turn.answeredAt = line.at;
  };
  const connecting = new Set<string>();
  const notices: Notice[] = [];
  const system: SystemLine[] = [];
  const prs: PrCardEntry[] = [];
  // 부르기 id → 호출 줄, 호출 줄이 대신한 Thread 도구 줄 id들, 턴 밖의 호출 줄.
  const calls = new Map<string, CallEntry>();
  const absorbed = new Set<string>();
  const loose: LooseCall[] = [];
  const notice = (seq: number, kind: Notice["kind"], words: string, who: string | null) =>
    notices.push({ key: `n${seq}`, kind, text: words, handle: who ?? HOST, turnsBefore: turns.length });
  const say = (
    seq: number,
    kind: SystemLine["kind"],
    handle: string | null,
    before: string,
    name: string,
    after: string,
    avatar?: Avatar | null,
    code?: string | null,
  ) =>
    system.push({
      key: `s${seq}`,
      kind,
      handle,
      before,
      name,
      after,
      ...(avatar !== undefined && { avatar }),
      ...(code !== undefined && { code }),
      turnsBefore: turns.length,
    });
  // 그 참여자의 프로세스가 사라졌다(`who`가 `undefined`면 모두 — 앱을 다시 켬) — 열린 턴은 끝났고, 걸린 권한 요청에는 답할 곳이 없고,
  // 끝을 받지 못한 도구 줄은 끊겼다.
  const vanish = (at: string, error: string, who?: string | null) => {
    const mine = (one: string | null) => who === undefined || one === (who ?? HOST);
    for (const [id, request] of pending) if (mine(request.who)) dropAsk(id);
    if (who === undefined) connecting.clear();
    else connecting.delete(who ?? HOST);
    for (const turn of turns) {
      if (!mine(turn.who ?? HOST)) continue;
      for (const entry of turn.entries) if (entry.kind === "tool" && !toolDone(entry)) entry.cut = true;
    }
    // 앱이 꺼지면 부르기를 기다리던 엔진도 함께 꺼졌다 — 끝 줄이 오지 않는다.
    if (who === undefined) for (const call of calls.values()) if (call.end === null) call.cut = true;
    const ending = who === undefined ? [...open.values()] : [openFor(who ?? HOST)].filter((turn) => turn !== null);
    for (const turn of ending) {
      turn.end = {
        stopReason: null,
        durationMs: Math.max(0, Date.parse(at) - Date.parse(turn.startedAt)) || 0,
        cancelledByUs: false,
        error,
        at,
      };
      close(turn);
    }
  };
  let gone = goneThrough === null;
  let lastAt = "";

  for (const line of lines) {
    const previousAt = lastAt || line.at;
    if (!gone && line.seq > (goneThrough ?? 0)) {
      vanish(previousAt, GONE_WITH_APP);
      gone = true;
    }
    lastAt = line.at;
    const payload = isObject(line.payload) ? line.payload : {};
    switch (line.kind) {
      case "sent":
        start(
          `t${line.seq}`,
          text(payload.text) ?? "",
          line.at,
          text(payload.to),
          attachmentsOf(payload.attachments),
          null,
          quoteOf(payload.quote),
        );
        break;
      case "update": {
        const update = isObject(payload.update) ? payload.update : null;
        const kind = update && text(update.sessionUpdate);
        if (!update || !kind) break;
        if (kind === "tool_call_update") {
          // 늦게 온 update는 그 도구 줄을 찾아 붙는다 — 턴이 이미 끝났어도 같다.
          const id = text(update.toolCallId);
          if (id && (planReviews.has(id) || absorbed.has(id) || questionTools.has(id))) break;
          const mine = openFor(line.who ?? null);
          let tool = id ? findTool(turns, id) : null;
          if (tool) tool.call = mergeCall(tool.call, update);
          else if (id && mine) {
            tool = newTool(`u${line.seq}`, id, update, line.at);
            mine.entries.push(tool);
          }
          if (!tool) break;
          tool.output += outputOf(update);
          if (tool.endedAt === null && toolDone(tool)) tool.endedAt = line.at;
          if (deniedTools.has(tool.toolCallId)) tool.denied = true;
          tool.allowed = allowedTools.get(tool.toolCallId) ?? tool.allowed;
          if (mine && update.status === "failed" && mine.entries.includes(tool)) {
            closedLast.set(mine, [...(closedLast.get(mine) ?? []), tool]);
          }
          break;
        }
        if (kind === "session_info_update" && outOfTurnStarted(update)) {
          if (!openFor(line.who ?? null)) start(`o${line.seq}`, null, line.at, line.who ?? null);
          break;
        }
        if (!TURN_UPDATES.has(kind)) break;
        const called = text(update.toolCallId) ?? "";
        if (kind === "tool_call" && (planReviews.has(called) || questionTools.has(called))) break;
        if (kind === "tool_call" && (toolNameOf(update) === TOOL_SEARCH || writesPlanFile(update))) {
          absorbed.add(called);
          break;
        }
        const turn: Turn = openFor(line.who ?? null) ?? start(`o${line.seq}`, null, line.at, line.who ?? null);
        answer(turn, line);
        closedLast.delete(turn);
        if (kind === "plan_update") {
          const body = isObject(update.plan) && update.plan.type === "markdown" ? text(update.plan.content) : null;
          if (body === null) break;
          planCard = settle(planCard, turn, () => ({ kind: "plan", key: `p${line.seq}`, text: body }), null);
          planCard.entry.text = body;
          break;
        }
        if (kind === "plan") {
          const items = checklistOf(update.entries);
          if (items.length === 0) {
            if (checklist) drop(checklist.turn, checklist.entry);
            checklist = null;
            break;
          }
          checklist = settle(checklist, turn, () => ({ kind: "checklist", key: `k${line.seq}`, items }), null);
          checklist.entry.items = items;
          break;
        }
        if (kind === "tool_call") {
          const tool = newTool(`c${line.seq}`, text(update.toolCallId) ?? `seq-${line.seq}`, update, line.at);
          if (toolDone(tool)) tool.endedAt = line.at;
          tool.allowed = allowedTools.get(tool.toolCallId) ?? null;
          // 이 도구 줄의 부르기가 먼저 섰다(두 줄이 엇갈려 적혔다) — 호출 줄이 이미 그 자리다.
          const call = isCallTool(tool) ? unpaired(turn, tool) : null;
          if (call) {
            call.toolCallId = tool.toolCallId;
            absorbed.add(tool.toolCallId);
            break;
          }
          const asking = cardOfTool(tool);
          if (asking) {
            // 카드 줄이 먼저 왔다 — 그 카드의 도구 줄이 이것이다. 이미 답했으면 결정 줄이 그 자리다.
            const waiting = [...pending].find(
              ([key, one]) => one.card === asking && one.who === (turn.who ?? HOST) && proposedBy.get(key) === null,
            );
            if (waiting) proposedBy.set(waiting[0], tool.toolCallId);
            const choice = turn.entries.find((entry) => choiceCard(entry) === asking && "toolCallId" in entry && entry.toolCallId === null);
            if (!waiting && choice && (choice.kind === "work-choice" || choice.kind === "project-choice")) {
              choice.toolCallId = tool.toolCallId;
              absorbed.add(tool.toolCallId);
              break;
            }
          }
          turn.entries.push(tool);
          break;
        }
        const content = isObject(update.content) ? update.content : {};
        const chunk = content.type === "text" ? text(content.text) : null;
        if (chunk === null) break;
        appendChunk(turn, kind === "agent_message_chunk" ? "message" : "thought", text(update.messageId), chunk, line.seq);
        break;
      }
      case "turn-end": {
        let turn = openFor(line.who ?? null);
        if (!turn && payload.outOfTurn === true) turn = start(`o${line.seq}`, null, line.at, line.who ?? null);
        if (!turn) break;
        const error = isObject(payload.error) ? text(payload.error.message) : null;
        turn.end = {
          stopReason: text(payload.stopReason),
          durationMs: typeof payload.durationMs === "number" ? payload.durationMs : 0,
          cancelledByUs: payload.cancelledByUs === true,
          error,
          at: line.at,
        };
        if (turn.end.stopReason === "cancelled" && turn.end.cancelledByUs) {
          markStopped(turn, closedLast.get(turn) ?? [], withdrawnByStop);
        }
        if (payload.outOfTurn === true) turn.selfContinued = true;
        close(turn);
        break;
      }
      case "permission": {
        const requestId = text(payload.requestId);
        if (!requestId) break;
        const key = askKey(line.who ?? HOST, requestId);
        if (payload.state === "asked") {
          const id = askedToolId(payload);
          const request = askedOf(requestId, line.who ?? HOST, payload);
          askedFor.set(key, { tool: id, request });
          pending.set(key, request);
          if (request.planReview && id) {
            planReviews.add(id);
            const home = toolHome(turns, id);
            const turn = home?.turn ?? openFor(line.who ?? null) ?? turns[turns.length - 1];
            const rawInput = isObject(request.toolCall.rawInput) ? request.toolCall.rawInput : {};
            const body = text(rawInput.plan);
            if (turn && body !== null) {
              planCard = settle(planCard, turn, () => ({ kind: "plan", key: `p${line.seq}`, text: body }), home?.tool ?? null);
              planCard.entry.text = body;
            } else if (home) drop(home.turn, home.tool);
          }
          break;
        }
        dropAsk(key);
        const asked = askedFor.get(key);
        const chosen = asked?.request.options.find((option) => option.optionId === payload.optionId);
        if (payload.state === "answered" && asked?.tool) {
          // 거절 갈래로 답했다 — 그 도구는 돌지 않는다(「실행하지 않음 · 내가 거절함」).
          if (chosen?.kind.startsWith("reject")) {
            deniedTools.add(asked.tool);
            const tool = findTool(turns, asked.tool);
            if (tool) tool.denied = true;
          }
        }
        if (payload.state === "decided") {
          // 판정이 닫았다 — 받은 자리의 판정이면 요청이 같은 줄에, 걸린 물음을 닫았으면 물음 줄에 있다(v1 티켓 18 · 22).
          const options = isObject(payload.request)
            ? askedOf(requestId, line.who ?? HOST, payload).options
            : (asked?.request.options ?? []);
          const picked = options.find((option) => option.optionId === payload.optionId);
          const id = askedToolId(payload) ?? asked?.tool ?? null;
          const reason = text(payload.reason);
          if (id && reason !== null && picked?.kind.startsWith("allow")) {
            allowedTools.set(id, reason);
            const tool = findTool(turns, id);
            if (tool) tool.allowed = reason;
          }
        }
        // 사람이 고른 것은 물은 참여자의 열린 턴에 결정 줄로 남는다.
        const home = payload.state === "answered" && asked ? openFor(line.who ?? null) : null;
        if (home && asked) {
          home.entries.push({
            kind: "decision",
            key: `d${line.seq}`,
            allowed: chosen?.kind.startsWith("allow") ?? false,
            granted: grantedOf(payload.granted),
            words: nonEmpty(payload.words),
            toolCall: asked.request.toolCall,
            planReview: asked.request.planReview,
          });
        }
        if (payload.state === "withdrawn" && payload.reason === "stopped" && asked?.tool) {
          withdrawnByStop.add(asked.tool);
          const tool = findTool(turns, asked.tool);
          if (tool?.stop === "ran-on") tool.stop = "stopped";
        }
        break;
      }
      // 질문 줄 — Agent의 질문(`card: question`, v1 티켓 26)과 Thread 도구가 세운 카드 — Work 만들기(`card: work`, v1 티켓 30) · Work 밖
      // Project(`card: project`, v1 티켓 32)다.
      case "question": {
        const requestId = text(payload.requestId);
        if (!requestId) break;
        const who = line.who ?? HOST;
        const key = askKey(who, requestId);
        if (payload.card === "question") {
          if (payload.state === "asked") {
            const toolCall = isObject(payload.toolCall) ? payload.toolCall : {};
            pending.set(key, { card: "question", requestId, who, toolCall, questions: questionsOf(payload.questions) });
            const entry: QuestionEntry = { kind: "question", key: `q${line.seq}`, choice: null, answers: [] };
            questions.set(key, entry);
            // 그 질문을 낸 도구 줄 자리에 선다 — 같은 일이 두 줄로 서지 않게. 도구 줄이 아직 없으면 물은 이의 턴 끝이다.
            const id = text(toolCall.toolCallId);
            if (id) questionTools.add(id);
            const home = id ? toolHome(turns, id) : null;
            if (home) home.turn.entries.splice(home.turn.entries.indexOf(home.tool), 1, entry);
            else (openFor(who) ?? start(`o${line.seq}`, null, line.at, who)).entries.push(entry);
            break;
          }
          dropAsk(key);
          const entry = questions.get(key);
          if (!entry) break;
          if (payload.state === "answered") {
            entry.choice = payload.choice === "later" ? "later" : "answer";
            entry.answers = entry.choice === "answer" ? answersOf(payload.answers) : [];
          } else {
            // 거둬졌다 — 답하지 않은 질문은 흐름에 남지 않는다(그 턴의 끝이 멈춤 · 끊김을 말한다).
            for (const turn of turns) drop(turn, entry);
          }
          break;
        }
        // Thread 도구가 세운 카드 — 제안 · 답 · 거둠. Work 만들기(v1 티켓 30)와 Work 밖 Project(v1 티켓 32)가 같은 길이다.
        const card = payload.card === "work" || payload.card === "project" ? payload.card : null;
        if (!card) break;
        if (payload.state === "asked") {
          pending.set(key, card === "work" ? proposalOf(requestId, who, payload) : outsideOf(requestId, who, payload));
          const turn = openFor(who);
          const tool = [...(turn?.entries ?? [])]
            .reverse()
            .find(
              (entry): entry is ToolEntry =>
                entry.kind === "tool" && cardOfTool(entry) === card && ![...proposedBy.values()].includes(entry.toolCallId),
            );
          proposedBy.set(key, tool?.toolCallId ?? null);
          break;
        }
        const asked = pending.get(key);
        dropAsk(key);
        if (payload.state !== "answered" || asked?.card !== card) break;
        const toolCallId = proposedBy.get(key) ?? null;
        const created = payload.choice === "create";
        const picked = payload.choice === "attach" || payload.choice === "read" ? payload.choice : "decline";
        const choice: WorkChoiceEntry | ProjectChoiceEntry =
          card === "work"
            ? {
                kind: "work-choice",
                key: `w${line.seq}`,
                created,
                projects:
                  created && Array.isArray(payload.projects) ? payload.projects.filter((one): one is string => typeof one === "string") : [],
                branch: created ? text(payload.branch) : null,
                toolCallId,
              }
            : { kind: "project-choice", key: `w${line.seq}`, choice: picked, project: text(payload.project) ?? "", toolCallId };
        const home = toolCallId ? toolHome(turns, toolCallId) : null;
        if (home && toolCallId) {
          home.turn.entries.splice(home.turn.entries.indexOf(home.tool), 1, choice);
          absorbed.add(toolCallId);
        } else openFor(who)?.entries.push(choice);
        break;
      }
      // Work 연결(v1 티켓 30) — 「Work 환불 API 버그 수정을 만들고 이 Thread에 연결함」. worktree 생성(v1 티켓 32) — 「api-server에 worktree를
      // 만듦 · fix/refund-api」. Project 붙임(`attached`)은 시스템 줄이 아니다 — 카드의 결정 줄 「web-app을 이 Work에 붙임」이 말한다.
      case "work": {
        const title = nonEmpty(payload.title) ?? nonEmpty(payload.slug);
        if (payload.state === "created" && title) say(line.seq, "work", null, "Work ", title, `${particle(title, "을", "를")} 만들고 이 Thread에 연결함`);
        const project = nonEmpty(payload.project);
        if (payload.state === "worktree" && project) {
          const branch = nonEmpty(payload.branch);
          say(line.seq, "worktree", null, "", project, branch ? "에 worktree를 만듦 ·" : "에 worktree를 만듦", undefined, branch);
          // 그 Project를 고치기 시작한 도는 턴(그 도구 줄이나 카드의 결정 줄이 있다)의 머리에 선다. `work` 줄은 누가 적지 않으므로 못
          // 찾으면 마지막에 열린 턴이고, 열린 턴이 없으면(옛 기록) 턴 사이다.
          const turns = [...open.values()];
          const home = turns.find((turn) => turn.entries.some((entry) => startedHere(entry, project))) ?? turns[turns.length - 1];
          if (home) system[system.length - 1].turn = home.key;
        }
        break;
      }
      case "session": {
        switch (payload.state) {
          case "spawning":
            vanish(previousAt, GONE_WITH_APP, line.who ?? null);
            connecting.add(line.who ?? HOST);
            break;
          case "opened":
            connecting.delete(line.who ?? HOST);
            if (payload.how === "fresh") notice(line.seq, "fresh", FRESH_NOTICE, line.who ?? null);
            break;
          case "login-required":
            connecting.delete(line.who ?? HOST);
            break;
          case "version-warning":
            notice(line.seq, "version", versionNotice(text(payload.agentVersion), payload.supportedMajor), line.who ?? null);
            break;
          case "died":
          case "closed":
            vanish(line.at, payload.state === "closed" ? "Session이 닫혔어요" : "Claude Code가 끝났어요", line.who ?? null);
            if (payload.state === "died") notice(line.seq, "died", diedNotice(text(payload.reason)), line.who ?? null);
            break;
          default:
            break;
        }
        break;
      }
      case "call": {
        const id = text(payload.id);
        const to = text(payload.to);
        if (!id || !to) break;
        const from = text(payload.from) ?? line.who ?? HOST;
        let call = calls.get(id);
        if (!call) {
          call = {
            kind: "call",
            key: `a${line.seq}`,
            id,
            from,
            to,
            text: text(payload.text) ?? "",
            startedAt: line.at,
            work: null,
            end: null,
            cut: false,
            toolCallId: null,
          };
          calls.set(id, call);
          const turn = openFor(from);
          if (turn) {
            answer(turn, line);
            closedLast.delete(turn);
            place(turn, call, absorbed);
          } else loose.push({ entry: call, turnsBefore: turns.length });
        }
        if (payload.state === "started" && call.work === null) {
          call.work = start(`a${line.seq}`, null, line.at, to, [], call).entries;
        } else if (payload.state === "ended") {
          const outcome = payload.outcome === "answered" || payload.outcome === "stopped" ? payload.outcome : "failed";
          call.end = {
            outcome,
            answer: outcome === "answered" ? (text(payload.answer) ?? "") : null,
            reason: outcome === "answered" ? null : (text(payload.reason) ?? null),
            durationMs: typeof payload.durationMs === "number" ? payload.durationMs : 0,
          };
        }
        break;
      }
      case "title": {
        const title = nonEmpty(payload.title);
        if (title) say(line.seq, "title", null, "Thread 이름을 ", title, `${particle(title, "으로", "로")} 바꿈`);
        break;
      }
      case "joined":
      case "left": {
        const handle = text(payload.handle) ?? line.who ?? null;
        if (line.kind === "joined" && handle && handle !== HOST) {
          cast[handle] = { name: nonEmpty(payload.name) ?? handle, avatar: avatarOf(payload.avatar) };
        }
        // 모든 Thread가 Host의 들어옴으로 시작한다 — 세우지 않는다(머리말).
        if (line.kind === "joined" && handle === HOST) break;
        const name = nonEmpty(payload.name) ?? (handle ? cast[handle]?.name : null) ?? handle;
        if (!name) break;
        const verb = line.kind === "joined" ? "참여함" : "나감";
        say(line.seq, line.kind, handle, "", name, `${particle(name, "이", "가")} ${verb}`);
        break;
      }
      // 사람이 물어보는 정도를 바꿈(v1 티켓 23) — 「Policy를 편집은 허용으로 바꿈 · 이 Work에만」. Work에 이은 Thread의 정도는 그 Work의
      // 것이라 같은 Work의 다른 Thread에도 든다는 것을 꼬리가 말한다.
      case "mode": {
        const level = askLevelOf(payload.mode);
        if (!level) break;
        const scope = nonEmpty(payload.work) ? " · 이 Work에만" : "";
        say(line.seq, "mode", null, "Policy를 ", level.name, `${particle(level.name, "으로", "로")} 바꿈${scope}`);
        break;
      }
      // 그 Work의 PR이 처음 보였거나 상태가 바뀜(v1 티켓 36) — 엔진이 그 Work에서 가장 최근에 말한 Thread에 남긴 줄이 PR 카드다.
      case "pr": {
        const pr = prLineOf(payload);
        if (pr) prs.push({ key: `p${line.seq}`, pr, latest: false, turnsBefore: turns.length });
        break;
      }
      // Agent가 Thread 도구 「Agent 저장」으로 Library에 Agent를 둠(v1 티켓 19) — 그 Agent는 들어오지 않았다. 부르면 그때 들어온다.
      case "library": {
        const handle = nonEmpty(payload.handle);
        const name = nonEmpty(payload.name) ?? handle;
        if (!handle || !name) break;
        say(line.seq, "library", handle, "Library에 ", name, `${particle(name, "을", "를")} 저장함`, avatarOf(payload.avatar));
        break;
      }
      default:
        break;
    }
  }
  if (!gone) vanish(lastAt, GONE_WITH_APP);
  for (const [at, card] of prs.entries()) {
    const same = (one: PrCardEntry) => one.pr.project === card.pr.project && one.pr.number === card.pr.number;
    card.latest = !prs.slice(at + 1).some(same);
  }
  // Host의 답에는 이름 줄이 없다(02 구현 스펙 §8) — 다 접은 뒤에 본다. 말한 이는 답한 줄이 정하므로(`answer`) 턴이 설 때는 아직
  // 모를 수 있다(받는 이를 모르는 옛 `sent`).
  for (const turn of turns) if (turn.who === HOST) turn.namesWho = false;
  const answering = turns.filter((turn) => [...open.values()].includes(turn)).map((turn) => turn.who ?? HOST);
  const asks = [...pending.values()].map((one): PendingAsk => {
    if (one.card === "work" || one.card === "question" || one.card === "project") return one;
    const id = text(one.toolCall.toolCallId);
    const tool = id ? findTool(turns, id) : null;
    if (tool) tool.asking = true;
    return { ...one, tool };
  });
  return {
    turns,
    running: open.size > 0,
    answering: [...new Set(answering)],
    connecting: connecting.size > 0,
    cast,
    notices,
    system,
    calls: loose,
    prs,
    pending: asks.filter((one): one is PendingPermission => !isCardAsk(one)),
    asks,
    settled,
  };
}

/**
 * 흐름에 서는 것 — 그리는 쪽(`ThreadFlow`)이 이것만 읽는다. `turnsBefore`는 서는 턴의 수로 다시 센다.
 *
 * - **온 흐름**(`only`가 null) — 불린 Agent의 맡은 턴은 **답을 받은 뒤에만** 그 Agent의 말로 선다(캔버스 화면 3 「리뷰어」). 일하는
 *   동안은 부른 턴의 호출 줄이 그 일(지금 도구 · 경과)을 말하고, 답하지 못했으면 호출 줄이 까닭을 말한다 — 같은 일이 두 자리에서
 *   돌거나 같은 실패가 두 번 서지 않게.
 * - **Session 보기**(`only`가 handle — 구현 스펙 §8 · S37 「Session 열기」) — 같은 화면에서 그 참여자의 줄만 거른다: 그의 턴(맡은 턴은
 *   일하는 동안에도), 그가 들고 난 시스템 줄, 그 Session의 상태 줄, 그가 턴 밖에서 낸 부르기. 이름 바꾸기는 Thread의 일이라 빠진다.
 * - **「답하는 중」**(캔버스 Messages 보드 「답하는 중」 · Motion 보드 「Agent 참여」) — 서는 턴 가운데 **흐름 끝에서 답이 보이지 않는**
 *   도는 턴의 참여자다: 아직 아무 줄도 오지 않은 턴(보낸 말 · 참여 줄 바로 뒤)과 흐름 끝이 아닌 자리에서 도는 턴. 흐름 끝의 턴이
 *   답 · 생각 · 도구 줄을 흘리고 있으면 그 턴의 이름 줄 · 머리줄이 이미 말하므로 뺀다. 서지 않는 턴(일하는 맡은 턴)도 뺀다 — 호출
 *   줄이 말한다. 승인을 기다리는 참여자도 뺀다 — 답하는 것이 아니라 사람을 기다리고, 그 턴의 머리줄이 「승인을 기다립니다」를 말한다
 *   (v1 티켓 25 — 두 Agent가 함께 물으면 앞의 턴이 흐름 끝이 아니다). 아무도 없으면 `null`이다. 여럿이면 턴이 선 차례로 모두 든다
 *   (「리뷰어와 테스터가 답하는 중」).
 */
export interface Flow {
  turns: Turn[];
  notices: Notice[];
  system: SystemLine[];
  calls: LooseCall[];
  /** PR 카드 — 온 흐름에만 선다(그 Agent의 줄이 아니라 Work의 일이다). */
  prs: PrCardEntry[];
  answering: string[] | null;
}

export function flowOf(model: ThreadModel, only: string | null = null): Flow {
  const shows = (turn: Turn) =>
    only === null ? turn.assigned === null || turn.assigned.end?.outcome === "answered" : (turn.who ?? HOST) === only;
  // 앞 턴 n개 가운데 서는 턴의 수.
  const shownBefore: number[] = [0];
  for (const turn of model.turns) shownBefore.push(shownBefore[shownBefore.length - 1] + (shows(turn) ? 1 : 0));
  const recount = <T extends { turnsBefore: number }>(one: T): T => ({ ...one, turnsBefore: shownBefore[one.turnsBefore] });
  const turns = model.turns.filter(shows);
  const last = turns[turns.length - 1];
  const speaking = last && last.end === null && last.entries.length > 0 ? (last.who ?? HOST) : null;
  const running = new Set(turns.filter((turn) => turn.end === null).map((turn) => turn.who ?? HOST));
  const asking = new Set(model.asks.map((request) => request.who));
  const answering = model.answering.filter((who) => who !== speaking && running.has(who) && !asking.has(who));
  return {
    turns,
    notices: model.notices.filter((one) => only === null || one.handle === only).map(recount),
    system: model.system.filter((line) => only === null || line.handle === only).map(recount),
    calls: model.calls.filter((one) => only === null || one.entry.from === only).map(recount),
    prs: only === null ? model.prs.map(recount) : [],
    answering: answering.length > 0 ? answering : null,
  };
}

/** 온 흐름의 「답하는 중」 줄에 설 참여자(`flowOf`의 `answering`). */
export function answeringLine(model: ThreadModel): string[] | null {
  return flowOf(model).answering;
}

/** 들어옴 줄의 `avatar` — 모양 · 색 글자만 좁힌다(푸는 일은 `faces.ts`). */
function avatarOf(value: unknown): Avatar | null {
  if (!isObject(value)) return null;
  return { shape: text(value.shape), color: text(value.color) };
}

/** 앱을 다시 켜기 전에 끊긴 턴의 끝 까닭 — 앱이 꺼지면 Session도 함께 꺼진다. */
export const GONE_WITH_APP = "앱이 꺼지며 끊겼어요";

/** 「새로 시작함」 상태 줄. */
const FRESH_NOTICE = "새로 시작함 — 앞의 맥락을 잇지 못해 새 Session으로 열었어요";

function diedNotice(reason: string | null): string {
  return `${reason ?? "Claude Code가 끝났어요"} · 다음 말에서 다시 띄워요`;
}

function versionNotice(version: string | null, major: unknown): string {
  const supported = typeof major === "number" ? ` — 확인한 판은 ${major}.x` : "";
  return `확인하지 않은 Claude Code 판이에요(${version ?? "판 모름"}${supported}). 그대로 이어 가요`;
}

/**
 * 이름 뒤의 조사 — 마지막 글자가 받침 있는 한글이면 `withFinal`, 아니면 `without`이다. 「으로/로」는 ㄹ 받침도 「로」다. 한글이
 * 아닌 끝 글자(영문 · 숫자)는 읽는 끝소리로 고른다(아래). 끝의 닫는 괄호 · 따옴표 · 문장 부호는 읽지 않는다 — 「환불 버그 (#31)」은
 * 「31」로 끝난다(v1 티켓 39).
 */
export function particle(word: string, withFinal: string, without: string): string {
  const trimmed = word.trim().replace(CLOSING, "");
  const code = trimmed.codePointAt(trimmed.length - 1) ?? 0;
  if (code < 0xac00 || code > 0xd7a3) {
    // 영어 · 숫자(Project slug · 「v1」)는 읽는 끝소리로 고른다 — 받침이 분명한 것만(web-app → 「웹앱」, helm → 「헬름」, 3 → 「삼」).
    // 끝소리가 갈리는 글자(t · s · r …)는 받침 없음으로 둔다(Host → 「호스트가」).
    const last = trimmed.slice(-1).toLowerCase();
    if (!LATIN_FINALS.has(last)) return without;
    return withFinal === "으로" && LATIN_RIEUL.has(last) ? without : withFinal;
  }
  const final = (code - 0xac00) % 28;
  if (final === 0) return without;
  if (withFinal === "으로" && final === 8) return without;
  return withFinal;
}

/** 이름 끝에서 건너뛰는 닫는 괄호 · 따옴표 · 문장 부호. */
const CLOSING = /[)\]}」』"'”’.,!?…\s]+$/u;
/** 읽으면 받침이 있는 영어 · 숫자 끝 글자 — b · k · m · n · p · l(ㄹ), 0(영) · 1(일) · 3(삼) · 6(육) · 7(칠) · 8(팔). `ng`는 g로 끝난다. */
const LATIN_FINALS = new Set(["b", "k", "l", "m", "n", "p", "0", "1", "3", "6", "7", "8"]);
/** 그 가운데 받침이 ㄹ인 것 — 「으로」 대신 「로」다. */
const LATIN_RIEUL = new Set(["l", "1", "7", "8"]);

/**
 * 같은 기록 줄을 한 번만 접는다 — Thread 몸(흐름 · 입력창 · 알약)과 사이드바가 같은 줄을 읽는다. 기록 줄 배열은 바뀔 때마다 새
 * 배열이라(`thread-store.ts`) 그 정체가 열쇠다. 접은 값은 읽기만 한다.
 */
const folded = new WeakMap<readonly RecordLine[], { goneThrough: number | null; model: ThreadModel }>();
export function foldOf(lines: readonly RecordLine[], goneThrough: number | null): ThreadModel {
  const hit = folded.get(lines);
  if (hit && hit.goneThrough === goneThrough) return hit.model;
  const model = foldThread(lines, goneThrough);
  folded.set(lines, { goneThrough, model });
  return model;
}

/** `sent`의 `attachments` 칸 → 첨부들. 경로가 글이 아닌 칸은 버린다 — 칩이 그릴 수 없다. */
function attachmentsOf(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): Attachment[] => {
    if (!isObject(item)) return [];
    const path = text(item.path);
    if (path === null) return [];
    return [{ path, size: typeof item.size === "number" ? item.size : null, folder: item.folder === true }];
  });
}

/** `sent`의 `quote` 칸 → 인용(엔진 `atelier_acp::Quote` 꼴). 칸이 하나라도 틀리면 없음이다 — 말풍선 위에 그릴 수 없다. */
function quoteOf(value: unknown): Quote | null {
  if (!isObject(value)) return null;
  const file = text(value.file);
  const quoted = text(value.text);
  const { start, end } = value;
  if (file === null || quoted === null || typeof start !== "number" || typeof end !== "number") return null;
  return { file, start, end, text: quoted };
}

/** 도구 호출의 Claude Code 도구 이름 — `_meta.claudeCode.toolName`, 없으면 제목. */
function toolNameOf(call: Json): string | null {
  const meta = isObject(call._meta) ? call._meta : {};
  const claudeCode = isObject(meta.claudeCode) ? meta.claudeCode : {};
  return text(claudeCode.toolName) ?? text(call.title);
}

/** Claude Code의 계획 파일에 쓰는 도구 줄인가 — 편집 도구이고, 다루는 파일(`locations` · 입력의 `file_path`)이 모두 계획 파일이다. */
function writesPlanFile(call: Json): boolean {
  if (call.kind !== "edit") return false;
  const input = isObject(call.rawInput) ? call.rawInput : {};
  const located = Array.isArray(call.locations) ? call.locations.filter(isObject).map((location) => text(location.path)) : [];
  const paths = [...located, text(input.file_path)].filter((path): path is string => path !== null);
  return paths.length > 0 && paths.every((path) => PLAN_FILE.test(path));
}

/** Agent 부르기 Thread 도구의 줄인가 — Claude Code의 MCP 도구 이름(`_meta.claudeCode.toolName`, 없으면 제목)으로 가린다. */
function isCallTool(tool: ToolEntry): boolean {
  return toolNameOf(tool.call) === CALL_TOOL;
}

/** 사람에게 카드로 묻는 Thread 도구의 줄이면 그 카드 종류(v1 티켓 30 · 32) — 부르기 도구 줄과 같은 규칙으로 가린다. */
function cardOfTool(tool: ToolEntry): "work" | "project" | null {
  const name = toolNameOf(tool.call);
  if (name === CARD_TOOLS.work) return "work";
  if (name === CARD_TOOLS.project) return "project";
  return null;
}

/** 이 줄이 그 Project를 고치기 시작한 자리인가 — 「Project 고치기 시작」 도구 줄이거나 그 카드의 결정 줄. */
function startedHere(entry: Entry, project: string): boolean {
  if (entry.kind === "project-choice") return entry.project === project;
  return entry.kind === "tool" && cardOfTool(entry) === "project" && isObject(entry.call.rawInput) && entry.call.rawInput.project === project;
}

/** 카드의 결정 줄이면 그 카드 종류. */
function choiceCard(entry: Entry): "work" | "project" | null {
  if (entry.kind === "work-choice") return "work";
  if (entry.kind === "project-choice") return "project";
  return null;
}

/** Work 밖 Project 카드 줄(`question` `asked`, `card: project`) → 카드. */
function outsideOf(requestId: string, who: string, payload: Json): PendingProject {
  const project = text(payload.project) ?? "";
  return {
    card: "project",
    requestId,
    who,
    project,
    name: nonEmpty(payload.name) ?? project,
    reason: nonEmpty(payload.reason),
    work: text(payload.work) ?? "",
    workProjects: Array.isArray(payload.workProjects) ? payload.workProjects.filter((one): one is string => typeof one === "string") : [],
  };
}

/** 제안 줄(`question` `asked`, `card: work`) → 카드. 꼴이 틀린 Project 줄은 버린다. */
function proposalOf(requestId: string, who: string, payload: Json): PendingWork {
  const projects = (Array.isArray(payload.projects) ? payload.projects : []).filter(isObject).flatMap((row): WorkProjectChoice[] => {
    const slug = text(row.slug);
    if (slug === null) return [];
    const branches = Array.isArray(row.branches) ? row.branches.filter((one): one is string => typeof one === "string") : [];
    return [
      {
        slug,
        name: nonEmpty(row.name) ?? slug,
        description: nonEmpty(row.description),
        recommended: row.recommended === true,
        reason: nonEmpty(row.reason),
        branches,
      },
    ];
  });
  return {
    card: "work",
    requestId,
    who,
    title: text(payload.title) ?? "",
    slug: text(payload.slug) ?? "",
    reason: text(payload.reason) ?? "",
    branch: nonEmpty(payload.branch),
    projects,
  };
}

/** 그 도구 줄이 낸 부르기인가 — 맡긴 말이 도구의 `task`와 같다(엔진이 받은 그대로 적는다). */
function sameTask(tool: ToolEntry, call: CallEntry): boolean {
  const input = isObject(tool.call.rawInput) ? tool.call.rawInput : {};
  return text(input.task) === call.text;
}

/**
 * 호출 줄을 부른 Agent의 턴에 세운다 — 그 부르기를 낸 Thread 도구 줄이 있으면 그 자리를 대신하고(맡긴 말이 같은 것 가운데 먼저 선
 * 것), 없으면 끝에 선다.
 */
function place(turn: Turn, call: CallEntry, absorbed: Set<string>): void {
  const at = turn.entries.findIndex(
    (entry) => entry.kind === "tool" && !absorbed.has(entry.toolCallId) && isCallTool(entry) && sameTask(entry, call),
  );
  if (at < 0) {
    turn.entries.push(call);
    return;
  }
  const tool = turn.entries[at] as ToolEntry;
  call.toolCallId = tool.toolCallId;
  absorbed.add(tool.toolCallId);
  turn.entries.splice(at, 1, call);
}

/** 그 턴에서 아직 도구 줄의 짝을 찾지 못한, 그 도구 줄과 맡긴 말이 같은 호출 줄. */
function unpaired(turn: Turn, tool: ToolEntry): CallEntry | null {
  const found = turn.entries.find((entry) => entry.kind === "call" && entry.toolCallId === null && sameTask(tool, entry));
  return found?.kind === "call" ? found : null;
}

function newTool(key: string, toolCallId: string, call: Json, at: string): ToolEntry {
  return {
    kind: "tool",
    key,
    toolCallId,
    call,
    output: outputOf(call),
    stop: null,
    cut: false,
    denied: false,
    allowed: null,
    asking: false,
    startedAt: at,
    endedAt: null,
  };
}

/** 스스로 이어 간 턴의 시작 표지(`session_info_update`의 `_meta.atelier.outOfTurn.state: "started"`). */
function outOfTurnStarted(update: Json): boolean {
  const meta = isObject(update._meta) ? update._meta : null;
  const atelier = meta && isObject(meta.atelier) ? meta.atelier : null;
  const mark = atelier && isObject(atelier.outOfTurn) ? atelier.outOfTurn : null;
  return mark?.state === "started";
}

/**
 * 물음 하나의 열쇠 — 물은 참여자와 요청 id다. 요청 id는 Session마다 따로 세므로(엔진 `answer_thread_permission`) 두 Agent의 첫 물음은 둘
 * 다 「0」이다 — id만으로 걸면 뒤의 물음이 앞의 것을 덮어 한 Thread에 물음이 하나뿐인 듯 보인다(v1 티켓 25).
 */
const askKey = (who: string, requestId: string) => `${who}\u0000${requestId}`;

function askedOf(requestId: string, who: string, payload: Json): Omit<PendingPermission, "tool"> {
  const request = isObject(payload.request) ? payload.request : {};
  const toolCall = isObject(payload.toolCall) ? payload.toolCall : isObject(request.toolCall) ? request.toolCall : {};
  const options = (Array.isArray(request.options) ? request.options : []).filter(isObject).flatMap((option) => {
    const optionId = text(option.optionId);
    return optionId === null ? [] : [{ optionId, name: text(option.name) ?? optionId, kind: text(option.kind) ?? "" }];
  });
  const card = payload.card === "command" || payload.card === "edit" || payload.card === "plan" ? payload.card : null;
  const grant = Array.isArray(payload.grant) ? payload.grant.filter((rule): rule is string => typeof rule === "string") : [];
  return {
    requestId,
    who,
    options,
    toolCall,
    planReview: toolCall.kind === "switch_mode",
    card,
    policy: nonEmpty(payload.policy),
    grant,
  };
}

/** 질문 줄의 `questions` → 물음들. 물음 글이 없는 물음 · 이름이 없는 선택지는 버린다 — 카드가 그릴 수 없다. */
function questionsOf(value: unknown): AskedQuestion[] {
  return (Array.isArray(value) ? value : []).filter(isObject).flatMap((one): AskedQuestion[] => {
    const question = nonEmpty(one.question);
    if (question === null) return [];
    const options = (Array.isArray(one.options) ? one.options : []).filter(isObject).flatMap((option) => {
      const label = nonEmpty(option.label);
      return label === null ? [] : [{ label, description: nonEmpty(option.description) }];
    });
    return [{ question, description: nonEmpty(one.description), multiSelect: one.multiSelect === true, options }];
  });
}

/** 질문 답 줄의 `answers` → 물음마다의 답. */
function answersOf(value: unknown): QuestionAnswer[] {
  return (Array.isArray(value) ? value : []).filter(isObject).flatMap((one) => {
    const question = text(one.question);
    const answer = text(one.answer);
    return question === null || answer === null ? [] : [{ question, answer }];
  });
}

/** 답 줄의 「다시 묻지 않기」 허락(`{rules, work}`) — 없거나 꼴이 아니면 null이다. */
function grantedOf(value: unknown): DecisionEntry["granted"] {
  if (!isObject(value) || !Array.isArray(value.rules)) return null;
  const rules = value.rules.filter((rule): rule is string => typeof rule === "string");
  return rules.length === 0 ? null : { rules, work: text(value.work) };
}

/** 도구 줄이 끝났나 — ACP 도구 상태 넷 가운데 `completed` · `failed`가 끝이다. */
export const toolDone = (tool: ToolEntry): boolean => tool.call.status === "completed" || tool.call.status === "failed";

/** 도구 호출에 update를 덮어 합친다 — 칸은 뒤의 것이 이기고, `_meta`만 한 겹 안쪽까지 합친다. */
function mergeCall(call: Json, update: Json): Json {
  const merged = { ...call, ...update };
  if (isObject(call._meta) && isObject(update._meta)) merged._meta = { ...call._meta, ...update._meta };
  return merged;
}

function outputOf(update: Json): string {
  const meta = isObject(update._meta) ? update._meta : null;
  const delta = meta && isObject(meta.terminal_output_delta) ? meta.terminal_output_delta : null;
  return (delta && text(delta.data)) ?? "";
}

function markStopped(turn: Turn, closedLast: readonly ToolEntry[], withdrawn: ReadonlySet<string>): void {
  for (const entry of turn.entries) {
    if (entry.kind !== "tool") continue;
    if (!toolDone(entry)) entry.stop = withdrawn.has(entry.toolCallId) ? "stopped" : "ran-on";
    else if (closedLast.includes(entry)) entry.stop = "stopped";
  }
}

function askedToolId(payload: Json): string | null {
  const summary = isObject(payload.toolCall) ? text(payload.toolCall.toolCallId) : null;
  if (summary) return summary;
  const request = isObject(payload.request) ? payload.request : null;
  return request && isObject(request.toolCall) ? text(request.toolCall.toolCallId) : null;
}

interface Held<T extends Entry> {
  turn: Turn;
  entry: T;
}

function settle<T extends Entry>(held: Held<T> | null, turn: Turn, fresh: () => T, replacing: ToolEntry | null): Held<T> {
  if (held && held.turn === turn) {
    if (replacing) drop(turn, replacing);
    return held;
  }
  if (held) drop(held.turn, held.entry);
  const entry = fresh();
  const at = replacing ? turn.entries.indexOf(replacing) : -1;
  if (at >= 0) turn.entries.splice(at, 1, entry);
  else turn.entries.push(entry);
  return { turn, entry };
}

function drop(turn: Turn, entry: Entry): void {
  const at = turn.entries.indexOf(entry);
  if (at >= 0) turn.entries.splice(at, 1);
}

function checklistOf(entries: unknown): ChecklistItem[] {
  return (Array.isArray(entries) ? entries : []).filter(isObject).flatMap((entry) => {
    const content = text(entry.content);
    return content === null || content.trim() === "" ? [] : [{ content, status: text(entry.status) ?? "pending" }];
  });
}

function toolHome(turns: readonly Turn[], id: string): { turn: Turn; tool: ToolEntry } | null {
  for (let t = turns.length - 1; t >= 0; t -= 1) {
    for (const entry of turns[t].entries) {
      if (entry.kind === "tool" && entry.toolCallId === id) return { turn: turns[t], tool: entry };
    }
  }
  return null;
}

function findTool(turns: readonly Turn[], id: string): ToolEntry | null {
  return toolHome(turns, id)?.tool ?? null;
}

function appendChunk(turn: Turn, kind: "message" | "thought", messageId: string | null, chunk: string, seq: number): void {
  const last = turn.entries[turn.entries.length - 1];
  if (last && last.kind === kind && last.messageId === messageId) {
    last.text += chunk;
    return;
  }
  turn.entries.push({ kind, key: `${kind === "message" ? "m" : "r"}${seq}`, messageId, text: chunk });
}

/**
 * 턴 끝 메시지가 시작하는 자리 — 마지막 도구 호출(호출 줄 포함) 뒤의 답이다. 접힌 턴은 이 자리부터의 메시지만 펼쳐 둔다. Work 만들기
 * 결정 줄은 가르지 않는다 — 사람의 결정이라 카드 앞에 물은 말과 결정 뒤의 답 사이에 그대로 선다(화면 2 보드).
 */
export function finalFrom(turn: Turn): number {
  let lastTool = -1;
  turn.entries.forEach((entry, index) => {
    // 질문 줄은 그 질문을 낸 도구 줄 자리다(v1 티켓 26).
    if (entry.kind === "tool" || entry.kind === "call" || entry.kind === "question") lastTool = index;
  });
  return lastTool + 1;
}

/** 접힌 턴에도 펼쳐 두는 줄들 — 턴 끝 메시지. */
export function finalMessages(turn: Turn): Entry[] {
  return turn.entries.slice(finalFrom(turn)).filter((entry) => entry.kind === "message");
}

/** 걸린 시간 — 「8초」 · 「3분 41초」 · 「1시간 5분」. 1초보다 짧아도 1초로 말한다. */
export function spoken(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}초`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return seconds % 60 === 0 ? `${minutes}분` : `${minutes}분 ${seconds % 60}초`;
  const hours = Math.floor(minutes / 60);
  return minutes % 60 === 0 ? `${hours}시간` : `${hours}시간 ${minutes % 60}분`;
}

const STOPPED: Record<string, string> = {
  max_tokens: "답이 길이 한도에 닿아 멈췄어요",
  max_turn_requests: "한 턴의 요청 한도에 닿아 멈췄어요",
  refusal: "Agent가 거절해서 멈췄어요",
};

/**
 * 작업 구분선의 글(02 구현 스펙 §8 · Diff-Chat 「작업 구분선」). `end_turn`이면 「N초 동안 작업」(Codex 결 — v1은 「작업함」), 우리가 멈춘
 * `cancelled`면 「N초 후에 중단했습니다」, 그 밖은 까닭을 보인다.
 */
export function headline(end: TurnEnd): string {
  const took = spoken(end.durationMs);
  if (end.stopReason === "end_turn") return `${took} 동안 작업`;
  if (end.stopReason === "cancelled") return end.cancelledByUs ? `${took} 후에 중단했습니다` : "거부해서 멈췄어요";
  if (end.stopReason !== null) return STOPPED[end.stopReason] ?? `멈췄어요 — ${end.stopReason}`;
  return end.error ? `멈췄어요 — ${end.error}` : "멈췄어요";
}

/** 접힌 턴에도 남는 줄인가 — 계획 · 체크리스트 · 호출 줄 · 질문에 답한 줄 · 카드의 결정 줄은 다시 보는 것이라 접어도 선다. */
export function keptFolded(entry: Entry): boolean {
  return (
    entry.kind === "plan" ||
    entry.kind === "checklist" ||
    entry.kind === "call" ||
    entry.kind === "question" ||
    entry.kind === "work-choice" ||
    entry.kind === "project-choice"
  );
}

/** 그리는 줄인가 — 글이 빈 생각은 그리지 않는다(Claude Code는 생각의 글을 빈 문자열로 준다). */
export const shownEntry = (entry: Entry): boolean => entry.kind !== "thought" || entry.text.trim() !== "";

/**
 * 끝난 턴의 작업 구분선(02 구현 스펙 §8 · 스토리 48 · 49) — 글(`headline`)과 펼칠 것이 있나(`unfolds`). 펼칠 것은 턴 끝 메시지 앞의 줄
 * 가운데 접으면 숨는 것(도구 줄 · 생각 · 앞선 답 · 승인 결정 줄)이다.
 * - **펼칠 것 없이 끝난 턴(`end_turn`)에는 구분선이 없다** — 말만 한 턴에 빈 머리가 서지 않는다(Codex). 호출 줄 · 계획처럼 접힌 턴에도
 *   남는 줄만 있는 턴도 그렇다.
 * - 끝 까닭이 있는 턴(길이 한도 · 거절 …)은 펼칠 것이 없어도 그 까닭이 선다 — 오류와 중단은 문장으로 말한다.
 * - 도는 턴은 null이다(「N초 동안 작업 중입니다」가 따로 선다 — `runningHeadline`).
 */
export function workLine(turn: Turn): { text: string; unfolds: boolean } | null {
  if (turn.end === null) return null;
  const unfolds = turn.entries.slice(0, finalFrom(turn)).some((entry) => shownEntry(entry) && !keptFolded(entry));
  if (!unfolds && turn.end.stopReason === "end_turn") return null;
  return { text: headline(turn.end), unfolds };
}

/** 도는 턴의 머리줄 — 보낸 때부터 지금까지. */
export function runningHeadline(turn: Turn, now: number): string {
  return `${spoken(now - Date.parse(turn.startedAt))} 동안 작업 중입니다`;
}

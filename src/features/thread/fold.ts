import { replaceEqualDeep } from "@tanstack/react-query";
import { askLevelOf } from "./chips";
import { isObject, nonEmpty, text, type Json } from "./json";
import { readingText, registeredText } from "@/features/services/scope";
import type { Quote } from "@/features/works/QuotePick";
import { prLineOf, type PrLine } from "./pr";
import { innerCalls } from "./subagent";
import { toolFields } from "./tool-fields";
import {
  cardOfDecision,
  cardOfMcp,
  isCardDecision,
  isToolCard,
  isToolCardAsk,
  toolCardRow,
  type ToolCard,
  type ToolCardAsk,
  type ToolChoiceEntry,
} from "./tool-cards";
import type { Attachment, ProjectAddAnswer, QuestionAnswer, RecordLine } from "./types";
import { particle } from "@/lib/particle";

// Thread 접기(v1 티켓 05 · 구현 스펙 §14) — Thread 기록 줄을 받아 화면 모델(턴 · 말한 이 · 메시지 · 생각 · 도구 줄 · 시스템 줄 ·
// 도는가)로 접는 **순수 함수**다. Thread 화면은 Thread를 이것 하나로 그린다: 처음 그릴 때 읽은 기록도, 흐르는 기록 줄 이벤트도 같은
// 줄이라 이 함수는 어디서 온 줄인지 모른다.
//
// three-axes 대화 접기(`chat/fold.ts`)를 옮겨 왔다 — 턴 · 멈춘 뒤의 도구 줄 · 스스로 이어 간 턴 · 계획 카드 · 상태 줄의 규칙은 그대로이고
// (그쪽 머리말이 근거를 든다), Thread에서 달라진 것은 셋이다.
// - **채팅 하나가 Runtime 세션 하나다.** 줄에 말한 이가 없고 열린 턴도 하나다 — 말은 Runtime 이름으로 선다(`runtime.ts`). 세션이 죽거나
//   닫히거나 앱을 다시 켜면(`goneThrough`) 그 턴과 걸린 물음이 끝난다.
// - **Thread의 일은 흐름 가운데의 시스템 줄이다**(캔버스 Messages 보드 「시스템 줄」) — 이름 바꾸기(`title`), 물어보는 정도 바꿈(`mode` —
//   「Policy를 편집 자동으로 바꿈 · 이 작업공간에만」, v1 티켓 23). Work · PR 줄은 그 장(30 · 31 · 40)이 더한다.
// - **도구 줄은 시작과 끝의 시각을 든다** — 작업 로그가 마우스를 올린 줄에 걸린 시간을 말한다(캔버스 WorkLog 보드). 사람이 거절한
//   물음의 도구 줄은 「실행하지 않음 · 내가 거절함」이라 거절을 든다(`denied`). 판정이 묻지 않고 허용한 도구 줄은 그 까닭을 든다
//   (`allowed` — 방패 줄 「자동으로 허용함」, v1 티켓 23 · 구현 스펙 §9). 판정 줄(`decided`)의 고른 선택지가 허용 갈래일 때다 — 엔진의
//   거절도 같은 줄로 온다. 답하지 않은 물음의 도구 줄은 「승인을 기다리는 중」이다(`asking`, v1 티켓 24).
// - **사람이 승인 카드에서 고른 것은 결정 줄이다**(v1 티켓 24 · 캔버스 Cards · Approval 보드 「결정한 뒤」) — 답 줄(`answered`)이 오면
//   카드가 걷히고 열린 턴에 결정 줄이 선다(허락인지 · 다시 묻지 않기로 준 허락 · 거절하며 남긴 말). 판정이 묻지 않고
//   닫은 요청(`decided`)은 결정 줄이 아니다 — 그쪽은 위의 방패 줄이다.
// - **Work 만들기 카드는 `question` 줄(`card: work`)이다**(v1 티켓 30 · 캔버스 Cards 보드 「작업공간 만들기」) — 제안 줄이 오면 카드가 권한
//   요청과 같은 물음 차례에 서고(`asks`), 답 줄이 오면 걷히며 그 제안을 낸 Thread 도구 줄(`atelier-thread.propose_work`) 자리에 결정 줄이
//   선다(「✓ 작업공간 만들기 · api-server · fix/refund-api」 · 「→ 작업공간 없이 계속함」 — 화면 2 보드). 만들었으면 `work` 줄이 시스템 줄
//   「작업공간 … 을 만들고 이 채팅에 연결함」이 된다. 두 줄(도구 줄 · 제안 줄)은 다른 길로 적혀 엇갈릴 수 있다 — 먼저 온 쪽이 나중 것을
//   기다린다.
// - **Agent의 질문은 질문 줄이다**(v1 티켓 26 · 캔버스 Cards 보드 「Agent의 질문」) — `question` 줄(`card: question`)이 오면 승인 ·
//   Work 만들기 카드와 같은 물음 차례(`asks`)에 질문으로 서고, 그 질문을 낸 도구 줄 자리를 질문 줄이 대신한다. 답하면 그 자리에
//   답한 카드가 남고, 거둬지면 아무것도 남지 않는다.
// - **대화 정리는 도구 줄로 오지만 일이 아니다**(01b-4 · 스토리 51 · 52) — 두 Runtime이 같은 줄(`Compact conversation`, `think`)로 알린다. 제목으로 가려
//   작업 로그에 넣지 않고, 턴이 열려 있고 줄이 끝나지 않은 동안만 정리 중이다(`compacting`). `Guardian Review`도 `think`라 종류로는 가리지 않고,
//   서브에이전트의 설명이 같은 글일 수 있어 `toolNameOf`로 읽는다.
// - **Runtime 경고는 `stderr` 줄이다**(01b-8 · 구현 스펙 「01b — 그 밖의 Runtime 신호」) — 이어진 줄을 안내 하나로 묶어 그 자리에 세운다. 도는
//   턴의 줄이면 턴 안에(`WarningEntry`), 턴 밖의 줄이면 턴 사이에(`Notice`) 선다. 일이 아니라서 턴을 열지 않고, 답한 것으로 치지 않고,
//   앞뒤의 답을 끊지 않는다(`lastWork`). 그래서 대화를 막지 않는다.
// - **실패한 턴은 글 유무가 아니라 `turn-end`의 `error`로 읽는다**(01b-5 · 스토리 67) — 글이 일부 왔어도 실패다. 끝 줄 없이 Session이 사라진 턴은 실패한 턴과
//   가른다(`TurnEnd.cut`) — 그쪽은 다시 이을 일이다. 실패와 끝 까닭(거절 · 길이 제한 · 턴 한도)은 턴 끝의 안내 줄이 말한다(`endNotice`).
// - **끊긴 턴은 사람이 다시 잇는다**(01b-6 · 스토리 55) — 턴을 끊은 Session이 다시 열리지 않은 동안이 `severed`이고 안내가 까닭과 「다시 잇기」를 말한다(`cutNotice`).
//   쉬다 죽은 Session은 끊긴 턴이 없어 지금처럼 상태 줄이 말하고 다음 말에서 다시 띄운다.
// - **앱이 거절해 멈춘 턴은 사람이 거부한 턴과 가른다**(01c-7) — Codex는 둘 다 `cancelled`로 끝내므로 엔진이 끝 줄에 단 까닭(`appRefusal`)으로 읽는다.
//   구분선은 「앱이 막아서 멈췄어요」이고 안내가 까닭을 말한다(`endNotice`).
// Thread Session에는 고친 곳(`changes`) 줄이 없다 — 바뀐 파일 알약은 마지막 턴의 편집 도구가 낸 diff에서 센다(`log.ts`).
//
// 모르는 줄은 버리지 않고 지나간다 — 기록은 원문 그대로라 스키마에 없는 갈래도 오고, 그것이 화면을 멈추면 안 된다.

/** 턴이 끝난 모양 — `turn-end` 줄, 또는 그 줄 없이 Session이 사라진 것(죽음 · 닫힘 · 앱을 다시 켬). */
export interface TurnEnd {
  /** Runtime이 준 끝 까닭(`end_turn` · `cancelled` · `max_tokens` …). 실패했거나 사라졌으면 null이다. */
  stopReason: string | null;
  /** 말을 보낸 때부터 끝날 때까지. */
  durationMs: number;
  /** 그 가운데 사람의 답을 기다린 시간(`Turn.waitedMs`) — 머리의 시간은 이것을 뺀다(restart 02b-4). */
  waitedMs: number;
  /** 우리가 멈췄나 — `cancelled`가 사람의 멈춤인지 Runtime의 거부인지를 가른다. */
  cancelledByUs: boolean;
  /**
   * 앱이 거절해 멈춘 턴의 까닭(01c-7) — `turn-end` 줄의 `appRefusal`이다(`refusalOf`). Codex는 앱의 거절도 거부 선택지로만 받아 턴을 `cancelled`로
   * 끝내므로, 사람이 거부한 턴과 이것으로 가른다. 없으면 null이다.
   */
  appRefusal: AppRefusal | null;
  /** 실패한 까닭 — `turn-end` 줄의 `error`다. 글이 왔어도 실패다. 실패하지 않았으면 null이다. */
  error: string | null;
  /** 끝 줄 없이 Session이 사라진 까닭(죽음 · 닫힘 · 앱을 다시 켬). 실패한 턴과 가른다. 사라지지 않았으면 null이다. */
  cut: string | null;
  /** 죽음 줄이 적은 까닭(「… 종료 코드 137」) — 안내가 말한다. `cut`은 목록의 짧은 글이다. 적지 않았으면 null이다. */
  cutReason: string | null;
  /** 끝난 때 — 턴 끝 줄(또는 Session이 사라진 줄)의 시각. 함께 돈 턴들의 말한 차례를 가른다(사이드바의 마지막 말). */
  at: string;
}

/** 턴 안의 한 줄. 같은 메시지의 조각들은 한 줄로 이어 붙는다. */
export type Entry =
  /** `stream`은 조각을 합친 줄의 흐름 번호다 — 화면은 흐르던 글과 이 줄을 이 번호로 잇는다(`ThreadFlow`의 `MessageView`). */
  | { kind: "message"; key: string; messageId: string | null; text: string; stream?: number }
  | { kind: "thought"; key: string; messageId: string | null; text: string }
  | ToolEntry
  | PlanEntry
  | ChecklistEntry
  | DecisionEntry
  | QuestionEntry
  | ToolChoiceEntry
  | UnansweredEntry
  | ResultEntry
  | WarningEntry;

/** Runtime 경고(01b-8) — 이어진 `stderr` 줄 묶음. 안내 글은 첫 줄이고, 「자세히」가 `lines`를 모두 펼친다. 첫 줄은 빈 줄이 아니다. */
export interface WarningEntry {
  kind: "warning";
  key: string;
  lines: string[];
}

/**
 * Work 만들기 카드에서 사람이 고른 것(v1 티켓 30) — 「작업공간 만들기 · api-server · fix/refund-api」 또는 「작업공간 없이 계속함」. 그 제안을 낸
 * Thread 도구 줄의 자리를 대신한다.
 */
export interface WorkChoiceEntry {
  kind: "work-choice";
  key: string;
  /** Work를 만들었나 — 아니면 「작업공간 없이 계속」이다. */
  created: boolean;
  /** 만든 Work의 Project들(카드에서 고친 것)과 브랜치. 「작업공간 없이 계속」이면 비었다. */
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
 * Work 밖 Project 카드에서 사람이 고른 것(v1 티켓 32 · S22) — 「web-app을 이 작업공간에 붙임」 · 「web-app을 읽기만 하기로 함」 · 「web-app을
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
 * Service 질문 카드에서 사람이 고른 것(03 티켓 08 · §11) — 질문 카드처럼 「✓ 어느 Service에서 할까요? · 결제 서비스」 한 줄로 접힌다(`service-card.ts`의
 * `serviceChoiceCard`). 그 카드를 낸 Thread 도구(「Service 붙이기」) 줄의 자리를 대신한다. 고른 Service는 Service 줄을 따로 남기지 않는다(§9).
 */
export interface ServiceChoiceEntry {
  kind: "service-choice";
  key: string;
  /** 그 Service · Service 없이 · 나중에(esc). */
  choice: "service" | "none" | "later";
  /** 고른 Service의 이름 — 그 Service를 골랐을 때만. */
  name: string | null;
  /** 이 결정의 카드를 낸 Thread 도구 줄의 id — 아직 짝을 찾지 못했으면 null이다. */
  toolCallId: string | null;
}

/**
 * Project 추가 카드에서 사람이 고른 것(03 티켓 12 · §12) — 질문 카드처럼 「✓ notes는 git 저장소가 아니에요. 어떻게 할까요? · git init 하고 추가」
 * 한 줄로 접힌다(`project-add-card.ts`의 `projectAddChoiceCard`). 그 카드를 낸 Thread 도구(「Project 추가」) 줄의 자리를 대신한다. 추가했으면
 * 바로 뒤에 결과 카드가 따로 선다.
 */
export interface ProjectAddChoiceEntry {
  kind: "project-add-choice";
  key: string;
  /** git init 하고 추가 · 뿌리 폴더로 추가 · 그대로 추가 · 추가하지 않기(esc). */
  choice: ProjectAddAnswer;
  /** 물은 카드의 갈래와 폴더 — 접힌 줄이 물음을 다시 짓는다. */
  look: PendingProjectAdd["look"];
  folder: string;
  root: string | null;
  /** 이 결정의 카드를 낸 Thread 도구 줄의 id — 아직 짝을 찾지 못했으면 null이다. */
  toolCallId: string | null;
}

/**
 * 답이 없어 닫힌 카드의 결정 줄(01c-8 · Tools 보드 「승인 결정 줄」의 마지막 줄) — Codex는 MCP 도구를 300초에서 끊어서, Codex 채팅에서 카드로 사람을
 * 기다리는 Thread 도구는 그 전에 카드를 닫는다(`question` `withdrawn` · `reason: timeout`). 「답이 없어 닫음 · Codex는 5분까지만 기다려요」. 그 카드를 낸
 * Thread 도구 줄의 자리를 대신한다 — 도구의 실패 결과가 함께 서지 않는다.
 */
export interface UnansweredEntry {
  kind: "unanswered";
  key: string;
  /** 닫힌 카드의 갈래. */
  card: ToolCard;
  /** 그 카드를 낸 Thread 도구 줄의 id — 아직 짝을 찾지 못했으면 null이다. */
  toolCallId: string | null;
}

/**
 * 결정 줄(v1 티켓 24) — 사람이 승인 카드에서 고른 것. 문구는 `approval.ts`의 `decisionText`가 짓는다(「한 번만 허용함」 · 「이 작업공간의 모든
 * 편집 허용함」 · 「거부함」, restart 02b-5).
 */
export interface DecisionEntry {
  kind: "decision";
  key: string;
  /** 허락했나(고른 선택지의 `kind`가 `allow…`). */
  allowed: boolean;
  /** 고른 선택지 — Codex가 보낸 왼쪽 단추(`allow_always`)는 그 이름이 결정 줄의 글이다. 물음을 찾지 못했으면 null이다. */
  chosen: PermissionOption | null;
  /** 「다시 묻지 않기」로 준 허락과 둔 자리 — 없으면 null이다. */
  granted: { rules: string[]; work: string | null } | null;
  /** 거절하며 남긴 말 — 없으면 null이다. */
  words: string | null;
  /** 물음의 도구 요지 — 무엇을 결정했는지(명령 · 파일 · 계획)가 여기서 나온다. */
  toolCall: Json;
  /** 계획 승인이었나. */
  planReview: boolean;
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
  /** 서브에이전트가 안에서 부른 도구 줄들(스토리 63) — 온 차례다. 기록된 안쪽 줄이 없으면 비어 있고 이 줄은 도구 줄 하나다(`subagent.ts`). */
  inner: ToolEntry[];
  stop: ToolStop | null;
  /** 끝을 알리기 전에 그 Session이 사라졌나 — 더 올 update가 없다. 도는 것으로 보이지 않는다. */
  cut: boolean;
  /** 이 도구가 물은 권한을 사람이 거절했나(거절 갈래의 선택지로 답했다). */
  denied: boolean;
  /**
   * 판정이 묻지 않고 허용했으면 그 까닭 — 엔진이 적은 그대로다(「편집 자동」 · 「이 Work에서는 다시 묻지 않기」 …). 아니면 null이다. 방패
   * 줄은 화면의 말로 읽는다(`approval.ts`의 `autoAllowReason` — 「늘 허용」 허락은 카드의 말).
   */
  allowed: string | null;
  /** 이 도구가 물은 권한이 아직 답을 기다리나 — 「승인을 기다리는 중」(v1 티켓 24). */
  asking: boolean;
  /** `tool_call` 줄의 시각. */
  startedAt: string;
  /** 끝(`completed` · `failed`)을 알린 줄의 시각. 끝나지 않았으면 null이다. */
  endedAt: string | null;
}

/** 그 턴의 사용량(ACP `usage_update`) — 지금 컨텍스트에 든 토큰과 컨텍스트 창의 크기다. */
export interface Usage {
  used: number;
  size: number;
}

export interface Turn {
  /** 턴의 정체 — 접고 펴기를 기억하는 열쇠다. 보낸 말의 seq에서 나온다. */
  key: string;
  /** 사람이 보낸 말의 화면 글(기록의 `sent`). 머리말은 기록의 `prompt`에만 있다. 스스로 이어 간 턴은 null이다. */
  sent: string | null;
  /** 그 말에 붙인 파일 · 폴더(`sent`의 `attachments`, v1 티켓 06) — 말풍선 위 칩이다. 없으면 빈 목록이다. */
  attachments: Attachment[];
  /** 그 말에 붙인 인용(`sent`의 `quote`, v1 티켓 35 · S41) — 넓힌 카드의 문서에서 고른 글이고 말풍선 위에 선다. 없으면 null이다. */
  quote: Quote | null;
  /**
   * 대기 줄의 「지금 보내기」로 하던 턴을 끊고 들어간 말인가(`sent`의 `sendNow`, restart 02b-2 · Cards 「대기 중에 끼어든 말」) — 말풍선 아래에
   * 「하던 일을 멈추고 보냄」이 선다. 차례대로 간 말 · 스스로 이어 간 턴은 칸이 없다.
   */
  interjected?: true;
  /** 턴이 선 시각(보낸 말 · 처음 온 줄). */
  startedAt: string;
  /** 답한 첫 줄의 시각. 아직 답이 없으면 null이다. */
  answeredAt: string | null;
  entries: Entry[];
  /** 끝났으면 그 모양, 도는 중이면 null. */
  end: TurnEnd | null;
  /** 마지막으로 받은 사용량 — 답 아래 줄에 선다. 모델을 부르지 않은 턴(내장 명령)은 null이다. */
  usage: Usage | null;
  /**
   * 사람의 답을 기다린 시간(restart 02b-4 · Tools 보드 「승인 대기 — 사람을 기다리는 동안 시계는 멈춘다」) — 이 턴에서 물음(승인 · 질문 · Thread 도구
   * 카드)이 하나라도 걸려 있던 동안의 합이다. 머리의 시간이 이것을 뺀다(`runningHeadline` · `headline`).
   */
  waitedMs: number;
  /** 지금 걸린 물음이 걸리기 시작한 때 — 걸린 물음이 없으면 null이다. 그동안 도는 턴의 시계가 이 때에 멈춰 있다. */
  waitingSince: string | null;
}

/**
 * 흐름 안의 상태 줄(three-axes 티켓 23) — 되살리기가 새 Session으로 끝남 · 프로세스 죽음 · 판 경고 · 턴 밖의 Runtime 경고(01b-8). 턴에 들지
 * 않고 턴 사이에 선다.
 */
export interface Notice {
  key: string;
  kind: "fresh" | "died" | "version" | "warning";
  text: string;
  /** Runtime 경고로 묶인 `stderr` 줄 모두(`WarningEntry.lines`) — 다른 갈래는 비어 있다. */
  lines: string[];
  /** 이 줄보다 먼저 선 턴의 수 — 흐름에서 그 턴들 뒤, 다음 턴 앞에 선다. */
  turnsBefore: number;
}

/**
 * 시스템 줄(캔버스 Messages 보드) — 가운데에 회색 한 줄, 굵게 쓰는 것은 이름(`name`)뿐이다. 문장은 `before` · `name` · `after`를 잇는다
 * (「채팅 이름을 」 · 「환불 API 버그」 · 「로 바꿈」). 끝에 고정폭 조각(`code` — 브랜치)이 붙을 수 있다(「api-server에 worktree를 만듦
 * · `fix/refund-api`」).
 */
export interface SystemLine {
  key: string;
  kind: "title" | "mode" | "work" | "worktree" | "service";
  before: string;
  name: string;
  after: string;
  /** 문장 끝의 고정폭 조각 — 없으면 칸째 없거나 null이다. */
  code?: string | null;
  turnsBefore: number;
  /**
   * 턴 사이가 아니라 이 턴(열쇠)의 머리 — 사람 말 뒤, 답의 줄 앞 — 에 선다. worktree를 만든 줄이 그 Project를 고치기 시작한 턴에
   * 선다(화면 2 보드). 없으면 `turnsBefore`의 턴 사이다.
   */
  turn?: string;
}

/**
 * PR 카드 하나(v1 티켓 36 · 스토리 124) — 엔진이 그 Work의 PR이 처음 보였을 때와 상태가 바뀔 때 남긴 `pr` 줄이다. 시스템 줄처럼 턴 사이에
 * 선다. 같은 PR(Project · 번호)의 마지막 카드만 `latest`다 — 지금의 상태라 「고쳐 달라고 하기」가 그 카드에만 선다.
 */
export interface PrCardEntry {
  key: string;
  pr: PrLine;
  latest: boolean;
  turnsBefore: number;
}

/**
 * 결과 카드 하나(03 티켓 12 · 구현 스펙 §12) — Agent가 대화로 한 설정(Project 추가 · 고침, Service 만듦 · 고침)이 남긴 `setting` 줄이다. 그 설정을 한
 * 턴 안, 그 도구 줄 뒤에 서고 턴이 접혀도 남는다(`keptFolded` — 캔버스 F4-ThreadNoWork는 「6초 동안 작업」 아래, 답 앞이다). 두 줄의 글은 엔진이
 * 그때 지어 줄에 실었다 — 화면은 다시 짓지 않는다. 「열기」가 갈 곳은 `result-card.ts`가 고른다.
 */
export interface ResultEntry {
  kind: "result";
  key: string;
  action: ResultAction;
  /** 대상 — Project · Service의 slug와 그때의 이름. */
  slug: string;
  name: string;
  title: string;
  detail: string;
}

/** 결과 카드의 갈래 — 무엇을 했나. */
export type ResultAction = "project-added" | "project-edited" | "service-created" | "service-edited";

const RESULT_ACTIONS: readonly ResultAction[] = ["project-added", "project-edited", "service-created", "service-edited"];

/** 턴을 끊고 사라진 Session — 다시 열리지 않은 동안이다(01b-6). */
export interface Severed {
  /** 다시 열다 죽은 까닭 — 다시 열어 보지 않았으면 null이다. */
  failed: string | null;
}

export interface ThreadModel {
  turns: Turn[];
  /** 도는 턴이 있나. */
  running: boolean;
  /** Session을 띄우거나 되살리는 중인가 — 띄우는 중 줄 뒤로 열림 · 죽음 · 닫힘 · 로그인 필요가 아직 오지 않았다. */
  connecting: boolean;
  /** 턴을 끊은 Session이 아직 다시 열리지 않았으면 그 모양 — 「다시 잇기」가 설 때다. */
  severed: Severed | null;
  /** 대화를 정리하는 중인가 — 도는 턴에 끝나지 않은 정리 줄이 있다. 턴이 끝나면 끝나지 않은 줄도 닫힌 것이다. */
  compacting: boolean;
  notices: Notice[];
  system: SystemLine[];
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
  title: string;
  /** Work 폴더 이름 — 카드에서 고치지 않는다. */
  slug: string;
  /** 왜 Work로 묶는지 — 제목 옆에 선다. */
  reason: string;
  /** Host가 고른 브랜치 — Project가 없는 제안이면 null이다. */
  branch: string | null;
  projects: WorkProjectChoice[];
  /**
   * 받아들이면 새 Work로 옮겨 갈 이 Thread의 Service(03 §9 · S8) — 카드에 「◇ 결제 서비스 · Service」 한 줄로 선다. 카드에서 바꾸지 않는다. Service가
   * 없으면 `null`이다.
   */
  service: { slug: string; name: string } | null;
}

/**
 * 답하지 않은 Work 밖 Project 카드 하나(기록의 `question` `asked`, `card: project` — v1 티켓 32 · S22). Agent가 이 Work에 없는 Project를
 * 고치려 한다.
 */
export interface PendingProject {
  card: "project";
  /** 카드의 답 명령이 싣는 요청 id. */
  requestId: string;
  /** 고치려는 Project의 slug와 이름. */
  project: string;
  name: string;
  /** 왜 그 Project를 고치려는지 — 물음 아래 줄. 없으면 null이다. */
  reason: string | null;
  /** 이 Thread가 이은 Work의 slug와 그 Project들 — 「아니요, api-server에서만 고쳐 주세요」. */
  work: string;
  workProjects: string[];
}

/** Service 질문 카드의 후보 하나 — slug · 이름 · 담은 Project의 이름(적힌 차례). */
export interface ServiceOption {
  slug: string;
  name: string;
  projects: string[];
}

/**
 * 답하지 않은 Service 질문 카드 하나(기록의 `question` `asked`, `card: service` — 03 티켓 08 · §11 · S12). Host가 다루는 Project로 Service를 붙이려
 * 하고, Atelier가 사람에게 묻기로 했다(「묻지 않음」이 아니다 · 이미 붙어 있다 · 후보가 여럿).
 */
export interface PendingService {
  card: "service";
  /** 카드의 답 명령이 싣는 요청 id. */
  requestId: string;
  /** Host가 넘긴 Service의 slug — 「추천」이 선다. `null`이면 「Service 없이」가 추천이다. */
  recommended: string | null;
  /** 추천이 맨 앞, 그 뒤 다른 후보. */
  services: ServiceOption[];
  /** 등록된 Project 수 — 「Service 없이 · 등록된 Project N개를 모두 읽어요」. */
  registered: number;
}

/**
 * 답하지 않은 Project 추가 카드 하나(기록의 `question` `asked`, `card: project-add` — 03 티켓 12 · §12). Host가 「Project 추가」 Thread 도구로
 * 등록하려는 폴더가 git 저장소가 아니거나(`notGit`) 저장소 안의 하위 폴더다(`subfolder` — 그 뿌리 `root`). 화면 추가 창과 같은 물음이다.
 */
export interface PendingProjectAdd {
  card: "project-add";
  requestId: string;
  look: "notGit" | "subfolder";
  /** 물은 폴더(`~`로 줄인 꼴)와 그 이름 — 「notes는 git 저장소가 아니에요」. */
  path: string;
  folder: string;
  /** 하위 폴더면 그 저장소의 뿌리 — git이 아닌 폴더면 null이다. */
  root: string | null;
}

/** `question` 줄로 선 카드 — 권한 요청이 아닌 물음. Agent의 질문과 Thread 도구 카드(`tool-cards.ts`의 표)다. */
type CardAsk = PendingQuestion | ToolCardAsk;

/** 입력창 자리에 서는 물음 하나 — 권한 요청이거나 Work 만들기 카드 · Agent의 질문 · Work 밖 Project 카드 · Service 질문 카드 · Project 추가
 * 카드다(`card`로 가른다). */
export type PendingAsk = PendingPermission | CardAsk;

/** `question` 줄로 선 카드(Work 만들기 · Agent의 질문 · Work 밖 Project · Service 질문 · Project 추가)인가 — 아니면 권한 요청이다. */
export function isCardAsk(ask: Pick<PendingAsk, "card">): ask is CardAsk {
  return ask.card === "question" || isToolCard(ask.card);
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
  /** 질문 답 명령이 싣는 요청 id — 권한 요청과 같은 대기 표에서 나온다. */
  requestId: string;
  /** 그 질문을 낸 도구 요지. */
  toolCall: Json;
  questions: AskedQuestion[];
}

/** 답하지 않은 권한 요청 하나(기록의 `permission` `asked`). */
export interface PendingPermission {
  /** 권한 답 명령이 싣는 요청 id. */
  requestId: string;
  options: PermissionOption[];
  /** 엔진이 채운 도구 요지(`toolCall`) — 없으면 요청 원문의 `toolCall`이다. */
  toolCall: Json;
  /** 그 요청의 도구 줄 — 흐름에 있으면(물음보다 먼저 온 `tool_call`) 그것이다. */
  tool: ToolEntry | null;
  /** 계획 승인 요청인가 — ACP 도구 kind `switch_mode`. */
  planReview: boolean;
  /** 판정이 세운 카드 종류(v1 티켓 22) — 판정 없이 물은 옛 기록이면 null이다. */
  card: "command" | "edit" | "plan" | null;
  /** 왜 묻는지 — 판정이 단 까닭(「매번 묻기」 · 「채팅 기록을 건드리기 전에 묻기」). 없으면 null이다. */
  policy: string | null;
  /** 「다시 묻지 않기」를 고르면 줄 허락(규칙 이름들) — 비었으면 카드에 그 선택지가 없다(앱 경계가 물었다 · 계획 · 그 밖의 도구). */
  grant: string[];
}

/** 턴 안의 줄이 되는 `session/update` 갈래. */
const TURN_UPDATES = new Set(["agent_message_chunk", "agent_thought_chunk", "tool_call", "plan_update", "plan"]);

/**
 * 미뤄 실린 도구(Thread 도구 · 사용자 MCP)를 들이는 Claude Code 도구(v1 티켓 20) — 일이 아니라 도구 싣기라 작업 로그에 세우지 않는다.
 * 진짜 claude 2.1.309는 Thread 도구를 부르기 전에 늘 이것(`select:mcp__atelier-thread__…`)을 먼저 부른다.
 */
const TOOL_SEARCH = "ToolSearch";

/**
 * Claude Code가 계획 모드에서 제 계획을 적는 파일(`~/.claude/plans/<이름>.md`, v1 티켓 27) — 진짜 claude 2.1.309는 계획을 이 파일에
 * 묻지 않고 쓴 뒤 `ExitPlanMode`로 묻는다. 계획은 계획 넘어가기 카드가 보이므로 작업 로그 · 바뀐 파일에 세우지 않는다 — 「계획」인데
 * 「파일 1개 바꿈」이 서지 않게.
 */
const PLAN_FILE = /\/\.claude\/plans\/[^/]+\.md$/;

/** 대화 정리 줄의 이름 — Codex가 주고 Claude 변환기가 같은 모양으로 옮긴다(`translator/stream.rs`). */
const COMPACT = "Compact conversation";

/**
 * 기록 줄을 화면 모델로 접는다. `goneThrough`는 Thread가 「떠 있는 Session이 없다」고 말할 때의 마지막 seq다 — 그 seq까지의 줄을
 * 적던 프로세스는 이미 없다(앱을 다시 켬). 그 뒤의 줄(되살린 뒤)은 여느 때처럼 접는다. 떠 있으면 `null`이다.
 */
export function foldThread(lines: readonly RecordLine[], goneThrough: number | null = null): ThreadModel {
  const turns: Turn[] = [];
  // 열린 턴 — 세션 하나에 하나다. 아래 닫힌 함수들이 바꾸므로 첫 값으로 좁혀지지 않게 적는다.
  let open = null as Turn | null;
  // 도는 턴에서 `failed`로 닫힌 뒤 아무 일도 이어지지 않은 도구 줄들(턴마다) — 그 턴이 우리의 멈춤으로 끝나면 멈춤이다.
  const closedLast = new Map<Turn, ToolEntry[]>();
  // 권한 요청 id → 그 요청의 도구 줄 id · 물음, 그리고 멈추기로 요청이 거둬진 도구 줄 id들.
  const askedFor = new Map<string, { tool: string | null; request: Omit<PendingPermission, "tool"> }>();
  const withdrawnByStop = new Set<string>();
  const deniedTools = new Set<string>();
  // 판정이 묻지 않고 허용한 도구 줄 id → 까닭 — 도구 줄이 판정 줄보다 늦게 와도 든다.
  const allowedTools = new Map<string, string>();
  // 답하지 않은 물음 — 요청 id마다, 온 차례다(v1 티켓 25). 닫히면 지금 묶음의 닫힌 수가 오르고, 다 닫히면 묶음이 끝난다. Work 만들기
  // 카드(v1 티켓 30 · 32) · 질문(v1 티켓 26)도 같은 차례에 선다.
  const pending = new Map<string, Omit<PendingPermission, "tool"> | CardAsk>();
  // 질문의 요청 id → 그 질문 줄, 그리고 질문 줄이 대신한 도구 줄 id들.
  const questions = new Map<string, QuestionEntry>();
  const questionTools = new Set<string>();
  let settled = 0;
  // 사람을 기다리는 시계(restart 02b-4) — 열린 턴에 물음이 걸리면 그 턴의 시계가 그때에 멈추고, 걸린 물음이 다 닫히거나 턴이 끝나면 기다린 만큼을
  // 더한다. 턴보다 오래 선 카드(Codex — report 「사람을 기다리는 카드가 턴보다 오래 설 수 있다」)는 그 턴이 끝날 때까지만 센다.
  const holdClock = (at: string) => {
    if (open && open.waitingSince === null) open.waitingSince = at;
  };
  const freeClock = (turn: Turn | null, at: string) => {
    if (!turn || turn.waitingSince === null) return;
    turn.waitedMs += Math.max(0, Date.parse(at) - Date.parse(turn.waitingSince)) || 0;
    turn.waitingSince = null;
  };
  const dropAsk = (key: string, at: string) => {
    if (!pending.delete(key)) return;
    settled = pending.size === 0 ? 0 : settled + 1;
    if (pending.size === 0) freeClock(open, at);
  };
  // 카드의 요청 id → 그 카드를 낸 도구 줄 id(짝을 찾았으면) — Work 만들기 · Work 밖 Project.
  const proposedBy = new Map<string, string | null>();
  let planCard: Held<PlanEntry> | null = null;
  let checklist: Held<ChecklistEntry> | null = null;
  const planReviews = new Set<string>();
  // 끝나지 않은 대화 정리 줄 id들 — 도는 턴의 것이다.
  const compacts = new Set<string>();
  let severed = null as Severed | null;
  const start = (
    key: string,
    sent: string | null,
    at: string,
    attachments: Attachment[] = [],
    quote: Quote | null = null,
  ): Turn => {
    const turn: Turn = {
      key,
      sent,
      attachments,
      quote,
      startedAt: at,
      answeredAt: null,
      entries: [],
      end: null,
      usage: null,
      waitedMs: 0,
      waitingSince: null,
    };
    turns.push(turn);
    open = turn;
    severed = null;
    return turn;
  };
  const close = (turn: Turn) => {
    if (open === turn) open = null;
    closedLast.delete(turn);
    compacts.clear();
  };
  let connecting = false;
  const notices: Notice[] = [];
  const system: SystemLine[] = [];
  const prs: PrCardEntry[] = [];
  // 다른 줄이 대신한 Thread 도구 줄 id들.
  const absorbed = new Set<string>();
  const notice = (seq: number, kind: Notice["kind"], words: string, lines: string[] = []) =>
    notices.push({ key: `n${seq}`, kind, text: words, lines, turnsBefore: turns.length });
  const say = (
    seq: number,
    kind: SystemLine["kind"],
    before: string,
    name: string,
    after: string,
    code?: string | null,
  ) =>
    system.push({
      key: `s${seq}`,
      kind,
      before,
      name,
      after,
      ...(code !== undefined && { code }),
      turnsBefore: turns.length,
    });
  // 세션의 프로세스가 사라졌다 — 열린 턴은 끝났고, 걸린 권한 요청에는 답할 곳이 없고, 끝을 받지 못한 도구 줄은 끊겼다.
  const vanish = (at: string, cut: string, cutReason: string | null = null) => {
    for (const id of pending.keys()) dropAsk(id, at);
    connecting = false;
    for (const turn of turns) {
      for (const entry of turn.entries) if (entry.kind === "tool" && !toolDone(entry)) entry.cut = true;
    }
    if (!open) return;
    freeClock(open, at);
    open.end = {
      stopReason: null,
      durationMs: Math.max(0, Date.parse(at) - Date.parse(open.startedAt)) || 0,
      waitedMs: open.waitedMs,
      cancelledByUs: false,
      appRefusal: null,
      error: null,
      cut,
      cutReason,
      at,
    };
    close(open);
    severed = { failed: null };
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
      case "sent": {
        const turn = start(`t${line.seq}`, text(payload.text) ?? "", line.at, attachmentsOf(payload.attachments), quoteOf(payload.quote));
        if (payload.sendNow === true) turn.interjected = true;
        break;
      }
      // Runtime 경고(01b-8) — 도는 턴의 줄이면 그 턴에, 아니면 턴 사이에 선다. 턴을 열지 않는다 — 턴이 돌면 입력창이 잠긴다.
      case "stderr": {
        const words = text(payload.line);
        if (words === null) break;
        const turn = open;
        if (turn) {
          const tail = turn.entries[turn.entries.length - 1];
          gather(tail?.kind === "warning" ? tail : null, words, (lines) => {
            turn.entries.push({ kind: "warning", key: `e${line.seq}`, lines });
          });
        } else {
          const tail = notices[notices.length - 1];
          const same = tail?.kind === "warning" && tail.turnsBefore === turns.length;
          gather(same ? tail : null, words, (lines) => notice(line.seq, "warning", words, lines));
        }
        break;
      }
      case "update": {
        const update = isObject(payload.update) ? payload.update : null;
        const kind = update && text(update.sessionUpdate);
        if (!update || !kind) break;
        if (kind === "tool_call_update") {
          // 늦게 온 update는 그 도구 줄을 찾아 붙는다 — 턴이 이미 끝났어도 같다.
          const id = text(update.toolCallId);
          if (id && statusDone(update.status)) compacts.delete(id);
          if (id && (planReviews.has(id) || absorbed.has(id) || questionTools.has(id))) break;
          let tool = id ? findTool(turns, id) : null;
          if (tool) tool.call = mergeCall(tool.call, update);
          else if (id && open) {
            tool = newTool(`u${line.seq}`, id, update, line.at);
            open.entries.push(tool);
          }
          if (!tool) break;
          tool.output += outputOf(update);
          holdInner(tool, update, line.at);
          if (tool.endedAt === null && toolDone(tool)) tool.endedAt = line.at;
          if (deniedTools.has(tool.toolCallId)) tool.denied = true;
          tool.allowed = allowedTools.get(tool.toolCallId) ?? tool.allowed;
          if (open && update.status === "failed" && open.entries.includes(tool)) {
            closedLast.set(open, [...(closedLast.get(open) ?? []), tool]);
          }
          break;
        }
        if (kind === "session_info_update" && outOfTurnStarted(update)) {
          if (!open) start(`o${line.seq}`, null, line.at);
          break;
        }
        // 일이 아니라 턴의 표다 — 줄이 서지 않고 답한 것으로 치지 않는다. 턴이 끝난 뒤에 오면 마지막 턴의 것이다.
        if (kind === "usage_update") {
          const usage = usageOf(update);
          const turn = open ?? turns[turns.length - 1];
          if (usage && turn) turn.usage = usage;
          break;
        }
        if (!TURN_UPDATES.has(kind)) break;
        const called = text(update.toolCallId) ?? "";
        if (kind === "tool_call" && (planReviews.has(called) || questionTools.has(called))) break;
        if (kind === "tool_call" && (toolNameOf(update) === TOOL_SEARCH || writesPlanFile(update))) {
          absorbed.add(called);
          break;
        }
        const turn: Turn = open ?? start(`o${line.seq}`, null, line.at);
        if (kind === "tool_call" && toolNameOf(update) === COMPACT) {
          absorbed.add(called);
          if (!statusDone(update.status)) compacts.add(called);
          break;
        }
        if (turn.answeredAt === null) turn.answeredAt = line.at;
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
          const asking = cardOfTool(tool);
          if (asking) {
            // 카드 줄이 먼저 왔다 — 그 카드의 도구 줄이 이것이다. 이미 답했거나 닫혔으면 결정 줄이 그 자리다.
            const waiting = [...pending].find(([key, one]) => one.card === asking && proposedBy.get(key) === null);
            if (waiting) proposedBy.set(waiting[0], tool.toolCallId);
            const choice = turn.entries.find(
              (entry): entry is ToolChoiceEntry | UnansweredEntry =>
                isCardDecision(entry) && cardOfDecision(entry) === asking && entry.toolCallId === null,
            );
            if (!waiting && choice) {
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
        appendChunk(turn, kind === "agent_message_chunk" ? "message" : "thought", text(update.messageId), chunk, line.seq, streamOfUpdate(update));
        break;
      }
      case "turn-end": {
        const turn = open ?? (payload.outOfTurn === true ? start(`o${line.seq}`, null, line.at) : null);
        if (!turn) break;
        const error = isObject(payload.error) ? text(payload.error.message) : null;
        freeClock(turn, line.at);
        turn.end = {
          stopReason: text(payload.stopReason),
          durationMs: typeof payload.durationMs === "number" ? payload.durationMs : 0,
          waitedMs: turn.waitedMs,
          cancelledByUs: payload.cancelledByUs === true,
          appRefusal: refusalOf(payload.appRefusal),
          error,
          cut: null,
          cutReason: null,
          at: line.at,
        };
        if (turn.end.stopReason === "cancelled" && turn.end.cancelledByUs) {
          markStopped(turn, closedLast.get(turn) ?? [], withdrawnByStop);
        }
        close(turn);
        break;
      }
      case "permission": {
        const requestId = text(payload.requestId);
        if (!requestId) break;
        if (payload.state === "asked") {
          const id = askedToolId(payload);
          const request = askedOf(requestId, payload);
          askedFor.set(requestId, { tool: id, request });
          pending.set(requestId, request);
          holdClock(line.at);
          if (request.planReview && id) {
            planReviews.add(id);
            const home = toolHome(turns, id);
            const turn = home?.turn ?? open ?? turns[turns.length - 1];
            const rawInput = isObject(request.toolCall.rawInput) ? request.toolCall.rawInput : {};
            const body = text(rawInput.plan);
            if (turn && body !== null) {
              planCard = settle(planCard, turn, () => ({ kind: "plan", key: `p${line.seq}`, text: body }), home?.tool ?? null);
              planCard.entry.text = body;
            } else if (home) drop(home.turn, home.tool);
          }
          break;
        }
        dropAsk(requestId, line.at);
        const asked = askedFor.get(requestId);
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
            ? askedOf(requestId, payload).options
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
        // 사람이 고른 것은 열린 턴에 결정 줄로 남는다 — 그 도구 줄이 이 턴에 있으면 바로 위다(restart 02b-4 · Thread 보드 「한 번만 허용함」 뒤 「편집함」).
        if (payload.state === "answered" && asked && open) {
          const asker = asked.tool ? open.entries.findIndex((entry) => entry.kind === "tool" && entry.toolCallId === asked.tool) : -1;
          open.entries.splice(asker >= 0 ? asker : open.entries.length, 0, {
            kind: "decision",
            key: `d${line.seq}`,
            allowed: chosen?.kind.startsWith("allow") ?? false,
            chosen: chosen ?? null,
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
        if (payload.card === "question") {
          if (payload.state === "asked") {
            const toolCall = isObject(payload.toolCall) ? payload.toolCall : {};
            pending.set(requestId, { card: "question", requestId, toolCall, questions: questionsOf(payload.questions) });
            holdClock(line.at);
            const entry: QuestionEntry = { kind: "question", key: `q${line.seq}`, choice: null, answers: [] };
            questions.set(requestId, entry);
            // 그 질문을 낸 도구 줄 자리에 선다 — 같은 일이 두 줄로 서지 않게. 도구 줄이 아직 없으면 턴 끝이다.
            const id = text(toolCall.toolCallId);
            if (id) questionTools.add(id);
            const home = id ? toolHome(turns, id) : null;
            if (home) home.turn.entries.splice(home.turn.entries.indexOf(home.tool), 1, entry);
            else (open ?? start(`o${line.seq}`, null, line.at)).entries.push(entry);
            break;
          }
          dropAsk(requestId, line.at);
          const entry = questions.get(requestId);
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
        // Thread 도구가 세운 카드 — 제안 · 답 · 거둠. Work 만들기(v1 티켓 30) · Work 밖 Project(v1 티켓 32) · Service 질문(03 티켓 08) · Project
        // 추가(03 티켓 12)가 같은 길이다.
        const card = isToolCard(payload.card) ? payload.card : null;
        if (!card) break;
        if (payload.state === "asked") {
          pending.set(requestId, toolCardRow(card).ask(requestId, payload));
          holdClock(line.at);
          const tool = [...(open?.entries ?? [])]
            .reverse()
            .find(
              (entry): entry is ToolEntry =>
                entry.kind === "tool" && cardOfTool(entry) === card && ![...proposedBy.values()].includes(entry.toolCallId),
            );
          proposedBy.set(requestId, tool?.toolCallId ?? null);
          break;
        }
        const asked = pending.get(requestId);
        dropAsk(requestId, line.at);
        if (asked === undefined || !isToolCardAsk(asked) || asked.card !== card) break;
        const toolCallId = proposedBy.get(requestId) ?? null;
        const at = { key: `w${line.seq}`, toolCallId };
        // 답했으면 고른 것, 한도에 닫혔으면(01c-8) 「답이 없어 닫음」이 그 도구 줄 자리에 선다. 멈춤 · 끊김으로 거둔 카드는 그 턴의 끝이 말한다.
        let choice: ToolChoiceEntry | UnansweredEntry;
        if (payload.state === "answered") choice = toolCardRow(asked.card).answer(asked, payload, at);
        else if (payload.state === "withdrawn" && payload.reason === "timeout") choice = { kind: "unanswered", card: asked.card, ...at };
        else break;
        const home = toolCallId ? toolHome(turns, toolCallId) : null;
        if (home && toolCallId) {
          home.turn.entries.splice(home.turn.entries.indexOf(home.tool), 1, choice);
          absorbed.add(toolCallId);
        } else open?.entries.push(choice);
        break;
      }
      // Work 연결(v1 티켓 30) — 「작업공간 환불 API 버그 수정을 만들고 이 채팅에 연결함」. worktree 생성(v1 티켓 32) — 「api-server에 worktree를
      // 만듦 · fix/refund-api」. Project 붙임(`attached`)은 시스템 줄이 아니다 — 카드의 결정 줄 「web-app을 이 작업공간에 붙임」이 말한다.
      case "work": {
        const title = nonEmpty(payload.title) ?? nonEmpty(payload.slug);
        if (payload.state === "created" && title) say(line.seq, "work", "작업공간 ", title, `${particle(title, "을", "를")} 만들고 이 채팅에 연결함`);
        const project = nonEmpty(payload.project);
        if (payload.state === "worktree" && project) {
          const branch = nonEmpty(payload.branch);
          say(line.seq, "worktree", "", project, branch ? "에 worktree를 만듦 ·" : "에 worktree를 만듦", branch);
          // 그 Project를 고치기 시작한 도는 턴의 머리에 선다. 열린 턴이 없으면(옛 기록) 턴 사이다.
          if (open) system[system.length - 1].turn = open.key;
        }
        break;
      }
      case "session": {
        switch (payload.state) {
          case "spawning":
            vanish(previousAt, GONE_WITH_APP);
            connecting = true;
            break;
          case "opened":
            connecting = false;
            severed = null;
            if (payload.how === "fresh") notice(line.seq, "fresh", FRESH_NOTICE);
            break;
          case "login-required":
            connecting = false;
            break;
          case "version-warning":
            notice(line.seq, "version", versionNotice(text(payload.agentVersion), payload.supportedMajor));
            break;
          case "died":
          case "closed": {
            const reason = text(payload.reason);
            const cutting = open !== null;
            const reopening = connecting && severed !== null;
            vanish(line.at, payload.state === "closed" ? "Session이 닫혔어요" : DIED, reason);
            if (payload.state !== "died") break;
            // 턴을 끊은 죽음과 다시 열다 죽은 것은 끊긴 턴의 안내가 말한다 — 상태 줄이 겹쳐 서지 않는다.
            if (reopening) severed = { failed: reason ?? DIED };
            else if (!cutting) notice(line.seq, "died", diedNotice(reason));
            break;
          }
          default:
            break;
        }
        break;
      }
      case "title": {
        const title = nonEmpty(payload.title);
        if (title) say(line.seq, "title", "채팅 이름을 ", title, `${particle(title, "으로", "로")} 바꿈`);
        break;
      }
      // 사람이 물어보는 정도를 바꿈(v1 티켓 23) — 「Policy를 편집 자동으로 바꿈 · 이 작업공간에만」. Work에 이은 Thread의 정도는 그 Work의
      // 것이라 같은 Work의 다른 Thread에도 든다는 것을 꼬리가 말한다.
      case "mode": {
        const level = askLevelOf(payload.mode);
        if (!level) break;
        const scope = nonEmpty(payload.work) ? " · 이 작업공간에만" : "";
        say(line.seq, "mode", "Policy를 ", level.name, `${particle(level.name, "으로", "로")} 바꿈${scope}`);
        break;
      }
      // 그 Work의 PR이 처음 보였거나 상태가 바뀜(v1 티켓 36) — 엔진이 그 Work에서 가장 최근에 말한 Thread에 남긴 줄이 PR 카드다.
      case "pr": {
        const pr = prLineOf(payload);
        if (pr) prs.push({ key: `p${line.seq}`, pr, latest: false, turnsBefore: turns.length });
        break;
      }
      // 사람이 Service를 바꿈 · 뺌(03 티켓 05 · §9) · 지움 · 되돌림(07) — 「Service를 사내 도구로 바꿨어요 — 다음 차례부터 api-server · backoffice를 읽어요」. 범위는
      // 그때 엔진이 센 것이 줄에 실려 온다(기록은 덧붙이기만 해 지금 다시 세면 그때와 다르다). Work의 Service가 바뀌면 그 Work의 Thread마다 선다.
      case "service": {
        // worktree에서 일하는 Project(`worked` — 엔진이 있을 때만 싣는다)가 먼저다 — 범위 줄과 같은 이름들(03 코드 리뷰 P3).
        const projects = [payload.worked, payload.projects].flatMap((names) =>
          Array.isArray(names) ? names.filter((one): one is string => typeof one === "string") : [],
        );
        const name = nonEmpty(payload.name);
        if (payload.change === "changed" && name) {
          say(line.seq, "service", "Service를 ", name, `${particle(name, "으로", "로")} 바꿨어요 — 다음 차례부터 ${readingText(projects)}`);
        }
        // Host가 묻지 않고 붙임(03 티켓 08 — 「묻지 않음」) — 「결제 서비스 Service에 넣었어요 — web-app · api-server를 읽어요」.
        if (payload.change === "attached" && name) {
          say(line.seq, "service", "", name, ` Service에 넣었어요 — ${readingText(projects)}`);
        }
        if (payload.change === "removed") {
          const registered = typeof payload.registered === "number" ? payload.registered : 0;
          say(line.seq, "service", `Service를 뺐어요 — 다음 차례부터 ${registeredText(registered)}`, "", "");
        }
        // 지움 · 되돌림(03 티켓 07) — 이은 Service가 지워진 대화는 굵은 것 없이 한 줄이다(시안 F4-KitChat 「Service가 지워짐」). 손으로 지운
        // 파일은 이름을 읽을 수 없어 엔진이 slug를 싣는다.
        if (payload.change === "deleted" && name) {
          say(line.seq, "service", `${name} Service가 지워져 Service 없이 이어가요 — 대화는 그대로예요`, "", "");
        }
        if (payload.change === "restored" && name) {
          say(line.seq, "service", "", name, ` Service를 되돌렸어요 — ${readingText(projects, { again: true })}`);
        }
        break;
      }
      // Agent가 대화로 한 설정(03 티켓 12) — 결과 카드 「Project를 추가했어요 — landing-page · 열기」. 글은 엔진이 지어 실은 그대로다. 그 설정을 한
      // 턴 안, 그 도구 줄 뒤에 선다.
      case "setting": {
        const action = RESULT_ACTIONS.find((one) => one === payload.action);
        const slug = nonEmpty(payload.slug);
        const title = nonEmpty(payload.title);
        if (!action || !slug || !title) break;
        const entry: ResultEntry = {
          kind: "result",
          key: `r${line.seq}`,
          action,
          slug,
          name: nonEmpty(payload.name) ?? slug,
          title,
          detail: text(payload.detail) ?? "",
        };
        (open ?? start(`o${line.seq}`, null, line.at)).entries.push(entry);
        break;
      }
      default:
        break;
    }
  }
  if (!gone) vanish(lastAt, GONE_WITH_APP);
  for (const turn of turns) {
    for (const entry of turn.entries) if (entry.kind === "tool") settleInner(entry, turn);
  }
  for (const [at, card] of prs.entries()) {
    const same = (one: PrCardEntry) => one.pr.project === card.pr.project && one.pr.number === card.pr.number;
    card.latest = !prs.slice(at + 1).some(same);
  }
  const asks = [...pending.values()].map((one): PendingAsk => {
    if (isCardAsk(one)) return one;
    const id = text(one.toolCall.toolCallId);
    const tool = id ? findTool(turns, id) : null;
    if (tool) tool.asking = true;
    return { ...one, tool };
  });
  return {
    turns,
    running: open !== null,
    connecting,
    severed,
    compacting: compacts.size > 0,
    notices,
    system,
    prs,
    pending: asks.filter((one): one is PendingPermission => !isCardAsk(one)),
    asks,
    settled,
  };
}

/**
 * 「생각 중」 줄을 세우나(States 보드 04 「생각 중 — 보낸 뒤 첫 출력까지」 · restart 02b-1) — 턴이 도는데 아직 아무 줄도 오지 않았다(보낸 말 바로 뒤).
 * 턴이 답 · 생각 · 도구 줄을 흘리고 있으면 그 줄이 말하므로 서지 않는다. 승인을 기다릴 때도 서지 않는다 — 생각하는 것이 아니라 사람을 기다리고, 입력창
 * 자리의 카드가 말한다(v1 티켓 25). 대화를 정리하는 동안도 서지 않는다 — 「대화를 정리하는 중」이 말한다. 한때 이 자리에 Runtime 이름의 「답하는 중」과
 * 점 셋이 섰다(캔버스 Messages 보드).
 */
export function thinkingLine(model: ThreadModel): boolean {
  const last = model.turns[model.turns.length - 1];
  return model.running && last !== undefined && lastWork(last.entries) === null && model.asks.length === 0 && !model.compacting;
}

/** 줄들의 마지막 일 — Runtime 경고는 일이 아니다. 아무 일도 없으면 null이다. */
export function lastWork(entries: readonly Entry[]): Entry | null {
  for (let at = entries.length - 1; at >= 0; at -= 1) {
    if (entries[at].kind !== "warning") return entries[at];
  }
  return null;
}

/** 앱을 다시 켜기 전에 끊긴 턴의 끝 까닭 — 앱이 꺼지면 Session도 함께 꺼진다. */
export const GONE_WITH_APP = "앱이 꺼지며 끊겼어요";

/** 「새로 시작함」 상태 줄. */
const FRESH_NOTICE = "새로 시작함 — 앞의 맥락을 잇지 못해 새 Session으로 열었어요";

/** 죽음 줄이 까닭을 적지 않았을 때의 글. */
const DIED = "Claude Code가 끝났어요";

function diedNotice(reason: string | null): string {
  return `${reason ?? DIED} · 다음 말에서 다시 띄워요`;
}

function versionNotice(version: string | null, major: unknown): string {
  const supported = typeof major === "number" ? ` — 확인한 판은 ${major}.x` : "";
  return `확인하지 않은 Claude Code 판이에요(${version ?? "판 모름"}${supported}). 그대로 이어 가요`;
}

/**
 * 같은 기록 줄을 한 번만 접는다 — Thread 몸(흐름 · 입력창 · 알약)과 사이드바가 같은 줄을 읽는다. 기록 줄 배열은 바뀔 때마다 새
 * 배열이라(`thread-store.ts`) 그 정체가 열쇠다. 접은 값은 읽기만 한다.
 *
 * **줄이 늘어도 바뀌지 않은 값은 앞의 것을 그대로 쓴다**(restart 티켓 01b-9). 접기 자체는 1,000줄에 1ms가 안 들지만 값이 모두 새것이면 흐름이 지난 턴을 모두 다시
 * 그린다 — 턴이 끝날 때 기록 줄이 잇따라 오면 그것만으로 프레임이 찬다. 앞의 값은 그 기록의 첫 줄로 찾는다: 첫 줄은 줄이 늘어도 같은 값이다.
 */
const folded = new WeakMap<readonly RecordLine[], { goneThrough: number | null; model: ThreadModel }>();
const latest = new WeakMap<RecordLine, ThreadModel>();
export function foldOf(lines: readonly RecordLine[], goneThrough: number | null): ThreadModel {
  const hit = folded.get(lines);
  if (hit && hit.goneThrough === goneThrough) return hit.model;
  const fresh = foldThread(lines, goneThrough);
  const first = lines[0];
  const model = first === undefined ? fresh : replaceEqualDeep(latest.get(first), fresh);
  if (first !== undefined) latest.set(first, model);
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

/**
 * 일이 아닌 도구 줄을 가르는 이름 — Claude 도구 이름, 없으면 제목(`tool-fields.ts`). 대화 정리(`Compact conversation`)는 두 Runtime이 같은 제목으로
 * 알리지만, 제목을 먼저 읽지 않는다 — Claude 서브에이전트의 설명이 같은 글일 수 있다.
 */
function toolNameOf(call: Json): string | null {
  const { toolName, title } = toolFields(call);
  return toolName ?? title;
}

/** Claude Code의 계획 파일에 쓰는 도구 줄인가 — 편집 도구이고, 다루는 파일(`locations` · 입력의 `file_path`)이 모두 계획 파일이다. */
function writesPlanFile(call: Json): boolean {
  if (call.kind !== "edit") return false;
  const input = isObject(call.rawInput) ? call.rawInput : {};
  const located = Array.isArray(call.locations) ? call.locations.filter(isObject).map((location) => text(location.path)) : [];
  const paths = [...located, text(input.file_path)].filter((path): path is string => path !== null);
  return paths.length > 0 && paths.every((path) => PLAN_FILE.test(path));
}

/** 사람에게 카드로 묻는 Thread 도구의 줄이면 그 카드 종류(v1 티켓 30 · 32) — MCP 이름(`tool-fields.ts`, 표준 값 먼저)으로 가린다. */
function cardOfTool(tool: ToolEntry): ToolCard | null {
  return cardOfMcp(toolFields(tool.call).mcp);
}

function newTool(key: string, toolCallId: string, call: Json, at: string): ToolEntry {
  return {
    kind: "tool",
    key,
    toolCallId,
    call,
    output: outputOf(call),
    inner: [],
    stop: null,
    cut: false,
    denied: false,
    allowed: null,
    asking: false,
    startedAt: at,
    endedAt: null,
  };
}

function usageOf({ used, size }: Json): Usage | null {
  return typeof used === "number" && typeof size === "number" && size > 0 ? { used, size } : null;
}

/** 서브에이전트의 안쪽 줄을 그 도구 줄에 쥔다 — 도구 호출은 안쪽 줄을 세우고, 결과는 그 줄에 덮어 합친다. */
function holdInner(tool: ToolEntry, update: Json, at: string): void {
  for (const body of innerCalls(update, tool.inner)) {
    const id = text(body.toolCallId);
    if (id === null) continue;
    let inner = tool.inner.find((one) => one.toolCallId === id);
    if (inner) inner.call = mergeCall(inner.call, body);
    else {
      inner = newTool(`i${id}`, id, body, at);
      tool.inner.push(inner);
    }
    if (inner.endedAt === null && toolDone(inner)) inner.endedAt = at;
  }
}

/**
 * 끝을 받지 못한 안쪽 줄의 때 — 바깥 줄을 따른다. 바깥 줄이 끊겼거나 끝난 채 턴도 끝났으면 더 올 결과가 없다(끝난 턴에 반짝이는 줄이 남지 않게).
 * 바깥 줄만 끝난 동안은 턴이 돌고 결과가 더 올 수 있어 도는 줄로 둔다(백그라운드 서브에이전트가 그럴 수 있다 — 녹음에는 없어 재지 못했다).
 */
function settleInner(tool: ToolEntry, turn: Turn): void {
  for (const inner of tool.inner) {
    if (toolDone(inner)) continue;
    inner.stop = tool.stop;
    inner.cut = tool.cut || (toolDone(tool) && turn.end !== null);
  }
}

/** 스스로 이어 간 턴의 시작 표지(`session_info_update`의 `_meta.atelier.outOfTurn.state: "started"`). */
function outOfTurnStarted(update: Json): boolean {
  const meta = isObject(update._meta) ? update._meta : null;
  const atelier = meta && isObject(meta.atelier) ? meta.atelier : null;
  const mark = atelier && isObject(atelier.outOfTurn) ? atelier.outOfTurn : null;
  return mark?.state === "started";
}

function askedOf(requestId: string, payload: Json): Omit<PendingPermission, "tool"> {
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

/** ACP 도구 상태 넷 가운데 끝인가 — `completed` · `failed`다. */
const statusDone = (status: unknown): boolean => status === "completed" || status === "failed";

/** 도구 줄이 끝났나. */
export const toolDone = (tool: ToolEntry): boolean => statusDone(tool.call.status);

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

/** `stderr` 한 줄을 묶음에 잇거나, 묶음이 없으면 `fresh`로 세운다. 빈 줄은 묶음을 열지 않는다 — 안내 글이 첫 줄이라서다. */
function gather(group: { lines: string[] } | null, words: string, fresh: (lines: string[]) => void): void {
  if (group) group.lines.push(words);
  else if (nonEmpty(words) !== null) fresh([words]);
}

/** 답 글 사이에 온 Runtime 경고는 지나쳐 붙인다 — 한 답이 둘로 끊기면 코드 블록 같은 마크다운이 깨진다. */
function appendChunk(
  turn: Turn,
  kind: "message" | "thought",
  messageId: string | null,
  chunk: string,
  seq: number,
  stream: number | null,
): void {
  const last = lastWork(turn.entries);
  if (last && last.kind === kind && last.messageId === messageId) {
    last.text += chunk;
    return;
  }
  if (kind === "message") {
    turn.entries.push({ kind, key: `m${seq}`, messageId, text: chunk, ...(stream !== null && { stream }) });
  } else {
    turn.entries.push({ kind, key: `r${seq}`, messageId, text: chunk });
  }
}

/** 그 조각 줄이 합친 흐름의 번호(`update._meta.atelier.stream`) — 턴 안의 조각 줄만 있다. */
export function streamOfUpdate(update: unknown): number | null {
  const meta = isObject(update) ? update._meta : null;
  const atelier = isObject(meta) ? meta.atelier : null;
  const stream = isObject(atelier) ? atelier.stream : null;
  return typeof stream === "number" ? stream : null;
}

/**
 * 턴 끝 메시지가 시작하는 자리 — 마지막 도구 호출 뒤의 답이다. 접힌 턴은 이 자리부터의 메시지만 펼쳐 둔다. Work 만들기
 * 결정 줄은 가르지 않는다 — 사람의 결정이라 카드 앞에 물은 말과 결정 뒤의 답 사이에 그대로 선다(화면 2 보드).
 */
export function finalFrom(turn: Turn): number {
  let lastTool = -1;
  turn.entries.forEach((entry, index) => {
    // 질문 줄은 그 질문을 낸 도구 줄 자리다(v1 티켓 26). 결과 카드는 그 설정을 한 도구가 남긴 것이라 도구 줄과 같이 센다(03 티켓 12) — 카드를 낸
    // 도구 줄이 답한 줄로 바뀌었어도 답한 줄 · 결과 카드 · 턴 끝 답 차례가 선다.
    if (entry.kind === "tool" || entry.kind === "question" || entry.kind === "result") lastTool = index;
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

/** 끝 까닭의 안내 줄(Cards 보드 「거절」 · 「턴 한도」 · Thread 보드 「길이 제한」). */
const END_NOTICES = new Map([
  ["refusal", { title: "이 요청에는 답할 수 없어요.", detail: "말을 바꿔서 다시 보내 보세요." }],
  ["max_tokens", { title: "답이 길이 제한에서 끊겼어요.", detail: "이어서 쓰게 할 수 있어요." }],
  ["max_turn_requests", { title: "요청 수 한도에 닿았어요.", detail: "이어서 시킬 수 있어요." }],
]);

/** 끝 까닭의 「이어서」 단추 — 단추의 글과 입력창에 채울 말(Thread 보드 「길이 제한」 · Cards 보드 「턴 한도」). */
const CONTINUES = new Map([
  ["max_tokens", { label: "이어서 쓰기", text: "이어서 써 줘" }],
  ["max_turn_requests", { label: "이어서 하기", text: "이어서 해 줘" }],
]);

/** 턴 끝의 안내 줄 — 실패한 턴과 끝 까닭이 있는 턴, 끊긴 턴이다. `kind`는 `failed`, `cut`, `reconnect-failed`이거나 그 끝 까닭이다. */
export interface EndNotice {
  kind: string;
  title: string;
  detail: string;
}

/** 까닭 글을 문장으로 맺는다 — Runtime이 준 글은 마침표가 있기도 하고 없기도 하다. */
const sentence = (words: string): string => (/[.!?。]$/.test(words) ? words : `${words}.`);

/**
 * 앱이 편집을 거절한 까닭(엔진 `policy.rs`의 `AppRefusal` — 01c-7) — 거절의 갈래와 그 값, 그리고 엔진이 Runtime에게 준 글(`message` — 모델에게 할 말이라
 * 경로와 채팅 도구 이름이 든다)이다. 갈래는 작업공간(또는 채팅 폴더 `work/`) 밖의 파일(`outside` — 등록된 Project 안이면 그 Project) · Atelier만 쓰는
 * 채팅 기록(`kept`) · 다른 채팅이 쥔 쓰기 자리(`busy` — 그 채팅의 이름)다. 모르는 갈래와 옛 기록(글만 실렸다)은 `other`다.
 */
export type AppRefusal =
  | { kind: "outside"; inWork: boolean; project: string | null; message: string }
  | { kind: "kept"; message: string }
  | { kind: "busy"; chat: string; message: string }
  | { kind: "other"; message: string };

/** `turn-end` 줄의 `appRefusal`을 읽는다 — 없으면 null이다. 옛 기록은 엔진이 Runtime에게 준 글 하나였다. */
function refusalOf(value: unknown): AppRefusal | null {
  if (typeof value === "string") return { kind: "other", message: value };
  if (!isObject(value)) return null;
  const message = text(value.message) ?? "";
  if (value.kind === "outside") return { kind: "outside", inWork: value.inWork === true, project: text(value.project), message };
  if (value.kind === "kept") return { kind: "kept", message };
  const chat = text(value.chat);
  if (value.kind === "busy" && chat !== null) return { kind: "busy", chat, message };
  return { kind: "other", message };
}

/**
 * 앱이 거절한 까닭을 사람의 말로(Cards 보드 「앱이 막음」 · restart 02b-5) — 엔진이 실은 갈래를 읽어 사람이 할 일을 말한다. 작업공간 밖이면서 등록된
 * Project 안이면 보드의 글 그대로다. 모르는 갈래는 엔진이 Runtime에게 준 글을 그대로 보인다 — 엔진이 새 갈래를 더해도 까닭이 사라지지 않는다. 한때 그
 * 글의 머리를 맞춰 보아 갈래를 읽었다.
 */
function refusalWords(refusal: AppRefusal): string {
  switch (refusal.kind) {
    case "outside":
      if (refusal.inWork) {
        return refusal.project !== null
          ? "작업공간 밖 파일이라 고칠 수 없어요. 고치려면 그 Project를 작업공간에 붙여 달라고 말해 보세요."
          : "작업공간 밖 파일이라 고칠 수 없어요. 이 작업공간의 worktree와 spec 폴더 안에서만 고칠 수 있어요.";
      }
      return refusal.project !== null
        ? "채팅 폴더 밖 파일이라 고칠 수 없어요. 고치려면 그 Project로 작업공간을 만들어 달라고 말해 보세요."
        : "채팅 폴더 밖 파일이라 고칠 수 없어요. 작업공간이 없는 채팅은 채팅 폴더 안에서만 고칠 수 있어요.";
    case "kept":
      return "채팅 기록이라 고칠 수 없어요. 이 파일은 Atelier만 써요.";
    case "busy":
      return `「${refusal.chat}」 채팅이 이 작업공간을 고치는 중이에요. 그 채팅이 끝난 뒤 다시 시켜 보세요.`;
    case "other":
      return sentence(refusal.message);
  }
}

/**
 * 그 턴의 안내 줄(Cards 보드 「실패한 턴」 · 01b-5) — 실패는 까닭을 보이고 받은 글이 있으면 남아 있다고 말한다. 끝 까닭은 보드의 문장이다. 앱이 거절해 멈춘
 * 턴(Cards 보드 「앱이 막음」 · 01c-7)은 엔진이 Runtime에게 준 거절 글을 사람의 말로 옮겨 보인다(`refusalWords`) — 앱이 거절하는 것은 편집뿐이다(앱 경계 ·
 * 쓰기 자리). 도는 턴 · 보통으로 끝난 턴 · 멈춘 턴 · 사람이 거부한 턴 · 끊긴 턴은 없다. 끊긴 턴의 안내는 `cutNotice`다.
 */
export function endNotice(turn: Turn): EndNotice | null {
  if (turn.end === null) return null;
  if (turn.end.appRefusal !== null) return { kind: "app-refused", title: "앱이 이 편집을 막았어요.", detail: refusalWords(turn.end.appRefusal) };
  if (turn.end.error !== null) {
    const received = turn.entries.some((entry) => entry.kind === "message");
    const detail = sentence(turn.end.error);
    return { kind: "failed", title: "이 턴이 실패로 끝났어요.", detail: received ? `${detail} 받은 글까지는 남아 있어요.` : detail };
  }
  const reason = turn.end.stopReason ?? "";
  const notice = END_NOTICES.get(reason);
  return notice ? { kind: reason, ...notice } : null;
}

/**
 * 끊긴 턴의 안내(Cards 보드 「연결 끊김」 · 「다시 잇지 못함」 · Thread 보드 · 01b-6). `severed`는 이 턴에서 끊긴 Session을 아직 다시 이을 수 있을 때의 모양이고,
 * 다시 이은 뒤의 지난 턴이나 읽기만인 채팅이면 null이다 — 그때는 다시 잇자고 말하지 않는다. 끊기지 않은 턴은 없다.
 */
export function cutNotice(turn: Turn, runtime: string, severed: Severed | null): EndNotice | null {
  if (turn.end === null || turn.end.cut === null) return null;
  if (severed?.failed) {
    return { kind: "reconnect-failed", title: "다시 잇지 못했어요.", detail: `${sentence(severed.failed)} 기록은 그대로 남아 있어요.` };
  }
  const received = turn.entries.some((entry) => entry.kind === "message");
  const after = severed
    ? `${received ? "받은 글은 남아 있고, 다시" : "다시"} 이으면 이 채팅을 이어서 쓸 수 있어요.`
    : received
      ? "받은 글까지는 남아 있어요."
      : "";
  const why = sentence(turn.end.cutReason ?? turn.end.cut);
  return {
    kind: "cut",
    title: `${runtime}${particle(runtime, "과", "와")} 연결이 끊겼어요.`,
    detail: after === "" ? why : `${why} ${after}`,
  };
}

/** 그 턴의 안내에 붙는 「이어서」 단추 — 입력창에 말을 채울 뿐 보내지 않는다. 실패한 턴과 다른 끝에는 없다. */
export function continueAsk(turn: Turn): { label: string; text: string } | null {
  if (turn.end === null || turn.end.error !== null) return null;
  return CONTINUES.get(turn.end.stopReason ?? "") ?? null;
}

/** 까닭을 구분선이 말하지 않아도 되는 끝 — 보통의 끝과 안내 줄이 말하는 끝 까닭, 끊긴 턴이다. */
const plainEnd = (end: TurnEnd): boolean => end.stopReason === "end_turn" || END_NOTICES.has(end.stopReason ?? "") || end.cut !== null;

/**
 * 작업 구분선의 글(02 구현 스펙 §8 · States 보드 13 「턴 끝」). `end_turn`이면 「N초 동안 작업함」(restart 02b-1 — 한때 Codex 결의 「N초 동안 작업」), 우리가 멈춘
 * `cancelled`면 「N초 후에 중단했습니다」, 실패면 「N초 후에 실패했습니다」, 그 밖은 까닭을 보인다. 안내 줄이 말하는 끝 까닭은 `end_turn`과 같다(Thread 보드 「길이 제한」).
 * 우리가 멈추지 않은 `cancelled`는 앱이 거절했으면 「앱이 막아서 멈췄어요」(Tools 보드 「앱이 막아서 멈춤」 — 아래 안내가 까닭을 보인다), 아니면 사람의 거부다.
 */
export function headline(end: TurnEnd): string {
  // 사람을 기다린 시간은 일한 시간이 아니다 — 도는 동안의 시계와 같은 셈이라 끝나는 순간 시간이 뛰지 않는다(restart 02b-4).
  const took = spoken(Math.max(0, end.durationMs - end.waitedMs));
  if (end.error !== null) return `${took} 후에 실패했습니다`;
  if (plainEnd(end)) return `${took} 동안 작업함`;
  if (end.stopReason === "cancelled") {
    if (end.cancelledByUs) return `${took} 후에 중단했습니다`;
    return end.appRefusal !== null ? "앱이 막아서 멈췄어요" : "거부해서 멈췄어요";
  }
  if (end.stopReason !== null) return `멈췄어요 — ${end.stopReason}`;
  return "멈췄어요";
}

/** 접힌 턴에도 남는 줄인가 — 계획 · 체크리스트 · 질문에 답한 줄 · 카드의 결정 줄 · 결과 카드는 다시 보는 것이라 접어도 선다. 접으면 숨는 경고는 경고가 아니라서 Runtime 경고도 남는다. */
export function keptFolded(entry: Entry): boolean {
  return (
    entry.kind === "plan" ||
    entry.kind === "checklist" ||
    entry.kind === "question" ||
    isCardDecision(entry) ||
    entry.kind === "result" ||
    entry.kind === "warning"
  );
}

/** 그리는 줄인가 — 글이 빈 생각은 그리지 않는다(Claude Code는 생각의 글을 빈 문자열로 준다). */
export const shownEntry = (entry: Entry): boolean => entry.kind !== "thought" || entry.text.trim() !== "";

/** 접으면 숨는 일인가 — 도구 줄 · 글이 있는 생각 · 승인 결정 줄 같은 작업 로그의 줄이다. 답 글과 접힌 턴에도 남는 줄(`keptFolded`)은 아니다. */
const foldsAway = (entry: Entry): boolean => shownEntry(entry) && !keptFolded(entry);

/**
 * 도는 턴의 머리줄을 세우나(States 보드 05 「도구 실행」 · restart 02b-1) — 접으면 숨는 일이 하나라도 왔다. 말만 흘리는 턴과 아직 아무것도 오지 않은 턴은
 * 머리 없이 선다(States 보드 04 · 12의 말만 한 턴) — 끝나도 구분선이 서지 않는 턴이라(`workLine`) 머리가 섰다 걷히며 글이 튀지 않는다. 일이 오면 그때 선다.
 */
export function workShown(turn: Turn): boolean {
  return turn.entries.some((entry) => foldsAway(entry) && entry.kind !== "message");
}

/**
 * 끝난 턴의 작업 구분선(02 구현 스펙 §8 · 스토리 48 · 49) — 글(`headline`)과 펼칠 것이 있나(`unfolds`). 펼칠 것은 턴 끝 메시지 앞의 줄
 * 가운데 접으면 숨는 것(도구 줄 · 생각 · 앞선 답 · 승인 결정 줄)이다.
 * - **펼칠 것 없이 끝난 턴(`end_turn`)에는 구분선이 없다** — 말만 한 턴에 빈 머리가 서지 않는다(Codex). 계획처럼 접힌 턴에도
 *   남는 줄만 있는 턴도 그렇다. 안내 줄이 말하는 턴(실패 · 거절 · 길이 제한 · 턴 한도)도 같다 — 까닭은 안내가 말한다.
 * - **끊긴 턴에도 없다**(States 보드 15 「연결 끊김」 · restart 02b-1) — 한 일은 펼친 채 남고 안내가 까닭을 말한다. 한때 펼칠 일이 있으면 「N초 동안 작업」으로 접혔다.
 * - 그 밖에 끝 까닭이 있는 턴은 펼칠 것이 없어도 그 까닭이 선다 — 오류와 중단은 문장으로 말한다.
 * - 도는 턴은 null이다(「N초 동안 작업 중입니다」가 따로 선다 — `runningHeadline`).
 */
export function workLine(turn: Turn): { text: string; unfolds: boolean } | null {
  if (turn.end === null || turn.end.cut !== null) return null;
  const unfolds = turn.entries.slice(0, finalFrom(turn)).some(foldsAway);
  if (!unfolds && (plainEnd(turn.end) || turn.end.error !== null)) return null;
  return { text: headline(turn.end), unfolds };
}

/** 답 아래 줄의 글(Cards 보드 「답 아래 줄」) — 「토큰 18.4k · 컨텍스트 38%」. */
export function usageText({ used, size }: Usage): string {
  return `토큰 ${roughCount(used)} · 컨텍스트 ${Math.round((used / size) * 100)}%`;
}

/** 토큰 수의 어림 — 「950」 · 「18.4k」 · 「1.3M」. */
function roughCount(count: number): string {
  if (count < 1000) return `${count}`;
  const thousands = Math.round(count / 100) / 10;
  return thousands < 1000 ? `${thousands.toFixed(1)}k` : `${(count / 1_000_000).toFixed(1)}M`;
}

/**
 * 도는 턴의 머리줄 — 보낸 때부터 지금까지에서 사람의 답을 기다린 시간을 뺀다. 물음이 걸려 있으면 그 물음이 걸린 때에 멈춰 있다(restart 02b-4 · Tools 보드
 * 「승인 대기」).
 */
export function runningHeadline(turn: Pick<Turn, "startedAt" | "waitedMs" | "waitingSince">, now: number): string {
  const until = turn.waitingSince === null ? now : Date.parse(turn.waitingSince);
  return `${spoken(until - Date.parse(turn.startedAt) - turn.waitedMs)} 동안 작업 중입니다`;
}

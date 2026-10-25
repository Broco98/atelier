import { particle } from "@/lib/particle";
import { type PendingAsk, type ThreadModel, type ToolEntry } from "./fold";
import { text } from "./json";
import { describeTool } from "./tool-view";

// 물음 차례(v1 티켓 25 · 구현 스펙 §9 카드 · 스토리 80 · 캔버스 Approval 보드 A안 「두 Agent가 함께 물을 때」) — 한 Thread에 걸린 물음이
// 여럿이면 **먼저 온 것 하나만** 입력창 자리에 카드로 서고, 카드 머리 오른쪽의 「1 / 2」와 카드 아래 「다음 · 테스터가 … 실행을 기다려요」
// 줄이 차례를 말한다. 한 번에 한 결정만 한다. 차례를 읽는 **순수 함수**다 — 그리는 것은 카드(`ApprovalCard`)와 `AskTurnMarks`다.
//
// - **차례는 기록 줄의 차례다** — 참여자마다 Session이 따로 묻지만 기록은 Thread에 하나라 물음 줄의 seq가 곧 온 차례다. 접기(`foldThread`)가
//   물음을 그 차례로 쥐고(`ThreadModel.asks`), 엔진은 Thread 단위 차례를 따로 쥐지 않는다. 물음의 열쇠는 물은 참여자와 요청 id다
//   (요청 id는 Session마다 따로 센다).
// - **「1 / 2」는 묶음 안의 자리다** — 묶음은 걸린 물음이 하나라도 있는 동안 이어진다. 앞의 것에 답하면 다음 것이 「2 / 2」로 서고, 다
//   닫히면 묶음이 끝난다. 묶음에 물음이 하나뿐이면 세지 않는다(보드 「기다리는 순간」).
// - **카드 종류가 늘어도 같은 차례다**(§9 「Agent가 고를 답을 내미는 질문도 같은 자리, 같은 차례」) — 새 카드는 그 물음을 같은
//   `pending`(같은 열쇠 · 같은 닫힘)에 넣고, 이 함수와 다음 줄의 글(`nextOf`)에 갈래를 더한다. 걸린 물음 모두(`ThreadModel.asks`)가
//   차례이고, 다음 줄은 Work 만들기 카드(v1 티켓 30)면 「다음 · Host가 Work 만들기 답을 기다려요」, Agent의 질문(v1 티켓 26)이면 대상
//   없이 「다음 · Host가 질문의 답을 기다려요」다.

/** 입력창 자리의 차례 — 지금 서는 물음, 묶음 안의 자리, 그다음 물음. */
export interface AskTurn {
  /** 입력창 자리에 서는 물음 — 걸린 것 가운데 먼저 온 것. */
  current: PendingAsk;
  /** 「1 / 2」 — 묶음 안에서 몇째인가 · 모두 몇인가. 묶음에 물음이 하나뿐이면 null이다. */
  count: { at: number; total: number } | null;
  /** 카드 아래 「다음 · …」 줄의 물음. 없으면 null이다. */
  next: PendingAsk | null;
}

/** 지금 차례 — 걸린 물음이 없으면 null이다(입력창이 선다). */
export function askTurn(model: Pick<ThreadModel, "asks" | "settled">): AskTurn | null {
  const [current, next = null] = model.asks;
  if (!current) return null;
  const total = model.settled + model.asks.length;
  return { current, count: total > 1 ? { at: model.settled + 1, total } : null, next };
}

/**
 * 다음 줄의 글 조각 — 「다음 · **테스터**가 `pnpm playwright test` 실행을 기다려요」. 이름은 굵게, 대상은 작업 로그의 그 도구 줄과 같은
 * 글(「pnpm playwright test 승인을 기다리는 중」)이고, 파일 · 명령 · MCP 도구면 고정폭이다(`mono`). 계획 넘어가기 · 질문은 대상이 없다.
 */
export interface NextLine {
  name: string;
  /** 이름 뒤 조사 — 받침이 있으면 「이」다. */
  particle: string;
  subject: string | null;
  mono: boolean;
  /** 무엇을 기다리는지(「실행을 기다려요」). */
  what: string;
}

/** 무엇을 기다리는지 — 도구의 kind로 고른다(목적격 조사까지). */
const WAITING: Readonly<Record<string, string>> = {
  delete: "삭제를",
  move: "이동을",
  read: "읽기를",
  fetch: "가져오기를",
  search: "검색을",
};

/** 다음 줄. `name`은 물은 참여자의 화면 이름이다. */
export function nextOf(request: PendingAsk, name: string): NextLine {
  const head = { name, particle: particle(name, "이", "가") };
  if (request.card === "work") return { ...head, subject: "Work 만들기", mono: false, what: "답을 기다려요" };
  if (request.card === "question") return { ...head, subject: null, mono: false, what: "질문의 답을 기다려요" };
  if (request.card === "project") return { ...head, subject: `${request.name} 고치기`, mono: false, what: "답을 기다려요" };
  if (request.card === "space") return { ...head, subject: "Space", mono: false, what: "답을 기다려요" };
  if (request.card === "project-add") return { ...head, subject: `${request.folder} 추가`, mono: false, what: "답을 기다려요" };
  // 흐름의 도구 줄이 이긴다(`describeApproval`과 같다) — 없으면 요청이 실은 요지로 같은 문구를 짓는다.
  const call = { ...request.toolCall, ...(request.tool?.call ?? {}) };
  const tool: ToolEntry = request.tool
    ? { ...request.tool, call }
    : {
        kind: "tool",
        key: "",
        toolCallId: text(call.toolCallId) ?? "",
        call,
        output: "",
        stop: null,
        cut: false,
        denied: false,
        allowed: null,
        asking: true,
        startedAt: "",
        endedAt: null,
      };
  const view = describeTool(tool);
  if (request.planReview) return { ...head, subject: null, mono: false, what: "계획 승인을 기다려요" };
  const kind = typeof call.kind === "string" ? call.kind : "other";
  const written = view.diffs.length > 0 && view.diffs.every((piece) => piece.written);
  const what = view.mcp ? "호출을" : view.shell ? "실행을" : kind === "edit" ? (written ? "작성을" : "수정을") : (WAITING[kind] ?? "사용을");
  return { ...head, subject: view.phrase.subject, mono: view.phrase.mono, what: `${what} 기다려요` };
}

import { createContext, Fragment, memo, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { useStore } from "@tanstack/react-store";
import { Check, CircleAlert, Copy, Folder, GitBranch, Info, Layers, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { particle } from "@/lib/particle";
import { cn } from "@/lib/utils";
import { AnsweredCards } from "./AnsweredCards";
import { decisionText } from "./approval";
import { useArrival } from "./arrival";
import {
  answeringLine,
  continueAsk,
  cutNotice,
  endNotice,
  finalFrom,
  headline,
  keptFolded,
  lastWork,
  runningHeadline,
  shownEntry,
  usageText,
  workLine,
  type DecisionEntry,
  type UnansweredEntry,
  type EndNotice,
  type Entry,
  type Notice,
  type QuestionEntry,
  type Severed,
  type SystemLine,
  type ThreadModel,
  type ToolEntry,
  type Turn,
  type Usage,
  type WarningEntry,
} from "./fold";
import { SentAttachments } from "./ComposerAttachments";
import { DocCard } from "./DocCard";
import { createdDocs } from "./expanded";
import { Checklist, PlanCard } from "./PlanCard";
import { PrCard } from "./PrCard";
import { answeredCards } from "./question";
import { SentQuoteChip } from "./QuoteChip";
import { ResultCard } from "./ResultCard";
import ThreadMarkdown from "./ThreadMarkdown";
import { isCardDecision, isToolCardAsk, toolCardRow } from "./tool-cards";
import { ToolChoiceRow } from "./ToolCards";
import type { Quote } from "@/features/works/QuotePick";
import type { Attachment } from "./types";
import { threadFlowStore, threadUiStore, toggleTurn, turnKey } from "./thread-store";
import { ToolRows, Unfold, WorkDivider } from "./WorkLog";

// Thread의 흐름(v1 티켓 05 · 캔버스 Messages · WorkLog 보드) — 기록 줄을 접은 모델(`fold.ts`)을 그린다. three-axes 흐름
// (`chat/ChatThread.tsx`)을 옮겨 보드의 모양으로 고쳤다.
//
// - **말풍선은 내 말에만 쓴다** — 오른쪽 정렬 · 옅은 파랑(`bubble-user`)에 짙은 남색 글자, 폭은 줄의 70%까지다(02 구현 스펙 §8 —
//   `UserMessage`). 답은 머리 없이 본문 그대로 선다(Codex 결). 채팅은 Runtime 세션 하나라 말한 이를 가를 일이 없어 얼굴도 이름 줄도 없고,
//   이름이 필요한 말은 Runtime 이름으로 선다(`runtime`).
// - **턴 사이는 Codex의 대화 간격이다**(02 구현 스펙 §8) — 말풍선 → 답 첫 글자 51.5, 답 끝 → 다음 말풍선 52(글자 잉크에서 상자 끝까지,
//   `index.css`의 `--space-reply` · `--space-turn`). 흐름의 줄 사이(`TURN_GAP`)가 그 값에서 글줄의 위아래 여백을 뺀 상자 사이다. 턴
//   사이에 서는 시스템 줄 · 상태 줄 · PR 카드 · 「답하는 중」도 같은 줄 사이를 따른다. 턴 안의 줄 사이는 그대로다(8).
// - **「답하는 중」**(Messages 보드) — 답이 아직 안 보이는 도는 턴(보낸 말에 아직 아무 줄도 오지 않았거나, 흐름 끝이 아닌 자리에서 돈다)이
//   있으면 흐름 맨 아래에 「Claude Code가 답하는 중」과 차례로 떠오르는 세 점이 한 줄로 선다(`answeringLine`). 그래서 아직 아무 줄도 오지
//   않은 턴은 보낸 말만 서고, 첫 줄이 오면 그 자리에 「생각 중」 · 답이 선다.
// - **작업 로그** — 일하는 동안은 「N초 동안 작업 중입니다」가 반짝이고 그 아래로 도구 줄이 쌓인다. 승인을 기다리면 「· 승인을
//   기다립니다」가 링크 색으로 붙는다. 끝나면 작업 구분선 「N초 동안 작업 ›」(그 아래 가는 선 — 02 구현 스펙 §8)으로 접히고 **턴 끝
//   메시지**(마지막 도구 뒤의 답)만 펼쳐 둔다. 구분선을 누르면 생각 · 도구 줄 · 앞선 답이 높이와 함께 펼쳐진다(`Unfold`). **펼칠 것 없이
//   끝난 턴(말만 한 턴)에는 구분선이 없다**(`workLine`). 승인 카드에서 고른 것은 그 도구 줄 뒤의 결정 줄이다(v1 티켓 24 — 「✓ 명령
//   실행을 승인함 · 비슷한 명령 허용」, 거부는 ✕와 남긴 말). Work 만들기 카드에서 고른 것도 결정 줄이고(v1 티켓 30 —
//   「✓ 작업공간 만들기 · api-server · fix/refund-api」 · 「→ 작업공간 없이 계속함」), 접힌 턴에도 남는다(화면 2 보드). 만든 Work는 턴 뒤의
//   시스템 줄 「📁 작업공간 … 을 만들고 이 채팅에 연결함」이다.
// - **흐르는 답은 조각이 도착하는 방식으로 선다**(`MessageView` · `ThreadMarkdown`의 `streaming` — 끝 240px이 옅다). 조각은 기록 줄이 아니라 접은
//   모델에 없고, 마지막 턴의 꼬리에만 붙는다. 조각을 구독하는 부품은 그 꼬리 하나라 조각이 오는 동안 앞선 턴이 다시 그려지지 않는다(스펙 「01b —
//   스트리밍」). 같은 흐름의 기록 줄이 오면 글이 턴의 줄이 된다 — 꼬리와 그 줄은 같은 자리의 같은 부품이라(흐름 번호가 열쇠다, `flowKey`) 그려 둔 글을 다시
//   그리지 않고, 턴이 끝나 접혀도 턴 끝 답은 그 자리에 남는다(restart 티켓 01b-9). 답을 기다리는 동안은 「생각 중」에
//   띠가 지나간다(`think-shimmer` — 보인 뒤 600ms, 4s마다 한 번, 02 티켓 12). 대화를 정리하는 동안은 같은 자리의 「대화를 정리하는 중」이다
//   (01b-4 · Tools 보드 — 정리 신호가 오는 동안만, `compacting`). 정리 줄은 작업 로그에 서지 않는다.
// - **오류와 중단은 색 대신 문장이다** — 우리가 멈춘 턴은 ■ 「N초 후에 중단했습니다」다. 실패한 턴과 거절 · 길이 제한 · 턴 한도, 끊긴 턴은 받은 글 뒤의 안내 줄이
//   말한다(01b-5 · 01b-6 · Cards 보드 · `EndNoticeLine`) — 글이 있어도 그렇다. 끝난 답이 아니라 동작 줄이 없다. 모양은 02b-5가 맞춘다.
// - **안내의 단추는 지금의 턴에만 선다**(01b-6 · `FlowActions`) — 「다시 잇기」는 말을 보내지 않고 Session만 열어, 끊긴 턴이 저절로 다시 돌지 않는다. 「이어서
//   쓰기」 · 「이어서 하기」는 입력창을 채울 뿐이고 보내는 것은 사람이다. 읽기만인 채팅에는 어느 단추도 없다.
// - **시스템 줄**(이름 바꾸기 · 정도 바꿈 · Work · Service)은 가운데 회색 한 줄이고 이름만 굵다. 상태 줄(새로 시작함 · 죽음 · 판 경고)은 턴
//   사이의 옅은 줄이다.
// - 마지막으로 끝난 답 아래에만 응답 액션(복사)과 그 턴의 사용량이 선다(`AnswerActions` — 01b-7 · Cards 보드 「답 아래 줄」). 「…」는 무엇을 둘지
//   정해지면(02 P1) 단다.
// - **Runtime 경고**(01b-8 · Cards 보드 「Runtime 경고」 · `WarningLine`) — 이어진 `stderr` 줄의 안내다. 글은 첫 줄이고 「자세히」가 묶인 줄을 안내 안에서
//   모두 펼친다. 대화를 막지 않는다 — 턴 안의 안내가 서도 「답하는 중」 · 머리줄 · 「생각 중」은 일의 줄로 정한다(`lastWork`). 접힌 턴에도 남는다.
//   모양은 02b-5가 맞춘다.
// - **PR 카드**(v1 티켓 36 · `PrCard`) — 엔진이 그 Work의 PR이 처음 보였을 때와 상태가 바뀔 때 남긴 `pr` 줄이다. 시스템 줄처럼 턴 사이에
//   선다(턴의 일이 아니라 Work의 일이다).
//
// - **대화 속 문서 카드**(v1 티켓 35 · ChatCards 보드) — 끝난 턴에서 이은 Work의 spec 폴더에 새로 쓴 문서는 답 아래에 카드로 놓이고(`createdDocs`), 누르면 요약 카드가 넓어져 그 문서를 연다(`DocPlace`). 접힌 턴에도 남는다.
// - **인용**(v1 티켓 35 · S41) — 넓힌 카드의 문서에서 고른 글을 붙인 말은 말풍선 위에 인용 칩이 선다(`SentQuoteChip`).
//
// - **움직임**(v1 티켓 43 · Motion 보드) — 화면이 선 뒤에 새로 선 것만 움직인다(`arrival.tsx`). 결정 줄은 칩으로 나타나고(칩 나타남 — 보드
//   「승인 카드 올라옴」의 답한 뒤 줄), 시스템 줄 · 「답하는 중」은 아래 4에서 떠오르며(줄 바뀜), 턴이 끝나면 「N초 동안 작업」이 같은 자리에서 떠오르고(줄 바뀜), 구분선을 눌러 펼치면 줄들이 높이와
//   투명도로 자라 나온다(펼침 · 접힘 — 02 구현 스펙 §12). 흐르는 낱말은 `ThreadMarkdown`이 움직인다. 자리를 옮겨 다시 서는 줄(턴이
//   끝나 접힌 턴으로 옮겨 선 결정 줄)은 기록 줄의 열쇠로 알아보고 다시 움직이지 않는다.
//
// **알림 영역이 아니다.** 흐르는 답이 조각마다 읽히지 않도록 `aria-live`도 `role="log"`도 없다.

/**
 * 대화 속 문서 카드의 자리(v1 티켓 35) — 이은 Work의 spec 폴더(절대 경로)와 그 문서를 넓힌 카드에서 여는 길. Work 없는 Thread · Session을
 * 띄운 화면 밖에서는 `null`이고 카드가 서지 않는다. 흐름의 모든 턴이 같은 값을 쓰므로 Context로 건넨다(`LogPlace`와 같다).
 */
export const DocPlace = createContext<{ specRoot: string; open: (path: string) => void } | null>(null);

/**
 * 흐름의 줄 사이(02 구현 스펙 §8) — Codex의 대화 간격 말풍선 → 답 첫 글자 51.5 · 답 끝 → 다음 말풍선 52(`--space-reply` · `--space-turn`,
 * 글자 잉크에서 상자 끝까지)에서 글줄의 여백을 뺀 상자 사이다.
 * - 말풍선 → 답은 46이다. 답의 첫 줄(작업 머리줄 14 / 20 · 본문 14 / 22.75)은 잉크 위에 약 6의 여백이 있다.
 * - 답 끝 → 다음 말풍선은 48이다. 본문 끝 줄의 잉크 아래 여백은 약 4라, 말풍선 앞에 2를 더 띄운다(`TurnView`의 말풍선 칸).
 * 첫 말을 보낸 새 Thread(`NewThreadScreen`)의 말풍선 → 「생각 중」도 이 줄 사이다. WebKit에서 잰 값은 시안-비교/08이다.
 */
export const TURN_GAP = "gap-11.5";

/** 흐름의 Thread — Runtime 경고의 펼침을 Thread마다 기억하는 열쇠이고, 흐르는 글을 찾는 열쇠다. */
const FlowThread = createContext("");

/**
 * 맨 아래를 보던 흐름을 꼬리까지 내리는 길 — Thread 본문이 준다. 흐르는 글은 기록 줄이 아니라 본문이 다시 그려지지 않으므로, 글이 늘면
 * 꼬리가 부른다(`MessageView`).
 */
export const FollowTail = createContext<() => void>(() => {});

interface ThreadFlowProps {
  thread: string;
  model: ThreadModel;
  /** 그 채팅의 Runtime 이름(`runtimeNameOf`) — 「답하는 중」과 문서 카드의 말이 이 이름으로 선다. */
  runtime: string;
  /** 안내 줄의 단추가 하는 일 — 읽기만인 채팅에는 없다. */
  actions?: FlowActions | null;
}

/** 안내 줄의 단추가 하는 일(01b-6) — Thread 본문이 준다. */
export interface FlowActions {
  /** 입력창에 말을 채운다 — 보내는 것은 사람이다. */
  fill: (text: string) => void;
  /** 말을 보내지 않고 Session만 다시 연다. */
  reconnect: () => void;
  /** 다시 잇기가 도는 중인가. */
  reconnecting: boolean;
  /** 다시 잇기 명령이 거절된 까닭 — 기록에 줄이 서기 전에 막힌 때(찾지 못함 · 로그인 셸)도 든다. */
  reconnectFailure: string | null;
}

function ThreadFlow({ thread, model, runtime, actions = null }: ThreadFlowProps) {
  const expanded = useStore(threadUiStore, (state) => state.expanded);
  // PR 카드의 병합한 때(「어제 오후 6:12」)를 견줄 지금 — 흐름을 다시 그릴 때마다 읽는다.
  const now = Date.now();
  const between = (count: number) => [
    ...model.notices
      .filter((notice) => notice.turnsBefore === count)
      .map((notice) =>
        notice.kind === "warning" ? <WarningLine key={notice.key} warning={notice} /> : <NoticeLine key={notice.key} notice={notice} />,
      ),
    ...model.system
      .filter((line) => line.turn === undefined && line.turnsBefore === count)
      .map((line) => <SystemRow key={line.key} line={line} />),
    ...model.prs.filter((card) => card.turnsBefore === count).map((card) => <PrCard key={card.key} card={card} now={now} />),
  ];
  const last = model.turns[model.turns.length - 1];
  const answering = answeringLine(model);
  return (
    <FlowThread.Provider value={thread}>
      <div className={cn("flex flex-col text-chat-body", TURN_GAP)}>
        {between(0)}
        {model.turns.map((turn, at) => (
          <Fragment key={turn.key}>
            <TurnView
              turn={turn}
              runtime={runtime}
              open={expanded[turnKey(thread, turn.key)] === true}
              waiting={turn.end === null ? waitingFor(model) : null}
              compacting={turn.end === null && model.compacting}
              last={turn === last}
              actions={turn === last ? actions : null}
              // 다시 잇기는 지금의 턴에서만 읽는다 — 지난 턴의 그림은 이 값에 움직이지 않는다.
              severed={turn === last ? model.severed : null}
              connecting={turn === last && model.connecting}
              lead={leadOf(model, turn)}
            />
            {between(at + 1)}
          </Fragment>
        ))}
        {answering && <AnsweringRow runtime={runtime} />}
      </div>
    </FlowThread.Provider>
  );
}

/**
 * 「답하는 중」(Messages 보드 `.typing`) — 「Claude Code가 답하는 중」 13/20 `fg-tertiary`, 그 뒤에 점 셋이 파도친다(`typing-dots` — 입력창 위
 * 작업 중 점과 같은 Codex 파도, 점 색은 이 줄의 글자색). 점은 그림이라 숨고 문장이 말한다.
 */
function AnsweringRow({ runtime }: { runtime: string }) {
  const thread = useContext(FlowThread);
  // 답이 흐르기 시작하면 그 턴의 머리줄이 말한다 — 첫 기록 줄은 흐름이 끝나야 선다.
  const flowing = useStore(threadFlowStore, (state) => state[thread] !== undefined);
  const arrival = useArrival("row-in");
  if (flowing) return null;
  return (
    <p data-answering className={cn("flex items-center gap-2 text-chat-meta leading-5 text-fg-tertiary", arrival)}>
      <span>
        {runtime}
        {particle(runtime, "이", "가")} 답하는 중
      </span>
      <span className="typing-dots" aria-hidden>
        <i />
        <i />
        <i />
      </span>
    </p>
  );
}

/** 상태 줄 — 옅은 글자의 한 줄. 그림은 숨고 글이 말한다. */
function NoticeLine({ notice }: { notice: Notice }) {
  const Icon = notice.kind === "fresh" ? Info : TriangleAlert;
  return (
    <p data-notice={notice.kind} className="flex items-start gap-1.5 text-chat-meta text-fg-tertiary">
      <Icon className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 wrap-anywhere">{notice.text}</span>
    </p>
  );
}

/**
 * Runtime 경고(Cards 보드 「Runtime 경고」) — 그림 · 첫 줄 · 「자세히」. 펼침은 `expanded`에 둔다 — 턴이 끝나면 안내가 접힌 턴의 자리로 옮겨 서므로
 * 안내 안의 상태로 두면 펼친 것이 닫힌다.
 */
function WarningLine({ warning }: { warning: Pick<WarningEntry, "key" | "lines"> }) {
  const key = turnKey(useContext(FlowThread), warning.key);
  const open = useStore(threadUiStore, (state) => state.expanded[key] === true);
  return (
    <div data-warning className="flex w-full flex-col gap-1 text-chat-meta text-fg-tertiary">
      <p className="flex items-start gap-1.5">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 wrap-anywhere">{warning.lines[0]}</span>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => toggleTurn(key)}
          className="shrink-0 underline transition-colors hover:text-fg-secondary focus-ring"
        >
          자세히
        </button>
      </p>
      {open && <pre className="pl-5 font-mono text-xs whitespace-pre-wrap wrap-anywhere">{warning.lines.join("\n")}</pre>}
    </div>
  );
}

/**
 * 도는 턴의 머리줄 끝에 붙는 기다림 — 그 턴이 물은 것이 있으면 무엇을 기다리는지다. 승인은 시안 문장 그대로(「승인을 기다립니다」),
 * 시안에 없는 셋은 해요체다(코드 리뷰 1차 A4).
 */
function waitingFor(model: ThreadModel): string | null {
  const ask = model.asks[0];
  if (!ask) return null;
  if (isToolCardAsk(ask)) return toolCardRow(ask.card).waiting;
  return ask.card === "question" ? "질문의 답을 기다려요" : "승인을 기다립니다";
}

/**
 * 시스템 줄(보드 `.sys`) — 가운데 13/20 `fg-tertiary`, 이름만 500 `fg`. Work를 만든 줄은 앞에 폴더 14가, worktree를 만든 줄은 앞에 브랜치 14가 선다(화면 2 보드, 사이 6). 끝의 고정폭 조각(브랜치)은 빈칸 하나를 앞에 실어 글로 읽어도 「만듦 · fix/refund-api」다.
 */
function SystemRow({ line }: { line: SystemLine }) {
  return (
    <p
      data-system={line.kind}
      className={cn(
        "flex flex-wrap items-center justify-center self-center text-center text-chat-meta leading-5 text-fg-tertiary",
        useArrival("row-in", line.key),
      )}
    >
      {line.kind === "work" && <Folder className="mr-1.5 size-3.5 shrink-0" aria-hidden />}
      {line.kind === "worktree" && <GitBranch className="mr-1.5 size-3.5 shrink-0" aria-hidden />}
      {line.kind === "service" && <Layers className="mr-1.5 size-3.5 shrink-0" aria-hidden />}
      {/* 앞말의 끝 빈칸을 지킨다 — 줄 상자가 flex라 글 조각 끝의 빈칸이 접혀 앞말과 이름이 붙는다. */}
      {line.before && <span className="whitespace-pre">{line.before}</span>}
      {/* 이름이 없는 줄도 있다 — 「Service를 뺐어요 — …」는 앞말만이다. */}
      {line.name && <b className="font-medium text-fg">{line.name}</b>}
      {/* 뒷말의 앞 빈칸도 지킨다 — 「결제 서비스 Service를 되돌렸어요」처럼 이름 뒤에 빈칸으로 잇는 줄이 있다. */}
      {line.after && <span className="whitespace-pre-wrap">{line.after}</span>}
      {line.code && <span className="whitespace-pre font-mono text-xs">{` ${line.code}`}</span>}
    </p>
  );
}

/** 이 턴의 머리에 서는 시스템 줄들(worktree를 만듦) — 없으면 늘 같은 빈 값이다. */
const NO_LEAD: readonly SystemLine[] = [];
function leadOf(model: ThreadModel, turn: Turn): readonly SystemLine[] {
  const lead = model.system.filter((line) => line.turn === turn.key);
  return lead.length === 0 ? NO_LEAD : lead;
}

interface TurnViewProps {
  turn: Turn;
  runtime: string;
  open: boolean;
  /** 사람의 답을 기다리면 그 말(「승인을 기다립니다」) — 머리줄 끝에 링크 색으로 붙는다. */
  waiting: string | null;
  /** 이 턴이 대화를 정리하는 중인가 — 「생각 중」 자리에 「대화를 정리하는 중」이 선다. */
  compacting: boolean;
  last: boolean;
  /** 안내 줄의 단추가 하는 일 — 지금의 턴에만 온다. */
  actions: FlowActions | null;
  /** 턴을 끊은 Session이 아직 다시 열리지 않았나(`ThreadModel.severed`). */
  severed: Severed | null;
  /** Session을 띄우는 중인가(`ThreadModel.connecting`). */
  connecting: boolean;
  /** 이 턴의 머리에 서는 시스템 줄(worktree를 만듦) — 사람 말 뒤, 답의 줄 앞이다(화면 2 보드). */
  lead: readonly SystemLine[];
}

/**
 * 턴 하나. 값이 그대로인 턴은 다시 그리지 않는다 — 기록 줄이 늘어도 지난 턴의 값은 그대로다(`foldOf`). 시스템 줄은 값으로 견준다: 고른 배열은 그릴 때마다 새것이다.
 */
const TurnView = memo(function TurnView({ turn, runtime, open, waiting, compacting, last, actions, severed, connecting, lead }: TurnViewProps) {
  const thread = useContext(FlowThread);
  const onToggle = () => toggleTurn(turnKey(thread, turn.key));
  const running = turn.end === null;
  const tailed = running && last;
  const flow = useStore(threadFlowStore, (state) => (tailed ? (state[thread]?.kind ?? null) : null));
  const stream = useStore(threadFlowStore, (state) => (tailed ? (state[thread]?.stream ?? null) : null));
  const from = finalFrom(turn);
  // 글이 빈 생각은 그리지 않는다(`shownEntry`).
  const before = turn.entries.slice(0, from).filter(shownEntry);
  // 턴 끝의 답 사이에 선 카드의 결정 줄(Work 만들기 · Work 밖 Project …)은 그 자리에 함께 선다(화면 2 보드 — 물은 말 · 결정 · 답).
  const final = turn.end ? turn.entries.slice(from).filter((entry) => entry.kind === "message" || isCardDecision(entry)) : [];
  const stopped = turn.end?.stopReason === "cancelled" && turn.end.cancelledByUs;
  // 다시 이을 수 있을 때만 다시 잇자고 말한다 — 지난 턴과 읽기만인 채팅은 지난 일이다(`cutNotice`).
  const reconnectable = actions && severed && { failed: actions.reconnectFailure ?? severed.failed };
  const cut = cutNotice(turn, runtime, reconnectable);
  const notice = endNotice(turn) ?? cut;
  const reconnecting = cut !== null && actions !== null && reconnectable !== null && (connecting || actions.reconnecting);
  const finalText = final.flatMap((entry) => (entry.kind === "message" ? [entry.text] : [])).join("\n\n");
  // 작업 구분선(02 구현 스펙 §8) — 펼칠 것 없이 끝난 턴에는 없다. 구분선이 없거나 펼칠 것이 없는 턴은 늘 접힌 모양이다.
  const line = turn.end && !stopped ? workLine(turn) : null;
  const unfolded = open && (stopped || line?.unfolds === true);
  // 계획 카드 · 체크리스트 · 카드의 결정 줄 · 질문에 답한 줄 · 결과 카드는 접힌 턴에도 남는다(`keptFolded`) — 계획과 Work를 만들었는지 ·
  // 어느 Project를 붙였는지 · 무엇으로 답했는지 · 대화로 무엇을 설정했는지는 다시 보는 것이다. 턴 끝 자리의 결정 줄은 위의 `final`이 든다.
  // 턴 끝 자리(`from` 뒤)의 계획 · 체크리스트는 펼친 로그에 들지 않으므로 펼쳐도 여기 남는다.
  const kept = turn.end ? turn.entries.filter((entry, at) => keptFolded(entry) && (at < from ? !unfolded : !isCardDecision(entry))) : [];
  const keptRows = kept.map((entry) => <EntryView key={entry.key} entry={entry} />);
  return (
    <>
      {turn.sent !== null && (
        // 말풍선 앞은 흐름의 줄 사이(`TURN_GAP`)보다 2를 더 띄운다 — 답 끝 → 다음 말풍선 52(`TURN_GAP` 머리말).
        <div data-turn={turn.key} className="flex scroll-mt-16 flex-col not-first:mt-0.5">
          <UserMessage text={turn.sent} attachments={turn.attachments} quote={turn.quote} />
          {/* 대기 줄의 「지금 보내기」로 하던 턴을 끊고 들어간 말 — 말풍선 아래 4에 옅은 한 줄이 선다(Cards 「대기 중에 끼어든 말」). */}
          {turn.interjected && <span className="mt-1 self-end text-xs text-fg-tertiary">하던 일을 멈추고 보냄</span>}
        </div>
      )}
      {lead.map((line) => (
        <SystemRow key={line.key} line={line} />
      ))}
      {/* 아직 아무 줄도 오지 않은 도는 턴은 「답하는 중」 줄이 말한다(`answeringLine`) — 「생각 중」은 아직 서지 않는다. */}
      {(!running || turn.entries.length > 0 || flow !== null || compacting) && (
        // 도는 턴과 끝난 턴은 같은 상자이고 답은 같은 칸(`Entries`)에 선다 — 턴이 끝나도 그려 둔 답이 그대로 남는다.
        <div data-turn={turn.key} className="flex scroll-mt-16 flex-col items-start gap-2">
          {turn.end ? (
            stopped ? (
              <OpenedLog entries={before} open={unfolded} />
            ) : (
              <>
                {line && (
                  <>
                    <WorkDivider open={unfolded} onToggle={line.unfolds ? onToggle : undefined} arrival={turn.key}>
                      {line.text}
                    </WorkDivider>
                    {line.unfolds && <OpenedLog entries={before} open={unfolded} />}
                  </>
                )}
                {keptRows}
              </>
            )
          ) : (
            (lastWork(turn.entries) || flow) && <RunningHead turn={turn} waiting={waiting} />
          )}
          <Entries
            entries={turn.end ? final : turn.entries.filter(shownEntry)}
            muted={stopped}
            tail={flow === "message" && stream !== null ? <MessageView key={flowKey(stream)} /> : flow === "thought" ? <FlowingThought key="thought" /> : null}
          />
          {turn.end && stopped && (
            // 멈추기 전까지 흐른 답은 중단 줄 **위에** 옅게 남는다(보드 「중단」) — 끝난 답이 아니라 동작 버튼도 없다. 답은 도는 턴과 같은 칸이라 긴 답을 다시 그리지 않는다.
            <>
              <StopLine text={headline(turn.end)} open={unfolded} onToggle={onToggle} />
              {keptRows}
            </>
          )}
          {turn.end ? (
            <>
              <CreatedDocs turn={turn} name={runtime} />
              {reconnecting ? <ReconnectingLine /> : notice && <EndNoticeLine notice={notice} action={noticeAction(turn, cut, reconnectable, actions)} />}
              {last && !stopped && !notice && finalText !== "" && <AnswerActions text={finalText} usage={turn.usage} />}
            </>
          ) : (
            <>
              {!compacting && (flow ?? lastWork(turn.entries)?.kind) === "thought" && <p className="think-shimmer text-sm">생각 중</p>}
              {compacting && <p className="think-shimmer text-sm">대화를 정리하는 중</p>}
            </>
          )}
        </div>
      )}
    </>
  );
}, sameTurnView);

function sameTurnView(a: TurnViewProps, b: TurnViewProps): boolean {
  return (
    a.turn === b.turn &&
    a.runtime === b.runtime &&
    a.open === b.open &&
    a.waiting === b.waiting &&
    a.compacting === b.compacting &&
    a.last === b.last &&
    a.actions === b.actions &&
    a.severed === b.severed &&
    a.connecting === b.connecting &&
    a.lead.length === b.lead.length &&
    a.lead.every((line, at) => line === b.lead[at])
  );
}

/** 흐르던 글과 그 기록 줄이 함께 쓰는 열쇠 — 같은 칸의 같은 열쇠라 흐름이 줄이 되어도 그려 둔 글을 다시 그리지 않는다. */
const flowKey = (stream: number) => `flow-${stream}`;

/** 답 글 — `text`가 없으면 지금 흐르는 글이고 그 글을 구독한다. 조각을 구독하는 부품은 이것 하나다. 꼬리 모양은 02b-1이 맞춘다. */
function MessageView({ text, muted = false }: { text?: string; muted?: boolean }) {
  const thread = useContext(FlowThread);
  const flowing = useStore(threadFlowStore, (state) => (text === undefined ? state[thread]?.text : undefined));
  const follow = useContext(FollowTail);
  useLayoutEffect(() => {
    if (flowing) follow();
  }, [follow, flowing]);
  const shown = text ?? flowing;
  if (!shown) return null;
  return <ThreadMarkdown text={shown} streaming={text === undefined} className={cn("w-full", muted && "text-fg-secondary")} />;
}

/** 흐르는 생각 — 글이 빈 생각은 그리지 않는다. */
function FlowingThought() {
  const thread = useContext(FlowThread);
  const flowing = useStore(threadFlowStore, (state) => state[thread]?.text);
  const follow = useContext(FollowTail);
  useLayoutEffect(follow, [follow, flowing]);
  if (!flowing) return null;
  return <ThreadMarkdown text={flowing} className="w-full text-fg-tertiary" />;
}

/** 도는 턴의 머리줄 — 1초마다 걸린 시간을 다시 센다. 사람의 답을 기다리면 그 말이 링크 색으로 붙는다. */
function RunningHead({ turn, waiting }: { turn: Turn; waiting: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const text = runningHeadline(turn, now);
  // 작업 구분선 자리에 선다(02 구현 스펙 §8 · Screen-Live 단계 3 · 4) — 글은 그대로이고 그 아래 가는 선이 같다.
  return (
    <WorkDivider>
      {waiting ? (
        <span className="flex flex-wrap items-center gap-1.5">
          <span>{text}</span>
          <span aria-hidden>·</span>
          <span className="text-link">{waiting}</span>
        </span>
      ) : (
        <span className="chat-shimmer">{text}</span>
      )}
    </WorkDivider>
  );
}

/**
 * 턴의 줄들 — 잇따른 도구 줄은 작업 로그의 한 묶음이다(줄 사이 틈 없이, 묶음 줄 포함). 흐르는 꼬리는 줄들과 한 목록에 선다 — 기록 줄이 되어도 같은 열쇠다.
 */
function Entries({ entries, tail = null, muted = false }: { entries: readonly Entry[]; tail?: ReactNode; muted?: boolean }) {
  const runs: Entry[][] = [];
  for (const entry of entries) {
    const last = runs[runs.length - 1];
    if (entry.kind === "tool" && last && last[0].kind === "tool") last.push(entry);
    else runs.push([entry]);
  }
  const rows = runs.map((run) => {
    const [first] = run;
    if (first.kind === "tool") {
      return (
        <div key={first.key} data-log-run className="flex w-full flex-col">
          <ToolRows tools={run as ToolEntry[]} />
        </div>
      );
    }
    if (first.kind === "message") return <MessageView key={first.stream === undefined ? first.key : flowKey(first.stream)} text={first.text} muted={muted} />;
    if (muted) {
      return (
        <div key={first.key} className="w-full text-fg-secondary">
          <EntryView entry={first} />
        </div>
      );
    }
    return <EntryView key={first.key} entry={first} />;
  });
  return <>{tail === null ? rows : [...rows, tail]}</>;
}

/**
 * 펼친 작업 로그 — 작업 구분선을 누르면 생각 · 도구 줄 · 앞선 답이 높이와 투명도로 자라 나오고, 다시 누르면 줄어 걷힌다(02 구현 스펙 §12 ·
 * `Unfold`). 줄들은 턴의 줄 사이(8)를 그대로 따른다 — 자라는 상자는 위 8을 당겨 두고(`-mt-2`) 안에서 다시 띄워(`pt-2`), 다 접힌 상자가
 * 줄 사이를 하나 더 만들지 않는다.
 */
function OpenedLog({ entries, open }: { entries: readonly Entry[]; open: boolean }) {
  return (
    <Unfold open={open} className="-mt-2 w-full">
      <div className="flex flex-col items-start gap-2 pt-2">
        <Entries entries={entries} />
      </div>
    </Unfold>
  );
}

function EntryView({ entry }: { entry: Entry }) {
  switch (entry.kind) {
    case "message":
      return <ThreadMarkdown text={entry.text} className="w-full" />;
    case "thought":
      return <ThreadMarkdown text={entry.text} className="w-full text-fg-tertiary" />;
    case "tool":
      return <ToolRows tools={[entry]} />;
    case "plan":
      return (
        <div className="w-full">
          <PlanCard text={entry.text} />
        </div>
      );
    case "checklist":
      return (
        <div className="w-full">
          <Checklist items={entry.items} />
        </div>
      );
    case "decision":
      return <DecisionRow entry={entry} />;
    case "question":
      return <AnsweredRow entry={entry} />;
    case "result":
      return <ResultCard card={entry} />;
    case "warning":
      return <WarningLine warning={entry} />;
    case "unanswered":
      return <UnansweredRow entry={entry} />;
    // Thread 도구 카드의 결정 줄(Work 만들기 · Work 밖 Project · Service 질문 · Project 추가) — 갈래마다의 줄은 그 표다(`ToolCards.tsx`).
    default:
      return <ToolChoiceRow entry={entry} />;
  }
}

/**
 * 질문에 답한 줄(02 §10 「답한 카드」 — 겉은 `AnsweredCards`) — 물음마다 한 줄 카드다. 나중에로 닫은 질문은 미룬 표지(시계)와 「나중에
 * 답하기로 함」이다(`answeredCards`). 답을 기다리는 동안은 서지 않는다 — 입력창 자리의 질문 카드가 말한다.
 */
export function AnsweredRow({ entry }: { entry: QuestionEntry }) {
  return <AnsweredCards cards={answeredCards(entry)} card="question" choice={entry.choice ?? ""} arrival={entry.key} />;
}

/** 결정 줄(Screen-Thread · Approval 보드 `.done-line`) — 아이콘 16과 13/20 `fg-tertiary` 한 줄. 남긴 말은 뒤에 따옴표로 진하게 선다. */
function DecisionRow({ entry }: { entry: DecisionEntry }) {
  const Icon = entry.allowed ? Check : X;
  return (
    <p
      data-decision={entry.allowed ? "allowed" : "refused"}
      className={cn("flex min-h-7 flex-wrap items-center gap-2 text-chat-meta leading-5 text-fg-tertiary", useArrival("chip-in", entry.key))}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span>{decisionText(entry)}</span>
      {entry.words && <span className="min-w-0 text-fg-secondary wrap-anywhere">「{entry.words}」</span>}
    </p>
  );
}

/**
 * 답이 없어 닫힌 카드의 결정 줄(01c-8 · Tools 보드 「승인 결정 줄」의 마지막 줄 `.ra-decision.no`) — 승인 결정 줄의 거부와 같은 모양이다. Codex 채팅에서만
 * 선다 — Claude 채팅의 카드는 닫히지 않는다.
 */
function UnansweredRow({ entry }: { entry: UnansweredEntry }) {
  return (
    <p
      data-decision="unanswered"
      className={cn("flex min-h-7 flex-wrap items-center gap-2 text-chat-meta leading-5 text-fg-tertiary", useArrival("chip-in", entry.key))}
    >
      <X className="size-4 shrink-0" aria-hidden />
      <span>답이 없어 닫음 · Codex는 5분까지만 기다려요</span>
    </p>
  );
}

/**
 * 사람이 보낸 말(02 구현 스펙 §8 · Diff-Chat 「말풍선」) — 오른쪽 정렬, 줄 폭의 70%까지, 안쪽 10 / 16, 옅은 파랑 바탕(`bubble-user`)에
 * 짙은 남색 글자(`fg-bubble`). 둥글기는 superellipse 22이고 `corner-shape`가 없는 WebKit(앱 · L3)에서는 16의 둥근 네모다(S24 —
 * `speech`). 머리말은 기록에만 있다. 붙인 첨부는 위에 칩으로 선다.
 */
export function UserMessage({
  text,
  attachments = [],
  quote = null,
}: {
  text: string;
  attachments?: readonly Attachment[];
  quote?: Quote | null;
}) {
  const bubble = (
    <p className="max-w-[70%] self-end rounded-speech corner-superellipse bg-bubble-user px-4 py-2.5 text-fg-bubble whitespace-pre-wrap wrap-anywhere">
      {text}
    </p>
  );
  if (attachments.length === 0 && quote === null) return bubble;
  // 붙인 것은 말풍선 바로 위에 칩으로 선다(Messages 보드 「첨부」 — 칩과 말풍선 사이 8). 인용은 그 위다(v1 티켓 35).
  return (
    <div className="flex flex-col gap-2">
      {quote && <SentQuoteChip quote={quote} />}
      {attachments.length > 0 && <SentAttachments attachments={attachments} />}
      {bubble}
    </div>
  );
}

/** 안내 줄의 단추 — 끊긴 턴은 「다시 잇기」이고, 길이 제한과 턴 한도는 입력창을 채우는 「이어서」다. */
function noticeAction(
  turn: Turn,
  cut: EndNotice | null,
  reconnectable: Severed | null,
  actions: FlowActions | null,
): { label: string; run: () => void } | null {
  if (actions === null) return null;
  if (cut !== null) return reconnectable && { label: "다시 잇기", run: actions.reconnect };
  const ask = continueAsk(turn);
  return ask && { label: ask.label, run: () => actions.fill(ask.text) };
}

/**
 * 턴 끝의 안내 줄(Cards 보드 `.ra-notice` — 「실패한 턴」 · 「거절」 · 「턴 한도」 · 「연결 끊김」 · 「다시 잇지 못함」, Thread 보드 「길이 제한」). 끝에 단추
 * 하나가 설 수 있다. 모양은 02b-5가 맞춘다.
 */
function EndNoticeLine({ notice, action }: { notice: EndNotice; action: { label: string; run: () => void } | null }) {
  return (
    <div data-end-notice={notice.kind} className="flex w-full items-start gap-2 text-sm text-fg-secondary">
      <CircleAlert className="mt-0.5 size-4 shrink-0 text-fg" aria-hidden />
      <span className="min-w-0 flex-1 wrap-anywhere">
        <b className="font-medium text-fg">{notice.title}</b> {notice.detail}
      </span>
      {action && (
        <Button variant="outline" size="top" onClick={action.run}>
          {action.label}
        </Button>
      )}
    </div>
  );
}

/** 다시 잇는 중(Cards 보드 「다시 잇는 중」) — 안내 줄의 자리에 선다. 모양은 02b-5가 맞춘다. */
function ReconnectingLine() {
  return (
    <p data-end-notice="reconnecting" className="text-sm">
      <span className="chat-shimmer">다시 잇는 중</span>
    </p>
  );
}

/** 중단 줄(보드 「중단」) — ■ 「N초 후에 중단했습니다」. 누르면 멈추기 전까지 한 일이 펼쳐진다. */
function StopLine({ text, open, onToggle }: { text: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="flex items-center gap-1.5 text-chat-meta leading-5 text-fg-tertiary transition-colors hover:text-fg-secondary"
    >
      <span className="flex size-4 items-center justify-center" aria-hidden>
        <span className="size-2 rounded-2xs bg-current" />
      </span>
      {text}
    </button>
  );
}

/**
 * 응답 액션(02 구현 스펙 §8 · Diff-Chat 「응답 액션」) — 마지막으로 끝난 답에만 선다(`TurnView`). 글리프 15 `fg-subtle`이고, 버튼(24)은
 * 글리프가 열 왼쪽 끝에 서도록 그 안쪽만큼 왼쪽으로 낸다. 위로 2를 당겨 답 글자 잉크 → 글리프가 Codex의 15.5다(턴 안 줄 사이 8 + 버튼
 * 안쪽이 그보다 2 길다). 「…」는 무엇을 둘지 정해지기 전이라(P1) 그리지 않고 복사 하나다. 그 옆에 사용량이 호버 없이 선다(Cards 보드 「답 아래
 * 줄」 — 모양은 02b-6이 맞춘다). 모델을 부르지 않은 턴은 사용량이 없어 복사 하나다.
 */
function AnswerActions({ text, usage }: { text: string; usage: Usage | null }) {
  const [copied, setCopied] = useState(false);
  // 턴이 끝나 새로 서는 줄은 한 프레임 뒤에 선다. 이 줄을 더하는 배치가 답의 길이만큼 들어(9만 6천 자에 27ms) 턴 끝의 기록 줄들이 몰린 프레임에 얹으면 50ms를 넘는다
  // (01b-9).
  const late = useArrival("row-in") !== undefined;
  const [shown, setShown] = useState(!late);
  const follow = useContext(FollowTail);
  useEffect(() => {
    if (shown) return;
    const frame = window.requestAnimationFrame(() => setShown(true));
    return () => window.cancelAnimationFrame(frame);
  }, [shown]);
  useLayoutEffect(() => {
    if (shown && late) follow();
  }, [follow, shown, late]);
  if (!shown) return null;
  return (
    <div className="-mt-0.5 -ml-1 flex items-center">
      <button
        type="button"
        aria-label="답 복사"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => setCopied(true));
        }}
        className="icon-button-quiet icon-button-xs text-fg-subtle focus-ring"
      >
        {copied ? <Check className="size-3.75" aria-hidden /> : <Copy className="size-3.75" aria-hidden />}
      </button>
      {usage && (
        <span data-usage className="pl-2 text-xs text-fg-tertiary tabular-nums">
          {usageText(usage)}
        </span>
      )}
    </div>
  );
}

export default ThreadFlow;

/** 끝난 턴이 이은 Work의 spec 폴더에 새로 쓴 문서들의 카드(v1 티켓 35 · `DocCard`) — 자리를 모르면(Work 없음) 서지 않는다. */
function CreatedDocs({ turn, name }: { turn: Turn; name: string }) {
  const place = useContext(DocPlace);
  const docs = createdDocs(turn, place?.specRoot ?? null);
  if (!place || docs.length === 0) return null;
  return (
    <div className="flex w-full flex-col gap-2">
      {docs.map((doc) => (
        <DocCard key={doc.path} doc={doc} name={name} onOpen={() => place.open(doc.path)} />
      ))}
    </div>
  );
}

import { createContext, Fragment, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "@tanstack/react-store";
import { ArrowRight, Check, CircleAlert, Clock, Copy, Folder, GitBranch, Info, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AgentFace, FaceStack } from "./AgentFace";
import { decisionText } from "./approval";
import { useArrival } from "./arrival";
import { CallPlace, CallRow, type CallActions } from "./CallRow";
import {
  finalFrom,
  flowOf,
  headline,
  particle,
  runningHeadline,
  type CallEntry,
  type CastMember,
  type DecisionEntry,
  type Entry,
  type Notice,
  type ProjectChoiceEntry,
  type QuestionEntry,
  type SystemLine,
  type ThreadModel,
  type ToolEntry,
  type Turn,
  type WorkChoiceEntry,
} from "./fold";
import { SentAttachments } from "./ComposerAttachments";
import { DocCard } from "./DocCard";
import { createdDocs } from "./expanded";
import { mentionOf } from "./mentions";
import { Checklist, PlanCard } from "./PlanCard";
import { PrCard } from "./PrCard";
import { projectChoiceText } from "./project-card";
import { answeredText, saidOf } from "./question";
import { SentQuoteChip } from "./QuoteChip";
import ThreadMarkdown from "./ThreadMarkdown";
import type { Quote } from "@/features/works/QuotePick";
import type { Attachment } from "./types";
import { threadUiStore, toggleTurn, turnKey } from "./thread-store";
import { LogHead, ToolRows } from "./WorkLog";

// Thread의 흐름(v1 티켓 05 · 캔버스 Messages · WorkLog 보드) — 기록 줄을 접은 모델(`fold.ts`)을 그린다. three-axes 흐름
// (`chat/ChatThread.tsx`)을 옮겨 보드의 모양으로 고쳤다.
//
// - **말풍선은 내 말에만 쓴다** — 오른쪽 정렬 · 22 반경 · 옅은 파랑(`bubble-user`), 폭은 줄의 78%까지다. Agent의 답은 얼굴 · 이름 ·
//   `@handle` · 시각 아래에 본문 그대로 선다(Messages 보드 「다른 Agent의 말」 — Host는 handle 없이). 같은 Agent가 사람 말 없이 이어
//   말하면 이름 줄을 다시 쓰지 않는다(`Turn.namesWho`). 얼굴 · 이름은 들어옴 줄이 정본이다(`ThreadModel.cast`, v1 티켓 14).
// - **「답하는 중」**(Messages 보드 · Motion 보드 「Agent 참여」) — 답이 아직 안 보이는 도는 턴(보낸 말에 아직 아무 줄도 오지 않았거나,
//   흐름 끝이 아닌 자리에서 돈다)이 있으면 흐름 맨 아래에 얼굴(여럿이면 겹친 얼굴)과 「리뷰어와 테스터가 답하는 중」, 차례로 떠오르는
//   세 점이 한 줄로 선다(`answeringLine`). 그래서 아직 아무 줄도 오지 않은 턴은 이름 줄 없이 보낸 말만 서고, 첫 줄이 오면 그 자리에
//   이름 줄과 「생각 중」 · 답이 선다.
// - **작업 로그** — 일하는 동안은 「N초 동안 작업 중입니다」가 반짝이고 그 아래로 도구 줄이 쌓인다. 승인을 기다리면 「· 승인을
//   기다립니다」가 링크 색으로 붙는다. 끝나면 「N초 동안 작업함」 한 줄로 접히고 **턴 끝 메시지**(마지막 도구 뒤의 답)만 펼쳐 둔다.
//   머리줄을 누르면 생각 · 도구 줄 · 앞선 답이 펼쳐진다. 승인 카드에서 고른 것은 그 도구 줄 뒤의 결정 줄이다(v1 티켓 24 — 「✓ 명령
//   실행을 승인함 · 이 Work에서는 다시 묻지 않음」, 거부는 ✕와 남긴 말). Work 만들기 카드에서 고른 것도 결정 줄이고(v1 티켓 30 —
//   「✓ Work 만들기 · api-server · fix/refund-api」 · 「→ Work 없이 계속함」), 접힌 턴에도 남는다(화면 2 보드). 만든 Work는 턴 뒤의
//   시스템 줄 「📁 Work … 을 만들고 이 Thread에 연결함」이다.
// - **흐르는 답은 낱말이 도착하는 방식으로 선다**(`ThreadMarkdown`의 `streaming`). 답을 기다리는 동안은 「생각 중」이 반짝인다.
// - **오류와 중단은 색 대신 문장이다** — 답 없이 끊긴 턴은 「답하지 못했습니다. …」와 테두리 버튼 「다시 시도」(같은 말을 다시 보낸다),
//   우리가 멈춘 턴은 ■ 「N초 후에 중단했습니다」다.
// - **시스템 줄**(이름 바꾸기 · 들고 남)은 가운데 회색 한 줄이고 이름만 굵다. 들고 난 줄은 이름 앞에 그 얼굴이 선다(「● 리뷰어가
//   참여함」). 상태 줄(새로 시작함 · 죽음 · 판 경고)은 턴 사이의 옅은 줄이다.
// - 마지막 답 아래에는 동작 버튼(복사)이 늘 선다. 「다시 답하기」 · 「여기서 새 Thread」는 그 일을 하는 장이 단다.
// - **PR 카드**(v1 티켓 36 · `PrCard`) — 엔진이 그 Work의 PR이 처음 보였을 때와 상태가 바뀔 때 남긴 `pr` 줄이다. 시스템 줄처럼 턴 사이에
//   서고, 온 흐름에만 선다(그 Agent의 일이 아니라 Work의 일이다).
// - **호출 줄**(v1 티켓 17 · `CallRow`) — Agent가 다른 Agent에게 맡긴 부르기는 부른 턴 안의 카드 한 줄이고, 접힌 턴에도 남는다(계획
//   카드처럼 — 누가 무엇을 맡았는지는 다시 보는 것이다). 불린 Agent의 맡은 턴은 답을 받은 뒤에만 그 Agent의 말로 선다(`flowOf`).
// - **Session 보기**(S37 「Session 열기」, `only`) — 같은 흐름 부품으로 그 Agent의 줄만 그린다. 맡은 턴은 말풍선 자리에 「Host가 맡긴
//   일」을 세우고, 끝난 턴의 작업 로그는 처음부터 펼쳐 둔다 — 그 Agent가 한 일을 보러 온 보기다.
//
// - **대화 속 문서 카드**(v1 티켓 35 · Messages 보드 「Agent가 만든 파일」) — 끝난 턴에서 Agent가 이은 Work의 spec 폴더에 새로 쓴 문서는 답
//   아래에 카드로 놓이고(`createdDocs`), 누르면 Work 카드가 넓어져 그 문서를 연다(`DocPlace`). 접힌 턴에도 남는다.
// - **인용**(v1 티켓 35 · S41) — 넓힌 카드의 문서에서 고른 글을 붙인 말은 말풍선 위에 인용 칩이 선다(`SentQuoteChip`).
//
// - **움직임**(v1 티켓 43 · Motion 보드) — 화면이 선 뒤에 새로 선 것만 움직인다(`arrival.tsx`). 결정 줄은 칩으로 나타나고(칩 나타남 — 보드
//   「승인 카드 올라옴」의 답한 뒤 줄), 시스템 줄 · 「답하는 중」은 아래 4에서 떠오르며(줄 바뀜 — 보드 「Agent 참여」의 「시스템 줄과 답하는
//   중이 차례로 따라옵니다」), 턴이 끝나면 「N초 동안 작업함」이 같은 자리에서 떠오르고(줄 바뀜), 머리줄을 눌러 펼치면 줄들이 위에서부터
//   차례로 선다(로그 펼침). 흐르는 낱말은 `ThreadMarkdown`이 움직인다. 자리를 옮겨 다시 서는 줄(턴이 끝나 접힌 턴으로 옮겨 선 결정 줄 ·
//   Session 보기)은 기록 줄의 열쇠로 알아보고 다시 움직이지 않는다.
//
// **알림 영역이 아니다.** 흐르는 답이 조각마다 읽히지 않도록 `aria-live`도 `role="log"`도 없다.

/**
 * 대화 속 문서 카드의 자리(v1 티켓 35) — 이은 Work의 spec 폴더(절대 경로)와 그 문서를 넓힌 카드에서 여는 길. Work 없는 Thread · Session을
 * 띄운 화면 밖에서는 `null`이고 카드가 서지 않는다. 흐름의 모든 턴이 같은 값을 쓰므로 Context로 건넨다(`LogPlace` · `CallPlace`와 같다).
 */
export const DocPlace = createContext<{ specRoot: string; open: (path: string) => void } | null>(null);

interface ThreadFlowProps {
  thread: string;
  model: ThreadModel;
  /** Session 보기(S37) — 그 참여자의 줄만 그린다. 온 흐름이면 null이다. */
  only?: string | null;
  /** 답 없이 끊긴 턴의 「다시 시도」 — 그 턴의 말을 붙인 첨부와 함께 다시 보낸다. */
  onRetry: (text: string, attachments: readonly Attachment[]) => void;
  /** 호출 줄의 「Session 열기」 — 그 부르기를 받은 Agent의 Session 보기로 간다. */
  onOpenSession: (call: CallEntry) => void;
  /** 호출 줄의 「다시 맡기기」 — 같은 글로 부르기를 다시 한다. */
  onCallAgain: (call: CallEntry) => Promise<void>;
}

/** 참여자 한 사람 — 들어옴 줄에 없으면(옛 기록) handle이 이름이고 얼굴은 handle에서 정한다. */
const memberOf = (cast: Readonly<Record<string, CastMember>>, handle: string): CastMember =>
  cast[handle] ?? { name: handle, avatar: null };

function ThreadFlow({ thread, model, only = null, onRetry, onOpenSession, onCallAgain }: ThreadFlowProps) {
  const expanded = useStore(threadUiStore, (state) => state.expanded);
  const flow = flowOf(model, only);
  // PR 카드의 병합한 때(「어제 오후 6:12」)를 견줄 지금 — 흐름을 다시 그릴 때마다 읽는다.
  const now = Date.now();
  const between = (count: number) => [
    ...flow.notices.filter((notice) => notice.turnsBefore === count).map((notice) => <NoticeLine key={notice.key} notice={notice} />),
    ...flow.system
      .filter((line) => line.turn === undefined && line.turnsBefore === count)
      .map((line) => <SystemRow key={line.key} line={line} cast={model.cast} />),
    ...flow.calls.filter((one) => one.turnsBefore === count).map((one) => <CallRow key={one.entry.key} call={one.entry} />),
    ...flow.prs.filter((card) => card.turnsBefore === count).map((card) => <PrCard key={card.key} card={card} now={now} />),
  ];
  const last = flow.turns[flow.turns.length - 1];
  const actions = useMemo<CallActions>(
    () => ({
      cast: model.cast,
      asking: new Set(model.asks.map((request) => request.who)),
      openSession: onOpenSession,
      callAgain: onCallAgain,
    }),
    [model.cast, model.asks, onOpenSession, onCallAgain],
  );
  // Session 보기의 끝난 턴은 처음부터 펼쳐 둔다 — 그 열쇠에는 접은 턴이 든다(온 흐름의 펼침과 따로다).
  const keyOf = (turn: Turn) => turnKey(thread, only === null ? turn.key : `${only}\u0000${turn.key}`);
  const isOpen = (turn: Turn) => (only === null ? expanded[keyOf(turn)] === true : expanded[keyOf(turn)] !== true);
  return (
    <CallPlace.Provider value={actions}>
      <div className="flex flex-col gap-6 text-chat-body">
        {between(0)}
        {flow.turns.map((turn, at) => (
          <Fragment key={turn.key}>
            <TurnView
              turn={turn}
              member={turn.who ? memberOf(model.cast, turn.who) : null}
              cast={model.cast}
              task={only !== null}
              open={isOpen(turn)}
              onToggle={() => toggleTurn(keyOf(turn))}
              waiting={turn.end === null ? waitingFor(model, turn.who ?? "host") : null}
              last={turn === last}
              onRetry={onRetry}
              lead={flow.system
                .filter((line) => line.turn === turn.key)
                .map((line) => (
                  <SystemRow key={line.key} line={line} cast={model.cast} />
                ))}
            />
            {between(at + 1)}
          </Fragment>
        ))}
        {flow.answering && (
          <AnsweringRow people={flow.answering.map((handle) => ({ handle, ...memberOf(model.cast, handle) }))} />
        )}
      </div>
    </CallPlace.Provider>
  );
}

/**
 * 「답하는 중」(Messages 보드 `.typing`) — 얼굴 20을 겹치고(`-5` · 바탕 고리 2) 「리뷰어와 테스터가 답하는 중」 13/20 `fg-tertiary`,
 * 그 뒤에 세 점이 차례로 떠오른다(`typing-dots` · `duration-pulse`). 점은 그림이라 숨고 문장이 말한다.
 */
function AnsweringRow({ people }: { people: readonly { handle: string; name: string; avatar: CastMember["avatar"] }[] }) {
  const names = people.map((one) => one.name);
  const lastName = names[names.length - 1];
  const said =
    names.length === 1
      ? `${lastName}${particle(lastName, "이", "가")}`
      : `${names.slice(0, -1).join(", ")}${particle(names[names.length - 2], "과", "와")} ${lastName}${particle(lastName, "이", "가")}`;
  return (
    <p data-answering className={cn("flex items-center gap-2 text-chat-meta leading-5 text-fg-tertiary", useArrival("row-in"))}>
      {people.length === 1 ? (
        <AgentFace handle={people[0].handle} avatar={people[0].avatar} className="size-5" />
      ) : (
        <FaceStack people={people} label="답하는 이" faceClass="size-5" className="-space-x-1" />
      )}
      <span>{said} 답하는 중</span>
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
 * 도는 턴의 머리줄 끝에 붙는 기다림 — 그 참여자가 물은 것이 있으면 무엇을 기다리는지다. 승인은 시안 문장 그대로(「승인을 기다립니다」),
 * 시안에 없는 셋은 해요체다(코드 리뷰 1차 A4).
 */
function waitingFor(model: ThreadModel, who: string): string | null {
  const ask = model.asks.find((one) => one.who === who);
  if (!ask) return null;
  if (ask.card === "work") return "Work 만들기 답을 기다려요";
  if (ask.card === "project") return "Work 밖 Project 답을 기다려요";
  return ask.card === "question" ? "질문의 답을 기다려요" : "승인을 기다립니다";
}

/**
 * 시스템 줄(보드 `.sys`) — 가운데 13/20 `fg-tertiary`, 이름만 500 `fg`. 들고 난 줄 · Library에 저장한 줄은 이름 앞에 그 얼굴이 선다 —
 * 저장한 Agent는 참여자가 아니라 줄이 실은 얼굴이다. Work를 만든 줄은 앞에 폴더 14가, worktree를 만든 줄은 앞에 브랜치 14가 선다(화면 2
 * 보드, 사이 6). 끝의 고정폭 조각(브랜치)은 빈칸 하나를 앞에 실어 글로 읽어도 「만듦 · fix/refund-api」다.
 */
function SystemRow({ line, cast }: { line: SystemLine; cast: Readonly<Record<string, CastMember>> }) {
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
      {/* 앞말의 끝 빈칸을 지킨다 — 줄 상자가 flex라 글 조각 끝의 빈칸이 접혀 「Library에」와 얼굴이 붙는다. */}
      {line.before && <span className="whitespace-pre">{line.before}</span>}
      {line.handle && (
        <AgentFace
          handle={line.handle}
          avatar={line.avatar !== undefined ? line.avatar : memberOf(cast, line.handle).avatar}
          className="mr-1.5 size-4"
        />
      )}
      <b className="font-medium text-fg">{line.name}</b>
      {line.after}
      {line.code && <span className="whitespace-pre font-mono text-xs">{` ${line.code}`}</span>}
    </p>
  );
}

function TurnView({
  turn,
  member,
  cast,
  task,
  open,
  onToggle,
  waiting,
  last,
  onRetry,
  lead,
}: {
  turn: Turn;
  member: CastMember | null;
  cast: Readonly<Record<string, CastMember>>;
  /** 맡은 턴이면 맡긴 일을 말풍선 자리에 세우나 — Session 보기만 세운다(온 흐름에서는 호출 줄이 그 말을 든다). */
  task: boolean;
  open: boolean;
  onToggle: () => void;
  /** 사람의 답을 기다리면 그 말(「승인을 기다립니다」) — 머리줄 끝에 링크 색으로 붙는다. */
  waiting: string | null;
  last: boolean;
  onRetry: (text: string, attachments: readonly Attachment[]) => void;
  /** 이 턴의 머리에 서는 시스템 줄(worktree를 만듦) — 사람 말 뒤, Agent의 줄 앞이다(화면 2 보드). */
  lead: ReactNode[];
}) {
  const from = finalFrom(turn);
  const lastEntry = turn.entries[turn.entries.length - 1];
  // 글이 빈 생각은 그리지 않는다 — Claude Code는 생각의 글을 빈 문자열로 준다. 지금 생각하는 중이면 「생각 중」으로만 선다.
  const said = (entry: Entry) => entry.kind !== "thought" || entry.text.trim() !== "";
  const before = turn.entries.slice(0, turn.end ? from : turn.entries.length).filter(said);
  // 턴 끝의 답 사이에 선 카드의 결정 줄(Work 만들기 · Work 밖 Project)은 그 자리에 함께 선다(화면 2 보드 — 물은 말 · 결정 · 답).
  const choice = (entry: Entry) => entry.kind === "work-choice" || entry.kind === "project-choice";
  const final = turn.end ? turn.entries.slice(from).filter((entry) => entry.kind === "message" || choice(entry)) : [];
  // 계획 카드 · 체크리스트 · 호출 줄 · 카드의 결정 줄 · 질문에 답한 줄은 접힌 턴에도 남는다 — 계획과 누가 무엇을 맡았는지 · Work를
  // 만들었는지 · 어느 Project를 붙였는지 · 무엇으로 답했는지는 다시 보는 것이다. 턴 끝 자리의 결정 줄은 위의 `final`이 든다.
  const kept =
    turn.end && !open
      ? turn.entries.filter(
          (entry, at) =>
            entry.kind === "plan" ||
            entry.kind === "checklist" ||
            entry.kind === "call" ||
            entry.kind === "question" ||
            (choice(entry) && at < from),
        )
      : [];
  // 아직 아무 줄도 오지 않은 도는 턴은 「답하는 중」 줄이 말한다(`answeringLine`) — 이름 줄도 「생각 중」도 아직 서지 않는다.
  const waitingFirst = !turn.end && turn.entries.length === 0;
  const thinking = !turn.end && lastEntry?.kind === "thought";
  const stopped = turn.end?.stopReason === "cancelled" && turn.end.cancelledByUs;
  const failed = turn.end !== null && turn.end.stopReason === null && final.length === 0;
  const finalText = final.flatMap((entry) => (entry.kind === "message" ? [entry.text] : [])).join("\n\n");
  // 사람이 머리줄을 눌러 펼쳤나 — 펼친 줄들은 그때만 차례로 선다(Session 보기가 처음부터 펼쳐 둔 턴 · 다시 연 Thread는 그대로 선다).
  const [clicked, setClicked] = useState(false);
  const toggle = () => {
    setClicked(true);
    onToggle();
  };
  return (
    <>
      {turn.sent !== null && (
        <div data-turn={turn.key} className="flex scroll-mt-16 flex-col">
          <UserMessage text={turn.sent} to={turn.who} attachments={turn.attachments} quote={turn.quote} />
        </div>
      )}
      {task && turn.assigned && <AssignedTask call={turn.assigned} cast={cast} turn={turn.key} />}
      {lead}
      {!waitingFirst && (
        <div data-turn={turn.key} className="flex scroll-mt-16 flex-col items-start gap-2">
          {turn.namesWho && turn.who && member && (
            <WhoRow handle={turn.who} member={member} at={turn.answeredAt ?? turn.startedAt} />
          )}
          {turn.end ? (
            failed ? (
              <ErrorLine
                error={turn.end.error}
                retry={turn.sent === null ? null : () => onRetry(turn.sent ?? "", turn.attachments)}
              />
            ) : stopped ? (
              // 멈추기 전까지 흐른 답은 중단 줄 **위에** 옅게 남는다(보드 「중단」) — 끝난 답이 아니라 동작 버튼도 없다.
              <>
                {open && <OpenedLog entries={before} moving={clicked} />}
                {final.map((entry) => (
                  <div key={entry.key} className="w-full text-fg-secondary">
                    <EntryView entry={entry} streaming={false} />
                  </div>
                ))}
                <StopLine text={headline(turn.end)} open={open} onToggle={toggle} />
              </>
            ) : (
              <>
                <LogHead open={open} onToggle={toggle} arrival={turn.key}>
                  {headline(turn.end)}
                </LogHead>
                {open && <OpenedLog entries={before} moving={clicked} />}
              </>
            )
          ) : (
            <>
              {turn.entries.length > 0 && <RunningHead turn={turn} waiting={waiting} />}
              <Entries entries={before} streaming />
              {thinking && <p className="chat-shimmer text-sm">생각 중</p>}
            </>
          )}
          {kept.map((entry) => (
            <EntryView key={entry.key} entry={entry} streaming={false} />
          ))}
          {!stopped &&
            final.map((entry) => <EntryView key={entry.key} entry={entry} streaming={false} />)}
          {turn.end && <CreatedDocs turn={turn} name={member?.name ?? turn.who ?? "Host"} />}
          {turn.end && last && !stopped && finalText !== "" && <AnswerActions text={finalText} />}
        </div>
      )}
    </>
  );
}

/** 이름 줄(보드 `.who`) — 얼굴 20 · 이름 600 13/20 · `@handle`(Host는 없다) · 시각 12 `fg-tertiary`. */
function WhoRow({ handle, member, at }: { handle: string; member: CastMember; at: string }) {
  return (
    <div className="flex items-center gap-2 text-chat-meta leading-5">
      <AgentFace handle={handle} avatar={member.avatar} className="size-5" />
      <b className="font-semibold">{member.name}</b>
      {handle !== "host" && <span className="text-xs text-fg-tertiary">@{handle}</span>}
      <time dateTime={at} className="text-xs text-fg-tertiary">
        {clock(at)}
      </time>
    </div>
  );
}

/** 「오후 2:31」 — 이름 줄의 시각. */
function clock(at: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("ko-KR", { hour: "numeric", minute: "2-digit" });
}

/** 도는 턴의 머리줄 — 1초마다 걸린 시간을 다시 센다. 사람의 답을 기다리면 그 말이 링크 색으로 붙는다. */
function RunningHead({ turn, waiting }: { turn: Turn; waiting: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const text = runningHeadline(turn, now);
  return waiting ? (
    <p className="flex flex-wrap items-center gap-1.5 text-sm text-fg-tertiary">
      <span>{text}</span>
      <span aria-hidden>·</span>
      <span className="text-link">{waiting}</span>
    </p>
  ) : (
    <p className="chat-shimmer text-sm">{text}</p>
  );
}

/** 턴의 줄들 — 잇따른 도구 줄은 작업 로그의 한 묶음이다(줄 사이 틈 없이, 묶음 줄 포함). */
function Entries({ entries, streaming }: { entries: readonly Entry[]; streaming: boolean }) {
  const runs: Entry[][] = [];
  for (const entry of entries) {
    const tail = runs[runs.length - 1];
    if (entry.kind === "tool" && tail && tail[0].kind === "tool") tail.push(entry);
    else runs.push([entry]);
  }
  const lastEntry = entries[entries.length - 1];
  return (
    <>
      {runs.map((run) =>
        run[0].kind === "tool" ? (
          <div key={run[0].key} data-log-run className="flex w-full flex-col">
            <ToolRows tools={run as ToolEntry[]} />
          </div>
        ) : (
          <EntryView key={run[0].key} entry={run[0]} streaming={streaming && run[0] === lastEntry} />
        ),
      )}
    </>
  );
}

/**
 * 펼친 작업 로그(보드 「작업 로그 펼침」) — 사람이 머리줄을 눌러 펼치면 줄들이 위에서부터 차례로 선다(`log-open`, `moving`). 줄을 감싼
 * 상자는 자리를 차지하지 않아(`contents`) 줄들이 그대로 턴의 줄 사이에 선다. 차례는 화면의 줄마다다 — 잇따른 도구 줄은 한 묶음
 * 상자(`data-log-run`)에 들어 있어 그 안의 줄까지 위에서부터 세어 줄마다 적는다(`--log-at`). 그리기 전에 적어(`useLayoutEffect`) 첫
 * 장면부터 제 차례의 늦음으로 선다.
 */
function OpenedLog({ entries, moving }: { entries: readonly Entry[]; moving: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!moving || !box.current) return;
    const rows = box.current.querySelectorAll<HTMLElement>(":scope > :not([data-log-run]), :scope > [data-log-run] > *");
    rows.forEach((row, at) => row.style.setProperty("--log-at", String(at)));
  }, [moving]);
  return (
    <div ref={box} className={cn("contents", moving && "log-open")}>
      <Entries entries={entries} streaming={false} />
    </div>
  );
}

function EntryView({ entry, streaming }: { entry: Entry; streaming: boolean }) {
  switch (entry.kind) {
    case "message":
      return <ThreadMarkdown text={entry.text} streaming={streaming} className="w-full" />;
    case "thought":
      return <ThreadMarkdown text={entry.text} className="w-full text-fg-tertiary" />;
    case "tool":
      return <ToolRows tools={[entry]} />;
    case "call":
      return <CallRow call={entry} />;
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
    case "work-choice":
      return <WorkChoiceRow entry={entry} />;
    case "question":
      return <AnsweredRow entry={entry} />;
    case "project-choice":
      return <ProjectChoiceRow entry={entry} />;
  }
}

/**
 * Work 밖 Project 결정 줄(v1 티켓 32 · Cards 보드 「결정한 뒤」 `.done`) — 승인 결정 줄과 같은 모양에 폴더 글리프, Project 이름은
 * `fg-secondary`(보드 `.o`)다. 「web-app을 이 Work에 붙임」 · 「web-app을 읽기만 하기로 함」 · 「web-app을 고치지 않기로 함」.
 */
function ProjectChoiceRow({ entry }: { entry: ProjectChoiceEntry }) {
  const { name, after } = projectChoiceText(entry.choice, entry.project);
  return (
    <p
      data-decision={`project-${entry.choice}`}
      className={cn("flex min-h-7 flex-wrap items-center gap-2 text-chat-meta leading-5 text-fg-tertiary", useArrival("chip-in", entry.key))}
    >
      <Folder className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 wrap-anywhere">
        <span className="text-fg-secondary">{name}</span>
        {after}
      </span>
    </p>
  );
}

/**
 * Work 만들기 결정 줄(화면 2 보드 `.done-line` · Cards 보드 「결정한 뒤」 `.done`) — 승인 결정 줄과 같은 모양이다. 만들었으면 ✓와 「Work
 * 만들기 · api-server · fix/refund-api」, 아니면 →와 「Work 없이 계속함」.
 */
function WorkChoiceRow({ entry }: { entry: WorkChoiceEntry }) {
  const Icon = entry.created ? Check : ArrowRight;
  const text = entry.created
    ? ["Work 만들기", ...entry.projects, ...(entry.branch ? [entry.branch] : [])].join(" · ")
    : "Work 없이 계속함";
  return (
    <p
      data-decision={entry.created ? "work-created" : "work-skipped"}
      className={cn("flex min-h-7 flex-wrap items-center gap-2 text-chat-meta leading-5 text-fg-tertiary", useArrival("chip-in", entry.key))}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 wrap-anywhere">{text}</span>
    </p>
  );
}

/**
 * 질문에 답한 줄(Cards 보드 「답한 뒤」 `.done`) — ✓ 14와 13/20 `fg-tertiary`, 답은 `fg-secondary`(「답함: **비율대로 돌려준다**」). 답을
 * 기다리는 동안은 서지 않는다 — 입력창 자리의 질문 카드가 말한다.
 */
function AnsweredRow({ entry }: { entry: QuestionEntry }) {
  const motion = useArrival("chip-in", entry.key);
  if (entry.choice === null) return null;
  const said = saidOf(entry);
  // 나중에로 닫은 질문은 답하지 않았다 — 답한 표지(✓) 대신 미룬 표지다.
  const Icon = said === null ? Clock : Check;
  return (
    <p
      data-answered={entry.choice}
      className={cn("flex min-h-7 flex-wrap items-center gap-1.5 text-chat-meta leading-5 text-fg-tertiary", motion)}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 wrap-anywhere">
        {said === null ? answeredText(entry) : <>답함: <span className="text-fg-secondary">{said}</span></>}
      </span>
    </p>
  );
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
 * 사람이 보낸 말(보드 `.ubub`) — 오른쪽 정렬, 22 반경, 옅은 파랑, 줄 폭의 78%까지. 머리말은 기록에만 있다. 붙인 첨부는 위에 칩으로
 * 선다. 받는 이를 고른 멘션은 링크 색 500이다(보드 「길게 · 멘션」, v1 티켓 14 — `mentionOf`).
 */
export function UserMessage({
  text,
  to = null,
  attachments = [],
  quote = null,
}: {
  text: string;
  to?: string | null;
  attachments?: readonly Attachment[];
  quote?: Quote | null;
}) {
  const mention = to === null ? null : mentionOf(text, to);
  const bubble = (
    <p className="max-w-[78%] self-end rounded-bubble bg-bubble-user px-4 py-2.25 whitespace-pre-wrap wrap-anywhere">
      {mention ? (
        <>
          {text.slice(0, mention.start)}
          <span className="font-medium text-link">{text.slice(mention.start, mention.end)}</span>
          {text.slice(mention.end)}
        </>
      ) : (
        text
      )}
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

/**
 * 맡긴 일(Session 보기의 맡은 턴 머리) — 그 Agent에게 간 말이라 말풍선 자리(오른쪽)에 서되, 사람의 말이 아니라 옅은 회색 면이고 위에 부른
 * Agent의 얼굴 · 「Host가 맡긴 일」이 선다.
 */
function AssignedTask({ call, cast, turn }: { call: CallEntry; cast: Readonly<Record<string, CastMember>>; turn: string }) {
  const from = memberOf(cast, call.from);
  return (
    <div data-turn={turn} className="flex scroll-mt-16 flex-col items-end gap-1.5">
      <p className="flex items-center gap-1.5 text-xs text-fg-tertiary">
        <AgentFace handle={call.from} avatar={from.avatar} className="size-4" />
        {from.name}
        {particle(from.name, "이", "가")} 맡긴 일
      </p>
      <p className="max-w-[78%] rounded-bubble bg-fill-soft px-4 py-2 whitespace-pre-wrap wrap-anywhere">{call.text}</p>
    </div>
  );
}

/** 오류 줄(보드 `.errl`) — 원 안의 느낌표 · 문장 · 테두리 버튼 「다시 시도」(그림 없이 28 · 10 반경). 끊긴 까닭은 문장 뒤에 붙는다. */
function ErrorLine({ error, retry }: { error: string | null; retry: (() => void) | null }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-fg-secondary">
      <CircleAlert className="size-4 shrink-0 text-fg" aria-hidden />
      <span>답하지 못했습니다. {error ? `${error}.` : "Claude Code와 연결이 끊겼어요."}</span>
      {retry && (
        <Button variant="outline" className="h-7" onClick={retry}>
          다시 시도
        </Button>
      )}
    </div>
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

/** 마지막 답 아래의 동작 버튼(보드 `.aact`) — 지금은 복사 하나다. */
function AnswerActions({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="-ml-1.5 flex gap-0.5">
      <button
        type="button"
        aria-label="답 복사"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => setCopied(true));
        }}
        className={cn("icon-button-quiet text-fg-secondary focus-ring")}
      >
        {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
      </button>
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

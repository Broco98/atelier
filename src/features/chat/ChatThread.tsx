import { Fragment, useEffect, useState } from "react";
import { useStore } from "@tanstack/react-store";
import { ChevronDown, ChevronRight, Info, TriangleAlert } from "lucide-react";
import { chatUiStore, toggleTurn, turnKey } from "./chat-store";
import ChatMarkdown from "./ChatMarkdown";
import { Checklist, PlanCard } from "./PlanCard";
import { SentQuoteChip } from "./QuoteChip";
import ToolRow from "./ToolRow";
import { finalFrom, headline, runningHeadline, type ChatModel, type Entry, type Notice, type Turn } from "./fold";
import type { Quote } from "./types";

// 대화 한 개의 흐름(three-axes 티켓 17) — 기록 줄을 접은 모델(`fold.ts`)을 그린다. 사람의 말은 오른쪽 말풍선, 에이전트의 답은
// 마크다운 본문이고, 생각하는 동안은 「생각 중」이 반짝인다. 턴이 끝나면 생각 · 도구 줄 · 앞선 답이 「N초 동안 작업함」 머리줄
// 아래로 접히고 **턴 끝 메시지**(마지막 도구 호출 뒤의 답)만 펼쳐 둔다. 머리줄을 누르면 펼친다.
//
// 우리가 멈춘 턴(three-axes 티켓 20)에서 멈출 때 열려 있던 도구 줄은 접힌 턴에서도 머리줄 아래에 남는다 — 멈췄는데 무엇이 아직
// 도는지 보이고, 늦게 온 출력이 그 줄에 붙는다(결정 28 · 스토리 55). 에이전트가 스스로 이어 간 턴은 머리줄 옆에 「스스로 이어
// 감」 표지가 서고 사용자 메시지가 없다(S4 · 스토리 45).
//
// 계획(three-axes 티켓 21)은 흐름 안의 카드로 선다 — 엔진의 마크다운 계획은 계획 카드, ACP `plan`은 체크리스트다(`PlanCard`). 둘 다
// 대화에 하나라 다음 것이 오면 같은 카드가 바뀌고, 접힌 턴에도 남는다.
//
// 상태 줄(three-axes 티켓 23) — 되살리기가 새 세션으로 끝남 · 프로세스 죽음 · 판 경고는 턴 사이에 한 줄로 선다(`Notice`). 접은 모델이
// 그 줄 앞에 선 턴 수를 들고 와서, 그 턴들 뒤 · 다음 턴 앞에 끼운다.
//
// **알림 영역이 아니다.** 흐르는 답이 조각마다 읽히지 않도록 이 흐름에는 `aria-live`도 `role="log"`도 없다 — 턴 끝에 대화창 밖
// 알림 자리(`ChatAnnouncer`)가 한 번 읽는다(스토리 121).

interface ChatThreadProps {
  /** 대화 열쇠(`conversationKey`) — 펼친 턴을 기억하는 열쇠의 앞부분이다. */
  conversationKey: string;
  /** 그 대화의 기록 줄을 접은 값(`foldConversation`) — 대화 몸이 한 번 접어 흐름 · 알약 · 입력창에 함께 준다. */
  model: ChatModel;
}

function ChatThread({ conversationKey, model }: ChatThreadProps) {
  const expanded = useStore(chatUiStore, (state) => state.expanded);
  const noticesAfter = (count: number) =>
    model.notices.filter((notice) => notice.after === count).map((notice) => <NoticeLine key={notice.key} notice={notice} />);
  return (
    <div className="flex flex-col gap-4 text-row leading-(--chat-leading-prose)">
      {noticesAfter(0)}
      {model.turns.map((turn, at) => {
        const key = turnKey(conversationKey, turn.key);
        return (
          <Fragment key={turn.key}>
            <TurnView turn={turn} open={expanded[key] === true} onToggle={() => toggleTurn(key)} />
            {noticesAfter(at + 1)}
          </Fragment>
        );
      })}
    </div>
  );
}

/**
 * 상태 줄 하나 — 머리줄과 같은 옅은 글자의 한 줄이다(보드에 없는 부품이라 머리줄의 꼴을 따른다). 「새로 시작함」은 알림(ⓘ), 죽음 ·
 * 판 경고는 경고 그림이다. 그림은 숨고 글이 말한다. 알림 영역이 아니다 — 흐름의 한 줄이고, 다시 그려도 다시 읽히지 않는다.
 */
function NoticeLine({ notice }: { notice: Notice }) {
  const Icon = notice.kind === "fresh" ? Info : TriangleAlert;
  return (
    <p data-notice={notice.kind} className="flex items-start gap-1.5 text-ui text-tertiary">
      <Icon className="mt-[3px] size-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
      <span className="min-w-0 wrap-anywhere">{notice.text}</span>
    </p>
  );
}

function TurnView({ turn, open, onToggle }: { turn: Turn; open: boolean; onToggle: () => void }) {
  const from = finalFrom(turn);
  // 접힌 턴은 턴 끝 메시지와 멈춘 뒤에도 돈 도구 줄만, 펼친 턴과 도는 턴은 모든 줄을 보인다.
  const last = turn.entries[turn.entries.length - 1];
  // 글이 빈 생각은 그리지 않는다 — Claude 2.1.296은 생각의 글을 빈 문자열로 준다(실측 T14). 지금 생각하는 중이면 「생각 중」으로만
  // 선다. 빈 줄이 도구 줄 사이에 서면 흐름의 틈이 겹치고 잇따른 도구 줄의 묶음이 갈린다(three-axes 티켓 18).
  const said = (entry: Entry) => entry.kind !== "thought" || entry.text.trim() !== "" || (!turn.end && entry === last);
  // 계획 카드와 체크리스트도 접힌 턴에 남는다 — 계획은 문서처럼 다시 읽는 것이고(스토리 65), 「다시 짜기」로 끝난 턴에서는
  // 무엇을 고칠지 말하려면 그 계획을 보아야 한다(three-axes 티켓 21).
  const shown =
    turn.end && !open
      ? turn.entries.filter(
          (entry, at) =>
            (at >= from && entry.kind === "message") ||
            (entry.kind === "tool" && entry.stop === "ran-on") ||
            entry.kind === "plan" ||
            entry.kind === "checklist",
        )
      : turn.entries.filter(said);
  return (
    <>
      {turn.sent !== null && <UserMessage text={turn.sent} quote={turn.quote} />}
      {turn.end ? (
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-expanded={open}
            onClick={onToggle}
            className="flex w-fit items-center gap-1 text-ui text-tertiary transition-colors hover:text-muted-foreground"
          >
            {headline(turn.end)}
            {open ? (
              <ChevronDown className="size-3" strokeWidth={1.8} aria-hidden />
            ) : (
              <ChevronRight className="size-3" strokeWidth={1.8} aria-hidden />
            )}
          </button>
          {turn.selfContinued && <SelfContinued />}
        </div>
      ) : (
        // 보낸 직후(줄이 아직 없다)는 「생각 중」 하나, 일하는 동안은 걸린 시간 머리줄 + 선 아래로 줄이 쌓인다(보드 14 ① · ②).
        turn.entries.length > 0 && <RunningHead turn={turn} />
      )}
      {turn.end && open && <hr className="border-0 border-t-[0.5px] border-(--chat-border-heavy)" />}
      {runs(shown).map((run) =>
        run[0].kind === "tool" ? (
          // 잇따른 도구 줄은 한 묶음이다 — 줄 사이가 흐름의 틈(16)이 아니라 4다(캔버스 `.cx-tools`).
          <div key={run[0].key} className="flex flex-col gap-1">
            {run.map((entry) => (
              <EntryView key={entry.key} entry={entry} end={turn.end} thinking={false} />
            ))}
          </div>
        ) : (
          <EntryView key={run[0].key} entry={run[0]} end={turn.end} thinking={!turn.end && run[0] === last} />
        ),
      )}
      {!turn.end && turn.entries.length === 0 && <Thinking />}
    </>
  );
}

/** 그릴 줄을 묶는다 — 잇따른 도구 줄은 한 묶음, 그 밖의 줄은 하나씩이다. */
function runs(entries: readonly Entry[]): Entry[][] {
  const out: Entry[][] = [];
  for (const entry of entries) {
    const last = out[out.length - 1];
    if (entry.kind === "tool" && last && last[0].kind === "tool") last.push(entry);
    else out.push([entry]);
  }
  return out;
}

/** 도는 턴의 머리줄 — 1초마다 걸린 시간을 다시 센다. */
function RunningHead({ turn }: { turn: Turn }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-ui text-tertiary">{runningHeadline(turn, now)}</span>
        {turn.selfContinued && <SelfContinued />}
      </div>
      <hr className="border-0 border-t-[0.5px] border-(--chat-border-heavy)" />
    </div>
  );
}

/** 「스스로 이어 감」 표지 — 보낸 말 없이 에이전트가 백그라운드 작업 알림으로 이어 간 턴이다(S4). 앱 꼬리표(`tag`)의 모양이다. */
function SelfContinued() {
  return <span className="tag text-caption">스스로 이어 감</span>;
}

function Thinking() {
  return <p className="chat-shimmer font-medium">생각 중</p>;
}

/**
 * 사람이 보낸 말 — 기록의 `sent`에서 화면 글만 그린다. 머리말 · 인용 블록(에이전트에게 간 참조 꼴)은 기록에만 있다. 인용을 붙여
 * 보냈으면 말풍선 바로 위에 그 인용 칩이 선다(three-axes 티켓 27 · 스토리 81).
 */
function UserMessage({ text, quote }: { text: string; quote: Quote | null }) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      {quote && <SentQuoteChip quote={quote} />}
      <p className="max-w-[min(85%,560px)] whitespace-pre-wrap rounded-(--chat-radius-bubble) bg-(--chat-bubble) px-4 py-2.5 wrap-anywhere">
        {text}
      </p>
    </div>
  );
}

function EntryView({ entry, end, thinking }: { entry: Entry; end: Turn["end"]; thinking: boolean }) {
  switch (entry.kind) {
    case "message":
      return <ChatMarkdown text={entry.text} />;
    case "thought":
      // 지금 생각하는 중이면 「생각 중」이 반짝이고, 지나간 생각은 펼친 턴에서 옅은 글로 읽힌다.
      return thinking ? <Thinking /> : <ChatMarkdown text={entry.text} className="text-tertiary" />;
    case "tool":
      // 도구 줄 — 진행형 → 완료형 문구 · 명령 출력 · diff · MCP(티켓 18), 멈춘 턴의 줄(티켓 20).
      return <ToolRow tool={entry} end={end} />;
    case "plan":
      return <PlanCard text={entry.text} />;
    case "checklist":
      return <Checklist items={entry.items} />;
  }
}

export default ChatThread;

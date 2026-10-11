import { useEffect, useState } from "react";
import { useStore } from "@tanstack/react-store";
import { ChevronDown, ChevronRight } from "lucide-react";
import { chatUiStore, toggleTurn, turnKey } from "./chat-store";
import ChatMarkdown from "./ChatMarkdown";
import { SentQuoteChip } from "./QuoteChip";
import ToolRow from "./ToolRow";
import { finalFrom, headline, runningHeadline, type ChatModel, type Entry, type Turn } from "./fold";
import type { Quote } from "./types";

// 대화 한 개의 흐름(three-axes 티켓 17) — 기록 줄을 접은 모델(`fold.ts`)을 그린다. 사람의 말은 오른쪽 말풍선, 에이전트의 답은
// 마크다운 본문이고, 생각하는 동안은 「생각 중」이 반짝인다. 턴이 끝나면 생각 · 도구 줄 · 앞선 답이 「N초 동안 작업함」 머리줄
// 아래로 접히고 **턴 끝 메시지**(마지막 도구 호출 뒤의 답)만 펼쳐 둔다. 머리줄을 누르면 펼친다.
//
// 우리가 멈춘 턴(three-axes 티켓 20)에서 멈출 때 열려 있던 도구 줄은 접힌 턴에서도 머리줄 아래에 남는다 — 멈췄는데 무엇이 아직
// 도는지 보이고, 늦게 온 출력이 그 줄에 붙는다(결정 28 · 스토리 55). 에이전트가 스스로 이어 간 턴은 머리줄 옆에 「스스로 이어
// 감」 표지가 서고 사용자 메시지가 없다(S4 · 스토리 45).
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
  return (
    <div className="flex flex-col gap-4 text-row leading-(--chat-leading-prose)">
      {model.turns.map((turn) => {
        const key = turnKey(conversationKey, turn.key);
        return <TurnView key={turn.key} turn={turn} open={expanded[key] === true} onToggle={() => toggleTurn(key)} />;
      })}
    </div>
  );
}

function TurnView({ turn, open, onToggle }: { turn: Turn; open: boolean; onToggle: () => void }) {
  const from = finalFrom(turn);
  // 접힌 턴은 턴 끝 메시지와 멈춘 뒤에도 돈 도구 줄만, 펼친 턴과 도는 턴은 모든 줄을 보인다.
  const shown =
    turn.end && !open
      ? turn.entries.filter(
          (entry, at) => (at >= from && entry.kind === "message") || (entry.kind === "tool" && entry.stop === "ran-on"),
        )
      : turn.entries;
  const last = turn.entries[turn.entries.length - 1];
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
      {shown.map((entry) => (
        <EntryView key={entry.key} entry={entry} end={turn.end} thinking={!turn.end && entry === last} />
      ))}
      {!turn.end && turn.entries.length === 0 && <Thinking />}
    </>
  );
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
      // 도구 줄 — 지금은 멈춘 턴의 줄만 선다(20). 진행형 → 완료형 문구 · 출력 · diff · MCP는 티켓 18이 `ToolRow`에 더한다.
      return <ToolRow tool={entry} end={end} />;
  }
}

export default ChatThread;

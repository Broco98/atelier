import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useStore } from "@tanstack/react-store";
import { Plus, X } from "lucide-react";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { chatUiStore, chooseConversation, claimFirstConversation, conversationKey } from "./chat-store";
import ChangesPill from "./ChangesPill";
import ChatThread from "./ChatThread";
import Composer from "./Composer";
import { foldConversation } from "./fold";
import { useCloseConversation, useConversations, useCreateConversation, useRecordLines } from "./hooks";
import type { Agent, Conversation } from "./types";

// 대화창(three-axes 티켓 17) — 대화 탭 줄 · 흐름 · 입력창. 작업 패널의 `chat` 보기가 이것을 그리고, `chat` 탭(24)도 같은 것을
// 가운데에 띄운다. 모양은 캔버스 보드 04(대화 패널) · 14(말과 입력)이고 값은 대화창 범위 토큰(`[data-chat]`, three-axes 결정 31)이다.
//
// **대화는 호스트에서 돈다.** 이 화면은 대화 목록을 읽고(처음 보일 때), 대화마다 기록을 한 번 읽은 뒤 앱 층이 받는 기록 줄
// 이벤트로 잇는다(`hooks.ts`). 그래서 다른 work에 다녀와도, 패널을 닫았다 열어도 그사이 흐른 줄이 다 보이고, 패널을 닫아도
// 에이전트는 꺼지지 않는다(스토리 14 · 15 · 16).

/**
 * `+`와 첫 대화가 여는 에이전트 — 설정 「대화」의 기본 에이전트이고 처음은 Claude Code다(구현 스펙 「설정 「대화」 쪽」). 그
 * 설정을 읽는 것은 티켓 25다 — 그때까지는 이 처음 값 하나다.
 */
export const DEFAULT_AGENT: Agent = "claude";

interface ChatPaneProps {
  /** 그 work의 slug. 작업 패널에 key가 없어 work를 옮기면 이 값만 바뀐다. */
  work: string;
  /**
   * 대화창이 지금 보이는가. **처음 보일 때** 대화 목록을 읽고, 대화 없는 work면 기본 에이전트로 대화 하나를 연다(S8) — 숨은 채
   * 마운트돼 있는 동안(작업 패널이 `spec`을 보일 때)은 호스트를 부르지 않는다.
   */
  visible: boolean;
  /**
   * 대화창의 문서 링크(알약 목록의 파일)를 눌렀다 — 스펙 창이 그 파일을 그 줄에서 연다(three-axes 티켓 26). 줄을 모르면 `null`이다.
   * 주소를 쥔 것이 화면이라 받아서 부른다. `chat` 탭(24)에서 눌러도 같은 길이다 — 문서를 고르면 탭이 spec으로 돌아간다.
   */
  onOpenDoc: (path: string, line: number | null) => void;
}

function ChatPane({ work, visible, onOpenDoc }: ChatPaneProps) {
  const list = useConversations(work, visible);
  const create = useCreateConversation();
  const close = useCloseConversation();
  const conversations = list.data ?? [];
  const chosen = useStore(chatUiStore, (state) => state.active[work]);
  const active = conversations.find((one) => one.id === chosen) ?? conversations[0] ?? null;
  const createConversation = create.mutate;

  // 대화 없는 work에서 대화창을 처음 열면 기본 에이전트로 대화 하나가 열려 있다(스토리 2). work마다 한 번이다.
  useEffect(() => {
    if (!visible || !list.isSuccess || list.data.length > 0) return;
    if (!claimFirstConversation(work)) return;
    createConversation({ work, agent: DEFAULT_AGENT });
  }, [visible, list.isSuccess, list.data, work, createConversation]);

  const closeConversation = (conversation: Conversation) => {
    close.mutate(
      { work, conversation: conversation.id },
      {
        // 켜진 대화를 닫으면 그 옆(뒤, 없으면 앞)이 켜진다.
        onSuccess: () => {
          if (active?.id !== conversation.id) return;
          const at = conversations.findIndex((one) => one.id === conversation.id);
          const next = conversations[at + 1] ?? conversations[at - 1];
          if (next) chooseConversation(work, next.id);
        },
      },
    );
  };

  // 호스트가 거절하면 그 글을 그대로 보인다(호스트의 오류는 화면에 보일 글이다). 못 찾음 · 로그인 안내 카드는 티켓 22다.
  const problem = list.error ?? create.error ?? close.error;
  return (
    <div data-chat className="flex min-h-0 flex-1 flex-col">
      <div
        role="group"
        aria-label="대화 탭"
        className="flex h-10 shrink-0 items-center gap-0.5 overflow-x-auto px-2 shadow-(--chat-hairline-below) scroll-quiet"
      >
        {conversations.map((conversation) => (
          <ConversationTab
            key={conversation.id}
            conversation={conversation}
            on={conversation.id === active?.id}
            onChoose={() => chooseConversation(work, conversation.id)}
            onClose={() => closeConversation(conversation)}
          />
        ))}
        <Hint
          text="새 대화"
          announce="name"
          type="button"
          disabled={create.isPending}
          onClick={() => create.mutate({ work, agent: DEFAULT_AGENT })}
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-muted-foreground quiet-hover disabled:opacity-40"
        >
          <Plus className="size-4" strokeWidth={1.8} aria-hidden />
        </Hint>
      </div>
      {problem && (
        <p role="alert" className="px-4 pt-3 text-caption text-destructive">
          {String(problem)}
        </p>
      )}
      {conversations.length === 0 ? (
        <p className="px-4 pt-4 text-ui text-tertiary">
          {create.isPending || list.isPending ? "대화를 여는 중이에요" : "열린 대화가 없어요 — +로 새 대화를 열어요"}
        </p>
      ) : (
        conversations.map((conversation) => (
          <ConversationBody
            key={conversation.id}
            work={work}
            conversation={conversation}
            shown={conversation.id === active?.id}
            onOpenDoc={onOpenDoc}
          />
        ))
      )}
    </div>
  );
}

/**
 * 대화 탭 하나 — 이름과 ×. 이름은 에이전트 이름으로 호스트가 짓는다(Claude · Codex · Claude 2). 켜짐은 `aria-pressed`다 — 탭 줄의
 * 셸 칸과 같은 가족이다(`ShellTabs`). 배경은 바깥 상자가 갖고 가로 여백은 두 버튼이 나눠 가진다 — 바깥의 여백은 눌러도 아무
 * 일이 없는 자리가 된다. 상태 점과 닫기 확인은 티켓 23이 더한다.
 */
function ConversationTab({
  conversation,
  on,
  onChoose,
  onClose,
}: {
  conversation: Conversation;
  on: boolean;
  onChoose: () => void;
  onClose: () => void;
}) {
  return (
    <div
      data-conversation={conversation.id}
      className={cn(
        "flex h-7 min-w-0 max-w-[180px] shrink-0 items-center gap-1.5 rounded-lg text-ui transition-colors",
        on ? "bg-state-3 text-foreground" : "text-muted-foreground quiet-hover",
      )}
    >
      <button type="button" aria-pressed={on} onClick={onChoose} className="flex h-full min-w-0 items-center pl-2">
        <span className="truncate">{conversation.name}</span>
      </button>
      <button
        type="button"
        aria-label={`${conversation.name} 닫기`}
        onClick={onClose}
        className="mr-1.5 flex size-[18px] shrink-0 items-center justify-center rounded-(--chat-radius-inline) text-tertiary tint-hover"
      >
        <X className="size-3" strokeWidth={1.8} aria-hidden />
      </button>
    </div>
  );
}

/**
 * 대화 하나의 몸 — 흐름과 입력창. 고르지 않은 대화의 몸도 마운트된 채 숨어 있다: 기록을 읽어 두고, 대화를 오가도 입력 중인
 * 글과 펼친 턴이 남는다. 흐름은 바닥에 붙어 있다가(새 줄이 오면 따라 내려간다) 사람이 위로 굴리면 그 자리에 선다.
 */
function ConversationBody({
  work,
  conversation,
  shown,
  onOpenDoc,
}: {
  work: string;
  conversation: Conversation;
  shown: boolean;
  onOpenDoc: (path: string, line: number | null) => void;
}) {
  const key = conversationKey(work, conversation.id);
  const lines = useRecordLines(work, conversation.id);
  // 알약이 세는 것 — 이 대화의 마지막 턴의 고친 곳(티켓 26). 새 턴이 시작하면 그 턴에는 아직 없어 알약이 걷힌다.
  const changes = useMemo(() => {
    const { turns } = foldConversation(lines);
    return turns[turns.length - 1]?.changes ?? null;
  }, [lines]);
  const scroller = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [lines, shown]);
  return (
    <div hidden={!shown} className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        onScroll={(event) => {
          const el = event.currentTarget;
          stuck.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
        className="min-h-0 flex-1 overflow-y-auto px-4 pt-4 scroll-quiet"
      >
        <ChatThread conversationKey={key} lines={lines} />
      </div>
      <Composer
        work={work}
        conversation={conversation.id}
        draftKey={key}
        agent={conversation.agent}
        above={changes && changes.length > 0 && <ChangesPill files={changes} onOpenDoc={onOpenDoc} />}
      />
    </div>
  );
}

export default ChatPane;

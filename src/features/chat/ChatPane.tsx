import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useStore } from "@tanstack/react-store";
import { Plus, X } from "lucide-react";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { readDefaultAgent } from "@/features/settings/chat-settings";
import ApprovalCard from "./ApprovalCard";
import { ChatDocsContext } from "./chat-docs";
import {
  chatUiStore,
  chooseConversation,
  claimFirstConversation,
  conversationKey,
  dropWanted,
  wantConversation,
} from "./chat-store";
import ChangesPill from "./ChangesPill";
import ChatThread from "./ChatThread";
import Composer from "./Composer";
import { awaitingLogin, chatEngineStore, checkEngine, checkEngineOnce, guideKind, type GuideKind } from "./engine-store";
import { foldConversation } from "./fold";
import GuideCard from "./GuideCard";
import { useCloseConversation, useConversations, useCreateConversation, useQueue, useRecordLines } from "./hooks";
import QueuedMessages from "./QueuedMessages";
import type { Agent, Conversation, EngineCheck, Quote } from "./types";

// 대화창(three-axes 티켓 17) — 대화 탭 줄 · 흐름 · 입력창. 작업 패널의 `chat` 보기가 이것을 그리고, `chat` 탭(24)도 같은 것을
// 가운데에 띄운다. 모양은 캔버스 보드 04(대화 패널) · 14(말과 입력)이고 값은 대화창 범위 토큰(`[data-chat]`, three-axes 결정 31)이다.
//
// **대화는 호스트에서 돈다.** 이 화면은 대화 목록을 읽고(처음 보일 때), 대화마다 기록을 한 번 읽은 뒤 앱 층이 받는 기록 줄
// 이벤트로 잇는다(`hooks.ts`). 그래서 다른 work에 다녀와도, 패널을 닫았다 열어도 그사이 흐른 줄이 다 보이고, 패널을 닫아도
// 에이전트는 꺼지지 않는다(스토리 14 · 15 · 16).

/**
 * 흐름 · 입력창 · 안내 카드를 모으는 열(three-axes 티켓 24) — 읽기 좋은 폭(`--chat-thread-width`, 캔버스 `.cx-thread`)에 가운데로
 * 모인다. `chat` 탭은 가운데 카드 전체가 대화창이라 긴 답의 줄이 끝없이 늘지 않게 이 폭에서 멈추고, 작업 패널은 이보다 좁아 꽉
 * 찬다 — 두 자리가 같은 대화창이다(스토리 18). 대화 탭 줄은 모으지 않는다: 머리는 카드 폭 그대로다.
 */
const COLUMN = "mx-auto flex w-full max-w-(--chat-thread-width) flex-col";

interface ChatPaneProps {
  /** 그 work의 slug. 작업 패널에 key가 없어 work를 옮기면 이 값만 바뀐다. */
  work: string;
  /**
   * 대화창이 지금 보이는가. **처음 보일 때** 대화 목록을 읽고, 대화 없는 work면 기본 에이전트로 대화 하나를 연다(S8) — 숨은 채
   * 마운트돼 있는 동안(작업 패널이 `spec`을 보일 때)은 호스트를 부르지 않는다.
   */
  visible: boolean;
  /**
   * 그 work의 spec 폴더(코어가 준 홈 축약 표기) — 도구 줄의 파일이 이 폴더 안이면 스펙 창으로 여는 링크가 된다(three-axes 티켓 18).
   */
  specDir: string;
  /**
   * 대화창의 문서 링크(알약 목록의 파일 · 도구 줄의 파일)를 눌렀다 — 스펙 창이 그 파일을 그 줄에서 연다(three-axes 티켓 18 · 26).
   * 줄을 모르면 `null`이다. 주소를 쥔 것이 화면이라 받아서 부른다. `chat` 탭(24)에서 눌러도 같은 길이다 — 문서를 고르면 탭이
   * spec으로 돌아간다.
   */
  onOpenDoc: (path: string, line: number | null) => void;
}

function ChatPane({ work, visible, specDir, onOpenDoc }: ChatPaneProps) {
  const list = useConversations(work, visible);
  const create = useCreateConversation();
  const close = useCloseConversation();
  const conversations = list.data ?? [];
  const chosen = useStore(chatUiStore, (state) => state.active[work]);
  const active = conversations.find((one) => one.id === chosen) ?? conversations[0] ?? null;
  // 문서에서 고른 자리(three-axes 티켓 27) — 그 work의 지금 대화의 입력창에 칩으로 붙는다.
  const quote = useStore(chatUiStore, (state) => state.quotes[work] ?? null);
  const createConversation = create.mutate;
  // 도구 줄의 파일 링크가 흐름 깊숙이 서므로 뿌리에서 한 번 내려 준다(`chat-docs.ts`).
  const docs = useMemo(() => ({ specDir, onOpenDoc }), [specDir, onOpenDoc]);
  const [checking, setChecking] = useState(false);

  // 대화를 열기 전에 그 엔진을 확인한다(three-axes 티켓 22 「언제 확인하나」) — 못 찾았으면 대화를 만들지 않고(호스트도 거절한다)
  // 그 자리에 안내 카드를 세운다. 찾았으면 로그인이 안 됐어도 연다: Codex는 호스트가 로그인 필요 줄을 적고, 어느 엔진이든 그 대화
  // 자리에 로그인 카드가 선다. 확인이 거절되면(로그인 셸을 못 읽음) 그대로 열어 호스트의 거절을 보인다.
  //
  // 에이전트를 주지 않으면 설정 「대화」의 기본 에이전트다(three-axes 결정 16 · 티켓 25) — `+`와 첫 대화. 누를 때마다 설정 파일을 다시
  // 읽어, 바꾼 설정이 다음 `+`부터 들고 작업 패널 · `chat` 탭의 두 대화창이 같은 값을 본다. 읽는 동안도 「확인 중」이라 `+`가 잠긴다.
  // 모델 · 모드 기본값은 호스트가 새 대화 때 같은 파일에서 읽는다.
  const openConversation = useCallback(
    async (chosen?: Agent) => {
      setChecking(true);
      let check: EngineCheck | null = null;
      const agent = chosen ?? (await readDefaultAgent());
      try {
        check = await checkEngine(agent, false);
      } catch {
        // 호스트의 거절은 만들기에서 다시 서서 그 글이 보인다.
      } finally {
        setChecking(false);
      }
      if (check?.state === "missing") {
        wantConversation(work, agent);
        return;
      }
      dropWanted(work);
      createConversation({ work, agent });
    },
    [work, createConversation],
  );

  // 대화 없는 work에서 대화창을 처음 열면 기본 에이전트로 대화 하나가 열려 있다(스토리 2). work마다 한 번이다.
  useEffect(() => {
    if (!visible || !list.isSuccess || list.data.length > 0) return;
    if (!claimFirstConversation(work)) return;
    void openConversation();
  }, [visible, list.isSuccess, list.data, work, openConversation]);

  // 대화창이 그 엔진의 대화를 처음 보일 때 엔진을 확인한다 — 앱이 도는 동안 엔진마다 한 번이고, 그 뒤는 엔진 상태 이벤트가 잇는다.
  const activeAgent = active?.agent ?? null;
  useEffect(() => {
    if (visible && activeAgent) checkEngineOnce(activeAgent);
  }, [visible, activeAgent]);

  // 못 찾아 열지 못한 대화 — 「다시 확인」으로 찾으면 그때 연다(스토리 102).
  const wanted = useStore(chatUiStore, (state) => state.wanted[work] ?? null);
  const wantedView = useStore(chatEngineStore, (state) => (wanted ? state[wanted] : undefined));
  useEffect(() => {
    if (!wanted || wantedView?.found !== true) return;
    dropWanted(work);
    createConversation({ work, agent: wanted });
  }, [wanted, wantedView?.found, work, createConversation]);

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

  // 호스트가 거절하면 그 글을 그대로 보인다(호스트의 오류는 화면에 보일 글이다). 못 찾음 · 로그인은 안내 카드가 말한다.
  const problem = list.error ?? create.error ?? close.error;
  // 못 찾아 열지 못한 대화가 있으면 대화창 자리에 그 엔진의 카드가 선다 — 켜진 대화 대신이다.
  const wantedKind = wanted ? guideKind(wantedView, false) : null;
  return (
    <ChatDocsContext.Provider value={docs}>
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
              onChoose={() => {
                dropWanted(work);
                chooseConversation(work, conversation.id);
              }}
              onClose={() => closeConversation(conversation)}
            />
          ))}
          <Hint
            text="새 대화"
            announce="name"
            type="button"
            disabled={checking || create.isPending}
            onClick={() => void openConversation()}
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
        {wanted && wantedKind ? (
          <GuidePlace agent={wanted} kind={wantedKind} />
        ) : conversations.length === 0 ? (
          <p className="px-4 pt-4 text-ui text-tertiary">
            {checking || create.isPending || list.isPending
              ? "대화를 여는 중이에요"
              : "열린 대화가 없어요 — +로 새 대화를 열어요"}
          </p>
        ) : null}
        {conversations.map((conversation) => (
          <ConversationBody
            key={conversation.id}
            work={work}
            conversation={conversation}
            shown={conversation.id === active?.id && !(wanted && wantedKind)}
            quote={conversation.id === active?.id ? quote : null}
            onOpenDoc={onOpenDoc}
          />
        ))}
      </div>
    </ChatDocsContext.Provider>
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
  quote,
  onOpenDoc,
}: {
  work: string;
  conversation: Conversation;
  shown: boolean;
  quote: Quote | null;
  onOpenDoc: (path: string, line: number | null) => void;
}) {
  const key = conversationKey(work, conversation.id);
  const lines = useRecordLines(work, conversation.id);
  // 흐름 · 알약 · 멈추기가 같은 접은 값을 읽는다 — 기록 줄이 올 때마다 한 번 접는다.
  const model = useMemo(() => foldConversation(lines), [lines]);
  // 알약이 세는 것 — 이 대화의 마지막 턴의 고친 곳(티켓 26). 새 턴이 시작하면 그 턴에는 아직 없어 알약이 걷힌다.
  const changes = model.turns[model.turns.length - 1]?.changes ?? null;
  const asking = model.pending[0] ?? null;
  // 대기 중인 말(티켓 20) — 턴이 도는 동안 보낸 말. 알약 아래, 입력창 바로 위에 선다(보드 04).
  const queue = useQueue(work, conversation);
  const scroller = useRef<HTMLDivElement>(null);
  const stuck = useRef(true);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stuck.current) el.scrollTop = el.scrollHeight;
  }, [lines, shown]);
  // 못 찾음 · 로그인 안 됨 · 로그인 중이면 기록과 입력창 대신 안내 카드가 선다(three-axes 티켓 22). 엔진이 「됨」이 되면 걷히고
  // 그 자리에 기록이 그대로 다시 선다 — 대화를 다시 띄우는 것은 호스트다.
  const view = useStore(chatEngineStore, (state) => state[conversation.agent]);
  const waiting = useMemo(() => awaitingLogin(lines), [lines]);
  const kind = guideKind(view, waiting);
  if (kind) return shown ? <GuidePlace agent={conversation.agent} kind={kind} /> : null;
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
        <div className={COLUMN}>
          <ChatThread conversationKey={key} model={model} />
        </div>
      </div>
      <div className={COLUMN}>
        <Composer
          work={work}
          conversation={conversation.id}
          draftKey={key}
          agent={conversation.agent}
          quote={quote}
          running={model.running}
          card={
            // 답하지 않은 권한 요청 — 맨 앞의 것이 입력창 자리에 선다(티켓 21). 답 · 거둬짐 줄이 오면 접기가 빼서 걷힌다.
            asking && (
              <ApprovalCard
                key={asking.requestId}
                work={work}
                conversation={conversation.id}
                agent={conversation.agent}
                request={asking}
                running={model.running}
              />
            )
          }
          above={
            <>
              {changes && changes.length > 0 && <ChangesPill files={changes} onOpenDoc={onOpenDoc} />}
              <QueuedMessages work={work} conversation={conversation.id} queue={queue} />
            </>
          }
        />
      </div>
    </div>
  );
}

/** 안내 카드의 자리 — 대화창의 몸(기록과 입력창이 서던 곳) 위쪽에 선다. 카드가 길면 그 자리 안에서 구른다. */
function GuidePlace({ agent, kind }: { agent: Agent; kind: GuideKind }) {
  const view = useStore(chatEngineStore, (state) => state[agent]);
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 scroll-quiet">
      <div className={COLUMN}>
        <GuideCard agent={agent} kind={kind} view={view} />
      </div>
    </div>
  );
}

export default ChatPane;

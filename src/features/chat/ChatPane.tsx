import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useStore } from "@tanstack/react-store";
import { Plus, X } from "lucide-react";
import { askDialog } from "@/components/ui/confirm-store";
import { Spinner } from "@/components/ui/spinner";
import { SMALL_GLYPH_STROKE } from "@/components/ui/icon-stroke";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import ApprovalCard from "./ApprovalCard";
import { ChatDocsContext } from "./chat-docs";
import { chatRecordStore, chatUiStore, conversationKey, linesOf, seeConversation } from "./chat-store";
import ChangesPill from "./ChangesPill";
import { chipLists } from "./chips";
import ChatThread from "./ChatThread";
import Composer from "./Composer";
import { chooseConversation, closeConversation, openConversation, useConversationList } from "./conversation-list";
import { awaitingLogin, chatEngineStore, guideKind, type GuideKind } from "./engine-store";
import { foldOf } from "./fold";
import GuideCard from "./GuideCard";
import { useQueue } from "./hooks";
import QueuedMessages from "./QueuedMessages";
import { closeNotice, goneThrough, STATUS_LABEL, useConversationStatus, type ConversationStatus } from "./status";
import type { Agent, Conversation, Quote } from "./types";

// 대화창(three-axes 티켓 17) — 대화 탭 줄 · 흐름 · 입력창. 작업 패널의 `chat` 보기가 이것을 그리고, `chat` 탭(24)도 같은 것을
// 가운데에 띄운다. 모양은 캔버스 보드 04(대화 패널) · 14(말과 입력)이고 값은 DS의 대화 · 도구 토큰이다(three-axes 결정 31 · codex-ds
// 스펙 S2). 뿌리의 표식(`data-chat`)은 대화창을 집는 고리다.
//
// **대화는 호스트에서 돈다.** 그 work의 대화 목록과 그 수명(목록 읽기 · 첫 대화 · 새 대화 · 닫기 · 기록 읽기 · 여는 중 · 거절 글)은
// 이 화면이 아니라 work마다 하나인 주인이 쥔다(`conversation-list.ts`) — 이 화면은 그 상태를 읽고 동작을 부른다. 그래서 두 자리에
// 함께 서도, key 없는 작업 패널이 work를 옮겨도 같은 것을 보인다. 기록은 한 번 읽은 뒤 앱 층이 받는 기록 줄 이벤트로 잇는다
// (`hooks.ts`). 그래서 다른 work에 다녀와도, 패널을 닫았다 열어도 그사이 흐른 줄이 다 보이고, 패널을 닫아도 에이전트는 꺼지지
// 않는다(스토리 14 · 15 · 16).

/**
 * 흐름 · 입력창 · 안내 카드를 모으는 열(three-axes 티켓 24) — 읽기 좋은 폭(DS `size-thread`, 캔버스 `.cx-thread`)에 가운데로
 * 모인다. `chat` 탭은 가운데 카드 전체가 대화창이라 긴 답의 줄이 끝없이 늘지 않게 이 폭에서 멈추고, 작업 패널은 이보다 좁아 꽉
 * 찬다 — 두 자리가 같은 대화창이다(스토리 18). 대화 탭 줄은 모으지 않는다: 머리는 카드 폭 그대로다.
 */
const COLUMN = "mx-auto flex w-full max-w-(--size-thread) flex-col";

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
  const { conversations, active, wanted, reading, opening, problem } = useConversationList(work, visible);
  // 문서에서 고른 자리(three-axes 티켓 27) — 그 work의 지금 대화의 입력창에 칩으로 붙는다.
  const quote = useStore(chatUiStore, (state) => state.quotes[work] ?? null);
  // 도구 줄의 파일 링크가 흐름 깊숙이 서므로 뿌리에서 한 번 내려 준다(`chat-docs.ts`).
  const docs = useMemo(() => ({ specDir, onOpenDoc }), [specDir, onOpenDoc]);
  const wantedView = useStore(chatEngineStore, (state) => (wanted ? state[wanted] : undefined));

  // 대화 닫기(S25) — 턴이 돌거나 답하지 않은 승인이 걸려 있으면 × 앞에 확인 창을 띄운다. 셸 닫기 확인과 같은 손버릇이다(제목 · 「닫기」 ·
  // 경고색 · 기본 포커스 — `shellCloseDialog`). 묻는 말은 기록을 접은 값으로 정하고(`closeNotice`), 쉬는 대화는 묻지 않고 닫는다.
  const askClose = async (conversation: Conversation) => {
    const model = foldOf(linesOf(chatRecordStore.state, conversationKey(work, conversation.id)), goneThrough(conversation));
    const notice = closeNotice(model);
    if (notice !== null && !(await askDialog({ title: "대화 닫기", body: notice, confirm: "닫기", danger: true }))) return;
    void closeConversation(work, conversation.id);
  };

  // 못 찾아 열지 못한 대화가 있으면 대화창 자리에 그 엔진의 카드가 선다 — 켜진 대화 대신이다.
  const wantedKind = wanted ? guideKind(wantedView, false) : null;
  return (
    <ChatDocsContext.Provider value={docs}>
      <div data-chat className="flex min-h-0 flex-1 flex-col">
        <div
          role="group"
          aria-label="대화 탭"
          className="relative flex h-10 shrink-0 items-center gap-0.5 overflow-x-auto px-2 scroll-quiet after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[0.5px] after:bg-border"
        >
          {conversations.map((conversation) => (
            <ConversationTab
              key={conversation.id}
              work={work}
              conversation={conversation}
              on={conversation.id === active?.id}
              onChoose={() => chooseConversation(work, conversation.id)}
              onClose={() => void askClose(conversation)}
            />
          ))}
          {/* 새 대화를 여는 동안 잠긴다 — 버튼이 네이티브 `disabled`다. 트리거의 `disabled`는 툴팁만 끄고 버튼은 그대로 둔다(Base UI). */}
          <Hint
            text="새 대화"
            announce="name"
            disabled={opening}
            render={
              <button
                type="button"
                disabled={opening}
                onClick={() => void openConversation(work)}
                className="icon-button-quiet shrink-0 text-fg-secondary focus-ring disabled:opacity-40"
              />
            }
          >
            <Plus className="size-4" aria-hidden />
          </Hint>
        </div>
        {problem && (
          <p role="alert" className="px-4 pt-3 text-xs text-danger">
            {problem}
          </p>
        )}
        {wanted && wantedKind ? (
          <GuidePlace agent={wanted} kind={wantedKind} />
        ) : conversations.length === 0 ? (
          <p className="px-4 pt-4 text-chat-meta text-fg-tertiary">
            {opening || reading
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
            visible={visible}
            quote={conversation.id === active?.id ? quote : null}
            onOpenDoc={onOpenDoc}
          />
        ))}
      </div>
    </ChatDocsContext.Provider>
  );
}

/**
 * 대화 탭 하나 — 상태 점 · 이름 · ×. 이름은 에이전트 이름으로 호스트가 짓는다(Claude · Codex · Claude 2). 켜짐은 `aria-pressed`다 —
 * 탭 줄의 셸 칸과 같은 가족이다(`ShellTabs`). 배경은 바깥 상자가 갖고 가로 여백은 두 버튼이 나눠 가진다 — 바깥의 여백은 눌러도
 * 아무 일이 없는 자리가 된다.
 *
 * **상태가 이름에 붙는다**(three-axes 티켓 23 · 스토리 118). 점은 그림이라 숨고(`aria-hidden`), 「Codex — 나를 기다림」처럼 이름이
 * 상태를 말한다 — 셸 탭이 같은 자리에서 같은 꼴을 고른다(`ShellTabs`의 `spokenName`). 기다림은 이름 글자도 그 잉크로 물든다(캔버스
 * `.cx-tab.wait`).
 */
function ConversationTab({
  work,
  conversation,
  on,
  onChoose,
  onClose,
}: {
  work: string;
  conversation: Conversation;
  on: boolean;
  onChoose: () => void;
  onClose: () => void;
}) {
  const status = useConversationStatus(work, conversation);
  return (
    <div
      data-conversation={conversation.id}
      className={cn(
        "flex h-7 min-w-0 max-w-[180px] shrink-0 items-center gap-1.5 rounded-lg text-chat-meta transition-colors",
        // 탭 줄의 칸과 같은 단이다 — 켜진 탭 `fill-hover`(`tab-on`), 꺼진 탭의 hover `fill-soft`(index.css의 상태 농도).
        on ? "tab-on" : "text-fg-secondary hover:bg-fill-soft hover:text-fg",
      )}
    >
      <button
        type="button"
        aria-pressed={on}
        aria-label={status ? `${conversation.name} — ${STATUS_LABEL[status]}` : undefined}
        onClick={onChoose}
        className="flex h-full min-w-0 items-center gap-1.5 rounded-lg pl-2 focus-ring"
      >
        {status && <StatusDot status={status} />}
        <span className={cn("truncate", status === "waiting" && "text-warning")}>{conversation.name}</span>
      </button>
      <button
        type="button"
        aria-label={`${conversation.name} 닫기`}
        onClick={onClose}
        className="mr-1.5 flex size-4.5 shrink-0 items-center justify-center rounded-xs text-fg-tertiary tint-hover focus-ring"
      >
        <X className="size-3" strokeWidth={SMALL_GLYPH_STROKE} aria-hidden />
      </button>
    </div>
  );
}

/**
 * 대화 탭의 상태 점(S23 · 캔버스 `.cx-tab` · `.cx-dot` · `.cx-spin`) — 일하는 중은 앱의 스피너(12px), 나를 기다림 · 끝남은 부름의
 * 7px 점(사이드바 · 알림 띠의 「나를 기다림」 · 「확인할 것」과 같은 색 — DS `dot-wait` · `dot-new`), 이어 붙이는 중은 옅은 점이다. 그림일 뿐이라
 * 숨는다 — 상태는 탭 이름이 말한다. 갈래는 표식(`data-status`)이 든다.
 */
function StatusDot({ status }: { status: ConversationStatus }) {
  if (status === "working") return <Spinner aria-hidden data-status={status} className="size-3 text-fg-tertiary" />;
  return (
    <span
      aria-hidden
      data-status={status}
      className={cn(
        "size-1.75 shrink-0 rounded-full",
        status === "waiting" ? "bg-dot-wait" : status === "done" ? "bg-dot-new" : "bg-fg-tertiary",
      )}
    />
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
  visible,
  quote,
  onOpenDoc,
}: {
  work: string;
  conversation: Conversation;
  shown: boolean;
  /** 대화창이 지금 보이는가 — 켜진 대화이고 대화창이 보이면 그 대화를 「봤다」(three-axes 티켓 23). */
  visible: boolean;
  quote: Quote | null;
  onOpenDoc: (path: string, line: number | null) => void;
}) {
  const key = conversationKey(work, conversation.id);
  // 기록은 대화 목록의 주인이 한 번 읽어 두고(`conversation-list.ts`), 그 뒤는 앱 층이 받은 기록 줄 이벤트가 잇는다.
  const lines = useStore(chatRecordStore, (state) => linesOf(state, key));
  // 흐름 · 알약 · 멈추기가 같은 접은 값을 읽는다 — 기록 줄이 올 때마다 한 번 접고, 대화 탭의 상태 점도 같은 값을 읽는다. 다시 켠 뒤면
  // 그 앞의 열린 턴 · 물음은 끝난 것으로 접힌다(`goneThrough`).
  const model = foldOf(lines, goneThrough(conversation));
  // 칩과 「/」 메뉴의 원천(S15, three-axes 티켓 19) — 같은 기록 줄에서 목록과 엔진의 값을 접는다.
  const lists = useMemo(() => chipLists(lines), [lines]);
  // 보이는 동안 그 대화를 「봤다」 — 「끝남」이 걷히고, 보는 동안 끝난 턴에는 서지 않는다(S23 · 스토리 8).
  const seen = visible && shown;
  useEffect(() => (seen ? seeConversation(key) : undefined), [seen, key]);
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
          conversation={conversation}
          draftKey={key}
          lists={lists}
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

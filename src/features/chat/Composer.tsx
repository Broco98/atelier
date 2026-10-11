import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "@tanstack/react-store";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { chatApi } from "./api";
import { clearChangeMarks } from "./changes";
import { chatUiStore, dropQuote, restoreQuote, setDraft } from "./chat-store";
import { DraftQuoteChip } from "./QuoteChip";
import type { Agent, Quote } from "./types";

// 입력창(three-axes 티켓 17) — 글을 쓰고 보낸다. 캔버스 보드 14의 `.cx-composer`(r28 · 흰 면 · 그림자 셋 · 안쪽 15 12 8 18)와
// 보내기 원(32 · 파랑, 비면 옅은 면)이다. 칩(에이전트 · 모델 · 모드 · 계획)과 「/」 메뉴는 19가 이 자리에 더한다. 문서에서 고른
// 자리(인용, 27)는 입력칸 위에 칩으로 붙고, 보낼 때 함께 실려 간다.
//
// **턴이 도는 동안**(three-axes 티켓 20) 보내기 원은 멈추기가 된다(보드 14 「도는 중 — 보내기가 중지가 된다」, 흰 네모). 그동안
// 쓴 말도 보낸다 — 호스트가 대기 줄 끝에 넣고(S13) 입력창 위 「대기 중」에 선다. 그래서 칸에 글이 있으면 멈추기 앞에 보내기 원이
// 함께 선다 — 멈추기는 턴이 도는 내내 그 자리에 있다.
//
// **입력 중인 글은 대화마다 모듈 스토어에 산다**(`chatUiStore.drafts`). 레일에서 `spec`과 오가도 패널 몸은 마운트된 채라 남지만,
// 작업 패널에 key가 없어 work를 옮기면 같은 컴포넌트가 다른 대화를 그린다 — 그때 글이 따라오지 않게 대화 열쇠로 둔다.
//
// 보낸 말은 여기서 그리지 않는다 — 호스트가 기록에 적은 `sent` 줄이 사용자 메시지로 선다(그래서 머리말이 섞이지 않는다).

/** 에이전트의 화면 이름 — 칩과 자리 표시 글이 쓴다. */
export const AGENT_LABEL: Record<Agent, string> = { claude: "Claude Code", codex: "Codex" };

/** 입력칸이 자라는 끝 — 넘으면 칸 안에서 구른다. */
const FIELD_MAX = 200;

interface ComposerProps {
  work: string;
  conversation: string;
  /** 대화 열쇠(`conversationKey`) — 입력 중인 글의 열쇠다. */
  draftKey: string;
  agent: Agent;
  /** 입력창 바로 위, 같은 열에 서는 것 — 「N개 파일 변경됨」 알약(26). 입력창과의 틈은 이 열의 틈(10px)이다. */
  above?: ReactNode;
  /**
   * 그 work의 입력창에 붙은 인용(three-axes 티켓 27). 인용은 work의 **지금 대화**의 것이라 대화창은 켜진 대화의 입력창에만 이것을
   * 넘긴다 — 다른 대화로 옮기면 칩도 그 대화의 입력창으로 따라간다.
   */
  quote: Quote | null;
  /** 이 대화의 턴이 도는가 — 기록을 접은 값이다. 돌면 비어 있는 칸의 원이 멈추기다. */
  running: boolean;
  /**
   * 입력창 자리에 서는 카드 — 답하지 않은 권한 요청의 승인 카드 · 「이 계획대로 할까요?」(three-axes 티켓 21). 있으면 입력칸
   * 대신 선다(위의 알약 · 대기 줄은 그대로). 쓰던 글은 스토어에 있어 카드가 걷히면 그대로 돌아온다.
   */
  card?: ReactNode;
}

function Composer({ work, conversation, draftKey, agent, above, quote, running, card }: ComposerProps) {
  const draft = useStore(chatUiStore, (state) => state.drafts[draftKey] ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const empty = draft.trim() === "";

  // 인용이 붙으면 입력칸으로 간다 — 단추를 누른 그 자리에서 곧바로 이어서 말한다(스토리 79). 새로 고를 때마다다.
  useEffect(() => {
    if (quote) field.current?.focus();
  }, [quote]);

  // 글만큼 자란다 — 한 줄에서 시작해 FIELD_MAX까지. 넘으면 칸 안에서 구른다. 카드가 걷혀 칸이 다시 설 때도 잰다.
  const carded = card != null;
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, FIELD_MAX)}px`;
  }, [draft, carded]);

  const send = () => {
    const text = draft.trim();
    if (text === "") return;
    setDraft(draftKey, "");
    setProblem(null);
    // 사람이 다음 말을 보냈다 — 그 work의 고친 곳 표시를 지운다(티켓 26 · S19). 표시는 work의 것이라 어느 대화에서 보내든 같다.
    // 보내기의 답을 기다리지 않는다: 지우는 때는 사람이 보낸 그 순간이다(결정 22 · 프로토타입 D).
    clearChangeMarks(work);
    // 붙은 인용은 이 말과 함께 간다 — 보내는 순간 입력창에서 뗀다. 인용은 그 말 하나의 것이다(three-axes 티켓 27).
    const sending = quote ?? undefined;
    if (sending) dropQuote(work);
    chatApi.send(work, conversation, text, sending).catch((error: unknown) => {
      // 보내지 못했다 — 쓴 글과 인용을 돌려놓고 까닭을 보인다. 턴이 도는 동안의 말은 거절되지 않고 대기 줄에 든다(티켓 20).
      setDraft(draftKey, text);
      if (sending) restoreQuote(work, sending);
      setProblem(String(error));
    });
  };

  // 멈추기 — 기다리지 않는다. 멈춘 턴의 끝은 `cancelled` 턴 끝 줄로 오고, 그 머리줄이 「N초 후에 중단했습니다」다(S24).
  const stop = () => {
    setProblem(null);
    chatApi.stop(work, conversation).catch((error: unknown) => setProblem(String(error)));
  };

  return (
    <div className="flex shrink-0 flex-col gap-2.5 px-4 pb-4 pt-2">
      {above}
      {card ?? (
        <form
          className="flex flex-col gap-1.5 rounded-(--chat-radius-composer) bg-card pb-2 pl-[18px] pr-3 pt-[15px] shadow-(--chat-shadow-composer)"
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          {quote && <DraftQuoteChip quote={quote} onDrop={() => dropQuote(work)} />}
          <textarea
            ref={field}
            aria-label="보낼 말"
            rows={1}
            value={draft}
            placeholder={running ? "이어서 말하면 대기 줄에 쌓여요" : `${AGENT_LABEL[agent]}에게 요청하세요`}
            onChange={(event) => setDraft(draftKey, event.target.value)}
            onKeyDown={(event) => {
              // Enter는 보내기, Shift+Enter는 줄바꿈이다. 한국어 입력기가 글자를 짓는 동안의 Enter는 그 글자를 끝내는 키라 보내지 않는다.
              if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
              event.preventDefault();
              send();
            }}
            className="min-h-[23px] resize-none overflow-y-auto bg-transparent text-row leading-(--chat-leading-prose) tracking-(--chat-tracking-field) text-foreground outline-none placeholder:text-tertiary scroll-quiet"
          />
          <div className="flex flex-wrap items-center gap-0.5">
            <span className="flex-1" />
            {(!running || !empty) && (
              <button
                type="submit"
                aria-label="보내기"
                disabled={empty}
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full transition-colors",
                  empty ? "bg-state-3 text-tertiary" : "bg-(--chat-send) text-white",
                )}
              >
                <ArrowUp className="size-4" strokeWidth={1.8} aria-hidden />
              </button>
            )}
            {running && (
              <button
                type="button"
                aria-label="멈추기"
                onClick={stop}
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-(--chat-send) text-white"
              >
                <span className="size-2.5 rounded-xs bg-current" aria-hidden />
              </button>
            )}
          </div>
        </form>
      )}
      {problem && (
        <p role="alert" className="px-2 text-caption text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}

export default Composer;

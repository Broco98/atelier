import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useStore } from "@tanstack/react-store";
import { ArrowUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { chatApi } from "./api";
import { clearChangeMarks } from "./changes";
import { chatUiStore, setDraft } from "./chat-store";
import type { Agent } from "./types";

// 입력창(three-axes 티켓 17) — 글을 쓰고 보낸다. 캔버스 보드 14의 `.cx-composer`(r28 · 흰 면 · 그림자 셋 · 안쪽 15 12 8 18)와
// 보내기 원(32 · 파랑, 비면 옅은 면)이다. 칩(에이전트 · 모델 · 모드 · 계획)과 「/」 메뉴는 19, 대기 줄 · 멈추기는 20, 인용 칩은 27이
// 이 자리에 더한다.
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
}

function Composer({ work, conversation, draftKey, agent, above }: ComposerProps) {
  const draft = useStore(chatUiStore, (state) => state.drafts[draftKey] ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const empty = draft.trim() === "";

  // 글만큼 자란다 — 한 줄에서 시작해 FIELD_MAX까지. 넘으면 칸 안에서 구른다.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, FIELD_MAX)}px`;
  }, [draft]);

  const send = () => {
    const text = draft.trim();
    if (text === "") return;
    setDraft(draftKey, "");
    setProblem(null);
    // 사람이 다음 말을 보냈다 — 그 work의 고친 곳 표시를 지운다(티켓 26 · S19). 표시는 work의 것이라 어느 대화에서 보내든 같다.
    // 보내기의 답을 기다리지 않는다: 지우는 때는 사람이 보낸 그 순간이다(결정 22 · 프로토타입 D).
    clearChangeMarks(work);
    chatApi.send(work, conversation, text).catch((error: unknown) => {
      // 보내지 못했다 — 쓴 글을 돌려놓고 까닭을 보인다. 대기 줄(20)이 서기 전에는 턴이 도는 동안의 보내기도 여기로 온다.
      setDraft(draftKey, text);
      setProblem(String(error));
    });
  };

  return (
    <div className="flex shrink-0 flex-col gap-2.5 px-4 pb-4 pt-2">
      {above}
      <form
        className="flex flex-col gap-1.5 rounded-(--chat-radius-composer) bg-card pb-2 pl-[18px] pr-3 pt-[15px] shadow-(--chat-shadow-composer)"
        onSubmit={(event) => {
          event.preventDefault();
          send();
        }}
      >
        <textarea
          ref={field}
          aria-label="보낼 말"
          rows={1}
          value={draft}
          placeholder={`${AGENT_LABEL[agent]}에게 요청하세요`}
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
        </div>
      </form>
      {problem && (
        <p role="alert" className="px-2 text-caption text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}

export default Composer;

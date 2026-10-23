import { useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "@tanstack/react-store";
import { ArrowUp, AtSign } from "lucide-react";
import { cn } from "@/lib/utils";
import { THREAD_COMMANDS, type ChoiceOption, type CommandOption } from "./chips";
import { ComposerTray, ModelChip } from "./ComposerChips";
import SlashMenu, { commandText, matchCommands, optionId, slashQuery } from "./SlashMenu";
import { setDraft, threadUiStore } from "./thread-store";

// 입력창(v1 티켓 05 · 캔버스 Composer 보드 「컴포저 상태」) — 28 반경 입력창 하나에 아래 줄(받는 이 · Work · 물어보는 정도)이 붙는다.
// three-axes 입력창(`chat/Composer.tsx`)을 옮겨 보드의 모양으로 고쳤다.
// - **보내기 원 하나가 보내기 · 멈추기 · 꺼짐을 맡는다** — 비면 꺼진 면(`fill-active` · `fg-tertiary`), 쓰면 검정 면(`fg` 위
//   `fg-inverse`), 턴이 도는 동안 비어 있으면 멈추기(■)다. 도는 동안 쓴 말도 보낸다 — 엔진이 대기 줄 끝에 넣고 입력창 위 상자에 선다.
// - **@ 단추**는 입력칸에 `@`를 넣는다(Agent 부르기 메뉴는 14). 파일 첨부 `+`는 06이 단다.
// - **「/」로 시작하면 명령 메뉴**가 입력창 위에 선다(`SlashMenu`) — `/new`는 새 Thread로 가고, Runtime 명령은 입력칸이 `/이름 `이 된다.
// - **Esc는 멈추기**다(보드 「단축키」) — 메뉴가 서 있으면 메뉴만 걷는다.
//
// 입력 중인 글은 Thread마다 모듈 스토어에 산다(`threadUiStore.drafts`). 보낸 말은 여기서 그리지 않는다 — 엔진이 기록에 적은 `sent` 줄이
// 말풍선으로 선다.

/** 입력칸이 자라는 끝 — 넘으면 칸 안에서 구른다. */
const FIELD_MAX = 200;

/** 비어 있을 때의 말(보드) — 도는 동안 · 우리가 멈춘 뒤 · 그 밖. */
const PLACEHOLDER = {
  idle: "무엇이든 요청하세요",
  running: "이어서 말하면 다음 차례에 전달합니다",
  stopped: "무엇을 다르게 할지 말해 주세요",
} as const;

export interface ThreadComposerProps {
  /** 입력 중인 글의 열쇠 — Thread id, 새 Thread면 `NEW_THREAD`. */
  draftKey: string;
  models: readonly ChoiceOption[] | null;
  model: string | null;
  effort: string | null;
  onModel: (value: string) => void;
  onEffort: (value: string) => void;
  /** Runtime이 보낸 「/」 명령 — 화면 명령(`/new`) 뒤에 붙는다. */
  commands: readonly CommandOption[];
  running: boolean;
  /** 마지막 턴을 우리가 멈췄나 — 빈 칸의 말이 「무엇을 다르게 할지」가 된다. */
  stopped?: boolean;
  /** 빈 Thread의 입력창 — 위아래가 한 단 넓고 칸이 두 줄 높이다(Screen-Home 보드). */
  roomy?: boolean;
  /** 보내는 중이라 입력을 받지 않는다(새 Thread의 첫 말 — Session이 열릴 때까지). */
  busy?: boolean;
  /** 입력창 자리에 서는 카드 — 승인 카드. 있으면 입력창 대신 선다(위의 것은 그대로). */
  card?: ReactNode;
  /** 입력창 바로 위에 서는 것 — 바뀐 파일 알약 · 맨 아래로 · 기다리는 말. */
  above?: ReactNode;
  /** 말을 보낸다. 거절되면 쓴 글을 돌려놓고 그 글을 보인다. */
  onSend: (text: string) => Promise<void>;
  onStop?: () => Promise<void>;
  onNewThread: () => void;
  /** 화면이 바깥에서 보이는 거절 글(이름 바꾸기 · 칩) — 입력창 아래에 함께 선다. */
  problem?: string | null;
}

function ThreadComposer({
  draftKey,
  models,
  model,
  effort,
  onModel,
  onEffort,
  commands,
  running,
  stopped = false,
  roomy = false,
  busy = false,
  card,
  above,
  onSend,
  onStop,
  onNewThread,
  problem: outside = null,
}: ThreadComposerProps) {
  const draft = useStore(threadUiStore, (state) => state.drafts[draftKey] ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const empty = draft.trim() === "";

  const menuId = useId();
  const query = slashQuery(draft);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const all = useMemo(() => [...THREAD_COMMANDS, ...commands], [commands]);
  const items = useMemo(() => (query === null ? [] : matchCommands(all, query)), [all, query]);
  const [pointer, setPointer] = useState<{ query: string | null; at: number }>({ query: null, at: 0 });
  const active = pointer.query === query ? Math.min(pointer.at, Math.max(items.length - 1, 0)) : 0;
  const setActive = (at: number) => setPointer({ query, at });
  const menuOpen = items.length > 0 && dismissed !== draft;
  const pickCommand = (command: CommandOption) => {
    if (command.thread && command.name === "new") {
      setDraft(draftKey, "");
      onNewThread();
      return;
    }
    setDraft(draftKey, `${commandText(command)} `);
    field.current?.focus();
  };

  const carded = card != null;
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, FIELD_MAX)}px`;
  }, [draft, carded]);

  const send = () => {
    const text = draft.trim();
    if (text === "" || busy) return;
    setDraft(draftKey, "");
    setProblem(null);
    onSend(text).catch((error: unknown) => {
      setDraft(draftKey, text);
      setProblem(String(error));
    });
  };
  const stop = () => {
    setProblem(null);
    onStop?.().catch((error: unknown) => setProblem(String(error)));
  };
  const mention = () => {
    const el = field.current;
    const at = el?.selectionStart ?? draft.length;
    const end = el?.selectionEnd ?? at;
    const lead = at > 0 && !/\s$/.test(draft.slice(0, at)) ? " @" : "@";
    setDraft(draftKey, `${draft.slice(0, at)}${lead}${draft.slice(end)}`);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + lead.length, at + lead.length);
    });
  };

  const shown = outside ?? problem;
  return (
    <div className="flex shrink-0 flex-col">
      {above && <div className="flex flex-col gap-2 pb-2.5">{above}</div>}
      {card ?? (
        <form
          className={cn(
            "relative flex flex-col rounded-composer bg-surface-composer pb-2.5 pl-5 shadow-composer",
            roomy ? "gap-3.5 pt-4 pr-3" : "gap-2.5 pt-3.5 pr-2.5",
          )}
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          {menuOpen && <SlashMenu id={menuId} items={items} active={active} onPick={pickCommand} onPoint={setActive} />}
          <textarea
            ref={field}
            aria-label="보낼 말"
            rows={1}
            value={draft}
            readOnly={busy}
            placeholder={running ? PLACEHOLDER.running : stopped ? PLACEHOLDER.stopped : PLACEHOLDER.idle}
            onChange={(event) => setDraft(draftKey, event.target.value)}
            aria-controls={menuOpen ? menuId : undefined}
            aria-autocomplete={menuOpen ? "list" : undefined}
            aria-activedescendant={menuOpen ? optionId(menuId, active) : undefined}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (menuOpen) {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  const step = event.key === "ArrowDown" ? 1 : -1;
                  setActive((active + step + items.length) % items.length);
                  return;
                }
                if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
                  event.preventDefault();
                  pickCommand(items[active]);
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  setDismissed(draft);
                  return;
                }
              }
              if (event.key === "Escape" && running && onStop) {
                event.preventDefault();
                stop();
                return;
              }
              if (event.key !== "Enter" || event.shiftKey) return;
              event.preventDefault();
              send();
            }}
            className={cn(
              "resize-none overflow-y-auto bg-transparent pr-2.5 text-sm leading-5.5 text-fg outline-none placeholder:text-fg-tertiary scroll-quiet",
              roomy ? "min-h-11" : "min-h-5.5",
            )}
          />
          <div className="-ml-2.5 flex items-center gap-0.5">
            <button
              type="button"
              aria-label="Agent 부르기"
              onClick={mention}
              className="flex size-8 shrink-0 items-center justify-center rounded-lg text-fg-secondary transition-colors quiet-hover focus-ring"
            >
              <AtSign className="size-4" aria-hidden />
            </button>
            <span className="flex-1" />
            <ModelChip models={models} model={model} effort={effort} running={running} onModel={onModel} onEffort={onEffort} />
            {(!running || !empty) && (
              <button
                type="submit"
                aria-label="보내기"
                disabled={empty || busy}
                className={cn(
                  "ml-1 flex size-8 shrink-0 items-center justify-center rounded-full transition-colors focus-ring",
                  empty || busy ? "bg-fill-active text-fg-tertiary" : "bg-fg text-fg-inverse",
                )}
              >
                <ArrowUp className="size-4" aria-hidden />
              </button>
            )}
            {running && onStop && (
              <button
                type="button"
                aria-label="멈추기"
                onClick={stop}
                className="ml-1 flex size-8 shrink-0 items-center justify-center rounded-full bg-fg text-fg-inverse focus-ring"
              >
                <span className="size-2.5 rounded-xs bg-current" aria-hidden />
              </button>
            )}
          </div>
        </form>
      )}
      <ComposerTray />
      {shown && (
        <p role="alert" className="px-3 pt-1.5 text-xs text-danger">
          {shown}
        </p>
      )}
    </div>
  );
}

export default ThreadComposer;

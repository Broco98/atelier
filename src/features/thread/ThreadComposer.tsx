import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "@tanstack/react-store";
import { ArrowUp, Plus } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { useChanged } from "./arrival";
import { attachmentStore, attachmentsOf, setAttachments } from "./attachments";
import { slashCommands, type ChoiceOption, type CommandOption } from "./chips";
import { attachPaths, ComposerAttachmentChips, DropZone, pickFiles, useAttachmentDrop } from "./ComposerAttachments";
import {
  AskChip,
  LockedWorkChip,
  ModelChip,
  NewWorkChip,
  RuntimeChip,
  ScopeChip,
  ScopeLineText,
  type ComposerTray,
  type RuntimeChoice,
} from "./ComposerChips";
import SlashMenu, { commandText, matchCommands, optionId, slashQuery } from "./SlashMenu";
import { DraftQuoteChip } from "./QuoteChip";
import { setDraft, setQuote, takeFill, threadUiStore } from "./thread-store";
import type { Quote } from "@/features/works/QuotePick";
import type { AskLevel, Attachment } from "./types";

// 입력창(v1 티켓 05 · 02 티켓 10 · 02 구현 스펙 §9 · 03 구현 스펙 §5 · §6 · 캔버스 v35 Diff-Chat · Screen-Live · v52 F4-KitComposer) — Codex
// 입력창이다: 대화 열과 같은 737 폭에 둥글기 22(`rounded-prompt`) · 1px 4% 고리와 흐림 80의 그림자(`shadow-prompt`) · 안쪽 14/8/8 · 글 칸 최소
// 44 · 자리표시 `fg-placeholder`. 상자 안은 `+` · 물어보는 정도 · 모델과 생각 깊이 칩뿐이다(03 §6).
// Work 칩은 상자 **밖** 트레이에 서고(씨앗 없는 새 채팅에는 없다), 새 채팅이면 범위 칩 · 범위 줄이 곁에 선다 — 첫 화면은 상자 아래, Thread 화면은 상자 위다(03 §5 · `ComposerTray`).
// three-axes 입력창(`chat/Composer.tsx`)을 옮겨 보드의 모양으로 고쳤다.
// - **보내기 원 하나가 지금 할 수 있는 일을 말한다**(02 §9 · Screen-Live) — 28 파란 원(`accent-solid`)에 흰 글리프 14. 비면 옅은 ↑(40%,
//   꺼짐), 쓰면 ↑, 새 Thread의 첫 말을 보내는 중이면 옅은 파랑(`accent-solid-pending`)에 스피너, 턴이 도는 동안 비어 있으면 멈추기(■)다.
//   도는 동안 쓰면 원은 ↑다 — 쓴 말도 보낸다(엔진이 대기 줄 끝에 넣고 입력창 위 상자에 선다). 그동안 멈추기는 Esc가 맡는다.
// - **`+`와 끌어다 놓기는 첨부다**(v1 티켓 06 · S30) — 받은 파일 · 폴더가 입력칸 위에 칩(이름 · 크기)으로 쌓이고, 끌어다 놓는 동안은
//   입력창 자리에 「놓으면 첨부합니다」가 선다. 보내면 경로만 간다(`ComposerAttachments.tsx`).
// - **인용**(v1 티켓 35 · S41) — 넓힌 카드의 문서에서 고른 글(「❝ 이 자리를 두고 말하기」)이 입력칸 위에 인용 칩으로 붙는다(×로 뗀다). 보내면
//   말과 함께 가고, 엔진이 그 Work의 spec 폴더를 가리키는 인용 블록으로 본문 앞에 둔다.
// - **「/」로 시작하면 명령 메뉴**가 입력창 위에 선다(`SlashMenu`) — `/new`는 새 Thread로 가고, `/plan`은 물어보는 정도를 「계획」으로 바꾸고,
//   `/policy`는 물어보는 정도 메뉴를 연다(v1 티켓 23). `/model`은 모델 칩 메뉴를 연다(코드 리뷰 1차 B8). Runtime 명령은 입력칸이 `/이름 `이 된다.
// - **Esc는 멈추기**다(보드 「단축키」) — 메뉴가 서 있으면 메뉴만 걷는다.
//
// - **움직임**(v1 티켓 43 · 02 §12 · Motion 보드) — 카드가 걷히거나 끌어다 놓기가 끝나 입력창이 돌아오면 아래 4에서 떠오르고(줄 바뀜),
//   보내기 원의 글리프가 바뀌면 옛 글리프가 .6배로 줄며 사라지고 새 글리프가 .6배에서 커지며 선다(보내기 아이콘 모핑 .52s — 원의 면
//   색 · 옅음도 같은 박자로 바뀐다). 글 칸이 줄 수만큼 자라고 줄 때 높이가 패널 박자로 옮겨 간다(입력창 바닥 줄 높이 .22s). 첨부 ·
//   인용 칩은 붙을 때 칩으로 나타난다(칩 등장). 화면이 처음 설 때 이미 있던 것은 움직이지 않는다(`arrival.tsx`).
//
// 입력 중인 글 · 쌓인 첨부 · 붙은 인용은 Thread마다 모듈 스토어에 산다(`threadUiStore.drafts` · `attachmentStore` · `threadUiStore.quotes`). 보낸 말은 여기서 그리지
// 않는다 — 엔진이 기록에 적은 `sent` 줄이 말풍선으로 선다.

/** 입력칸이 자라는 끝 — 넘으면 칸 안에서 구른다. */
const FIELD_MAX = 200;

/** 비어 있을 때의 말(보드) — 첫 말을 보내는 중(Screen-Live 단계 1 — 시안의 「채팅」은 이 앱의 Thread다) · 도는 동안 · 우리가 멈춘 뒤 · 그 밖. */
const PLACEHOLDER = {
  starting: "채팅을 시작하는 중…",
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
  /** 보내는 중이라 입력을 받지 않는다(새 Thread의 첫 말 — Session이 열릴 때까지). */
  busy?: boolean;
  /** 입력창 자리에 서는 카드 — 승인 카드. 있으면 입력창(과 그 안의 칩) 대신 선다(위의 것은 그대로, 캔버스 Approval 보드 A안). */
  card?: ReactNode;
  /** 입력창 바로 위에 서는 것 — 바뀐 파일 알약 · 맨 아래로 · 기다리는 말. */
  above?: ReactNode;
  /** 말을 보낸다(붙인 첨부 · 인용과 함께). 거절되면 쓴 글 · 첨부 · 인용을 돌려놓고 그 글을 보인다. */
  onSend: (text: string, attachments: readonly Attachment[], quote: Quote | null) => Promise<void>;
  onStop?: () => Promise<void>;
  onNewThread: () => void;
  /** 화면이 바깥에서 보이는 거절 글(이름 바꾸기 · 칩) — 입력창 아래에 함께 선다. */
  problem?: string | null;
  /** 지금 물어보는 정도(v1 티켓 23) — 칩이 그리고 `/plan` · `/policy`가 바꾼다. */
  level: AskLevel;
  onLevel: (level: AskLevel) => void;
  /** 트레이(03 §5) — 첫 화면은 상자 아래, Thread 화면은 상자 위에 서는 회색 띠다. 입력창 자리에 카드가 서면 함께 걷힌다. */
  tray?: ComposerTray;
  /** 비어 있을 때의 말 — 새 채팅이 시작할 곳을 따른다(`startPlaceholder`). 없으면 「무엇이든 요청하세요」다. 도는 동안 · 멈춘 뒤의 말이 이긴다. */
  placeholder?: string;
  /**
   * 그 채팅의 Runtime(restart 01c-3) — 모델 칩 앞에 선다. 새 채팅이면 고르기(`onPick`)가 함께 오고, 턴이 시작된 채팅은 이름만 선다. 첫 말을 보내는
   * 중(`busy`)에도 잠긴다 — Runtime은 그 말과 함께 떠났다.
   */
  runtime?: RuntimeChoice;
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
  busy = false,
  card,
  above,
  onSend,
  onStop,
  onNewThread,
  problem: outside = null,
  level,
  onLevel,
  tray,
  placeholder,
  runtime,
}: ThreadComposerProps) {
  const draft = useStore(threadUiStore, (state) => state.drafts[draftKey] ?? "");
  // 바깥이 이 입력창을 채웠다(주소의 입력 글 씨앗 · PR 카드 — `fillDraft`) — 채운 글 끝에서 포커스를 받는다.
  const filled = useStore(threadUiStore, (state) => state.filled === draftKey);
  const attachments = useStore(attachmentStore, (state) => attachmentsOf(state, draftKey));
  const quote = useStore(threadUiStore, (state) => state.quotes[draftKey] ?? null);
  const [problem, setProblem] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const empty = draft.trim() === "";

  const menuId = useId();
  const query = slashQuery(draft);
  const [dismissed, setDismissed] = useState<string | null>(null);
  const all = useMemo(() => slashCommands(commands), [commands]);
  const items = useMemo(() => (query === null ? [] : matchCommands(all, query)), [all, query]);
  const [pointer, setPointer] = useState<{ query: string | null; at: number }>({ query: null, at: 0 });
  const active = pointer.query === query ? Math.min(pointer.at, Math.max(items.length - 1, 0)) : 0;
  const setActive = (at: number) => setPointer({ query, at });
  const menuOpen = items.length > 0 && dismissed !== draft;

  // 물어보는 정도 · 모델 메뉴의 열림 — 칩을 누르거나 `/policy` · `/model`이 연다.
  const [asking, setAsking] = useState(false);
  const [choosingModel, setChoosingModel] = useState(false);
  const pickCommand = (command: CommandOption) => {
    if (command.thread && command.name === "new") {
      setDraft(draftKey, "");
      onNewThread();
      return;
    }
    if (command.thread && command.name === "plan") {
      setDraft(draftKey, "");
      if (level !== "plan") onLevel("plan");
      field.current?.focus();
      return;
    }
    if (command.thread && command.name === "policy") {
      setDraft(draftKey, "");
      setAsking(true);
      return;
    }
    if (command.thread && command.name === "model") {
      setDraft(draftKey, "");
      // 칩이 보이기만 할 때(고를 목록이 없다)는 열 메뉴가 없다 — 입력칸으로 돌아간다.
      if (models && models.length > 0) setChoosingModel(true);
      else field.current?.focus();
      return;
    }
    setDraft(draftKey, `${commandText(command)} `);
    field.current?.focus();
  };

  const carded = card != null;
  // 붙인 뒤에는 입력칸으로 돌아간다 — 놓는 동안 입력창 자리를 「놓으면 첨부합니다」가 맡았다가 다시 선 칸이다.
  const attach = (paths: readonly string[]) => {
    setProblem(null);
    attachPaths(draftKey, paths)
      .then(() => field.current?.focus())
      .catch((error: unknown) => setProblem(String(error)));
  };
  const dragging = useAttachmentDrop(!busy && !carded, attach);
  // 입력창이 카드 · 놓는 자리에 자리를 내준 적이 있나 — 있으면 다시 설 때 떠오른다(처음 그린 입력창은 그대로 선다).
  const returned = useChanged(carded || dragging);
  // 카드가 걷히면(고른 뒤) 입력칸이 포커스를 되받는다 — 키보드로 고른 손이 그대로 이어 쓴다(스토리 76). 다른 칸에 간 포커스는 두다.
  const wasCarded = useRef(carded);
  useEffect(() => {
    const back = wasCarded.current && !carded;
    wasCarded.current = carded;
    const holder = document.activeElement;
    if (back && (holder === null || holder === document.body)) field.current?.focus();
  }, [carded]);
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    // 글 칸의 높이는 px에서 px로만 옮겨 간다(입력창 바닥 줄 높이 — 칸의 전이) — 재려고 거친 `auto`는 전이가 걸리지 않는 값이라, 잰 뒤
    // 옛 높이로 한 번 세우고(그 사이 그리지 않는다) 새 높이로 보낸다.
    const before = el.offsetHeight;
    el.style.height = "auto";
    const next = Math.min(el.scrollHeight, FIELD_MAX);
    if (before > 0 && before !== next) {
      el.style.height = `${before}px`;
      void el.offsetHeight;
    }
    el.style.height = `${next}px`;
  }, [draft, carded, dragging]);
  useLayoutEffect(() => {
    if (!filled) return;
    takeFill();
    const el = field.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [filled]);

  const send = () => {
    const text = draft.trim();
    if (text === "" || busy) return;
    const attached = attachments;
    const quoted = quote;
    setDraft(draftKey, "");
    setAttachments(draftKey, []);
    if (quoted) setQuote(draftKey, null);
    setProblem(null);
    onSend(text, attached, quoted).catch((error: unknown) => {
      setDraft(draftKey, text);
      setAttachments(draftKey, attached);
      if (quoted) setQuote(draftKey, quoted);
      setProblem(String(error));
    });
  };
  const pick = () => {
    pickFiles()
      .then(attach)
      .catch((error: unknown) => setProblem(String(error)));
  };
  const stop = () => {
    setProblem(null);
    onStop?.().catch((error: unknown) => setProblem(String(error)));
  };

  const shown = outside ?? problem;
  const trayed = tray && !card && (
    <Tray at={tray.at}>
      {tray.work?.kind === "new-work" ? <NewWorkChip {...tray.work} /> : tray.work && <LockedWorkChip {...tray.work} />}
      {tray.scope && (
        <>
          <ScopeChip {...tray.scope} />
          <ScopeLineText scope={tray.scope.reading} />
        </>
      )}
    </Tray>
  );
  return (
    <div className="flex shrink-0 flex-col">
      {above && <div className="flex flex-col gap-2 pb-2.5">{above}</div>}
      {tray?.at === "above" && trayed}
      {card ?? (dragging ? (
        <DropZone />
      ) : (
        <form
          // 위에 선다(`z-1`) — 트레이가 상자 밑으로 2 겹쳐 들어간다(F1-Home `.composer{z-index:1}`).
          className={cn(
            "relative z-1 flex flex-col gap-1.5 rounded-prompt bg-surface-composer px-2 pt-3.5 pb-2 shadow-prompt",
            returned && "row-in",
          )}
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          {menuOpen && <SlashMenu id={menuId} items={items} active={active} onPick={pickCommand} onPoint={setActive} />}
          {quote && <DraftQuoteChip quote={quote} onDrop={() => setQuote(draftKey, null)} />}
          {attachments.length > 0 && <ComposerAttachmentChips draftKey={draftKey} attachments={attachments} />}
          <div className="relative flex">
            <textarea
              ref={field}
              aria-label="보낼 말"
              rows={1}
              value={draft}
              readOnly={busy}
              placeholder={
                busy
                  ? PLACEHOLDER.starting
                  : running
                    ? PLACEHOLDER.running
                    : stopped
                      ? PLACEHOLDER.stopped
                      : (placeholder ?? PLACEHOLDER.idle)
              }
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
              // 글은 상자 끝에서 12(안쪽 8 + 4 — Diff-Chat 「입력 0 / 12」), 칸은 최소 44다. 줄 수가 바뀌면 높이가 패널 박자로 옮겨 간다.
              className="relative min-h-11 w-full resize-none overflow-y-auto bg-transparent px-1 text-sm text-fg outline-none transition-[height] duration-panel ease-panel placeholder:text-fg-placeholder scroll-quiet motion-reduce:transition-none"
            />
          </div>
          <div className="flex min-w-0 items-center gap-1">
            <button type="button" aria-label="파일 첨부" onClick={pick} disabled={busy} className={ROUND_BUTTON}>
              <Plus className="size-3.5" aria-hidden />
            </button>
            {/* 첫 말을 보내는 중(Screen-Live 단계 1)에는 칩이 옅게 쉰다 — 고른 것은 이미 첫 말과 함께 떠났다. */}
            <span className={cn("flex min-w-0 flex-1 items-center gap-1", busy && "pointer-events-none opacity-50")}>
              <AskChip level={level} onLevel={onLevel} open={asking} onOpenChange={setAsking} />
              <span className="min-w-0 flex-1" />
              {runtime && <RuntimeChip value={runtime.value} onPick={busy ? undefined : runtime.onPick} />}
              <ModelChip
                models={models}
                model={model}
                effort={effort}
                running={running}
                onModel={onModel}
                onEffort={onEffort}
                open={choosingModel}
                onOpenChange={setChoosingModel}
              />
            </span>
            <SendButton running={running} empty={empty} busy={busy} onStop={onStop && stop} />
          </div>
        </form>
      ))}
      {tray?.at === "below" && trayed}
      {shown && (
        <p role="alert" className="px-3 pt-1.5 text-xs text-fg-secondary">
          {shown}
        </p>
      )}
    </div>
  );
}

/**
 * 트레이(03 §5 · 시안 v52 `.tray` · `.tray.up`) — 회색 띠(`surface-tray`)가 좌우 14 안으로 들어서 상자에 2 겹쳐 붙는다. 상자 아래(첫 화면)면
 * 아래만 둥글고 안쪽이 위 10 · 아래 6이며, 상자 위(Thread 화면)면 위만 둥글고 위 6 · 아래 10이다 — 겹친 2는 늘 상자 쪽이고 상자가 덮는다.
 * 띠 안의 칩 모양은 두 자리에서 같다.
 */
function Tray({ at, children }: { at: ComposerTray["at"]; children: ReactNode }) {
  return (
    <div
      data-slot="composer-tray"
      className={cn(
        "mx-3.5 flex min-w-0 items-center gap-1 bg-surface-tray px-2",
        at === "below" ? "-mt-0.5 rounded-b-tray pt-2.5 pb-1.5" : "-mb-0.5 rounded-t-tray pt-1.5 pb-2.5",
      )}
    >
      {children}
    </div>
  );
}

/** 입력창 아래 줄의 `+` — 28 원, 본문색 글리프 14(Diff-Chat 「+ · @ 버튼 28」). */
const ROUND_BUTTON =
  "flex size-7 shrink-0 items-center justify-center rounded-full text-fg transition-colors quiet-hover focus-ring";

/** 보내기 원의 글리프 — ↑(빈 상태와 글이 있는 상태가 같은 ↑이고 원의 옅음만 다르다) · 스피너 · ■. */
type SendGlyph = "send" | "sending" | "stop";

/**
 * 보내기 원(02 §9 · Screen-Live 단계 1 · 3 · 6 · Motion 보드 「보내기 버튼 바뀜」) — 원 하나가 네 상태를 맡는다. 글리프가 바뀌면 **옛 글리프가
 * 줄며 사라지고 새 글리프가 커지며 선다**(`morph-out` · `morph-in` — .52s, times 0 / .22 / .72 / 1). 원이 선 뒤에 바뀐 것만 움직인다 —
 * 입력창이 카드 자리를 내줬다가 다시 서면(결정 줄 뒤) 원도 새로 서므로 글리프가 다시 커지지 않는다(v1 티켓 46).
 */
function SendButton({
  running,
  empty,
  busy,
  onStop,
}: {
  running: boolean;
  empty: boolean;
  busy: boolean;
  onStop?: () => void;
}) {
  const glyph: SendGlyph = busy ? "sending" : running && empty && onStop ? "stop" : "send";
  // 지금 글리프와 그 앞의 것 — 바뀐 그 그림에서 곧바로 고친다(효과에서 고치면 새 글리프가 움직임 없이 한 장면 그려진다, `useChanged`).
  const [held, setHeld] = useState<{ now: SendGlyph; before: SendGlyph | null }>({ now: glyph, before: null });
  const shown = held.now === glyph ? held : { now: glyph, before: held.now };
  if (shown !== held) setHeld(shown);
  const stop = glyph === "stop";
  return (
    <button
      type={stop ? "button" : "submit"}
      aria-label={glyph === "sending" ? "보내는 중" : stop ? "멈추기" : "보내기"}
      onClick={stop ? onStop : undefined}
      disabled={glyph === "sending" || (glyph === "send" && empty)}
      className={cn(
        "relative flex size-7 shrink-0 items-center justify-center rounded-full text-fg-on-solid transition-[background-color,opacity] duration-morph ease-default focus-ring",
        glyph === "sending" ? "bg-accent-solid-pending" : "bg-accent-solid",
        glyph === "send" && empty && "opacity-40",
      )}
    >
      {shown.before !== null && <SendFace key={`${shown.before}>${shown.now}`} glyph={shown.before} motion="morph-out" />}
      <SendFace key={shown.now} glyph={shown.now} motion={shown.before !== null ? "morph-in" : undefined} />
    </button>
  );
}

/** 보내기 원 안의 글리프 하나 — 바뀌는 동안 옛것과 새것이 같은 자리에 겹친다. */
function SendFace({ glyph, motion }: { glyph: SendGlyph; motion?: "morph-in" | "morph-out" }) {
  return (
    <span aria-hidden className={cn("absolute inset-0 flex items-center justify-center", motion)}>
      {glyph === "send" ? (
        <ArrowUp className="size-3.5" />
      ) : glyph === "stop" ? (
        <span className="size-1.5 rounded-2xs bg-current" />
      ) : (
        <Spinner className="size-3" />
      )}
    </span>
  );
}

export default ThreadComposer;

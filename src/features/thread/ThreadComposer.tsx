import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useStore } from "@tanstack/react-store";
import { ArrowUp, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChanged } from "./arrival";
import { attachmentStore, attachmentsOf } from "./attachments";
import { slashCommands, threadCommands, type CommandOption } from "./chips";
import { attachPaths, ComposerAttachmentChips, pickFiles, useAttachmentDrop } from "./ComposerAttachments";
import {
  AskChip,
  CodexModeChip,
  ModelChip,
  NewWorkChip,
  RuntimeChip,
  ScopeChip,
  ScopeLineText,
  type ComposerTray,
  type ModeChoice,
  type ModelChoice,
  type RuntimeChoice,
} from "./ComposerChips";
import { runtimeNameOf } from "./runtime";
import SlashMenu, { commandText, matchCommands, optionId, slashQuery } from "./SlashMenu";
import { sendDraft } from "./send-draft";
import { DraftQuoteChip } from "./QuoteChip";
import { setDraft, setQuote, takeFill, threadUiStore } from "./thread-store";
import type { Quote } from "@/features/works/QuotePick";
import type { Attachment } from "./types";

// 입력창(v1 티켓 05 · 02 티켓 10 · 02 구현 스펙 §9 · 03 구현 스펙 §5 · §6 · restart 02b-2 · 시안 Composer · Thread 보드) — Codex 입력창이다:
// 대화 열과 같은 737 폭에 둥글기 22(`rounded-prompt`) · 1px 4% 고리와 흐림 40의 그림자(`shadow-composer` — 다크는 안쪽 흰 0.2 실선) · 안쪽 14/8/8
// · 글 칸 최소 44 · 14 / 22.75 · 자리표시 `fg-placeholder`. 아래 줄은 `+` · 모드(Claude는 물어보는 정도, Codex는 Codex 모드) · 빈 칸 · Runtime ·
// 모델과 생각 깊이 · 보내기 원이고 사이는 2다. Runtime이 선언하지 않은 칩은 서지 않는다(「능력이 적을 때」).
// 트레이는 첫 말 전의 새 채팅에만 상자 아래에 선다 — 작업공간 만들기로 연 새 채팅의 「새 작업공간」 칩과 범위 칩 · 범위 줄이다(`ComposerTray`).
// 첫 말 뒤 입력창에는 트레이가 없다(Thread 보드 — 어디서 일하는지는 탭 줄 · 창 머리가 말한다).
// three-axes 입력창(`chat/Composer.tsx`)을 옮겨 보드의 모양으로 고쳤다.
// - **보내기 원 하나가 지금 할 수 있는 일을 말한다**(02 §9 · Composer 「보내는 중」 · 「일하는 중」) — 28 파란 원(`accent-solid`)에 흰 글리프 14.
//   비면 옅은 ↑(40%, 꺼짐), 쓰면 ↑, 새 채팅의 첫 말을 보내는 중이면 옅은 파랑(`accent-solid-pending`)에 13 고리 스피너, 턴이 도는 동안 비어 있으면
//   멈추기(■ 10)다. 도는 동안 쓰면 원은 ↑다 — 쓴 말도 보낸다(엔진이 대기 줄 끝에 넣고 입력창 위 대기 줄에 선다). 그동안 멈추기는 Esc가 맡는다.
// - **`+`와 끌어다 놓기는 첨부다**(v1 티켓 06 · S30) — 받은 파일 · 폴더가 입력칸 위에 칩(글리프 · 이름 · ×)으로 쌓인다. 끌고 들어온 동안은 입력창이
//   그 자리에 남아 포커스 링과 같은 표시를 두르고, 빈 칸의 말이 「여기에 놓으면 첨부돼요」가 된다(「끌어다 놓는 중」). 보내면 경로만 간다.
// - **인용**(v1 티켓 35 · S41) — 넓힌 카드의 문서에서 고른 글(「❝ 이 자리를 두고 말하기」)이 입력칸 위에 인용 칩으로 붙는다(×로 뗀다). 보내면
//   말과 함께 가고, 엔진이 그 Work의 spec 폴더를 가리키는 인용 블록으로 본문 앞에 둔다.
// - **「/」로 시작하면 명령 메뉴**가 입력창 위에 같은 폭으로 선다(`SlashMenu`) — `/new`는 새 Thread로 가고, `/plan`은 물어보는 정도를 「계획」으로
//   바꾸고, `/policy`는 물어보는 정도 메뉴를 연다(v1 티켓 23). `/model`은 모델 칩 메뉴를 연다(코드 리뷰 1차 B8). Runtime 명령은 입력칸이 `/이름 `이
//   된다. `/plan` · `/policy`는 물어보는 정도 칩이 설 때만 선다 — Codex 채팅에서는 Codex의 `/plan`이 그 이름으로 선다(`threadCommands`).
// - **칩의 메뉴는 입력창 위 8에 선다**(Composer `.ra-menu{bottom:calc(100% + 8px)}`) — 모드 메뉴는 상자 왼쪽 8, Runtime · 모델 메뉴는 오른쪽 8에
//   맞춘다. 그래서 메뉴의 닻은 칩이 아니라 상자(`box`)다.
// - **Esc는 멈추기**다(보드 「단축키」) — 메뉴가 서 있으면 메뉴만 걷는다.
//
// - **움직임**(v1 티켓 43 · 02 §12 · Motion 보드) — 카드가 걷혀 입력창이 돌아오면 아래 4에서 떠오르고(줄 바뀜), 보내기 원의 글리프가 바뀌면 옛
//   글리프가 .6배로 줄며 사라지고 새 글리프가 .6배에서 커지며 선다(보내기 아이콘 모핑 .52s — 원의 면 색 · 옅음도 같은 박자로 바뀐다). 글 칸이
//   줄 수만큼 자라고 줄 때 높이가 패널 박자로 옮겨 간다(입력창 높이 .22s). 첨부 · 인용 칩은 붙을 때 칩으로 나타난다(칩 등장). 끌어다 놓는 표시는
//   기본 박자(150ms)로 들고 난다. 칩의 메뉴는 .98배 · 아래 2에서 30ms 늦게 선다(메뉴가 열린다). 화면이 처음 설 때 이미 있던 것은 움직이지
//   않는다(`arrival.tsx`).
//
// 입력 중인 글 · 쌓인 첨부 · 붙은 인용은 Thread마다 모듈 스토어에 산다(`threadUiStore.drafts` · `attachmentStore` · `threadUiStore.quotes`). 보낸 말은 여기서 그리지
// 않는다 — 엔진이 기록에 적은 `sent` 줄이 말풍선으로 선다.

/** 입력칸이 자라는 끝 — 넘으면 칸 안에서 구른다(Motion 「입력창 높이」 — 44 → 최대 204). */
const FIELD_MAX = 204;

/**
 * 비어 있을 때의 말(Thread 보드의 `ph` · Composer 칸) — 첫 말을 보내는 중 · 도는 동안 · 턴이 끝난 채팅(우리가 멈춘 뒤도 같다)이다. 새 채팅은 시작할
 * 곳의 말을 받는다(`placeholder`). 파일을 끌고 들어온 동안은 놓을 자리를 말한다.
 */
const PLACEHOLDER = {
  starting: "채팅을 시작하는 중…",
  idle: "후속 작업을 입력하세요",
  running: "일하는 동안 더 말해 두면 차례로 보내요",
  drop: "여기에 놓으면 첨부돼요",
} as const;

export interface ThreadComposerProps {
  /** 입력 중인 글의 열쇠 — Thread id, 새 Thread면 `NEW_THREAD`. */
  draftKey: string;
  /** 모드 칩(restart 01c-5) — Claude Code는 물어보는 정도(v1 티켓 23 — `/plan` · `/policy`가 바꾼다), Codex는 Codex 모드다. 없으면 서지 않는다. */
  mode: ModeChoice | null;
  /** 모델과 생각 깊이 칩 — 없으면 서지 않는다(첫 말 전 Codex · Runtime이 모델을 선언하지 않았다). */
  model: ModelChoice | null;
  /** Runtime이 보낸 「/」 명령 — 화면 명령(`/new`) 뒤에 붙는다. */
  commands: readonly CommandOption[];
  running: boolean;
  /** 보내는 중이라 입력을 받지 않는다(새 Thread의 첫 말 — Session이 열릴 때까지). */
  busy?: boolean;
  /**
   * 고른 Runtime을 확인하는 중이라 보내기를 잠근다(restart 01c-9 — 새 채팅, 최대 20초). 쓰기와 Runtime 고르기는 그대로다 — 보내면 Runtime이 잠겨
   * 안내 카드의 바꾸는 단추가 사라지기 때문에 보내기만 잠근다.
   */
  checking?: boolean;
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
  /** 트레이(03 §5 · Composer 「새 채팅 · 범위 트레이」) — 첫 말 전의 새 채팅에만 상자 아래에 서는 회색 띠다. 입력창 자리에 카드가 서면 함께 걷힌다. */
  tray?: ComposerTray;
  /** 비어 있을 때의 말 — 새 채팅이 시작할 곳을 따른다(`startPlaceholder`). 없으면 턴이 끝난 채팅의 「후속 작업을 입력하세요」다. 도는 동안의 말이 이긴다. */
  placeholder?: string;
  /**
   * 그 채팅의 Runtime(restart 01c-3) — 모델 칩 앞에 선다. 새 채팅이면 고르기(`onPick`)가 함께 오고, 턴이 시작된 채팅은 이름만 선다. 첫 말을 보내는
   * 중(`busy`)에도 잠긴다 — Runtime은 그 말과 함께 떠났다.
   */
  runtime?: RuntimeChoice;
}

function ThreadComposer({
  draftKey,
  mode,
  model,
  commands,
  running,
  busy = false,
  checking = false,
  card,
  above,
  onSend,
  onStop,
  onNewThread,
  problem: outside = null,
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
  const modeKind = mode?.kind ?? null;
  const all = useMemo(() => slashCommands(commands, threadCommands(modeKind && { kind: modeKind })), [commands, modeKind]);
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
      if (mode?.kind === "ask" && mode.level !== "plan") mode.onLevel("plan");
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
      // 칩이 없거나 보이기만 할 때(고를 목록이 없다)는 열 메뉴가 없다 — 입력칸으로 돌아간다.
      if (model?.models && model.models.length > 0) setChoosingModel(true);
      else field.current?.focus();
      return;
    }
    setDraft(draftKey, `${commandText(command)} `);
    field.current?.focus();
  };

  const carded = card != null;
  // 입력창 상자 — 칩 메뉴의 닻이고(입력창 위 8 · 상자 끝 8), 좁을 때를 재는 칸이다.
  const box = useRef<HTMLFormElement>(null);
  const runtimeName = runtimeNameOf({ runtime: runtime?.value ?? model?.runtime ?? "claude-code" });
  // 붙인 뒤에는 입력칸으로 돌아간다 — 고르기 창이 가져간 포커스다.
  const attach = (paths: readonly string[]) => {
    setProblem(null);
    attachPaths(draftKey, paths)
      .then(() => field.current?.focus())
      .catch((error: unknown) => setProblem(String(error)));
  };
  const dragging = useAttachmentDrop(!busy && !carded, attach);
  // 입력창이 카드에 자리를 내준 적이 있나 — 있으면 다시 설 때 떠오른다(처음 그린 입력창은 그대로 선다). 끌어다 놓는 동안에는 자리를 내주지 않는다.
  const returned = useChanged(carded);
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
  }, [draft, carded]);
  useLayoutEffect(() => {
    if (!filled) return;
    takeFill();
    const el = field.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [filled]);

  // 거둔 글 · 첨부 · 인용은 거절되면 되돌아온다(`sendDraft`) — 새 채팅의 첫 말도 같다(restart 02a-11).
  const send = () => {
    if (draft.trim() === "" || busy || checking) return;
    setProblem(null);
    sendDraft(draftKey, onSend).catch((error: unknown) => setProblem(String(error)));
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
    <Tray>
      {tray.work && <NewWorkChip {...tray.work} />}
      {tray.scope && (
        <>
          <ScopeChip {...tray.scope} anchor={box} />
          <ScopeLineText scope={tray.scope.reading} />
        </>
      )}
    </Tray>
  );
  return (
    <div className="flex shrink-0 flex-col">
      {above && <div className="flex flex-col gap-2 pb-2">{above}</div>}
      {card ?? (
        <form
          ref={box}
          // 위에 선다(`z-1`) — 트레이가 상자 밑으로 14 겹쳐 들어간다(Composer `.ra-tray{margin-top:-14px}`). 폭을 재는 칸이다 — 좁으면(520 아래)
          // 모드 칩이 아이콘만 남는다(Composer 「좁을 때」). 파일을 끌고 들어온 동안은 포커스 링이 선다(`focus-ring`의 `[data-drop]` — 「끌어다 놓는 중」).
          data-drop={dragging || undefined}
          className={cn(
            "@container relative z-1 flex flex-col gap-1.5 rounded-prompt bg-surface-composer px-2 pt-3.5 pb-2 shadow-composer transition-shadow duration-basic ease-default focus-ring",
            returned && "row-in",
          )}
          onSubmit={(event) => {
            event.preventDefault();
            send();
          }}
        >
          {menuOpen && (
            <SlashMenu id={menuId} items={items} active={active} onPick={pickCommand} onPoint={setActive} runtime={runtimeName} />
          )}
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
                  : dragging
                    ? PLACEHOLDER.drop
                    : running
                      ? PLACEHOLDER.running
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
              // 글은 상자 끝에서 12(안쪽 8 + 4), 칸은 최소 44 · 14 / 22.75(Composer `.ra-field`)다. 줄 수가 바뀌면 높이가 패널 박자로 옮겨 간다
              // (Motion 「입력창 높이」 — 44 → 최대 204, 220ms).
              className="relative min-h-11 w-full resize-none overflow-y-auto bg-transparent px-1 text-chat-body tracking-[-0.15px] text-fg outline-none transition-[height] duration-panel ease-panel placeholder:text-fg-placeholder scroll-quiet motion-reduce:transition-none"
            />
          </div>
          <div className="flex min-w-0 items-center gap-0.5">
            <button type="button" aria-label="파일 첨부" onClick={pick} disabled={busy} className={ADD_BUTTON}>
              <Plus className="size-3.75" aria-hidden />
            </button>
            {/* 첫 말을 보내는 중(「세션 여는 중」)에도 칩은 그대로 서고 누르지 않는다 — 고른 것은 이미 첫 말과 함께 떠났다. 모델 칩만 Runtime이
                목록을 알려 줄 때까지 스켈레톤이다. */}
            <span className={cn("flex min-w-0 flex-1 items-center gap-0.5", busy && "pointer-events-none")}>
              {mode?.kind === "ask" && <AskChip level={mode.level} onLevel={mode.onLevel} open={asking} onOpenChange={setAsking} anchor={box} />}
              {mode?.kind === "codex" && <CodexModeChip {...mode} anchor={box} />}
              <span className="min-w-0 flex-1" />
              {runtime && <RuntimeChip value={runtime.value} onPick={busy ? undefined : runtime.onPick} anchor={box} />}
              {busy ? (
                <ModelSkeleton />
              ) : (
                model && <ModelChip {...model} running={running} open={choosingModel} onOpenChange={setChoosingModel} anchor={box} />
              )}
            </span>
            <SendButton running={running} empty={empty} busy={busy} locked={checking} onStop={onStop && stop} />
          </div>
        </form>
      )}
      {trayed}
      {shown && (
        <p role="alert" className="px-3 pt-1.5 text-xs text-fg-secondary">
          {shown}
        </p>
      )}
    </div>
  );
}

/**
 * 트레이(Composer 「새 채팅 · 범위 트레이」 `.ra-tray`) — 첫 말 전의 새 채팅에만 상자 아래에 서는 회색 띠(`surface-tray`)다. 좌우 14 안으로 들어서
 * 상자 밑으로 14 겹쳐 들어가고(상자가 덮는다), 보이는 안쪽은 위 6 · 아래 6이다. 아래만 둥글다(15.5 — `rounded-b-tray`). 첫 말 뒤 입력창에는
 * 트레이가 없다(Thread 보드).
 */
function Tray({ children }: { children: ReactNode }) {
  return (
    <div
      data-slot="composer-tray"
      className="mx-3.5 -mt-3.5 flex min-w-0 items-center gap-0.5 rounded-b-tray bg-surface-tray px-2 pt-5 pb-1.5 text-chat-meta text-fg-secondary"
    >
      {children}
    </div>
  );
}

/** 모델 칩 자리의 스켈레톤(Composer 「세션 여는 중」 `.ra-skel`) — 12 높이 · 92 폭 · 둥글기 6의 옅은 띠에 빛이 지나간다. 둘레 여백은 없다. */
function ModelSkeleton() {
  return <span role="status" aria-label="모델을 읽는 중" className="h-3 w-23 shrink-0 rounded-md skeleton-sweep" />;
}

/** 입력창 아래 줄의 `+` — 28 원 · 글리프 15 · `fg-secondary`(Composer `.ra-cc.ic-only.sec`). */
const ADD_BUTTON =
  "flex size-7 shrink-0 items-center justify-center rounded-full text-fg-secondary transition-colors hover:bg-fill-hover focus-ring";

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
  locked,
  onStop,
}: {
  running: boolean;
  empty: boolean;
  busy: boolean;
  /** 보내기를 잠근다 — 글리프는 ↑ 그대로고 원이 옅다(빈 칸과 같다). */
  locked: boolean;
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
      disabled={glyph === "sending" || (glyph === "send" && (empty || locked))}
      className={cn(
        "relative ml-1 flex size-7 shrink-0 items-center justify-center rounded-full text-fg-on-solid transition-[background-color,opacity] duration-morph ease-default focus-ring",
        glyph === "sending" ? "bg-accent-solid-pending" : "bg-accent-solid",
        glyph === "send" && (empty || locked) && "opacity-40",
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
        <span className="size-2.5 rounded-2xs bg-current" />
      ) : (
        // 13 고리 — 흰 35% 길에 흰 위 끝이 돈다(Composer `.ra-send .wait`, `duration-spin` 900ms).
        <span className="size-3.25 send-wait" />
      )}
    </span>
  );
}

export default ThreadComposer;

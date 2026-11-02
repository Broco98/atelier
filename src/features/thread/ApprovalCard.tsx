import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowUp,
  BookOpen,
  Bot,
  ChevronRight,
  Command,
  FileText,
  Globe,
  Info,
  Map as MapIcon,
  Pencil,
  Search,
  SquareTerminal,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { HOTKEYS } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";
import { threadApi } from "./api";
import { buttonKey, cardChoices, cardKey, describeApproval, fieldLabel, skipHint, type CardBadge, type CardChoice } from "./approval";
import { ASK_CARD, ASK_CODE, ASK_WHY, AskActs, AskButton, AskGrow, AskKind, AskTitle, AskTop } from "./AskCard";
import type { AskTurn } from "./asks";
import { AskCount } from "./AskTurnMarks";
import type { Json } from "./json";
import type { PendingPermission } from "./fold";
import type { DiffPiece } from "./tool-view";
import { Unfold } from "./WorkLog";

// 승인 카드(v1 티켓 24 · restart 02b-5 · 시안 Cards 보드 「승인 카드 — 입력창 자리에 선다」) — Runtime이 권한을 물으면 **입력창이 사라지고 그 자리에**
// 선다(스토리 74). 겉은 사람의 답을 기다리는 카드의 한 겉(`AskCard` — 보드 `.ra-ask`)이다. 위 칸은 갈래(「터미널」 · 「파일 편집」 · 「인터넷 액세스」 ·
// 「MCP」 · 「계획」), 누가 무엇을 하려는지 묻는 한 문장, 명령 상자나 줄어든 diff, 아래 한 줄(사유 · 대상)이다. 아래 줄은 왼쪽 허락 문구, 오른쪽 「거부 Esc」 ·
// 「한 번만 허용 ↵」다. 값과 선택지는 순수 함수가 짓는다(`approval.ts`).
//
// - **키보드로 고른다** — ↵는 「한 번만 허용」 · 「구현」, esc는 「거부」뿐이다(`buttonKey`). **숫자 키는 없다**(S25). Tab으로 단추에 옮겨 가면 ↵는
//   그 단추다. 보드의 글쇠는 「⌘↵」지만 앱의 ⌘Enter는 패널 토글이라 카드는 ↵ 그대로이고 글쇠도 「↵」로 적는다. 카드가 서면 포커스를 받는다 — 입력창이
//   자리를 내주며 풀린 포커스만 받고, 다른 칸에 있던 포커스는 빼앗지 않는다. **선 직후 잠깐(`ARMING_MS`)은 키를 받지 않는다** — 입력창에 말을 쓰던
//   손의 다음 글쇠(Enter)가 막 선 카드를 고르지 않게.
// - **Claude의 「거부」는 카드 안에 입력칸을 연다**(스토리 65 · 스펙 「승인 카드의 동작은 그대로다」) — 보내면 거부와 그 말이 Runtime에게 간다. 비워
//   보내면 거부만 간다. 입력칸의 Esc는 칸을 닫고 카드로 돌아간다. **계획의 「다시 짜기」**도 같은 칸을 열고 고칠 점을 받는다.
// - **Codex는 보낸 선택지를 그대로 그린다** — 긴 이름은 단추 안에서 접히고 그 줄은 다음 줄로 가지 않는다(`.ra-opt.long`).
// - **MCP의 「세부 정보 보기」**는 도구에 보낸 값을 카드 안에서 펼친다(스펙 「02b — 대화창」 · 펼침 · 접힘 — `Unfold`).
// - 이 카드는 권한 답 명령을 부르기만 한다. 고른 것은 기록의 답 줄(`answered`)로 오고, 그 줄이 오면 접기가 이 요청을 빼서 카드가 곧바로 걷히고 입력창이
//   200ms로 돌아오며(Motion 보드 「승인 카드가 올라온다」), 물은 턴의 그 도구 줄 위에 결정 줄이 칩으로 선다(스토리 71 — 「한 번만 허용함」). 답이 오기
//   전에 두 번 고르지 않게, 고른 뒤로는 단추가 잠긴다.
// - **고르기 전에 할 말**(v1 티켓 25 · 스토리 83) — 입력칸에 말을 쓰는 동안 그 아래에 「보내면 이 명령은 건너뛰고 …에게 말을 전해요」가 선다(`skipHint`).
// - **여럿이 물으면 차례를 말한다**(v1 티켓 25) — 갈래 줄 오른쪽에 「1 / 2」, 맨 아래에 「다음 · …」 줄(`AskTurnMarks`). 차례는 부르는 쪽이
//   `askTurn`으로 읽어 준다.
// - 카드에 멈추기가 없다 — 서 있는 동안 멈추는 길은 거부다.

/** 카드가 선 뒤 키를 받기 시작할 때까지(머리말). 입력창 자리의 다른 카드도 이 값을 쓴다(`useSlotCard`). */
export const ARMING_MS = 300;

/**
 * 입력창 자리 카드의 같은 몸(승인 · 질문 · 로그인 · Work 만들기 · Work 밖 Project · Thread 도구 질문 카드) — 카드 상자(`box`)는 서면 풀린 포커스만
 * 받는다(입력창이 자리를 내주며 풀린 것 — 다른 칸의 포커스는 빼앗지 않는다). 선 직후 잠깐(`ARMING_MS`)은 키를 받지 않는다(`armed`). 답은
 * 하나만 보낸다(`send` — 보내는 동안 `sent`). 답하지 못하면(엔진이 거절) 다시 고를 수 있게 풀고 까닭(`problem`)을 보인다 — 이미 닫힌
 * 물음이면 곧 그 줄이 와서 카드가 걷힌다.
 */
export function useSlotCard() {
  const box = useRef<HTMLDivElement>(null);
  const shownAt = useRef(0);
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    shownAt.current = performance.now();
    const holder = document.activeElement;
    if (holder === null || holder === document.body) box.current?.focus({ preventScroll: true });
  }, []);
  const armed = () => performance.now() - shownAt.current >= ARMING_MS;
  const send = (answer: () => Promise<unknown>) => {
    if (sent) return;
    setSent(true);
    setProblem(null);
    answer().catch((error: unknown) => {
      setSent(false);
      setProblem(String(error));
    });
  };
  return { box, armed, sent, problem, send };
}

/**
 * 시안에 없는 입력창 자리 카드(작업공간 제안 · Project · 도구 질문)의 겉(02 §10 · 스토리 68) — 1px `border-slot` · 흰 면, 그림자 없음. 폭은 입력창 자리
 * 그대로(열 737)다. 둥글기는 시안의 카드(`.ra-ask`)와 같은 22다(스펙 「02b — 대화창」 — 지금 모양에 둥글기만 맞춘다). 한때 25(superellipse)였다.
 */
export const SLOT_CARD = "rounded-prompt border border-border-slot bg-surface outline-none";

/** 카드 머리의 갈래 글리프 — 작업 로그의 종류 글리프(`WorkLog`의 `GLYPHS`)와 같은 그림이고, 계획은 지도다(보드 `ic-map`). */
const BADGE_ICONS: Record<CardBadge["glyph"], LucideIcon> = {
  read: BookOpen,
  edit: Pencil,
  doc: FileText,
  execute: SquareTerminal,
  search: Search,
  web: Globe,
  mcp: Command,
  skill: Wrench,
  agent: Bot,
  other: Zap,
  plan: MapIcon,
};

interface ApprovalCardProps {
  thread: string;
  /** 그 채팅의 Runtime 이름(`runtimeNameOf`) — 물음과 카드 이름에 선다. */
  name: string;
  /** 그 채팅의 Runtime 값(`ThreadView.runtime`) — Codex는 보낸 선택지를 그대로 그린다(`cardChoices`). */
  runtime: string;
  /** 맨 앞의 답하지 않은 요청. 부르는 쪽이 요청 id를 key로 건다 — 다음 요청이 오면 카드가 새로 선다. */
  request: PendingPermission;
  /** 허락을 둘 자리 — Work에 이은 Thread면 그 Work, 아니면 이 Thread(S18). */
  scope: "work" | "thread";
  /** 물은 Session의 작업 폴더 — 파일 자리를 그 폴더에서 본 자리로 줄인다. */
  cwd: string | null;
  /** 물음 차례의 「1 / 2」(`askTurn`) — 묶음에 물음이 하나뿐이면 null. */
  count?: AskTurn["count"];
  /** 카드 맨 아래 「다음 · …」 줄(`AskNext`) — 다음 차례가 없으면 비운다. */
  next?: ReactNode;
}

function ApprovalCard({ thread, name, runtime, request, scope, cwd, count = null, next }: ApprovalCardProps) {
  const hintId = useId();
  const { box: card, armed, sent, problem, send } = useSlotCard();
  const field = useRef<HTMLInputElement>(null);
  const view = describeApproval(request, name, cwd);
  const { layout, choices } = cardChoices(request, scope, runtime);
  const [active, setActive] = useState(0);
  const [writing, setWriting] = useState(false);
  const [words, setWords] = useState("");
  const hinted = writing && words.trim() !== "";

  useLayoutEffect(() => {
    if (writing) field.current?.focus();
  }, [writing]);

  const answer = (choice: CardChoice, said: string | null = null) =>
    send(() => threadApi.answerPermission(thread, request.requestId, choice.option, choice.remember, said));
  const choose = (at: number) => {
    const choice = choices[at];
    if (!choice || sent) return;
    setActive(at);
    if (choice.opensField) setWriting(true);
    else answer(choice);
  };
  const refuse = () => {
    const choice = choices.find((one) => one.opensField);
    if (choice) answer(choice, words.trim() === "" ? null : words.trim());
  };
  // 포커스가 선 단추 — 단추 줄의 ↵는 그 단추다(`buttonKey`). 카드 자체에 포커스가 있으면 null이다.
  const focusedChoice = (target: EventTarget) => {
    const at = target instanceof HTMLElement ? target.dataset.choice : undefined;
    return at === undefined ? null : Number(at);
  };
  // 빈칸은 왼쪽 단추들(허락 문구 · Codex가 보낸 이름) 뒤에 선다 — 거부 · 허용이 오른쪽 끝에 붙는다.
  const grow = choices.findIndex((choice) => choice.tone !== "opt");

  return (
    <div
      ref={card}
      role="group"
      aria-label={view.title}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.target === field.current || event.nativeEvent.isComposing || event.repeat) return;
        if (!armed()) return;
        if (layout === "buttons") {
          const at = buttonKey(event, choices, focusedChoice(event.target));
          if (at === null) return;
          event.preventDefault();
          choose(at);
          return;
        }
        const key = cardKey(event, choices.length, active);
        if (!key) return;
        event.preventDefault();
        if ("point" in key) setActive(key.point);
        else choose(key.pick);
      }}
      className={ASK_CARD}
    >
      <AskTop>
        <AskKind icon={BADGE_ICONS[view.badge.glyph]} label={view.badge.label} aside={<AskCount count={count} />} />
        <AskTitle>{view.title}</AskTitle>
        {view.command !== null && <pre className={ASK_CODE}>{view.command}</pre>}
        {view.diff && <DiffPeek piece={view.diff} />}
        {view.why !== null && <p className={ASK_WHY}>{view.why}</p>}
        {view.details !== null && <Details input={view.details} />}
      </AskTop>
      {layout === "rows" ? (
        <div className="flex flex-col gap-0.5 px-1 pb-2">
          {choices.map((choice, at) => {
            const last = at === choices.length - 1;
            return (
              <button
                key={`${at}-${choice.label}`}
                type="button"
                disabled={sent}
                onClick={() => choose(at)}
                onFocus={() => setActive(at)}
                aria-keyshortcuts={last ? HOTKEYS.dismiss.aria : undefined}
                className={cn(
                  "flex min-h-9 w-full items-center gap-2.5 rounded-xl px-3 text-left text-sm text-fg transition-colors hover:bg-fill-hover focus-ring disabled:opacity-60",
                  at === active && "bg-fill-soft",
                )}
              >
                <span aria-hidden className="w-3 shrink-0 text-xs text-fg-tertiary">
                  {at + 1}
                </span>
                <span className="min-w-0 flex-1 wrap-anywhere">{choice.label}</span>
                {at === active && <KeyCap>↵</KeyCap>}
                {last && at !== active && <KeyCap>{HOTKEYS.dismiss.glyph}</KeyCap>}
              </button>
            );
          })}
          {writing && <div className="mt-0.5 ml-8.5">{refuseField()}</div>}
          {hinted && <div className="mt-1 ml-8.5">{hint()}</div>}
        </div>
      ) : (
        <>
          {writing && (
            <div className="flex flex-col gap-1 px-4 pb-2">
              {refuseField()}
              {hinted && hint()}
            </div>
          )}
          <AskActs long={choices.some((choice) => choice.long)}>
            {grow < 0 && <AskGrow />}
            {choices.map((choice, at) => (
              <ChoiceButton
                key={`${at}-${choice.label}`}
                choice={choice}
                at={at}
                grow={at === grow}
                pressed={writing && choice.opensField}
                disabled={sent}
                onPick={() => choose(at)}
              />
            ))}
          </AskActs>
        </>
      )}
      {problem && (
        <p role="alert" className="px-4 pb-3 text-xs text-fg-secondary">
          {problem}
        </p>
      )}
      {next && <div className="px-3 pb-2">{next}</div>}
    </div>
  );

  /** 「거부」 · 「다시 짜기」가 여는 칸 — 보내면 거부(또는 다시 짜기)와 그 말이 간다. 칸의 Esc는 칸만 닫는다. */
  function refuseField() {
    return (
      <div className="flex h-10 items-center gap-2 rounded-xl pr-1.5 pl-3.5 inset-ring inset-ring-border-heavy">
        <input
          ref={field}
          value={words}
          disabled={sent}
          aria-label={fieldLabel(view.kind, name)}
          aria-describedby={hinted ? hintId : undefined}
          placeholder={fieldLabel(view.kind, name)}
          onChange={(event) => setWords(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              refuse();
            } else if (event.key === "Escape") {
              event.preventDefault();
              setWriting(false);
              card.current?.focus({ preventScroll: true });
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-sm leading-5.5 text-fg outline-none placeholder:text-fg-tertiary"
        />
        <button
          type="button"
          aria-label="보내기"
          disabled={sent}
          onClick={refuse}
          className="flex size-7 shrink-0 items-center justify-center rounded-full bg-fg text-fg-inverse focus-ring"
        >
          <ArrowUp className="size-3.5" aria-hidden />
        </button>
      </div>
    );
  }

  /** 고르기 전에 할 말 — 칸에 말을 쓰는 동안 그 아래에 선다(`skipHint`). */
  function hint() {
    return (
      <p id={hintId} className="flex items-center gap-1.5 px-1 text-xs text-fg-secondary">
        <Info className="size-3.5 shrink-0" aria-hidden />
        {skipHint(view.kind, name)}
      </p>
    );
  }
}

/**
 * 단추 줄의 단추 하나 — 승인 카드의 선택지(`CardChoice`)를 카드 단추(`AskButton`)에 얹는다. 글쇠는 ↵ · 「Esc」(단축키 표의 글리프)이고, esc가 고르는
 * 단추는 단축키 표의 그 키를 `aria-keyshortcuts`로 말한다(↵는 표 밖의 카드 안 키다). `grow`면 그 앞에 빈칸이 선다.
 */
function ChoiceButton({
  choice,
  at,
  grow,
  pressed,
  disabled,
  onPick,
}: {
  choice: CardChoice;
  at: number;
  grow: boolean;
  /** 「거부」 · 「다시 짜기」가 연 칸이 서 있다. */
  pressed: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  const dismisses = choice.key === "escape";
  const glyph = choice.key === "enter" ? "↵" : dismisses ? HOTKEYS.dismiss.glyph : null;
  const keycap = choice.keycap ? glyph : null;
  return (
    <>
      {grow && <AskGrow />}
      <AskButton
        tone={choice.tone}
        long={choice.long}
        keycap={keycap}
        data-choice={at}
        disabled={disabled}
        onClick={onPick}
        aria-keyshortcuts={dismisses ? HOTKEYS.dismiss.aria : undefined}
        aria-pressed={choice.opensField ? pressed : undefined}
        className="aria-pressed:bg-fill-hover"
      >
        {choice.label}
      </AskButton>
    </>
  );
}

/**
 * MCP 도구에 보낸 값(Cards 보드 「MCP 도구」 「세부 정보 보기 ›」) — 아래 한 줄 자리의 글 단추가 도구 입력을 카드 안에서 펼친다. 셰브런은 펼치면 ∨로
 * 돌고, 상자는 펼침 · 접힘(`Unfold` — 높이와 옅음)으로 자란다. 상자는 명령 상자와 같은 꼴이고 넘치면 그 안에서 굴린다.
 */
function Details({ input }: { input: Json }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((now) => !now)}
        className="flex w-fit items-center gap-1 rounded-xs text-xs text-fg-tool transition-colors duration-basic ease-default hover:text-fg-secondary focus-ring"
      >
        세부 정보 보기
        <ChevronRight
          className={cn("size-3 shrink-0 transition-transform duration-relaxed ease-enter", open && "rotate-90")}
          aria-hidden
        />
      </button>
      <Unfold open={open}>
        <pre className={cn(ASK_CODE, "max-h-45 overflow-auto scroll-quiet")}>{JSON.stringify(input, null, 2)}</pre>
      </Unfold>
    </>
  );
}

/**
 * 번호 줄 끝의 글쇠(보드 `.kbd`) — 높이 20 · 반경 6 · 머리카락 선, 고정폭 `fg-tertiary`. 그림이라 숨는다(줄의 이름은 선택지 글이다).
 * Work 밖 Project 카드(v1 티켓 32)의 번호도 이것이다.
 */
export function KeyCap({ children }: { children: string }) {
  return (
    <span
      aria-hidden
      className="inline-flex h-5 min-w-5.5 shrink-0 items-center justify-center rounded-sm px-1 font-mono text-2xs text-fg-tertiary shadow-hairline"
    >
      {children}
    </span>
  );
}

/**
 * 시안에 없는 입력창 자리 카드의 바닥 단추 — 28 알약 · 1px `border-slot` · 13. ↵ 단추(「고르기」)는 맨 오른쪽에 검게 서고(`ml-auto`), 나머지는 옅은
 * 면(`fill-soft`의 반)이다. 글쇠가 있으면 끝에 옅게 적는다 — `esc`(단축키 표의 글리프를 작은 글자로) · `↵`. 글쇠는 그림이라 숨는다 — esc가 고르는 단추는
 * 단축키 표의 그 키를 `aria-keyshortcuts`로 말한다(↵는 표 밖의 카드 안 키다). 글쇠를 그리지 않아도 esc가 고르는 단추(`dismisses` — Thread 도구 질문
 * 카드의 「나중에」)도 그렇다. Thread 도구 질문 카드(`ToolQuestionCard` — 03 티켓 08)의 「나중에」 · 「고르기 ↵」가 이것이다.
 */
export function SlotButton({
  label,
  keycap,
  dismisses = false,
  at,
  pressed,
  disabled,
  onClick,
}: {
  label: string;
  /** 끝에 옅게 적는 글쇠 — 없으면 null이다. */
  keycap: "enter" | "escape" | null;
  /** 글쇠를 그리지 않아도 esc가 이 단추다. */
  dismisses?: boolean;
  /** `data-choice` — 단추 줄의 ↵는 포커스가 선 단추다(`buttonKey`). */
  at: number;
  /** 칸을 여는 단추가 눌렸나(`aria-pressed`) — 칸을 열지 않는 단추는 `undefined`다. */
  pressed?: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const primary = keycap === "enter";
  const dismiss = keycap === "escape" || dismisses;
  return (
    <button
      type="button"
      data-choice={at}
      disabled={disabled}
      onClick={onClick}
      aria-keyshortcuts={dismiss ? HOTKEYS.dismiss.aria : undefined}
      aria-pressed={pressed}
      className={cn(
        "flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border-slot text-chat-meta transition-colors focus-ring disabled:opacity-60",
        keycap ? "pr-2 pl-2.5" : "px-2.5",
        primary ? "ml-auto bg-fg text-fg-inverse" : "bg-fill-soft/50 text-fg hover:bg-fill-soft aria-pressed:bg-fill-hover",
      )}
    >
      {label}
      {keycap && (
        <span
          aria-hidden
          className={cn(
            "inline-flex h-4 min-w-4 items-center justify-center rounded-row corner-superellipse px-1.5 text-xs leading-4",
            primary ? "bg-fg-inverse/16" : "bg-fill-hover lowercase",
          )}
        >
          {primary ? "↵" : HOTKEYS.dismiss.glyph}
        </span>
      )}
    </button>
  );
}

/** 줄어든 diff에 그릴 줄 수 — 상자(132)를 넘길 만큼만 그린다. 다 보려면 고친 뒤 작업 로그의 변경 카드에서 편다. */
const PEEK = 8;
/** 줄어든 diff의 높이(보드 `.ra-mdiff{max-height:132px}`)와 줄 높이(12 / 21.6). */
const PEEK_MAX = 132;
const PEEK_LINE = 21.6;

/**
 * 파일 카드의 줄어든 diff(보드 `.ra-mdiff`) — 둥근 8 · 안 1 `diff-border` · 고정폭 12 / 21.6 · 132까지. 더한 줄은 `diff-added-line` 바탕에 찬 막대, 지운
 * 줄은 `diff-deleted-line` 바탕에 빗금 막대다(작업 로그의 변경 카드와 같은 줄). 더한 줄은 `<ins>`, 지운 줄은 `<del>`이다. 넘치면 아래 30%가 옅다 — 보드는 늘
 * 옅지만 넘치지 않는 diff의 끝 줄까지 옅어지면 「더 있다」로 읽혀 넘칠 때만이다. 줄 번호는 없다 — ACP diff는 파일 안의 자리를 싣지 않는다(02b-4).
 */
function DiffPeek({ piece }: { piece: DiffPiece }) {
  const lines = piece.lines.slice(0, PEEK);
  const over = piece.lines.length * PEEK_LINE > PEEK_MAX;
  return (
    <figure
      aria-label={`${piece.path} 변경`}
      className={cn(
        "max-h-33 overflow-hidden rounded-md font-mono text-xs leading-[21.6px] tracking-normal inset-ring inset-ring-diff-border",
        over && "ask-diff-fade",
      )}
    >
      {lines.map((line, at) => {
        const key = `${at}`;
        if (line.type === "gap") {
          return (
            <div key={key} className="bg-fill-soft pl-3.5 font-sans text-fg-tertiary">
              {line.count}줄 숨김
            </div>
          );
        }
        const text = <span className="pl-2.5 whitespace-pre">{line.text === "" ? " " : line.text}</span>;
        if (line.type === "add") {
          return (
            <ins key={key} className="flex bg-diff-added-line no-underline">
              <span aria-hidden className="w-1 shrink-0 bg-diff-added" />
              {text}
            </ins>
          );
        }
        if (line.type === "del") {
          return (
            <del key={key} className="flex bg-diff-deleted-line no-underline">
              <span aria-hidden className="diff-bar-deleted w-1 shrink-0" />
              {text}
            </del>
          );
        }
        return (
          <div key={key} className="flex">
            <span aria-hidden className="w-1 shrink-0" />
            {text}
          </div>
        );
      })}
    </figure>
  );
}

export default ApprovalCard;

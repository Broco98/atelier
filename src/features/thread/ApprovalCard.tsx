import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Info, Shield } from "lucide-react";
import { HOTKEYS } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";
import { threadApi } from "./api";
import { buttonKey, cardChoices, cardKey, describeApproval, fieldLabel, skipHint, type CardChoice } from "./approval";
import type { AskTurn } from "./asks";
import { AskCount } from "./AskTurnMarks";
import type { PendingPermission } from "./fold";
import { shownPath, type DiffPiece } from "./tool-view";

// 승인 카드(v1 티켓 24 · 02 구현 스펙 §10 · 캔버스 v35 Screen-Live 단계 4) — Agent가 권한을 물으면 **입력창이 사라지고 그 자리에** 선다
// (스토리 74). 머리 한 줄이 누가 · 무슨 일 · 어떤 규칙 때문에 묻는지(스토리 61), 물음 아래 한 줄이 어디서 무엇이 바뀌는지(스토리 62)를
// 말하고, 단추 한 줄로 고른다(스토리 63). 값과 선택지는 순수 함수가 짓는다(`approval.ts`).
//
// 모양은 Screen-Live의 `section`이다 — 입력창 자리 카드의 한 겉(`SLOT_CARD` — 25 · 1px 옅은 테두리 · 흰 면, 폭은 입력창과 같다). 위
// 칸은 안쪽 16 / 16 / 12 · 사이 8: 머리(방패 14 · 13/20 2단계) → 물음(14/500)과 어디서 한 줄(13/18 3단계, 사이 2) → 명령 상자(12.5 ·
// `fill-soft` · 고정폭 13) 또는 파일 diff. 아래 단추 줄은 안쪽 8 / 16 / 16 · 사이 8: 테두리 단추 「아니요, 다르게」(`esc` 꼬리) · 「이
// Work에서 늘 허용」, 맨 오른쪽 검은 「이번만 허용」(`↵` 꼬리). 단추는 28 알약 · 1px 옅은 테두리 · 13이다.
//
// - **키보드로 고른다** — ↵는 「이번만 허용」, esc는 「아니요, 다르게」뿐이다(스토리 64 · `buttonKey`). **숫자 키는 없다**(S25). Tab으로
//   단추에 옮겨 가면 ↵는 그 단추다. 카드가 서면 포커스를 받는다 — 입력창이 자리를 내주며 풀린 포커스만 받고, 다른 칸에 있던 포커스는
//   빼앗지 않는다. **선 직후 잠깐(`ARMING_MS`)은 키를 받지 않는다** — 입력창에 말을 쓰던 손의 다음 글쇠(Enter)가 막 선 카드를 고르지 않게.
// - **「아니요, 다르게」는 카드 안에 입력칸을 연다**(스토리 65 · v1 보드 「고르기 전에 할 말이 있을 때」 A) — 보내면 거부와 그 말이
//   Agent에게 간다. 비워 보내면 거부만 간다. 입력칸의 Esc는 칸을 닫고 카드로 돌아간다.
// - **계획 넘어가기**(v1 티켓 26)는 같은 겉 · 같은 머리에 번호 줄 그대로다 — 「계획대로 구현」 · 「계획 다시 쓰기」, 숫자 · Enter(켜진 줄) ·
//   Esc(마지막) · ↑↓(`cardKey`). 다시 쓰기의 칸이 고칠 점을 받는다(`fieldLabel`). 엔진의 선택지를 그대로 보이는 요청도 번호 줄이다.
// - 이 카드는 권한 답 명령을 부르기만 한다. 고른 것은 기록의 답 줄(`answered`)로 오고, 그 줄이 오면 접기가 이 요청을 빼서 카드가 걷히고
//   그 자리(물은 턴)에 결정 줄이 선다(스토리 79). 답이 오기 전에 두 번 고르지 않게, 고른 뒤로는 단추가 잠긴다.
// - **고르기 전에 할 말**(v1 티켓 25 · 스토리 83) — 입력칸에 말을 쓰는 동안 그 아래에 「보내면 이 명령은 건너뛰고 Host에게 말을
//   전해요」가 선다(`skipHint`). 입력창은 카드가 대신했으니 카드에 할 말은 이 칸이 받는다.
// - **여럿이 물으면 차례를 말한다**(v1 티켓 25) — 머리 오른쪽에 「1 / 2」, 맨 아래에 「다음 · …」 줄(`AskTurnMarks`). 차례는 부르는 쪽이
//   `askTurn`으로 읽어 준다.
// - 카드에 멈추기가 없다 — 서 있는 동안 멈추는 길은 거부다.

/** 카드가 선 뒤 키를 받기 시작할 때까지(머리말). 질문 카드 · Work 밖 Project 카드도 이 값을 쓴다. */
export const ARMING_MS = 300;
/**
 * 입력창 자리 카드의 한 겉(02 §10 · 스토리 68) — 승인 · 계획 · 질문 · Work 만들기 · Project 붙이기 카드가 모두 이것이다. 둥글기 25
 * (superellipse — WebKit은 20의 둥근 네모) · 1px `border-slot` · 흰 면, 그림자 없음. 폭은 입력창 자리 그대로(열 737)다.
 */
export const SLOT_CARD = "rounded-slot corner-superellipse border border-border-slot bg-surface outline-none";
/** 파일 카드의 diff 상자에 보일 줄 수 — 넘으면 「N줄 더」. */
const PEEK = 8;

interface ApprovalCardProps {
  thread: string;
  /** 물은 참여자의 화면 이름(들어옴 줄, `ThreadModel.cast`) — 머리 한 줄과 카드 이름에 선다. */
  name: string;
  /** 맨 앞의 답하지 않은 요청. 부르는 쪽이 요청 id를 key로 건다 — 다음 요청이 오면 카드가 새로 선다. */
  request: PendingPermission;
  /** 「늘 허용」을 둘 자리 — Work에 이은 Thread면 그 Work, 아니면 이 Thread(S18). */
  scope: "work" | "thread";
  /** 물은 Session의 작업 폴더 — diff 머리의 경로를 줄인다. */
  cwd: string | null;
  /** 명령을 실행할 자리(`placeOf`). */
  place: string | null;
  /** 물음 차례의 「1 / 2」(`askTurn`) — 묶음에 물음이 하나뿐이면 null. */
  count?: AskTurn["count"];
  /** 카드 맨 아래 「다음 · …」 줄(`AskNext`) — 다음 차례가 없으면 비운다. */
  next?: ReactNode;
}

function ApprovalCard({ thread, name, request, scope, cwd, place, count = null, next }: ApprovalCardProps) {
  const hintId = useId();
  const card = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const shownAt = useRef(0);
  const view = describeApproval(request, name, place);
  const { layout, choices } = cardChoices(request, scope);
  const [active, setActive] = useState(0);
  const [writing, setWriting] = useState(false);
  const [words, setWords] = useState("");
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const hinted = writing && words.trim() !== "";

  useEffect(() => {
    shownAt.current = performance.now();
    const holder = document.activeElement;
    if (holder === null || holder === document.body) card.current?.focus({ preventScroll: true });
  }, []);
  useLayoutEffect(() => {
    if (writing) field.current?.focus();
  }, [writing]);

  const answer = (choice: CardChoice, said: string | null = null) => {
    setSent(true);
    setProblem(null);
    threadApi
      .answerPermission(thread, request.who, request.requestId, choice.option, choice.remember, said)
      .catch((error: unknown) => {
        // 답하지 못했다 — 다시 고를 수 있게 풀고 까닭을 보인다(이미 닫힌 요청이면 곧 그 줄이 와서 카드가 걷힌다).
        setSent(false);
        setProblem(String(error));
      });
  };
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

  return (
    <div
      ref={card}
      role="group"
      aria-label={view.label}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.target === field.current || event.nativeEvent.isComposing || event.repeat) return;
        if (performance.now() - shownAt.current < ARMING_MS) return;
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
      className={cn("flex shrink-0 flex-col overflow-hidden", SLOT_CARD)}
    >
      <div className="flex flex-col gap-2 px-4 pt-4 pb-3">
        <div className="flex items-center gap-2 text-chat-meta leading-5 text-fg-secondary">
          <Shield className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 wrap-anywhere">{view.head}</span>
          <AskCount count={count} />
        </div>
        <div className="flex flex-col gap-0.5">
          <p className="break-keep text-sm font-medium text-fg">{view.title}</p>
          {view.where && <p className="text-chat-meta text-fg-tertiary">{view.where}</p>}
        </div>
        {view.command !== null && <pre className={CODE_BOX}>$ {view.command}</pre>}
        {view.diff && <DiffPeek piece={view.diff} cwd={cwd} />}
        {view.subject !== null && <pre className={CODE_BOX}>{view.subject}</pre>}
      </div>
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
            <div className="flex flex-col gap-1 px-4 pb-1">
              {refuseField()}
              {hinted && hint()}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2 px-4 pt-2 pb-4">
            {choices.map((choice, at) => (
              <ChoiceButton
                key={`${at}-${choice.label}`}
                choice={choice}
                at={at}
                pressed={writing && choice.opensField}
                disabled={sent}
                onPick={() => choose(at)}
              />
            ))}
          </div>
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

  /** 「아니요, 다르게」 · 「계획 다시 쓰기」가 여는 칸 — 보내면 거부(또는 다시 쓰기)와 그 말이 간다. 칸의 Esc는 칸만 닫는다. */
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

/** 명령 · 대상 상자(Screen-Live `.mono.r-lg`) — 12.5(WebKit 10) · `fill-soft` · 안쪽 8 / 10 · 고정폭 13. */
const CODE_BOX =
  "rounded-row corner-superellipse bg-fill-soft px-2.5 py-2 font-mono text-code whitespace-pre-wrap break-all text-fg";

/**
 * 단추 줄의 단추 하나(Screen-Live 단계 4) — 28 알약 · 1px `border-slot` · 13. 「이번만 허용」은 맨 오른쪽에 검게 서고(`ml-auto`), 나머지는
 * 옅은 면(`fill-soft`의 반)이다. 글쇠가 있으면 끝에 옅게 적는다 — 「아니요, 다르게」의 `esc`(단축키 표의 글리프를 작은 글자로) ·
 * 「이번만 허용」의 `↵`. 글쇠는 그림이라 숨는다 — esc는 단추가 단축키 표의 그 키를 `aria-keyshortcuts`로 말한다(↵는 표 밖의 카드 안 키다).
 * Thread 도구 질문 카드(`ToolQuestionCard` — 03 티켓 08)의 「나중에」 · 「고르기 ↵」도 이것이다.
 */
export function ChoiceButton({
  choice,
  at,
  pressed,
  disabled,
  onPick,
}: {
  choice: CardChoice;
  at: number;
  /** 「아니요, 다르게」가 연 칸이 서 있다. */
  pressed: boolean;
  disabled: boolean;
  onPick: () => void;
}) {
  const primary = choice.key === "enter";
  const dismiss = choice.key === "escape";
  return (
    <button
      type="button"
      data-choice={at}
      disabled={disabled}
      onClick={onPick}
      aria-keyshortcuts={dismiss ? HOTKEYS.dismiss.aria : undefined}
      aria-pressed={choice.opensField ? pressed : undefined}
      className={cn(
        "flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border-slot text-chat-meta transition-colors focus-ring disabled:opacity-60",
        choice.key ? "pr-2 pl-2.5" : "px-2.5",
        primary ? "ml-auto bg-fg text-fg-inverse" : "bg-fill-soft/50 text-fg hover:bg-fill-soft aria-pressed:bg-fill-hover",
      )}
    >
      {choice.label}
      {choice.key && (
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

/**
 * 번호 줄 끝의 글쇠(보드 `.kbd`) — 높이 20 · 반경 6 · 머리카락 선, 고정폭 `fg-tertiary`. 그림이라 숨는다(줄의 이름은 선택지 글이다).
 * 질문 카드 · Work 밖 Project 카드(v1 티켓 32)의 번호도 이것이다.
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
 * 파일 카드의 바뀐 줄(보드 `.mdiff`) — 머리(경로 · `+N` `−N`, `surface-under` 면)와 바뀐 줄 둘레 몇 줄. 더한 줄은 `<ins>`, 지운 줄은 `<del>`
 * 이다(작업 로그의 변경 상자와 같다). 넘는 줄은 「N줄 더」 한 줄로 접는다 — 다 보려면 고친 뒤 작업 로그에서 편다.
 */
function DiffPeek({ piece, cwd }: { piece: DiffPiece; cwd: string | null }) {
  const lines = piece.lines.slice(0, PEEK);
  const rest = piece.lines.slice(PEEK).filter((line) => line.type !== "gap").length;
  return (
    <figure
      aria-label={`${piece.path} 변경`}
      className="overflow-hidden rounded-xl font-mono text-xs leading-5 shadow-hairline"
    >
      <figcaption className="flex h-7.5 items-center gap-2 border-b-[0.5px] border-border bg-surface-under px-3">
        <span className="min-w-0 truncate" title={piece.path}>
          {shownPath(piece.path, cwd)}
        </span>
        <span className="shrink-0 text-diff-added">+{piece.added}</span>
        <span className="shrink-0 text-diff-deleted">−{piece.deleted}</span>
      </figcaption>
      {lines.map((line, at) => {
        const key = `${at}`;
        if (line.type === "gap") {
          return (
            <div key={key} className="bg-fill-soft px-3 font-sans text-fg-tertiary">
              {line.count}줄 숨김
            </div>
          );
        }
        const text = line.text === "" ? " " : line.text;
        if (line.type === "add") {
          return (
            <ins key={key} className="block bg-diff-added-line px-3 whitespace-pre no-underline">
              +{text}
            </ins>
          );
        }
        if (line.type === "del") {
          return (
            <del key={key} className="block bg-diff-deleted-line px-3 whitespace-pre no-underline">
              -{text}
            </del>
          );
        }
        return (
          <div key={key} className="px-3 whitespace-pre">
            {` ${text}`}
          </div>
        );
      })}
      {rest > 0 && <div className="px-3 font-sans text-fg-tertiary">{rest}줄 더</div>}
    </figure>
  );
}

export default ApprovalCard;

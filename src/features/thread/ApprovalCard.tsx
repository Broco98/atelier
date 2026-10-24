import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, Info } from "lucide-react";
import { HOTKEYS } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";
import { AgentFace } from "./AgentFace";
import { threadApi } from "./api";
import { cardChoices, cardKey, describeApproval, fieldLabel, skipHint, type CardChoice } from "./approval";
import type { AskTurn } from "./asks";
import { AskCount } from "./AskTurnMarks";
import type { Avatar } from "./faces";
import type { PendingPermission } from "./fold";
import { shownPath, type DiffPiece } from "./tool-view";

// 승인 카드(v1 티켓 24 · 구현 스펙 §9 · 캔버스 Cards · Approval 보드 A안 「입력창 자리」) — Agent가 권한을 물으면 **입력창이 사라지고 그
// 자리에** 선다(스토리 74). 무엇을 하려는지(명령 · 파일과 diff · 실행할 worktree)와 왜 묻는지(Policy 이름)를 보이고(스토리 75), 번호 줄
// 셋으로 고른다(스토리 76 · 77 · 78). 값과 선택지는 순수 함수가 짓는다(`approval.ts`).
//
// 모양은 보드의 `.ap`다 — r28 · 입력창 면과 그림자 · 위 16 · 옆 8 · 아래 8, 칸 사이 10. 머리는 얼굴 22와 물음(14/20 600) · 「Policy · 이름」
// (12/18 `fg-tertiary`), 명령은 코드 면 상자(`$ 명령`), 파일은 작은 diff 상자(경로 · `+N` `−N` · 바뀐 줄 몇 줄)다. 번호 줄은 높이 36 · 반경
// 12에 번호(12 `fg-tertiary`)와 글이고, 켜진 줄은 `fill-soft` 면과 ↵ 글쇠, 마지막 줄은 Esc 글쇠를 단다.
//
// - **키보드로 고른다** — 숫자 · Enter(켜진 줄, 처음엔 첫째) · Esc(마지막) · ↑↓(`cardKey`). 카드가 서면 포커스를 받는다 — 입력창이 자리를
//   내주며 풀린 포커스만 받고, 다른 칸에 있던 포커스는 빼앗지 않는다. **선 직후 잠깐(`ARMING_MS`)은 키를 받지 않는다** — 입력창에 말을
//   쓰던 손의 다음 글쇠(Enter · 숫자)가 막 선 카드를 고르지 않게.
// - **「아니요, 다르게 해 주세요」는 카드 안에 입력칸을 연다**(보드 「고르기 전에 할 말이 있을 때」 A) — 보내면 거부와 그 말이 Agent에게
//   간다. 비워 보내면 거부만 간다. 입력칸의 Esc는 칸을 닫고 번호 줄로 돌아간다. 계획 넘어가기(v1 티켓 26)는 「계획대로 구현」 ·
//   「계획 다시 쓰기」이고, 다시 쓰기의 칸이 고칠 점을 받는다(`fieldLabel`).
// - 이 카드는 권한 답 명령을 부르기만 한다. 고른 것은 기록의 답 줄(`answered`)로 오고, 그 줄이 오면 접기가 이 요청을 빼서 카드가 걷히고
//   그 자리(물은 턴)에 결정 줄이 선다(스토리 79). 답이 오기 전에 두 번 고르지 않게, 고른 뒤로는 줄이 잠긴다.
// - **고르기 전에 할 말**(v1 티켓 25 · 스토리 83) — 입력칸에 말을 쓰는 동안 그 아래에 「보내면 이 명령은 건너뛰고 Host에게 말을
//   전해요」가 선다(`skipHint`, 보드 B의 `.hint` 모양). 입력창은 카드가 대신했으니 카드에 할 말은 이 칸이 받는다.
// - **여럿이 물으면 차례를 말한다**(v1 티켓 25 · 보드 「두 Agent가 함께 물을 때」) — 머리 오른쪽에 「1 / 2」, 맨 아래에 「다음 · …」 줄
//   (`AskTurnMarks`). 차례는 부르는 쪽이 `askTurn`으로 읽어 준다.
// - 카드에 멈추기가 없다(보드) — 서 있는 동안 멈추는 길은 거부다.

/** 카드가 선 뒤 키를 받기 시작할 때까지(머리말). 질문 카드 · Work 밖 Project 카드도 이 값을 쓴다. */
export const ARMING_MS = 300;
/** 파일 카드의 diff 상자에 보일 줄 수 — 넘으면 「N줄 더」. */
const PEEK = 8;

interface ApprovalCardProps {
  thread: string;
  /** 물은 참여자의 화면 이름 · 얼굴(들어옴 줄, `ThreadModel.cast`). */
  name: string;
  avatar: Avatar | null;
  /** 맨 앞의 답하지 않은 요청. 부르는 쪽이 요청 id를 key로 건다 — 다음 요청이 오면 카드가 새로 선다. */
  request: PendingPermission;
  /** 「다시 묻지 않기」를 둘 자리 — Work에 이은 Thread면 그 Work, 아니면 이 Thread(S18). */
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

function ApprovalCard({ thread, name, avatar, request, scope, cwd, place, count = null, next }: ApprovalCardProps) {
  const titleId = useId();
  const hintId = useId();
  const card = useRef<HTMLDivElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const shownAt = useRef(0);
  const view = describeApproval(request, name, place);
  const choices = cardChoices(request, scope);
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

  return (
    <div
      ref={card}
      role="group"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.target === field.current || event.nativeEvent.isComposing || event.repeat) return;
        if (performance.now() - shownAt.current < ARMING_MS) return;
        const key = cardKey(event, choices.length, active);
        if (!key) return;
        event.preventDefault();
        if ("point" in key) setActive(key.point);
        else choose(key.pick);
      }}
      className="flex shrink-0 flex-col gap-2.5 rounded-composer bg-surface-composer px-2 pt-4 pb-2 shadow-composer outline-none"
    >
      <div className="flex items-start gap-2.5 px-2.5">
        <AgentFace handle={request.who} avatar={avatar} className="size-5.5 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col">
          <p id={titleId} className="break-keep text-sm font-semibold text-fg">
            {view.title}
          </p>
          {view.policy && <p className="text-xs text-fg-tertiary">Policy · {view.policy}</p>}
        </div>
        <AskCount count={count} />
      </div>
      {view.command !== null && (
        <div className="mx-2.5 flex flex-col gap-1.5">
          <pre className="rounded-xl bg-surface-code px-3 py-2 font-mono text-code whitespace-pre-wrap break-all text-fg">
            $ {view.command}
          </pre>
          {view.where && <p className="px-1 text-xs text-fg-tertiary">{view.where}</p>}
        </div>
      )}
      {view.diff && <DiffPeek piece={view.diff} cwd={cwd} />}
      {view.subject !== null && (
        <pre className="mx-2.5 rounded-xl bg-surface-code px-3 py-2 font-mono text-code whitespace-pre-wrap break-all text-fg">
          {view.subject}
        </pre>
      )}
      <div className="flex flex-col gap-0.5">
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
        {writing && (
          <div className="mt-0.5 ml-8.5 flex h-10 items-center gap-2 rounded-xl pr-1.5 pl-3.5 inset-ring inset-ring-border-heavy">
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
        )}
        {hinted && (
          <p id={hintId} className="mt-1 ml-8.5 flex items-center gap-1.5 px-1 text-xs text-fg-secondary">
            <Info className="size-3.5 shrink-0" aria-hidden />
            {skipHint(view.kind, name)}
          </p>
        )}
      </div>
      {problem && (
        <p role="alert" className="px-3 text-xs text-fg-secondary">
          {problem}
        </p>
      )}
      {next}
    </div>
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
      className="mx-2.5 overflow-hidden rounded-xl font-mono text-xs leading-5 shadow-hairline"
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

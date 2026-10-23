import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Check, Folder, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SMALL_GLYPH_STROKE } from "@/components/ui/icon-stroke";
import { cn } from "@/lib/utils";
import { threadApi } from "./api";
import type { AskTurn } from "./asks";
import { AskCount } from "./AskTurnMarks";
import type { PendingWork } from "./fold";
import { branchHint, firstPicked } from "./work-proposal";

// Work 만들기 카드(v1 티켓 30 · 구현 스펙 §11 · 스토리 89 · 90 · 91 · 캔버스 Cards 보드 「Work 만들기 · 묻는 중」) — Host가 Thread 도구
// `propose_work`로 Work 만들기를 제안하면 **입력창 자리에** 선다(승인 카드와 같은 자리 · 같은 물음 차례 — `askTurn`). 제목 · 까닭,
// 등록된 Project(Host 추천과 그 까닭이 먼저 · 처음부터 골라 둠), 규칙 설명과 함께 고치는 브랜치, 「worktree는 처음 고칠 때 만듭니다」
// 안내, 「Work 없이 계속」 · 「Work 만들기」다. 값은 순수 함수가 짓는다(`work-proposal.ts`).
//
// 모양은 보드의 `.wc`다 — r20 · 카드 그림자 · 흰 면 · 위 16 · 옆 16 · 아래 14, 칸 사이 12. 머리는 폴더 아이콘 상자(32 · r10 · `fill-soft`)와
// 물음 · 「제목 · 까닭」(12/18 `fg-tertiary`). Project 줄은 높이 38 · r12에 체크(16)와 이름, 추천이면 「Host 추천」 꼬리표와 까닭, 아니면
// Project 설명이 오른쪽에 선다. 브랜치 칸은 높이 36 · r12 · 안쪽 링에 고정폭 13이고 오른쪽에 규칙 설명(12 `fg-tertiary`)이 선다.
//
// - 이 카드는 답 명령을 부르기만 한다. 고른 것은 기록의 답 줄로 오고, 그 줄이 오면 접기가 이 카드를 빼서 카드가 걷히고 제안 도구 줄
//   자리에 결정 줄이 선다. 만들지 못하면(이미 있는 브랜치 · 사라진 Project) 까닭을 보이고 다시 고를 수 있게 푼다 — 엔진도 카드를
//   그대로 세워 둔다.
// - 브랜치 칸의 Enter는 「Work 만들기」다. 카드 전체의 글쇠는 두지 않는다 — 고칠 칸이 있는 카드라 숫자 · Esc가 칸의 글쇠와 겹친다.
// - 서면 포커스를 받는다 — 입력창이 자리를 내주며 풀린 포커스만 받고, 다른 칸에 있던 포커스는 빼앗지 않는다(승인 카드와 같다).
// - 문제(만들 수 없는 브랜치 · 만들지 못한 까닭)는 빨강이 아니라 `fg-secondary` 글이다 — Thread 화면의 오류는 색 대신 문장이다.

interface WorkProposalCardProps {
  thread: string;
  /** 맨 앞의 답하지 않은 제안. 부르는 쪽이 요청 id를 key로 건다 — 다음 제안이 오면 카드가 새로 선다. */
  card: PendingWork;
  /** 물음 차례의 「1 / 2」(`askTurn`) — 묶음에 물음이 하나뿐이면 null. */
  count?: AskTurn["count"];
  /** 카드 맨 아래 「다음 · …」 줄(`AskNext`) — 다음 차례가 없으면 비운다. */
  next?: ReactNode;
}

function WorkProposalCard({ thread, card, count = null, next }: WorkProposalCardProps) {
  const titleId = useId();
  const projectsId = useId();
  const branchId = useId();
  const hintId = useId();
  const box = useRef<HTMLDivElement>(null);
  const [checked, setChecked] = useState(() => firstPicked(card.projects));
  const [branch, setBranch] = useState(card.branch ?? card.slug);
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const hint = branchHint(branch, card.projects, checked);
  const picked = card.projects.filter((one) => checked.has(one.slug)).map((one) => one.slug);

  useEffect(() => {
    const holder = document.activeElement;
    if (holder === null || holder === document.body) box.current?.focus({ preventScroll: true });
  }, []);

  const answer = (create: boolean) => {
    if (sent || (create && hint.problem)) return;
    setSent(true);
    setProblem(null);
    const ask = create
      ? threadApi.answerWork(thread, card.requestId, true, picked, picked.length > 0 ? branch.trim() : null)
      : threadApi.answerWork(thread, card.requestId, false);
    ask.catch((error: unknown) => {
      // 만들지 못했다 — 다시 고를 수 있게 풀고 까닭을 보인다(이미 닫힌 카드면 곧 그 줄이 와서 카드가 걷힌다).
      setSent(false);
      setProblem(String(error));
    });
  };
  const toggle = (slug: string) =>
    setChecked((now) => {
      const next = new Set(now);
      if (!next.delete(slug)) next.add(slug);
      return next;
    });

  return (
    <div
      ref={box}
      role="group"
      aria-labelledby={titleId}
      tabIndex={-1}
      className="flex shrink-0 flex-col gap-3 rounded-3xl bg-surface px-4 pt-4 pb-3.5 shadow-card outline-none"
    >
      <div className="flex items-start gap-2.5">
        <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-fill-soft">
          <Folder className="size-4" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <p id={titleId} className="text-md font-semibold text-fg">
            이 일을 Work로 묶을까요?
          </p>
          <p className="text-xs text-fg-tertiary wrap-anywhere">
            {card.title}
            {card.reason && ` · ${card.reason}`}
          </p>
        </div>
        <AskCount count={count} />
      </div>
      {card.projects.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <p id={projectsId} className="text-xs text-fg-tertiary">
            Project
          </p>
          <div role="group" aria-labelledby={projectsId} className="-mx-1.5 flex flex-col gap-0.5">
            {card.projects.map((one) => {
              const on = checked.has(one.slug);
              const side = one.recommended ? one.reason : one.description;
              return (
                <button
                  key={one.slug}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  disabled={sent}
                  onClick={() => toggle(one.slug)}
                  className="flex min-h-9.5 w-full items-center gap-2.5 rounded-xl px-2 text-left text-sm text-fg transition-colors hover:bg-fill-hover focus-ring disabled:opacity-60"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-sm text-fg-on-solid",
                      on ? "bg-accent-solid" : "inset-ring-[1.5px] inset-ring-fg-tertiary",
                    )}
                  >
                    {on && <Check className="size-3" strokeWidth={SMALL_GLYPH_STROKE} />}
                  </span>
                  <span className="min-w-0 shrink-0 truncate">{one.name}</span>
                  {one.recommended && (
                    <span className="inline-flex h-5 shrink-0 items-center rounded-sm bg-accent-soft px-2 text-2xs font-medium text-link">
                      Host 추천
                    </span>
                  )}
                  {side && <span className="ml-auto min-w-0 truncate text-xs text-fg-tertiary">{side}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {card.projects.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor={branchId} className="text-xs text-fg-tertiary">
            브랜치
          </label>
          <div className="flex h-9 items-center gap-2 rounded-xl px-3 inset-ring inset-ring-border-heavy">
            <input
              id={branchId}
              value={branch}
              disabled={sent || picked.length === 0}
              spellCheck={false}
              autoComplete="off"
              aria-describedby={hintId}
              aria-invalid={hint.problem || undefined}
              onChange={(event) => setBranch(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === "Enter") {
                  event.preventDefault();
                  answer(true);
                }
              }}
              className="min-w-0 flex-1 bg-transparent font-mono text-code text-fg outline-none disabled:text-fg-tertiary"
            />
            <span id={hintId} className={cn("shrink-0 text-xs", hint.problem ? "text-fg-secondary" : "text-fg-tertiary")}>
              {hint.text}
            </span>
          </div>
        </div>
      )}
      <p className="flex items-center gap-2 text-xs text-fg-tertiary">
        <Info className="size-3.5 shrink-0" aria-hidden />
        worktree는 처음 고칠 때 만듭니다. 지금은 읽기만 해요.
      </p>
      {problem && (
        <p role="alert" className="text-xs text-fg-secondary wrap-anywhere">
          {problem}
        </p>
      )}
      <div className="flex items-center gap-2 pt-0.5">
        <span className="flex-1" />
        <Button variant="ghost" disabled={sent} onClick={() => answer(false)}>
          Work 없이 계속
        </Button>
        <Button disabled={sent || hint.problem} onClick={() => answer(true)}>
          Work 만들기
        </Button>
      </div>
      {next}
    </div>
  );
}

export default WorkProposalCard;

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Folder } from "lucide-react";
import { HOTKEYS } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";
import { AgentFace } from "./AgentFace";
import { ARMING_MS, KeyCap } from "./ApprovalCard";
import { threadApi } from "./api";
import { cardKey } from "./approval";
import type { AskTurn } from "./asks";
import { AskCount } from "./AskTurnMarks";
import type { Avatar } from "./faces";
import type { PendingProject } from "./fold";
import { describeProjectCard } from "./project-card";

// Work 밖 Project 카드(v1 티켓 32 · 구현 스펙 §11 S22 · 스토리 99 · 캔버스 Cards 보드 「Work 밖 Project」) — Agent가 이 Work에 없는
// Project를 고치려고 Thread 도구 「Project 고치기 시작」을 부르면 **입력창 자리에** 선다(승인 카드와 같은 자리 · 같은 물음 차례 —
// `askTurn`). 누가 무엇을 고치려는지(물음 · Agent가 든 까닭), 그 Project(「이 Work에 붙어 있지 않음」), 번호 줄 셋 — 붙이고 고치기 · 읽기만
// 하기 · 아니요, ○○에서만 고쳐 주세요. 값은 순수 함수가 짓는다(`project-card.ts`).
//
// 모양은 승인 카드와 같은 보드의 `.ap`다 — r28 · 입력창 면과 그림자 · 위 16 · 옆 8 · 아래 8, 칸 사이 10. 머리는 얼굴 22와 물음(14/20 600) ·
// 까닭(12/18 `fg-tertiary`). Project 상자는 보드 `.scope` — 옆 10 · 위아래 8 · 옆 12 안쪽 · r14 · `surface-under` 면 · 13/18, 폴더 글리프와
// 이름, 오른쪽에 「이 Work에 붙어 있지 않음」(12 `fg-tertiary`). 번호 줄은 승인 카드의 것 그대로다(높이 36 · r14 · 켜진 줄 `fill-soft`와
// ↵ 글쇠, 마지막 줄 Esc 글쇠).
//
// - **키보드로 고른다** — 숫자 · Enter(켜진 줄, 처음엔 첫째) · Esc(마지막 — 아니요) · ↑↓(`cardKey`). 선 직후 잠깐은 키를 받지 않는다.
//   서면 포커스를 받는다 — 풀린 포커스만 받고 다른 칸의 포커스는 빼앗지 않는다(승인 카드와 같다).
// - 이 카드는 답 명령을 부르기만 한다. 고른 것은 기록의 답 줄로 오고, 그 줄이 오면 접기가 이 카드를 빼서 카드가 걷히고 그 도구 줄 자리에
//   결정 줄(「web-app을 이 Work에 붙임」)이 선다. 붙이지 못하면(core가 거절) 까닭을 보이고 다시 고를 수 있게 푼다 — 엔진도 카드를 그대로
//   세워 둔다. 까닭은 빨강이 아니라 `fg-secondary` 글이다.

interface ProjectCardProps {
  thread: string;
  /** 물은 참여자의 화면 이름 · 얼굴(들어옴 줄, `ThreadModel.cast`). */
  name: string;
  avatar: Avatar | null;
  /** 맨 앞의 답하지 않은 카드. 부르는 쪽이 요청 id를 key로 건다 — 다음 카드가 오면 새로 선다. */
  card: PendingProject;
  /** 물음 차례의 「1 / 2」(`askTurn`) — 묶음에 물음이 하나뿐이면 null. */
  count?: AskTurn["count"];
  /** 카드 맨 아래 「다음 · …」 줄(`AskNext`) — 다음 차례가 없으면 비운다. */
  next?: ReactNode;
}

function ProjectCard({ thread, name, avatar, card, count = null, next }: ProjectCardProps) {
  const titleId = useId();
  const box = useRef<HTMLDivElement>(null);
  const shownAt = useRef(0);
  const view = describeProjectCard(card, name);
  const [active, setActive] = useState(0);
  const [sent, setSent] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    shownAt.current = performance.now();
    const holder = document.activeElement;
    if (holder === null || holder === document.body) box.current?.focus({ preventScroll: true });
  }, []);

  const choose = (at: number) => {
    const choice = view.choices[at];
    if (!choice || sent) return;
    setActive(at);
    setSent(true);
    setProblem(null);
    threadApi.answerProject(thread, card.requestId, choice.answer).catch((error: unknown) => {
      // 답하지 못했다 — 다시 고를 수 있게 풀고 까닭을 보인다(이미 닫힌 카드면 곧 그 줄이 와서 카드가 걷힌다).
      setSent(false);
      setProblem(String(error));
    });
  };

  return (
    <div
      ref={box}
      role="group"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.repeat) return;
        if (performance.now() - shownAt.current < ARMING_MS) return;
        const key = cardKey(event, view.choices.length, active);
        if (!key) return;
        event.preventDefault();
        if ("point" in key) setActive(key.point);
        else choose(key.pick);
      }}
      className="flex shrink-0 flex-col gap-2.5 rounded-composer bg-surface-composer px-2 pt-4 pb-2 shadow-composer outline-none"
    >
      <div className="flex items-start gap-2.5 px-2.5">
        <AgentFace handle={card.who} avatar={avatar} className="size-5.5 shrink-0" />
        <div className="flex min-w-0 flex-1 flex-col">
          <p id={titleId} className="break-keep text-sm font-semibold text-fg">
            {view.title}
          </p>
          {view.reason && <p className="text-xs text-fg-tertiary">{view.reason}</p>}
        </div>
        <AskCount count={count} />
      </div>
      <div className="mx-2.5 flex items-center gap-2 rounded-xl bg-surface-under px-3 py-2 text-chat-meta text-fg">
        <Folder className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 truncate">{view.name}</span>
        <span className="ml-auto shrink-0 text-xs text-fg-tertiary">{view.note}</span>
      </div>
      <div className="flex flex-col gap-0.5">
        {view.choices.map((choice, at) => {
          const last = at === view.choices.length - 1;
          return (
            <button
              key={choice.answer}
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

export default ProjectCard;

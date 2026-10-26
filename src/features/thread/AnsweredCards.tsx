import { Check, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useArrival } from "./arrival";
import type { AnsweredCard } from "./question";
import type { ToolCard } from "./tool-cards";

/**
 * 답한 카드(02 §10 · 캔버스 v35 Components 「답한 카드」) — 물음마다 한 줄 카드다: 초록 ✓ 13 · 물은 제목(13 2단계) · 오른쪽 끝 고른 답(13
 * 1단계). 겉은 1px `separator-soft` · 둥글기 12 · 안쪽 8 / 12. 미룬 물음은 답한 표지 대신 미룬 표지(시계 `fg-tertiary`)와 그 글이다. 시계도
 * 같은 표지 자리라 13이다 — 두 카드의 글이 같은 세로줄에 선다. ✓의 선은 앱 기본(24칸 2.25 — 13에서 1.22px)이다. 시안의 ✓는 16칸
 * 1.6(24칸 2.4 — DS `.ic-check`, 13에서 1.3px)이지만 그 굵기(`SMALL_GLYPH_STROKE`)는 DS가 12 이하에만 주고 `icon-stroke` 검사가 그 자리를
 * 지킨다 — 0.08px 차이는 남긴다(02 결정 「코드 리뷰 고침」).
 *
 * Agent의 질문(`ThreadFlow`의 `AnsweredRow`)과 Thread 도구 질문 카드(Space 질문 · Project 추가 — `ToolCards.tsx`)의 접힌 줄이 이 겉이다. 상자는
 * 무슨 카드였나(`data-answered` — `question` · `space` · `project-add`)와 고른 갈래(`data-choice`)를 든다.
 */
export function AnsweredCards({
  cards,
  card,
  choice,
  arrival,
}: {
  cards: AnsweredCard[];
  /** 무슨 카드였나 — Agent의 질문이거나 Thread 도구 카드의 갈래다. */
  card: "question" | ToolCard;
  choice: string;
  arrival: string;
}) {
  const motion = useArrival("chip-in", arrival);
  if (cards.length === 0) return null;
  return (
    <div data-answered={card} data-choice={choice} className={cn("flex flex-col gap-1.5 self-stretch", motion)}>
      {cards.map((one, at) => (
        <p
          key={`${at}-${one.asked}`}
          className="flex items-center gap-2 rounded-xl border border-separator-soft px-3 py-2 text-chat-meta text-fg-secondary"
        >
          {one.said === null ? (
            <Clock className="size-3.25 shrink-0 text-fg-tertiary" aria-hidden />
          ) : (
            <Check className="size-3.25 shrink-0 text-diff-added" aria-hidden />
          )}
          <span className="min-w-0 wrap-anywhere">{one.asked}</span>
          {one.said !== null && <span className="ml-auto min-w-0 text-right text-fg wrap-anywhere">{one.said}</span>}
        </p>
      ))}
    </div>
  );
}

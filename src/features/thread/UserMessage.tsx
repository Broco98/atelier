import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Quote } from "@/features/works/QuotePick";
import { useArrival } from "./arrival";
import { SentAttachments } from "./ComposerAttachments";
import { CopyButton } from "./CopyButton";
import { motionMs, reducedMotion } from "./motion";
import { SentQuoteChip } from "./QuoteChip";
import { sentWhen } from "./sent-when";
import type { Attachment } from "./types";

// **내 말**(Thread · Cards 보드 「내 말」 `.ra-msg` · restart 02b-1 · 02b-6) — 오른쪽에 붙은 한 묶음이고 칸 사이는 4다.
//
//   [인용 칩] [첨부 칩]        — 붙인 것은 말풍선 위(Cards 「첨부와 함께」)
//   [말풍선]                   — 줄 폭의 70%까지, 안쪽 10 / 16, 14 / 22.75, 옅은 파랑(`bubble-user`)에 짙은 남색 글자(`bubble-user-fg`), 둥근 22
//   [더 보기]                  — 8줄 넘는 말만(Cards 「긴 말」)
//   [하던 일을 멈추고 보냄]    — 대기 줄의 「지금 보내기」로 하던 턴을 끊고 들어간 말만(Cards 「대기 중에 끼어든 말」 · 02b-2)
//   [오후 2:14 ⧉]              — 말 머리 26(Cards 「호버」 `.ra-msg-meta`). 옅음 속에 숨어 자리만 차지하고, 말에 올리거나 초점이 들면 선다
//
// 끼어든 말의 줄은 말풍선 바로 아래 4에 그대로 서고 말 머리가 그 아래로 내려간다 — 늘 보이는 줄이 호버의 줄에 가리지 않는다(02b-6 결정).

/** 이보다 긴 내 말은 접힌다(스토리 73 · Cards 「긴 말」 「8줄 넘으면 접고 더 보기」). */
const FOLD_LINES = 8;

/** 글 높이가 몇 줄인가로 접을 말인지 가린다 — 반 줄 아래의 어긋남(글자 바닥 · 반올림)은 그 줄로 센다. */
export function foldsLong(textHeight: number, lineHeight: number): boolean {
  return lineHeight > 0 && Math.round(textHeight / lineHeight) > FOLD_LINES;
}

/** 말풍선의 접힘 — 짧은 말(`whole`) · 접힌 긴 말(`folded`) · 펼친 긴 말(`open`). */
export type Fold = "whole" | "folded" | "open";

export function UserMessage({
  text,
  attachments = [],
  quote = null,
  at = null,
  interjected = false,
  arrival,
}: {
  text: string;
  attachments?: readonly Attachment[];
  quote?: Quote | null;
  /** 보낸 시각(기록의 `sent` 줄) — 기록에 서기 전의 말은 없다. */
  at?: string | null;
  interjected?: boolean;
  /** 들어서는 이름(`useArrival`) — 대기 말풍선과 그 말이 선 기록의 턴이 같은 이름이라 옮겨 서도 다시 오르지 않는다. */
  arrival?: string;
}) {
  // 화면이 선 뒤에 새로 선 말은 아래 12 · .985배에서 제자리로 오른다(Motion 「보낸 말이 선다」 · 보드 `.ra-msg.rise` — restart 02b-7). 말 묶음 전체다.
  const rise = useArrival("msg-rise", arrival);
  return (
    <div data-user-message className={cn("group/message flex flex-col items-end gap-1", rise)}>
      {quote && <SentQuoteChip quote={quote} />}
      {attachments.length > 0 && <SentAttachments attachments={attachments} />}
      <MessageBubble text={text} />
      {interjected && <span className="text-xs tracking-normal text-fg-tertiary">하던 일을 멈추고 보냄</span>}
      <div
        data-message-meta
        className="flex h-6.5 items-center gap-0.5 text-xs text-fg-tertiary opacity-0 transition-opacity group-focus-within/message:opacity-100 group-hover/message:opacity-100"
      >
        {at && <span className="pr-1.5">{sentWhen(at, Date.now())}</span>}
        <CopyButton text={text} label="메시지 복사" />
      </div>
    </div>
  );
}

/**
 * 말풍선 — 8줄 넘는 말은 112에서 잘리고 아래 40%가 옅어진 채 서고(`fold-fade`), 그 아래 「더 보기」(`.ra-mini` — ghost 24 · 12 / 18)가 펼친다.
 * 펼치면 높이가 112에서 글 높이까지 자라고(`duration-relaxed` · `ease-enter` — Motion 「작업 로그가 접힌다」와 같은 박자) 단추는 「접기」가 된다.
 * 줄 수는 그려진 뒤에 잰다 — 폭(대화 열의 70%)에 따라 줄바꿈이 달라서다. 열 폭이 바뀌면 다시 잰다.
 */
function MessageBubble({ text }: { text: string }) {
  const box = useRef<HTMLParagraphElement>(null);
  const [fold, setFold] = useState<Fold>("whole");
  // 자라고 줄어드는 동안의 높이 끝(px) — 다 자라 멎으면 `null`이라 잘리지 않는다.
  const [limit, setLimit] = useState<number | null>(null);
  useLayoutEffect(() => {
    const bubble = box.current;
    if (!bubble) return;
    const measure = () => {
      const style = getComputedStyle(bubble);
      const textHeight = bubble.scrollHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const long = foldsLong(textHeight, parseFloat(style.lineHeight));
      setFold((now) => (!long ? "whole" : now === "whole" ? "folded" : now));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(measure);
    watch.observe(bubble);
    return () => watch.disconnect();
  }, [text]);
  // 다 자라면 높이 끝을 걷는다 — 펼친 뒤 열 폭이 줄어 줄이 늘어도 잘리지 않게.
  useEffect(() => {
    if (fold !== "open" || limit === null) return;
    const timer = window.setTimeout(() => setLimit(null), reducedMotion() ? 0 : motionMs("--duration-relaxed") + 50);
    return () => window.clearTimeout(timer);
  }, [fold, limit]);
  const toggle = () => {
    const bubble = box.current;
    if (!bubble) return;
    if (fold === "folded") {
      setLimit(bubble.scrollHeight);
      setFold("open");
      return;
    }
    // 접을 때는 지금 높이를 한 번 세워 두고 다음 그림에서 112로 줄인다 — 끝이 없는(`none`) 높이에서는 전이가 걸리지 않는다.
    setLimit(bubble.scrollHeight);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => setFold("folded")));
  };
  return (
    <>
      <p
        ref={box}
        data-fold={fold === "whole" ? undefined : fold}
        style={fold === "open" && limit !== null ? { maxHeight: limit } : undefined}
        className={cn(
          "max-w-[70%] rounded-bubble bg-bubble-user px-4 py-2.5 text-bubble-user-fg whitespace-pre-wrap wrap-anywhere",
          fold !== "whole" && "overflow-hidden transition-[max-height] duration-relaxed ease-enter motion-reduce:transition-none",
          fold === "folded" && "max-h-28 fold-fade",
        )}
      >
        {text}
      </p>
      {fold !== "whole" && (
        <Button
          variant="ghost"
          size="xs"
          aria-expanded={fold === "open"}
          onClick={toggle}
          className="h-6 rounded-lg px-2 font-normal tracking-normal"
        >
          {fold === "open" ? "접기" : "더 보기"}
        </Button>
      )}
    </>
  );
}

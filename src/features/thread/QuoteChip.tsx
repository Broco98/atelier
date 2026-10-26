import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useArrival } from "./arrival";
import type { Quote } from "@/features/works/QuotePick";

// 인용 칩(v1 티켓 35 · S41 — three-axes 티켓 27의 칩을 Thread 입력창으로 옮겼다) — 넓힌 카드의 문서에서 고른 자리를 「❝앞부분…❞ · 파일」로
// 보인다. 두 자리에 선다: 입력창에 붙은 인용(×로 뺀다)과, 보낸 말 위의 인용(기록의 `sent`에서 — 나중에 읽어도 어느 자리를 두고 한 말인지
// 안다). 모양은 three-axes가 따른 캔버스 `.cx-cite`(22 · 좌우 8 · 틈 4 · 알약 · 옅은 파랑 면 · 링크 파랑 · 500)이고, 글자는 DS 단계
// `text-xs`(12/18 — 옛 `caption` 12/16 자리)다. 이번 캔버스(v31)에는 인용 칩이 없다.

/** 칩에 보일 앞부분의 글자 수 — 넘으면 잘라 「…」를 붙인다. */
const HEAD = 24;

/** 고른 글의 앞부분 — 줄바꿈과 겹친 빈칸을 한 칸으로 접고, 길면 잘라 「…」를 붙인다. 글자는 코드 포인트로 센다. */
export function quoteHead(text: string): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length > HEAD ? `${chars.slice(0, HEAD).join("")}…` : chars.join("");
}

/** 칩의 도움말 — 그 자리의 원문 줄 범위(문서 보기의 「줄 참조 복사」와 같은 말)와 고른 글 전부. */
function quoteTitle(quote: Quote): string {
  const lines = quote.end > quote.start ? `${quote.start}–${quote.end}줄` : `${quote.start}줄`;
  return `${quote.file} ${lines}\n${quote.text}`;
}

const CHIP = "inline-flex h-5.5 max-w-full min-w-0 items-center gap-1 rounded-full bg-accent-soft text-xs font-medium text-link";

/**
 * 입력창에 붙은 인용 — 끝의 ×로 뺀다. 붙으면 칩으로 나타난다(v1 티켓 43 · Motion 보드 「칩 나타남」) — 카드가 걷혀 입력창이 다시 설 때
 * 같은 인용은 다시 움직이지 않는다.
 */
export function DraftQuoteChip({ quote, onDrop }: { quote: Quote; onDrop: () => void }) {
  const motion = useArrival("chip-in", `quote:${quote.file}:${quote.start}-${quote.end}`);
  return (
    <span data-quote className={cn(CHIP, "self-start pr-1 pl-2", motion)} title={quoteTitle(quote)}>
      <span className="min-w-0 truncate">
        ❝{quoteHead(quote.text)}❞ · {quote.file}
      </span>
      <button
        type="button"
        aria-label="인용 빼기"
        onClick={onDrop}
        className="flex size-4 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-fill-hover focus-ring"
      >
        <X className="size-3" aria-hidden />
      </button>
    </span>
  );
}

/** 보낸 말 위의 인용 — 말풍선처럼 오른쪽에 붙는다. */
export function SentQuoteChip({ quote }: { quote: Quote }) {
  return (
    <span data-sent-quote className={cn(CHIP, "self-end px-2")} title={quoteTitle(quote)}>
      <span className="min-w-0 truncate">
        ❝{quoteHead(quote.text)}❞ · {quote.file}
      </span>
    </span>
  );
}

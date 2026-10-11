import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Quote } from "./types";

// 인용 칩(three-axes 티켓 27 · 스토리 79 · 80 · 81) — 문서에서 고른 자리를 「❝앞부분…❞ · 파일」로 보인다. 두 자리에 선다: 입력창의
// 붙은 인용(×로 뺀다)과, 보낸 사용자 메시지 위의 인용(기록의 `sent`에서). 모양은 캔버스의 `.cx-cite`(22 · 좌우 8 · 틈 4 · 알약 ·
// 옅은 파랑 면 · 링크 파랑 · 12/16 500)이고 값은 대화창 범위 토큰이다(three-axes 결정 31). 입력창 칩의 ×는 보드에 없어 같은 칩
// 끝에 붙였다(구현 노트 「화면 부품」의 추측 그대로).

/** 칩에 보일 앞부분의 글자 수 — 넘으면 잘라 「…」를 붙인다. */
const HEAD = 24;

/** 고른 글의 앞부분 — 줄바꿈과 겹친 빈칸을 한 칸으로 접고, 길면 잘라 「…」를 붙인다. 글자는 코드 포인트로 센다. */
export function quoteHead(text: string): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length > HEAD ? `${chars.slice(0, HEAD).join("")}…` : chars.join("");
}

/** 칩의 도움말 — 그 자리의 원문 줄 범위(스펙 창의 「줄 참조 복사」와 같은 말)와 고른 글 전부. */
function quoteTitle(quote: Quote): string {
  const lines = quote.end > quote.start ? `${quote.start}–${quote.end}줄` : `${quote.start}줄`;
  return `${quote.file} ${lines}\n${quote.text}`;
}

const CHIP =
  "inline-flex h-[22px] max-w-full min-w-0 items-center gap-1 rounded-full bg-(--chat-quote) text-caption font-medium text-(--chat-link)";

/** 입력창에 붙은 인용 — 끝의 ×로 뺀다. */
export function DraftQuoteChip({ quote, onDrop }: { quote: Quote; onDrop: () => void }) {
  return (
    <span data-quote className={cn(CHIP, "self-start pl-2 pr-1")} title={quoteTitle(quote)}>
      <span className="min-w-0 truncate">
        ❝{quoteHead(quote.text)}❞ · {quote.file}
      </span>
      <button
        type="button"
        aria-label="인용 빼기"
        onClick={onDrop}
        className="flex size-4 shrink-0 items-center justify-center rounded-full tint-hover"
      >
        <X className="size-3" strokeWidth={1.8} aria-hidden />
      </button>
    </span>
  );
}

/** 보낸 말 위의 인용 — 나중에 기록을 읽어도 어느 자리를 두고 한 말인지 안다(스토리 81). */
export function SentQuoteChip({ quote }: { quote: Quote }) {
  return (
    <span data-sent-quote className={cn(CHIP, "px-2")} title={quoteTitle(quote)}>
      <span className="min-w-0 truncate">
        ❝{quoteHead(quote.text)}❞ · {quote.file}
      </span>
    </span>
  );
}

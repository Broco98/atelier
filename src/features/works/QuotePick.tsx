import { useEffect, useState, type RefObject } from "react";
import type { Quote } from "@/features/chat/types";

// 「❝ 이 자리를 두고 말하기」(three-axes 티켓 27 · 스토리 78 · 79 · 83) — 스펙 창에서 글을 고르면 그 자리 곁에 뜨고, 누르면 고른 자리를
// 인용으로 넘긴다. 렌더 보기와 원문 보기 모두에서 된다.
//
// **줄 범위는 원문 위치다.** 렌더 보기는 고른 글이 걸친 첫 블록의 시작 줄부터 마지막 블록의 끝 줄까지(블록 래퍼의
// `data-src-start` · `data-src-end`, 티켓 26이 단 표식), 원문 보기는 고른 줄 그대로(줄 행의 `data-line`)다. 「걸쳤다」는 그 블록의
// 글이 하나라도 골라졌다는 뜻이다 — 세 번 눌러 문단을 고르면 고른 범위의 끝이 다음 블록의 첫머리(글 0자)에 닿는데, 그 블록은 들지
// 않는다.
//
// 모양은 프로토타입 D의 `#qfloat`(28 · 좌우 12 · 알약 · 어두운 면 · 흰 12/16 500 · 떠 있는 그림자)이고, 고른 글의 첫 줄 바로 위에
// 선다(위에 자리가 없으면 아래). 스크롤 상자 안의 내용 층에 놓여 글과 함께 구른다. 스펙 창은 대화창 밖이라 DS 토큰을 쓴다.

/** 단추가 서는 높이와 고른 글과의 틈. */
const HEIGHT = 28;
const GAP = 6;
/** 단추 폭의 어림 — 오른쪽 끝에서 넘치지 않게 왼쪽 자리를 물린다. */
const WIDTH = 172;

type Mode = "pretty" | "source";

interface Picked {
  quote: Quote;
  top: number;
  left: number;
}

interface QuotePickProps {
  /** 스크롤 상자 — 고른 글이 이 안에 있어야 단추가 뜬다. */
  box: RefObject<HTMLElement | null>;
  /** 단추를 놓는 내용 층(`position: relative`) — 고른 글의 자리를 이 층 기준으로 잰다. */
  layer: RefObject<HTMLElement | null>;
  /** 지금 문서 — spec 폴더 기준 경로. */
  file: string;
  /** 렌더 보기인가 원문 보기인가 — 줄 범위를 읽는 표식이 다르다. */
  mode: Mode;
  onQuote: (quote: Quote) => void;
}

export function QuotePick({ box, layer, file, mode, onQuote }: QuotePickProps) {
  const [picked, setPicked] = useState<Picked | null>(null);

  useEffect(() => {
    const root = box.current;
    if (!root) return;
    // 마우스로 끄는 동안은 띄우지 않는다 — 놓았을 때 한 번 뜬다(프로토타입 D). 키보드로 고르면 고를 때마다 따라온다.
    let pressing = false;
    const read = () => {
      if (pressing) return;
      setPicked(pick(root, layer.current, file, mode));
    };
    const down = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-quote-pick]")) return;
      pressing = true;
      setPicked(null);
    };
    const up = () => {
      if (!pressing) return;
      pressing = false;
      read();
    };
    // 문서를 옮기거나 보기를 바꾸면 앞 문서에서 고른 자리를 버린다 — 지금 고른 것으로 다시 읽는다.
    read();
    document.addEventListener("selectionchange", read);
    root.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    return () => {
      document.removeEventListener("selectionchange", read);
      root.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
    };
  }, [box, layer, file, mode]);

  if (!picked) return null;
  return (
    <button
      type="button"
      data-quote-pick
      // 누르는 동안 고른 글이 풀리지 않게 — 풀리면 그 순간 단추가 걷혀 눌림이 닿지 않는다.
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        onQuote(picked.quote);
        window.getSelection()?.removeAllRanges();
        setPicked(null);
      }}
      style={{ top: picked.top, left: picked.left }}
      className="absolute z-20 inline-flex h-7 items-center whitespace-nowrap rounded-full bg-fg px-3 text-xs font-medium text-fg-inverse shadow-prominent outline-none focus-ring"
    >
      ❝ 이 자리를 두고 말하기
    </button>
  );
}

/** 지금 고른 글이 이 문서의 어느 자리인가 — 고른 것이 없거나 문서 밖이거나 원문 위치를 모르는 자리면 `null`이다. */
function pick(root: HTMLElement, layer: HTMLElement | null, file: string, mode: Mode): Picked | null {
  const selection = window.getSelection();
  if (!layer || !selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;
  const lines = mode === "source" ? sourceLines(root, range) : prettyLines(root, range, selection.toString());
  if (!lines) return null;
  return { quote: { file, ...lines }, ...spot(root, layer, range) };
}

/** 렌더 보기 — 고른 글이 걸친 최상위 블록들의 원문 줄 범위와, 화면에 고른 그대로의 글. */
function prettyLines(root: HTMLElement, range: Range, selected: string): Omit<Quote, "file"> | null {
  const text = selected.trim();
  const blocks = [...root.querySelectorAll<HTMLElement>("[data-src-start]")].filter((block) => {
    const part = selectedPart(range, block);
    return part !== null && part.trim() !== "";
  });
  if (text === "" || blocks.length === 0) return null;
  const start = Number(blocks[0].dataset.srcStart);
  const end = Number(blocks[blocks.length - 1].dataset.srcEnd);
  return Number.isInteger(start) && Number.isInteger(end) ? { start, end, text } : null;
}

/**
 * 원문 보기 — 고른 줄 그대로. 글은 줄마다 고른 부분을 줄바꿈으로 잇는다 — 줄번호 칸은 글에 넣지 않는다(화면의 고르기는 그 칸을
 * 건너뛰지만, 범위를 글로 바꾸면 그 칸의 숫자까지 딸려 온다).
 */
function sourceLines(root: HTMLElement, range: Range): Omit<Quote, "file"> | null {
  const rows = [...root.querySelectorAll<HTMLElement>("[data-line]")].map((row) => ({
    line: Number(row.dataset.line),
    part: selectedPart(range, row.lastElementChild ?? row),
  }));
  const chosen = (row: (typeof rows)[number]) => row.part !== null && row.part.trim() !== "";
  const first = rows.findIndex(chosen);
  if (first < 0) return null;
  const last = rows.length - 1 - [...rows].reverse().findIndex(chosen);
  const text = rows
    .slice(first, last + 1)
    .map((row) => row.part ?? "")
    .join("\n");
  return { start: rows[first].line, end: rows[last].line, text };
}

/** 고른 범위 가운데 `el` 안에 든 글 — 겹치지 않으면 `null`이다. */
function selectedPart(range: Range, el: Element): string | null {
  if (!range.intersectsNode(el)) return null;
  const part = document.createRange();
  part.selectNodeContents(el);
  if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) part.setStart(range.startContainer, range.startOffset);
  if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) part.setEnd(range.endContainer, range.endOffset);
  return part.toString();
}

/** 단추 자리 — 고른 글의 첫 줄 바로 위, 그 줄의 왼쪽 끝에서. 스크롤 상자 위쪽에 자리가 없으면 첫 줄 바로 아래다. */
function spot(root: HTMLElement, layer: HTMLElement, range: Range): { top: number; left: number } {
  const first = [...range.getClientRects()].find((rect) => rect.width > 0 && rect.height > 0) ?? range.getBoundingClientRect();
  const base = layer.getBoundingClientRect();
  const roomAbove = first.top - root.getBoundingClientRect().top >= HEIGHT + GAP;
  const top = roomAbove ? first.top - base.top - HEIGHT - GAP : first.bottom - base.top + GAP;
  const left = Math.max(8, Math.min(first.left - base.left, base.width - WIDTH - 8));
  return { top, left };
}

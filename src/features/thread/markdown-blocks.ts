// 마크다운 글을 따로 풀어도 뜻이 같은 덩어리로 나눈다(restart 티켓 01b-9). 답이 흐르는 동안 글 전체를 조각마다 다시 풀면 글이 길어질수록 화면이 멎는다 —
// 앞서 닫힌 덩어리는 글이 그대로이므로 다시 풀지 않고 끝 덩어리만 푼다(`ThreadMarkdown`).
//
// 가르는 자리는 빈 줄 뒤에 새 블록이 줄 머리에서 시작하는 곳뿐이다.
// - 코드 블록 안의 빈 줄은 글이다.
// - 목록 항목 앞이나 들여 쓴 줄 앞에서는 가르지 않는다. 앞 목록에 이어지는 줄일 수 있고, 나누면 느슨한 목록이 두 목록이 된다.
// - 문서 전체를 봐야 뜻이 서는 줄이 있으면 나누지 않는다. 링크 · 각주 정의는 다른 블록에서 찾아지고, HTML 블록은 안에 빈 줄을 품을 수 있다.
// 닫힌 덩어리는 글이 자라도 그대로다. 글을 이으면 원문이다. 흐르는 글은 `continueBlocks`로 끝부터 잇는다.

const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const LIST_ITEM = /^(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/;
const WHOLE_DOCUMENT = /^ {0,3}(?:\[[^\]]+\]:|<)/;

/** 그 울타리를 닫는 줄인가 — 같은 글자로 그만큼 길고 뒤에 글이 없다. */
function closesFence(line: string, fence: string): boolean {
  const body = line.trim();
  return line.startsWith("    ") ? false : body.length >= fence.length && body === fence[0].repeat(body.length);
}

/** 코드 블록 밖의 줄마다 부른다. 끝까지 훑었으면 나눈 자리들을, 문서 전체를 봐야 하는 줄을 만나면 `null`이다. */
function blockStarts(text: string): number[] | null {
  const starts = [0];
  let fence: string | null = null;
  let blank = false;
  for (let at = 0; at < text.length; ) {
    const newline = text.indexOf("\n", at);
    const end = newline < 0 ? text.length : newline;
    const line = text.slice(at, end);
    if (fence !== null) {
      if (closesFence(line, fence)) fence = null;
    } else if (line.trim() === "") {
      blank = true;
    } else {
      if (WHOLE_DOCUMENT.test(line)) return null;
      if (blank && !/^\s/.test(line) && !LIST_ITEM.test(line)) starts.push(at);
      blank = false;
      fence = FENCE.exec(line)?.[1] ?? null;
    }
    at = end + 1;
  }
  return starts;
}

const hasWholeDocumentLine = (text: string) => blockStarts(text) === null;

export function markdownBlocks(text: string): string[] {
  if (text === "") return [];
  const starts = blockStarts(text);
  if (starts === null) return [text];
  return starts.map((start, at) => text.slice(start, starts[at + 1]));
}

/** 나눈 값 — 다음 글을 끝부터 이어 나누는 데 쓴다. */
export interface BlockScan {
  text: string;
  /** 닫힌 덩어리들 — 뒤로만 는다. */
  closed: readonly string[];
  /** 닫힌 덩어리까지의 글 길이. */
  closedLength: number;
  /** 글 전체가 한 덩어리다 — 문서 전체를 봐야 뜻이 서는 줄이 나왔다. */
  whole: boolean;
  blocks: readonly string[];
}

const NOTHING_CLOSED: readonly string[] = [];

/**
 * 앞서 나눈 값에 이어 나눈다. 닫힌 덩어리는 다시 훑지 않고 복사해 둔다 — `slice`한 글은 잘린 원본을 통째로 붙들어, 그대로 두면 덩어리마다 그때의 긴 글이 메모리에
 * 남는다.
 */
export function continueBlocks(previous: BlockScan | null, text: string): BlockScan {
  const continues = previous !== null && text.startsWith(previous.text);
  if (continues && previous.whole) return { ...previous, text, blocks: [text] };
  const closed = continues ? previous.closed : NOTHING_CLOSED;
  const closedLength = continues ? previous.closedLength : 0;
  const rest = markdownBlocks(text.slice(closedLength));
  if (rest.length === 1 && hasWholeDocumentLine(rest[0])) return { text, closed: NOTHING_CLOSED, closedLength: 0, whole: true, blocks: [text] };
  if (rest.length <= 1) return { text, closed, closedLength, whole: false, blocks: [...closed, ...rest] };
  const closing = rest.slice(0, -1);
  const size = closing.reduce((sum, block) => sum + block.length, closedLength);
  const grown = [...closed, ...closing.map((block) => structuredClone(block))];
  return { text, closed: grown, closedLength: size, whole: false, blocks: [...grown, rest[rest.length - 1]] };
}

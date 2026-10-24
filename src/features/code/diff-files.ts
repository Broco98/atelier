import type { FileDiffMetadata } from "@pierre/diffs";

// **숨긴 줄 펼치기의 옛 글**(v1 티켓 35 · 구현 스펙 §15 「변경」) — 넓힌 카드의 diff는 `read_work_diff`의 patch다(v1 티켓 33). patch는
// 바뀐 덩어리 둘레만 싣고, 라이브러리(`@pierre/diffs`)는 덩어리 사이의 접힌 줄을 펼칠 때 양쪽 파일 전체를 달라고 한다(`loadDiffFiles`).
// 새 쪽은 worktree의 파일 그대로다(변경은 커밋한 것과 아직 커밋하지 않은 것을 합친 base 대비다 — §12). 옛 쪽은 base의 파일을 읽는
// 명령이 없어, **새 글에서 patch의 덩어리를 거꾸로 되돌려 짓는다** — 덩어리 밖의 줄은 두 쪽이 같고, 덩어리 안의 옛 줄(둘레 + 지운 줄)은
// patch에 다 있다.
//
// 이 모듈은 라이브러리의 **타입만** 읽는다 — 값은 코드 보기 청크 아래에서만 들인다(`code-view-chunk.test.ts`).

/** 덩어리를 되돌리는 데 드는 patch의 칸 — 라이브러리가 patch를 읽은 값(부분 diff)이다. */
type PartialDiff = Pick<FileDiffMetadata, "hunks" | "additionLines" | "deletionLines">;

/** 라이브러리가 줄을 가르는 법 — 줄바꿈을 줄 끝에 남긴다(`splitFileContents`와 같다). 그래야 이어 붙인 글이 원래 글과 글자까지 같다. */
const linesOf = (text: string): string[] => (text === "" ? [] : text.split(/(?<=\n)/));

/**
 * base의 글 — worktree의 글(`contents`)에서 덩어리마다 새 줄을 옛 줄로 갈아 끼운다. 새 쪽이 0줄인 덩어리(지우기만 함)는 머리의 줄
 * 번호가 그 **뒤** 자리를 가리킨다(unified diff의 꼴). **worktree의 글이 patch의 새 줄과 어긋나면 던진다** — patch를 읽은 뒤 파일이 다시
 * 바뀌었다. 틀린 옛 글로 펼치느니 펼치지 않는다(라이브러리는 실패를 콘솔에 남기고 접힌 채 둔다 — 감시가 곧 새 patch를 가져온다).
 */
export function baseContentsOf(contents: string, diff: PartialDiff): string {
  const after = linesOf(contents);
  const out: string[] = [];
  let at = 0;
  for (const hunk of diff.hunks) {
    const start = hunk.additionCount === 0 ? hunk.additionStart : hunk.additionStart - 1;
    const now = after.slice(start, start + hunk.additionCount);
    const patched = diff.additionLines.slice(hunk.additionLineIndex, hunk.additionLineIndex + hunk.additionCount);
    if (start < at || now.length !== patched.length || now.some((line, i) => line !== patched[i])) {
      throw new Error("worktree의 파일이 patch와 맞지 않아요 — diff를 다시 읽어야 해요");
    }
    out.push(...after.slice(at, start));
    out.push(...diff.deletionLines.slice(hunk.deletionLineIndex, hunk.deletionLineIndex + hunk.deletionCount));
    at = start + hunk.additionCount;
  }
  out.push(...after.slice(at));
  return out.join("");
}

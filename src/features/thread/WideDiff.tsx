import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, FileCheck, FileDigit, FileStack, FileWarning, FolderX, GitCompare } from "lucide-react";
import { codeFileQuery, useWorkDiff } from "@/features/code/hooks";
import { Notice } from "@/features/code/Notice";
import { cn } from "@/lib/utils";
import { chunksOf, diffRows, widestOf, type DiffChunk, type DiffLine, type DiffRow } from "./wide-diff";

/**
 * **넓힌 카드의 변경 보기 몸**(restart 03-15b · 구현 스펙 §15 「변경」 · 시안 Summary `.ra-vwdiff`) — 그 파일의 diff(`read_work_diff`)를 줄 목록으로
 * 그리고, 답이 patch가 아니면 갈래별 안내를 낸다. 머리(경로 · 브랜치 · +/− · ×)는 넓힌 카드가 세운다(`ViewerHead`).
 *
 * worktree의 지금 파일(`read_worktree_file` — 파일 탭과 같은 쿼리)도 함께 읽는다 — 마지막 덩어리 아래 「숨긴 줄 N개」의 수와 펼 줄이 거기서
 * 온다(`diffRows`). 한때 이 몸은 문법색을 칠하는 diff 부품(`@pierre/diffs` — 파일 탭의 코드 보기와 같은 청크)이었고 지금 파일은 숨긴 줄을
 * 펼 때에야 읽었다.
 */
export function WideDiff({ slug, project, path }: { slug: string; project: string; path: string }) {
  const { data, error } = useWorkDiff(slug, project, path);
  const patch = data?.kind === "patch" ? data.patch : null;
  const { data: file } = useQuery({ ...codeFileQuery(slug, project, path), enabled: patch !== null });
  const current = file?.kind === "text" ? file.content : null;
  const rows = useMemo(() => (patch === null ? [] : diffRows(patch, current)), [patch, current]);
  // 편 숨긴 줄 — 숨긴 첫 줄의 새 번호다. 파일마다 새 보기라(부르는 쪽의 열쇠) 다른 파일로 따라가지 않는다.
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set());
  const unfold = useCallback((at: number) => setOpen((now) => new Set(now).add(at)), []);
  if (error) return <Notice icon={FileWarning} title="diff를 읽지 못했어요" detail={String(error)} />;
  if (!data) return null;
  switch (data.kind) {
    case "patch":
      return <DiffLines rows={rows} open={open} onUnfold={unfold} />;
    case "binary":
      return <Notice icon={FileDigit} title="바이너리 파일" detail="글로 견줄 수 없는 파일이라 diff를 보이지 않아요." />;
    case "tooLarge":
      return <Notice icon={FileStack} title="너무 큰 파일" detail="5MB를 넘는 파일은 diff를 열지 않아요." />;
    case "unchanged":
      return <Notice icon={FileCheck} title="바뀐 것이 없어요" detail="base와 같은 파일이에요." />;
    case "worktreeMissing":
      return <Notice icon={FolderX} title="워크트리 없음" detail={`이 작업공간에 ${project} 워크트리가 없어요.`} />;
    case "baseUnknown":
      return (
        <Notice
          icon={GitCompare}
          title="견줄 base를 모르겠어요"
          detail={data.base ? `base 브랜치 ${data.base}를 찾지 못했어요.` : "이 Project의 base 브랜치를 정하지 못했어요."}
        />
      );
    case "unreadable":
      return <Notice icon={FileWarning} title="diff를 읽지 못했어요" detail={data.reason} />;
    default: {
      const unhandled: never = data;
      return unhandled;
    }
  }
}

/** 줄 높이(시안 `.ra-vwdiff` 21.6)와 펼침 줄 높이(`.ra-vwfold` 28) — 그리지 않은 덩어리의 빈 자리 높이를 짓는다. */
const LINE_HEIGHT = 21.6;
const FOLD_HEIGHT = 28;
const heightOf = (chunk: DiffChunk) => Math.round((chunk.lines * LINE_HEIGHT + chunk.folds * FOLD_HEIGHT) * 100) / 100;

/**
 * **줄 목록**(시안 `.ra-vwdiff`) — 고정폭 12 / 21.6, 문법색 없이 받은 줄을 그대로 그린다(`WideDiff.test.tsx`). 줄은 왼쪽 막대 4 · 줄번호 40 · 글의 세 칸이고
 * (`.ra-ln`), 숨긴 줄은 「숨긴 줄 N개」 펼침 줄이다(`.ra-vwfold`). 편 숨긴 줄(`open`)은 그 자리에 바뀌지 않은 줄로 선다.
 *
 * - 몸이 구르는 상자다(시안 `.ra-vwbody`). 긴 줄은 꺾지 않고 상자가 옆으로 구른다 — 목록은 가장 긴 줄만큼 넓어(`widestOf`의 칸 수를 최소 폭으로)
 *   줄 바탕과 펼침 줄이 구른 자리까지 이어진다.
 * - **큰 diff는 덩어리로 그린다**(`chunksOf` — 100줄씩). 첫 덩어리만 곧바로 그리고, 나머지는 같은 높이의 빈 자리로 두었다가 상자 한 높이 앞까지 오면
 *   그린다(`IntersectionObserver`). 한 번 그린 덩어리는 남긴다. 2만 줄을 한 번에 그리면 첫 그리기가 1.1초 멎었다(restart 03-15b — 이제 0.1초).
 *   빈 자리 높이는 줄 21.6 · 펼침 줄 28을 곱한 값이라, 엔진이 줄마다 1/64px로 끊어 쌓는 실제 높이(21.59375)와 100줄에 0.625px 다르다.
 */
export function DiffLines({
  rows,
  open,
  onUnfold,
}: {
  rows: readonly DiffRow[];
  open: ReadonlySet<number>;
  onUnfold: (at: number) => void;
}) {
  const chunks = useMemo(() => chunksOf(rows, open), [rows, open]);
  const widest = useMemo(() => Math.max(0, ...chunks.map((chunk) => widestOf(chunk.rows))), [chunks]);
  const box = useRef<HTMLDivElement>(null);
  // 그린 덩어리 — 차례 번호다. 첫 덩어리는 곧바로 그린다.
  const [drawn, setDrawn] = useState<ReadonlySet<number>>(() => new Set([0]));
  useEffect(() => {
    const root = box.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const near = entries.filter((entry) => entry.isIntersecting).map((entry) => Number((entry.target as HTMLElement).dataset.chunk));
        if (near.length > 0) setDrawn((now) => new Set([...now, ...near]));
      },
      { root, rootMargin: "100% 0px" },
    );
    for (const pending of root.querySelectorAll("[data-chunk-pending]")) observer.observe(pending);
    return () => observer.disconnect();
  }, [chunks, drawn]);
  return (
    <div ref={box} data-diff="" className="min-h-0 flex-1 overflow-auto scroll-quiet">
      <div
        className="w-max font-mono text-xs leading-[21.6px] tracking-normal [tab-size:4]"
        style={{ minWidth: `max(100%, calc(44px + ${widest}ch))` }}
      >
        {chunks.map((chunk, index) =>
          drawn.has(index) ? (
            <Chunk key={index} chunk={chunk} onUnfold={onUnfold} />
          ) : (
            <div key={index} data-chunk={index} data-chunk-pending="" style={{ height: `${heightOf(chunk)}px` }} />
          ),
        )}
      </div>
    </div>
  );
}

/**
 * 그린 덩어리 — 줄은 목록의 바로 아래 줄이다(덩어리 상자가 없다). 덩어리를 `content-visibility: auto` 상자로 감싸면 그 상자의 칠 가둠이 덩어리
 * 끝의 펼침 줄 포커스 링을 자르는데, 2만 줄을 다 그린 뒤에도 굴림 · 창 폭 바꾸기가 상자 없이 같은 값이라(restart 03-15b 잼) 감싸지 않았다.
 */
const Chunk = memo(function Chunk({ chunk, onUnfold }: { chunk: DiffChunk; onUnfold: (at: number) => void }) {
  return (
    <Fragment>
      {chunk.rows.map((row) =>
        row.type === "line" ? (
          <Line key={`${row.kind}${row.number}`} line={row} />
        ) : (
          <button
            key={`fold${row.at}`}
            type="button"
            tabIndex={0}
            disabled={row.lines === null}
            onClick={() => onUnfold(row.at)}
            className="flex h-7 w-full items-center gap-1.5 bg-fill-soft pr-3 pl-11 font-sans text-xs tracking-normal text-fg-tertiary transition-colors hover:text-fg-secondary focus-ring disabled:hover:text-fg-tertiary"
          >
            <ChevronRight aria-hidden className="size-3 shrink-0" />
            숨긴 줄 {row.count}개
          </button>
        ),
      )}
    </Fragment>
  );
});

/**
 * 줄 하나(시안 `.ra-ln`) — 더한 줄은 `<ins>`(`diff-added-line` 바탕 · 찬 막대 · 초록 번호), 지운 줄은 `<del>`(`diff-deleted-line` 바탕 · 빗금 막대 ·
 * 붉은 번호)이라 보조 기술도 더함 · 지움을 읽는다. 번호는 오른쪽 10 앞에 맞추고 고를 수 없다 — 글을 골라 복사하면 글만 간다.
 */
function Line({ line }: { line: DiffLine }) {
  const Tag = line.kind === "add" ? "ins" : line.kind === "del" ? "del" : "div";
  return (
    <Tag
      className={cn(
        "grid grid-cols-[4px_40px_minmax(0,1fr)] whitespace-pre",
        line.kind === "add" && "bg-diff-added-line no-underline",
        line.kind === "del" && "bg-diff-deleted-line no-underline",
      )}
    >
      <span aria-hidden className={cn(line.kind === "add" && "bg-diff-added", line.kind === "del" && "diff-bar-deleted")} />
      <span
        className={cn(
          "select-none pr-2.5 text-right",
          line.kind === "add" ? "text-diff-added" : line.kind === "del" ? "text-diff-deleted" : "text-fg-tertiary",
        )}
      >
        {line.number}
      </span>
      <span>{line.text}</span>
    </Tag>
  );
}

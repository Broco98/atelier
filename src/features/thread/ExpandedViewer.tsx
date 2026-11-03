import { Fragment, lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Copy, X } from "lucide-react";
import { copyText } from "@/components/shell/copy-text";
import type { PathView } from "@/components/shell/PathBar";
import { Toaster } from "@/components/ui/toast";
import { Hint } from "@/components/ui/tooltip";
import FilesTree from "@/features/files/FilesTree";
import { docBody, ignoresViewSwitch } from "@/features/works/doc-refs";
import { useSpecFile } from "@/features/works/hooks";
import { specRef, worktreeDirRef } from "@/features/works/refs";
import SpecViewer from "@/features/works/SpecViewer";
import type { WorkView } from "@/features/works/types";
import type { CodeTarget } from "@/features/terminal/shell-registry";
import { freshLines, treePick, viewerPath, type Opened } from "./expanded";
import { setQuote } from "./thread-store";
import type { ChangeSummary } from "./summary-card";
import { cn } from "@/lib/utils";

// 강조 라이브러리(`@pierre/diffs`)는 코드 보기 모듈 아래에서만 들어온다(git-integration 결정 35 · `code-view-chunk.test.ts`) — 넓힌 카드도 그
// 모듈을 `lazy`로 부른다. diff 보기는 그 모듈의 이름 붙은 내보내기다. 넓힌 카드 안의 코드 보기는 걷었다(restart 02a-12 — 트리의 파일은 파일 탭으로 연다).
const DiffView = lazy(() => import("@/features/code/CodeView").then((module) => ({ default: module.DiffView })));

/**
 * **넓힌 카드의 보기**(v1 티켓 35 · 구현 스펙 §15 배치 1 · 캔버스 Layout-Expand 보드 `.viewer`) — 요약 카드가 넓어지면 목록 오른쪽에
 * 선다(02 §7 — 넓힌 카드는 그대로다). 한 번에 파일 하나다.
 *
 * - 머리는 보기 머리(`ViewerHead` — SummarySheet 보드 `.ra-vwhead`)다: 「/」로 이은 경로(「문서 / 01-실패-신호 / 재시도-규칙.md」 ·
 *   「atelier / src-tauri / src / watcher.rs」 · 「Project / atelier」), 변경이면 Work 브랜치와 +/−(브랜치는 요약 카드 머리에서 옮겨 왔다 —
 *   02 §7 표), 문서면 렌더 · 원문 두 단추, 경로 복사(트리는 없다), 「카드로 접기」 ×(스토리 117). 한때 경로 줄(`PathBar`)이 섰고 쓰는
 *   중인 문서의 「쓰는 중」이 끝에 붙었다 — 쓰는 중은 목록의 그 문서 줄이 말한다(restart 02b-8).
 * - **문서**는 작업 화면의 문서 보기 그대로다(`SpecViewer` — 링크 따라가기, 문서 글 메뉴). 다시 읽은 글에서 바뀐
 *   줄만 잠깐 칠하고(스토리 118 · Motion 보드 — `freshLines` · `doc-flash`), 구르는 자리는 그대로다(같은 쿼리의 새 값이 같은 상자에
 *   들어간다). 글을 고르면 「❝ 이 자리를 두고 말하기」가 떠 그 자리를 지금 입력창(`draftKey` — 채팅이면 그 채팅, 작업공간의 새 채팅 탭이면
 *   그 탭의 글 열쇠, restart 02a-11)에 인용으로 붙인다(S41 · `setQuote`).
 * - **변경**은 그 파일의 diff다(`DiffView` — `read_work_diff`, 숨긴 줄 펼치기).
 * - **Project**는 그 worktree의 파일 트리다(`FilesTree`). 트리에서 바뀐 파일을 누르면 그 diff가 이 카드에 열리고(보드 — 트리의 `schema.prisma`가 그
 *   diff를 연다), 그 밖의 파일은 **파일 탭**으로 간다(restart 02a-12 · 스토리 102 · SummarySheet 「넓힌 카드」 표 — 파일 탭이 켜지면 이 카드는 닫힌다).
 *   한때 카드 안에 강조된 코드가 섰다.
 */
export function ExpandedViewer({
  draftKey,
  work,
  opened,
  changes,
  onOpen,
  onOpenFile,
  onClose,
}: {
  /** 문서 인용이 가는 입력창의 글 열쇠. */
  draftKey: string;
  work: WorkView;
  opened: Opened;
  changes: ChangeSummary | null;
  onOpen: (next: Opened) => void;
  /** Project 트리에서 바뀌지 않은 파일을 눌렀다 — 파일 탭으로 연다. */
  onOpenFile: (target: CodeTarget) => void;
  onClose: () => void;
}) {
  // 렌더 · 원문 보기 — 사람이 정한 값이라 문서를 옮겨도 남는다(작업 화면의 `showSource`와 같다).
  const [source, setSource] = useState(false);
  const doc = opened.kind === "doc" ? opened.path : null;
  const view: PathView | undefined =
    doc === null ? undefined : { source, locked: ignoresViewSwitch(doc), onChange: setSource };
  const copy = copyPathOf(work, opened);
  return (
    // 경로 복사의 「… 복사됨」은 이 보기 아래 가운데에 선다(`Toaster` — 자리를 받는 상자가 이 칸이다). 카드가 넓어지면 보기가 옅음에서 선다
    // (v1 티켓 43 · Layout-Expand 보드 `.viewer` — 카드 폭과 같은 패널 박자).
    <div data-viewer={opened.kind} className="relative flex min-w-0 flex-1 flex-col view-in">
      <ViewerHead
        path={viewerPath(opened)}
        change={changeNote(opened, work.branch, changes)}
        view={view}
        onCopy={copy}
        onClose={onClose}
      />
      {/* 몸은 바탕 0에서 자란다(보드 `.ra-vwbody`의 `flex: 1 1 0`) — 바탕이 글 높이면 카드가 넓어지는 첫 프레임들에서 아직 좁은 보기에 글이 길게
          접혀 카드 높이를 판 끝까지 밀었다가 놓는다(높이가 튄다). 카드 높이는 목록과 `min-height`(0 → 100%)만 정한다. */}
      <div className="flex min-h-0 flex-1 basis-0 flex-col">
        {opened.kind === "doc" ? (
          <DocBody
            key={opened.path}
            draftKey={draftKey}
            work={work}
            path={opened.path}
            source={source}
            view={view!}
            onCopyPath={copy}
            onNavigate={(path) => onOpen({ kind: "doc", path })}
          />
        ) : opened.kind === "change" ? (
          <Suspense fallback={null}>
            <DiffView slug={work.slug} project={opened.project} path={opened.path} wide={false} />
          </Suspense>
        ) : (
          <ProjectTree work={work} project={opened.project} changes={changes} onOpen={onOpen} onOpenFile={onOpenFile} />
        )}
      </div>
      <Toaster />
    </div>
  );
}

/** 그 Project의 worktree 자리(`~` 축약, 끝에 `/`) — 이 Work에 그 worktree가 없거나 폴더가 사라졌으면 `null`이다(`WorksPage`와 같다). */
function worktreeDirOf(work: WorkView, project: string): string | null {
  const worktree = work.worktrees.find((one) => one.project === project && one.exists);
  return worktree ? worktreeDirRef(worktree.path) : null;
}

/**
 * 보기 머리의 경로 복사 — 작업 화면 경로 줄의 경로 복사와 같은 값이다. 문서는 그 spec 파일의 참조(`specRef`), 변경은 worktree의 그 파일 경로다. 트리는
 * 가리킬 파일이 없어 서지 않는다.
 */
function copyPathOf(work: WorkView, opened: Opened): (() => void) | undefined {
  if (opened.kind === "doc") return () => copyText(specRef(work.slug, opened.path));
  if (opened.kind === "project") return undefined;
  const dir = worktreeDirOf(work, opened.project);
  return dir !== null ? () => copyText(`${dir}${opened.path}`) : undefined;
}

/** 변경 보기의 머리 끝 — Work 브랜치와 그 파일의 +/−. 변경이 아니면, 또는 적을 것이 없으면 `undefined`다. */
interface ChangeNote {
  branch: string | null;
  additions: number;
  deletions: number;
}

function changeNote(opened: Opened, branch: string | null, changes: ChangeSummary | null): ChangeNote | undefined {
  if (opened.kind !== "change") return undefined;
  const file = changes?.groups
    .find((group) => group.project === opened.project)
    ?.files.find((one) => one.path === opened.path);
  return { branch, additions: file?.additions ?? 0, deletions: file?.deletions ?? 0 };
}

// 머리의 작은 아이콘 단추(보드 `.ra-vwhead .ra-ic-btn`) — 24 · `radius-md` · 글리프 14 `fg-tertiary`, 가리키면 `fill-hover` 면에 `fg`다. 카드
// 머리의 「…」(`SummaryCard`)와 같은 단이다.
const HEAD_BUTTON = "icon-button icon-button-xs text-fg-tertiary transition-colors quiet-hover focus-ring";

// 렌더 · 원문 단추(보드 `.ra-mini`) — 24 · 좌우 8 · `radius-lg` · 12 `fg-secondary`, 가리키면 `fill-hover` 면에 `fg`, 지금 보기는 `fill-selected`
// 면에 `fg`다.
const MINI = "flex h-6 shrink-0 items-center rounded-lg px-2 text-xs transition-colors focus-ring disabled:pointer-events-none disabled:opacity-40";

/**
 * **넓힌 카드 보기의 머리**(SummarySheet 보드 `.ra-vwhead`) — 38 · 왼쪽 14 · 오른쪽 6 · 사이 8 · 아래 0.5 `border-heavy` · 13/18. 받은 값을 그대로
 * 그린다(`ExpandedViewer.test.tsx`).
 *
 * - **경로**는 「위치」 nav 안에 「/」로 이은 조각이다 — 앞 조각 `fg-tertiary`, 끝 조각(지금 보는 것)만 `fg`이고 길면 끝 조각이 말줄임으로
 *   줄어든다. 보여 주기만 한다(이름 「위치」는 경로 줄의 것 그대로다 — 검사가 같은 이름으로 찾는다).
 * - **변경**이면 Work 브랜치(고정폭 12 `fg-tertiary`)와 +/−(0인 쪽은 적지 않는다 — 카드의 줄과 같다).
 * - **문서**면 「문서 보기」 묶음의 렌더 · 원문 두 단추다 — 지금 보기가 눌린 단추다(`aria-pressed`). 본문이 이 묶음을 따르지 않는 파일
 *   (`locked`)이면 둘 다 못 누른다.
 * - 경로 복사(`onCopy`가 없으면 — 트리 — 서지 않는다)와 「카드로 접기」 ×.
 */
export function ViewerHead({
  path,
  change,
  view,
  onCopy,
  onClose,
}: {
  path: readonly string[];
  change?: ChangeNote;
  view?: PathView;
  onCopy?: () => void;
  onClose: () => void;
}) {
  const last = path.length - 1;
  return (
    <div className="flex h-9.5 shrink-0 items-center gap-2 border-b-[0.5px] border-border-heavy pr-1.5 pl-3.5 text-chat-meta whitespace-nowrap">
      <nav aria-label="위치" className="flex min-w-0 flex-1 basis-0 items-center gap-1 overflow-hidden text-fg-tertiary">
        {path.map((piece, index) => (
          <Fragment key={index}>
            {index > 0 && <span aria-hidden>/</span>}
            {index === last ? (
              <span aria-current="page" className="min-w-0 truncate text-fg">
                {piece}
              </span>
            ) : (
              <span className="shrink-0">{piece}</span>
            )}
          </Fragment>
        ))}
      </nav>
      {change && (
        <>
          {change.branch && <span className="shrink-0 font-mono text-xs text-fg-tertiary">{change.branch}</span>}
          {change.additions > 0 && <span className="shrink-0 text-xs text-diff-added tabular-nums">+{change.additions}</span>}
          {change.deletions > 0 && <span className="shrink-0 text-xs text-diff-deleted tabular-nums">−{change.deletions}</span>}
        </>
      )}
      {view && (
        <span role="group" aria-label="문서 보기" className="flex shrink-0 gap-0.5">
          {([false, true] as const).map((source) => (
            <button
              key={String(source)}
              type="button"
              tabIndex={0}
              aria-pressed={view.source === source}
              disabled={view.locked}
              onClick={() => view.onChange(source)}
              className={cn(MINI, view.source === source ? "bg-fill-selected text-fg" : "text-fg-secondary quiet-hover")}
            >
              {source ? "원문" : "렌더"}
            </button>
          ))}
        </span>
      )}
      {onCopy && (
        <Hint text="경로 복사" announce="name" type="button" tabIndex={0} onClick={onCopy} className={HEAD_BUTTON}>
          <Copy aria-hidden className="size-3.5" />
        </Hint>
      )}
      <Hint text="카드로 접기" announce="name" type="button" tabIndex={0} onClick={onClose} className={HEAD_BUTTON}>
        <X aria-hidden className="size-3.5" />
      </Hint>
    </div>
  );
}

/**
 * 문서 보기 — 작업 화면의 문서 몸(`SpecViewer`)을 그대로 세우고, 다시 읽은 글에서 바뀐 줄을 칠한다. 칠하는 자리는 문서 보기가 단 원문 줄
 * 표식이다 — 렌더 보기는 최상위 블록(`data-src-start` · `data-src-end`), 원문 보기는 줄(`data-line`). 그 블록 · 줄에 `data-doc-flash`를
 * 다시 달아 애니메이션을 처음부터 돌린다(`index.css`). 처음 연 글은 칠하지 않는다(`freshLines`).
 */
function DocBody({
  draftKey,
  work,
  path,
  source,
  view,
  onCopyPath,
  onNavigate,
}: {
  draftKey: string;
  work: WorkView;
  path: string;
  source: boolean;
  view: PathView;
  onCopyPath?: () => void;
  onNavigate: (path: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  // 문서 보기와 같은 쿼리다(같은 키라 한 번 읽는다) — 그림은 글로 읽지 않는다(`SpecViewer`와 같다).
  const { data: content } = useSpecFile(work.slug, docBody(path, source) === "image" ? null : path);
  const before = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (content === undefined) return;
    const lines = freshLines(before.current, content);
    before.current = content;
    if (lines.length > 0 && box.current) flashLines(box.current, lines);
  }, [content]);
  return (
    <div ref={box} className="flex min-h-0 flex-1 flex-col">
      <SpecViewer
        work={work}
        // 본문 열은 넓히지 않는다 — 넓힌 카드의 보기는 대화 곁의 칸이다.
        panelOpen
        sidebarOpen={false}
        file={path}
        showSource={source}
        onNavigate={onNavigate}
        onCopy={copyText}
        docMenu={{ view, onCopyPath }}
        onQuote={(quote) => setQuote(draftKey, quote)}
      />
    </div>
  );
}

/** 바뀐 줄이 걸친 블록 · 줄에 칠함을 다시 단다 — 떼고, 한 번 재서(스타일을 다시 셈하게) 다시 달아야 애니메이션이 처음부터 돈다. */
function flashLines(root: HTMLElement, lines: readonly number[]): void {
  for (const el of root.querySelectorAll<HTMLElement>("[data-src-start], [data-line]")) {
    const start = Number(el.dataset.srcStart ?? el.dataset.line);
    const end = Number(el.dataset.srcEnd ?? el.dataset.line);
    if (!lines.some((line) => line >= start && line <= end)) continue;
    el.removeAttribute("data-doc-flash");
    void el.offsetWidth;
    el.setAttribute("data-doc-flash", "");
  }
}

/**
 * Project 보기 — 그 Project worktree의 파일 트리(SummarySheet 보드 `.ra-vwtree`). 트리는 files 트리다(`FilesTree` — 이 Project 하나만 건네
 * 구획 머리 없이 선다). 이 Work가 바꾼 파일은 바뀐 행(파란 이름 · 끝의 점)이고 누르면 그 diff를 이 카드에, 다른 파일은 파일 탭을 연다
 * (`treePick` — restart 02a-12). 한때 트리 위에 「api-server · worktree fix/refund-api」 머리가 섰다(v1 보드 `.tree-v` — restart 02b-8이 걷었다 —
 * 시안의 트리에는 머리가 없고 브랜치는 변경 보기 머리가 든다).
 */
function ProjectTree({
  work,
  project,
  changes,
  onOpen,
  onOpenFile,
}: {
  work: WorkView;
  project: string;
  changes: ChangeSummary | null;
  onOpen: (next: Opened) => void;
  onOpenFile: (target: CodeTarget) => void;
}) {
  const changed = useMemo(
    () => changes?.groups.find((group) => group.project === project)?.files.map((file) => file.path) ?? [],
    [changes, project],
  );
  const one = { ...work, worktrees: work.worktrees.filter((worktree) => worktree.project === project) };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FilesTree
        work={one}
        visible
        current={null}
        changed={changed}
        onPress={(target) => {
          const pick = treePick(project, target.path, changed);
          if (pick.kind === "change") onOpen(pick);
          else onOpenFile(pick);
        }}
      />
    </div>
  );
}

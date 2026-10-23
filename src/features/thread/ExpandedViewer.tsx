import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { copyText } from "@/components/shell/copy-text";
import { PathBar, ROUND, type PathView } from "@/components/shell/PathBar";
import { Toaster } from "@/components/ui/toast";
import { Hint } from "@/components/ui/tooltip";
import FilesTree from "@/features/files/FilesTree";
import { docBody, ignoresViewSwitch } from "@/features/works/doc-refs";
import { useSpecFile } from "@/features/works/hooks";
import { specRef, worktreeDirRef } from "@/features/works/refs";
import SpecViewer from "@/features/works/SpecViewer";
import type { WorkView } from "@/features/works/types";
import { AgentFace } from "./AgentFace";
import { freshLines, viewerPath, type Opened } from "./expanded";
import { setQuote } from "./thread-store";
import type { DocWriting } from "./types";
import { writerLine, type ChangeSummary } from "./work-card";

// 강조 라이브러리(`@pierre/diffs`)는 코드 보기 모듈 아래에서만 들어온다(git-integration 결정 35 · `code-view-chunk.test.ts`) — 넓힌 카드도 그
// 모듈을 `lazy`로 부른다. diff 보기는 그 모듈의 이름 붙은 내보내기다.
const CodeView = lazy(() => import("@/features/code/CodeView"));
const DiffView = lazy(() => import("@/features/code/CodeView").then((module) => ({ default: module.DiffView })));

/**
 * **넓힌 카드의 보기**(v1 티켓 35 · 구현 스펙 §15 배치 1 · 캔버스 Layout-Expand 보드 `.viewer`) — Work 카드가 넓어지면 목록 오른쪽에 선다.
 * 한 번에 파일 하나다.
 *
 * - 머리는 경로 줄(`PathBar` — 보드 `.vh`의 「문서 / design.md」 · 「api-server / src / refund.service.ts」 · 「Project / api-server」)이다. 끝
 *   칸에 변경의 +/−, 쓰는 중인 문서의 「Host가 쓰는 중」, 그리고 「카드로 접기」 ×가 선다(스토리 117).
 * - **문서**는 작업 화면의 문서 보기 그대로다(`SpecViewer` — 렌더 · 원문 보기 묶음, 링크 따라가기, 문서 글 메뉴). 다시 읽은 글에서 바뀐
 *   줄만 잠깐 칠하고(스토리 118 · Motion 보드 — `freshLines` · `doc-flash`), 구르는 자리는 그대로다(같은 쿼리의 새 값이 같은 상자에
 *   들어간다). 글을 고르면 「❝ 이 자리를 두고 말하기」가 떠 그 자리를 지금 Thread의 입력창에 인용으로 붙인다(S41 · `setQuote`).
 * - **변경**은 그 파일의 diff다(`DiffView` — `read_work_diff`, 숨긴 줄 펼치기).
 * - **Project**는 그 worktree의 파일 트리다(`FilesTree`). 트리에서 바뀐 파일을 누르면 그 diff가, 다른 파일을 누르면 강조된 코드가 열린다
 *   (보드 — 트리의 `schema.prisma`가 그 diff를 연다). Project 줄을 다시 누르면 트리로 돌아온다.
 */
export function ExpandedViewer({
  thread,
  work,
  opened,
  changes,
  writing,
  onOpen,
  onClose,
}: {
  thread: string;
  work: WorkView;
  opened: Opened;
  changes: ChangeSummary | null;
  writing: readonly DocWriting[];
  onOpen: (next: Opened) => void;
  onClose: () => void;
}) {
  // 렌더 · 원문 보기 — 사람이 정한 값이라 문서를 옮겨도 남는다(작업 화면의 `showSource`와 같다).
  const [source, setSource] = useState(false);
  const doc = opened.kind === "doc" ? opened.path : null;
  const view: PathView | undefined =
    doc === null ? undefined : { source, locked: ignoresViewSwitch(doc), onChange: setSource };
  const copy = copyPathOf(work, opened);
  const close = (
    <Hint text="카드로 접기" announce="name" type="button" tabIndex={0} onClick={onClose} className={ROUND}>
      <X aria-hidden className="size-4" />
    </Hint>
  );
  return (
    // 경로 복사의 「… 복사됨」은 이 보기 아래 가운데에 선다(`Toaster` — 자리를 받는 상자가 이 칸이다).
    <div data-viewer={opened.kind} className="relative flex min-w-0 flex-1 flex-col">
      <PathBar
        path={viewerPath(opened)}
        view={view}
        onCopy={copy}
        end={
          <>
            <ViewerNote opened={opened} changes={changes} writing={writing} />
            {close}
          </>
        }
      />
      {opened.kind === "doc" ? (
        <DocBody
          key={opened.path}
          thread={thread}
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
      ) : opened.file === null ? (
        <ProjectTree work={work} project={opened.project} changes={changes} onOpen={onOpen} />
      ) : (
        <Suspense fallback={null}>
          <CodeView
            slug={work.slug}
            target={{ project: opened.project, path: opened.file }}
            worktreeDir={worktreeDirOf(work, opened.project)}
            wide={false}
          />
        </Suspense>
      )}
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
 * 경로 줄의 경로 복사 — 작업 화면의 두 경로 줄과 같은 값이다. 문서는 그 spec 파일의 참조(`specRef`), 변경 · Project의 파일은 worktree의 그
 * 파일 경로다. 트리만 열었을 때는 가리킬 파일이 없어 서지 않는다.
 */
function copyPathOf(work: WorkView, opened: Opened): (() => void) | undefined {
  if (opened.kind === "doc") return () => copyText(specRef(work.slug, opened.path));
  const file = opened.kind === "change" ? opened.path : opened.file;
  const dir = worktreeDirOf(work, opened.project);
  return file !== null && dir !== null ? () => copyText(`${dir}${file}`) : undefined;
}

/**
 * 경로 줄 끝의 옅은 메타(보드 `.vh .st` · `.vlive` — 12/18) — 변경은 그 파일의 +/−(0인 쪽은 적지 않는다 — 카드의 줄과 같다), 쓰는 중인
 * 문서는 그 Agent의 얼굴과 「Host가 쓰는 중」이다.
 */
function ViewerNote({
  opened,
  changes,
  writing,
}: {
  opened: Opened;
  changes: ChangeSummary | null;
  writing: readonly DocWriting[];
}) {
  if (opened.kind === "doc") {
    const writer = writing.find((one) => one.path === opened.path);
    if (!writer) return null;
    return (
      <span data-writer={writer.who} className="flex shrink-0 items-center gap-1.5 px-1 text-xs text-fg-tertiary">
        <AgentFace handle={writer.who} className="size-3.5" />
        {writerLine(writer.name)}
      </span>
    );
  }
  if (opened.kind !== "change") return null;
  const file = changes?.groups
    .find((group) => group.project === opened.project)
    ?.files.find((one) => one.path === opened.path);
  if (!file || (!file.additions && !file.deletions)) return null;
  return (
    <span className="flex shrink-0 items-center gap-1 px-1 text-xs">
      {!!file.additions && <span className="text-diff-added">+{file.additions}</span>}
      {!!file.deletions && <span className="text-diff-deleted">−{file.deletions}</span>}
    </span>
  );
}

/**
 * 문서 보기 — 작업 화면의 문서 몸(`SpecViewer`)을 그대로 세우고, 다시 읽은 글에서 바뀐 줄을 칠한다. 칠하는 자리는 문서 보기가 단 원문 줄
 * 표식이다 — 렌더 보기는 최상위 블록(`data-src-start` · `data-src-end`), 원문 보기는 줄(`data-line`). 그 블록 · 줄에 `data-doc-flash`를
 * 다시 달아 애니메이션을 처음부터 돌린다(`index.css`). 처음 연 글은 칠하지 않는다(`freshLines`).
 */
function DocBody({
  thread,
  work,
  path,
  source,
  view,
  onCopyPath,
  onNavigate,
}: {
  thread: string;
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
        onQuote={(quote) => setQuote(thread, quote)}
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
 * Project 보기 — 그 Project worktree의 파일 트리(보드 `.tree-v` — 머리 「api-server · worktree fix/refund-api」 12/18 옅은 글자). 트리는 작업
 * 화면 files 칸의 것 그대로다(`FilesTree` — 이 Project 하나만 건네 구획 머리 없이 선다). 바뀐 파일은 그 diff를, 다른 파일은 코드를 연다.
 */
function ProjectTree({
  work,
  project,
  changes,
  onOpen,
}: {
  work: WorkView;
  project: string;
  changes: ChangeSummary | null;
  onOpen: (next: Opened) => void;
}) {
  const changed = new Set(changes?.groups.find((group) => group.project === project)?.files.map((file) => file.path));
  const one = { ...work, worktrees: work.worktrees.filter((worktree) => worktree.project === project) };
  return (
    <div className="flex min-h-0 flex-1 flex-col pt-1">
      <div className="px-4.5 pt-1 pb-2 text-xs text-fg-tertiary">
        {project}
        {work.branch && (
          <>
            {" · worktree "}
            <span className="font-mono text-2xs">{work.branch}</span>
          </>
        )}
      </div>
      <FilesTree
        work={one}
        visible
        current={null}
        onPress={(target) =>
          onOpen(
            changed.has(target.path)
              ? { kind: "change", project, path: target.path }
              : { kind: "project", project, file: target.path },
          )
        }
      />
    </div>
  );
}

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderGit2, RotateCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Hint } from "@/components/ui/tooltip";
import { useProjects } from "@/features/projects/hooks";
import type { CodeTarget } from "@/features/terminal/shell-registry";
import { TreeRows, type RowLook, type TreeRowItem } from "@/features/works/SpecTree";
import type { WorktreeView, WorkView } from "@/features/works/types";
import { foldsOf, rememberFolds, type Folds } from "./folds";
import { refreshWorktrees, worktreeTreeQuery } from "./hooks";
import type { WorktreeEntry } from "./types";

// 걸린 행이 덧붙여 말하는 것 — 흐린 글자의 뜻을 화면 읽기로도 듣는다(스토리 88).
const IGNORED_NOTE = "gitignore에 걸림";
const SUBMODULE_NOTE = "하위 모듈";

// 몸 안의 안내 한 줄 — spec 몸의 「아직 spec 파일이 없어요」와 같은 규격이다.
const NOTE = "px-2 py-1.5 text-ui text-tertiary";

/**
 * files 몸 — 이 work의 워크트리 트리(git-integration 판 01, 결정 37). 프로젝트마다 구획이 하나다.
 *
 * **돌려주는 스크롤 영역이 패널 몸(WorkPanel 뿌리)의 직계 flex 자식이다** — spec 몸(`SpecTab`)과 같은 계약이다. 머리는 카드에
 * 고정되고 트리만 세로로 스크롤한다. 표식(`data-files-tree`)은 이 칸 범위의 토큰(흐린 글자 — `index.css`)이 서는 자리다.
 *
 * `visible`은 「files 칸이 열려 보이는가」다(S9) — 쿼리를 그것으로 켠다. 몸은 숨어도 마운트된 채라 그 값을 몸이 스스로 알 길이
 * 없어 화면이 내려 준다.
 *
 * `current`는 **본문에 선 파일 탭**이다 — 트리가 그 파일 행을 강조하고, 바뀌면 그 행을 보이는 자리로 데려온다(스토리 14 · 15).
 * 파일 행을 누르면 `onPress`가 그 파일과 클릭 횟수를 받는다 — 열지 닫을지(결정 30 — 다시 누르면 닫힘)는 화면이 정한다: 지금
 * 보이는 탭이 무엇인지와 탭을 닫는 길을 화면이 든다.
 */
function FilesTree({
  work,
  visible,
  current,
  onPress,
}: {
  work: WorkView;
  visible: boolean;
  current: CodeTarget | null;
  onPress: (target: CodeTarget, clicks: number) => void;
}) {
  const { data: projects } = useProjects();
  // 프로젝트가 하나면 구획 머리 없이 바로 트리다(S13) — 대부분의 work가 하나다.
  const headed = work.worktrees.length > 1;
  return (
    <div data-files-tree="" className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-0.5 pt-1 scroll-quiet">
      {work.worktrees.length === 0 ? (
        <span className={NOTE}>이 work에는 프로젝트가 없어요</span>
      ) : (
        work.worktrees.map((worktree) => (
          <ProjectSection
            // work를 옮기면 구획이 새로 선다 — 접힘을 그 work · 프로젝트의 기억에서 다시 읽는다(`useState`의 첫 값).
            key={`${work.slug}:${worktree.project}`}
            slug={work.slug}
            worktree={worktree}
            // 구획 머리는 프로젝트 **표시 이름**이다. 목록이 아직 안 왔거나 등록이 사라졌으면 slug로 선다.
            title={headed ? (projects?.find((p) => p.slug === worktree.project)?.name ?? worktree.project) : null}
            visible={visible}
            current={current?.project === worktree.project ? current.path : null}
            onPress={onPress}
          />
        ))
      )}
    </div>
  );
}

/** 트리 행에 그리는 항목 — 코어의 항목을 행의 모양(파일 / 폴더)으로 옮긴 것이다. 원래 항목은 `entry`로 든다. */
interface FileRow extends TreeRowItem<FileRow> {
  entry: WorktreeEntry;
}

// 폴더만 펼쳐지는 행이다. 심링크는 따라가지 않고, 하위 모듈은 다른 저장소라 펼치지 않는 행이다(S3) — 둘 다 파일 행으로 선다.
// 아직 안 읽은 폴더(`children: null`)는 빈 폴더로 옮기고, 펼침은 `isOpen`이 막는다.
const rowsOf = (entries: readonly WorktreeEntry[]): FileRow[] =>
  entries.map((entry) => ({
    name: entry.name,
    path: entry.path,
    kind: entry.kind === "folder" ? "folder" : "file",
    children: rowsOf(entry.children ?? []),
    entry,
  }));

// 행의 겉. 걸린 것은 흐리고 그 까닭을 말한다(스토리 19 · 88). 파일 행의 글리프는 확장자 꼬리표다(스토리 12) — 하위 모듈만
// 제 글리프를 받는다.
const lookOf = ({ entry }: FileRow): RowLook => ({
  glyph: entry.kind === "submodule" ? FolderGit2 : null,
  dim: entry.ignored,
  note: entry.ignored ? IGNORED_NOTE : entry.kind === "submodule" ? SUBMODULE_NOTE : undefined,
});

/** 프로젝트 하나의 구획 — 머리(프로젝트가 둘 이상일 때)와 그 워크트리의 트리. */
function ProjectSection({
  slug,
  worktree,
  title,
  visible,
  current,
  onPress,
}: {
  slug: string;
  worktree: WorktreeView;
  title: string | null;
  visible: boolean;
  /** 본문에 선 파일 탭의 워크트리 기준 경로 — 그 탭이 이 구획의 프로젝트 것일 때만 찬다. */
  current: string | null;
  onPress: (target: CodeTarget, clicks: number) => void;
}) {
  const { project } = worktree;
  // work 목록이 이미 「워크트리 없음」이라 말하면 묻지 않는다. 목록은 낡을 수 있어 물었더니 없다는 답도 같은 안내로 선다.
  const tree = useQuery(worktreeTreeQuery(slug, project, visible && worktree.exists));
  const rows = useMemo(() => (tree.data?.kind === "listed" ? rowsOf(tree.data.entries) : []), [tree.data]);
  // 손으로 접고 편 폴더 — work · 프로젝트의 기억에서 시작해 바꿀 때마다 거기 적는다(`folds.ts`).
  const [folds, setFolds] = useState<Folds>(() => foldsOf(slug, project));
  const setOpen = (paths: readonly string[], open: boolean) => {
    const next = { ...folds, ...Object.fromEntries(paths.map((path) => [path, open])) };
    rememberFolds(slug, project, next);
    setFolds(next);
  };
  const headingId = useId();

  // **지금 탭이 바뀌면 그 파일을 트리에서 보인다**(스토리 15 · 결정 37) — 조상 폴더를 펼치고 행을 보이는 자리로 스크롤한다.
  // 칸이 안 보이면(패널이 닫혔거나 다른 칸) 할 수 없다: 숨은 몸에는 잴 자리가 없고 트리도 안 읽었다(S9). 그래서 바뀐 파일을
  // 적어 두고(`toReveal`) **보이고 트리가 선 뒤에** 한 번 한다. 손으로 접은 것은 지금 탭이 다시 바뀔 때까지 그대로 둔다.
  const listed = tree.data?.kind === "listed";
  const toReveal = useRef<string | null>(null);
  const toScroll = useRef(false);
  const rowsBox = useRef<HTMLDivElement>(null);
  useEffect(() => {
    toReveal.current = current;
    toScroll.current = false;
  }, [current]);
  useEffect(() => {
    const path = toReveal.current;
    if (path === null || !visible || !listed) return;
    toReveal.current = null;
    toScroll.current = true;
    const closed = ancestorsOf(path).filter((folder) => !folds[folder]);
    if (closed.length > 0) setOpen(closed, true);
  }, [current, visible, listed]);
  // 행은 조상이 펼쳐진 **다음** 그림에 선다 — 그래서 스크롤은 그림마다 보고, 행이 서 있을 때 한 번 한다.
  useEffect(() => {
    if (!toScroll.current) return;
    const row = rowsBox.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row) return;
    toScroll.current = false;
    scrollToRow(row);
  });

  let body;
  if (!worktree.exists || tree.data?.kind === "worktreeMissing") {
    body = <span className={NOTE}>워크트리 없음</span>;
  } else if (tree.data?.kind === "unreadable") {
    body = <span className={NOTE}>읽지 못했어요 — {tree.data.reason}</span>;
  } else if (tree.data?.kind === "listed") {
    body =
      rows.length === 0 ? (
        <span className={NOTE}>파일이 없어요</span>
      ) : (
        <div ref={rowsBox} className="flex shrink-0 flex-col gap-(--row-gap)">
          <TreeRows
            items={rows}
            depth={0}
            current={current}
            // 걸린 폴더는 아직 안 읽어 펼치지 않는다(펼칠 때 한 겹 읽기는 티켓 02).
            isOpen={(row) => row.entry.children !== null && (folds[row.path] ?? false)}
            onOpenChange={(path, open) => setOpen([path], open)}
            onSelect={(path, clicks) => onPress({ project, path }, clicks)}
            lookOf={lookOf}
          />
        </div>
      );
  } else if (tree.isError) {
    body = <span className={NOTE}>읽지 못했어요 — {String(tree.error)}</span>;
  } else {
    body = <span className={NOTE}>읽는 중…</span>;
  }

  if (title === null) return body;
  return (
    <div role="group" aria-labelledby={headingId} className="flex shrink-0 flex-col">
      <h3 id={headingId} className="truncate px-2 pb-1 pt-2 text-ui font-semibold">
        {title}
      </h3>
      {body}
    </div>
  );
}

/** 워크트리 기준 경로의 조상 폴더들 — 위에서부터(`a/b/c.ts` → `a`, `a/b`). */
function ancestorsOf(path: string): string[] {
  const parts = path.split("/").slice(0, -1);
  return parts.map((_, at) => parts.slice(0, at + 1).join("/"));
}

/**
 * 행을 트리의 보이는 자리로 — **트리 상자만 세로로 민다.** `scrollIntoView`를 쓰지 않는 것은 그것이 넘침을 감춘 조상 상자까지
 * 모두 밀기 때문이다: 패널이 열리는 폭 트랜지션 한가운데에 부르면 바깥 칸이 가로로 밀린 채 남을 수 있다. 이미 보이면 그대로다.
 */
function scrollToRow(row: HTMLElement): void {
  const box = row.closest<HTMLElement>("[data-files-tree]");
  if (!box) return;
  const view = box.getBoundingClientRect();
  const at = row.getBoundingClientRect();
  if (at.top < view.top) box.scrollTop -= view.top - at.top;
  else if (at.bottom > view.bottom) box.scrollTop += at.bottom - view.bottom;
}

/**
 * 새로고침 버튼(스토리 16) — files 칸 머리에 선다. 무언가 낡아 보이면 손으로 그 work의 워크트리를 다시 읽는다. 머리 컨트롤의
 * 규격(DS `.at-icon-btn.outline`)은 문서 카드 머리의 경로 복사와 같다.
 */
export function FilesRefresh({ slug }: { slug: string }) {
  const queryClient = useQueryClient();
  return (
    <Hint
      text="새로고침"
      announce="name"
      render={<Button variant="outline" size="icon-round" onClick={() => void refreshWorktrees(queryClient, slug)} />}
    >
      <RotateCw className="size-4" strokeWidth={1.8} />
    </Hint>
  );
}

export default FilesTree;

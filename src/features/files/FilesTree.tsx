import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import { FolderGit2, RotateCw } from "lucide-react";
import { Hint } from "@/components/ui/tooltip";
import { useProjects } from "@/features/projects/hooks";
import type { CodeTarget } from "@/features/terminal/shell-registry";
import {
  TreeRows,
  treeIndent,
  type RowLook,
  type TreeRowItem,
  type TreeRowsProps,
} from "@/features/works/SpecTree";
import type { WorktreeView, WorkView } from "@/features/works/types";
import { foldsOf, rememberFolds, type Folds } from "./folds";
import { refreshWorktrees, worktreeFolderQuery, worktreeTreeQuery } from "./hooks";
import type { WorktreeEntry, WorktreeTree } from "./types";

// 걸린 행이 덧붙여 말하는 것 — 흐린 글자의 뜻을 화면 읽기로도 듣는다(스토리 88).
const IGNORED_NOTE = "gitignore에 걸림";
const SUBMODULE_NOTE = "하위 모듈";

// 몸 안의 안내 한 줄 — spec 몸의 「아직 spec 파일이 없어요」와 같은 규격이다.
const NOTE = "px-2 py-1.5 text-chat-meta text-fg-tertiary";

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
// 아직 안 읽은 폴더(`children: null`)는 빈 폴더로 옮긴다 — 펼치면 그 몸(`UnreadFolder`)이 한 겹 읽어 행을 세운다.
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

  // 구획의 행과 펼친 걸린 폴더 안의 행이 같은 값으로 선다 — 접힘 기억도, 강조하는 지금 파일도 한 벌이다.
  const rowsProps: RowsProps = {
    current,
    isOpen: (row) => folds[row.path] ?? false,
    onOpenChange: (path, open) => setOpen([path], open),
    onSelect: (path, clicks) => onPress({ project, path }, clicks),
    lookOf,
    // 아직 안 읽은 폴더(걸린 폴더)는 펼칠 때 한 겹 읽는다 — 그 몸이 읽기를 건다(스토리 20). 나머지 폴더는 받은 자식 행이다.
    folderBody: (row, depth) =>
      row.entry.children === null ? (
        <UnreadFolder slug={slug} project={project} path={row.path} depth={depth} visible={visible} rowsProps={rowsProps} />
      ) : undefined,
  };

  const body = worktree.exists ? (
    answerBody(
      tree,
      rows,
      (items) => (
        <div ref={rowsBox} className="flex shrink-0 flex-col gap-px">
          <TreeRows items={items} depth={0} {...rowsProps} />
        </div>
      ),
      sectionNote,
      "파일이 없어요",
    )
  ) : (
    sectionNote("워크트리 없음")
  );

  if (title === null) return body;
  return (
    <div role="group" aria-labelledby={headingId} className="flex shrink-0 flex-col">
      <h3 id={headingId} className="truncate px-2 pb-1 pt-2 text-chat-meta font-semibold">
        {title}
      </h3>
      {body}
    </div>
  );
}

/** 행 묶음의 입력 가운데 자리(항목 · 깊이)를 뺀 것 — 구획과 그 안의 펼친 걸린 폴더가 함께 쓴다. */
type RowsProps = Omit<TreeRowsProps<FileRow>, "items" | "depth">;

/**
 * 펼친 걸린 폴더의 몸(git-integration 티켓 02) — 그 폴더의 바로 아래를 한 겹 읽어 자식 행의 자리에 세운다. 묻는 동안은 「읽는
 * 중」 행이 서고(스토리 21), 읽지 못하면 그 자리에 까닭 행이 선다. 안의 폴더도 다시 「아직 안 읽음」이라 펼치면 또 이 몸이다.
 *
 * 펼쳐 둔 동안만 마운트된다 — 그래서 펼칠 때 읽고, 새로고침 버튼은 펼쳐 둔 것만 다시 읽는다(`worktreeFolderQuery`).
 *
 * 바로 아래가 상한을 넘으면 코어가 앞에서부터 상한까지만 싣고 나머지를 수로 말한다(`omitted`) — 받은 행 아래에 그 수를 한 줄로
 * 세운다. 행이 끝난 자리가 폴더의 끝이 아니라는 것을 말해야 한다.
 */
function UnreadFolder({
  slug,
  project,
  path,
  depth,
  visible,
  rowsProps,
}: {
  slug: string;
  project: string;
  path: string;
  depth: number;
  visible: boolean;
  rowsProps: RowsProps;
}) {
  const folder = useQuery(worktreeFolderQuery(slug, project, path, visible));
  const rows = useMemo(() => (folder.data?.kind === "listed" ? rowsOf(folder.data.entries) : []), [folder.data]);
  const omitted = folder.data?.kind === "listed" ? (folder.data.omitted ?? 0) : 0;
  return answerBody(
    folder,
    rows,
    (items) => (
      <>
        <TreeRows items={items} depth={depth} {...rowsProps} />
        {omitted > 0 && (
          <FolderNote depth={depth} text={`그 밖에 ${omitted.toLocaleString("ko-KR")}개는 그리지 않아요`} />
        )}
      </>
    ),
    (text) => <FolderNote depth={depth} text={text} />,
    "비어 있어요",
  );
}

/**
 * 트리 목록 · 한 겹 읽기의 답을 몸으로 옮긴다 — 둘은 같은 갈래(코어 `WorktreeTree`)라 구획과 펼친 걸린 폴더가 같은 규칙으로
 * 그린다. 행을 세우는 법(`rowsBody`)과 안내 한 줄의 모양(`note`), 비었을 때의 말만 자리마다 다르다.
 *
 * 답이 오기 전에 실패하면(명령 거절) 그 글이 까닭이다. 다시 읽는 동안에는 받아 둔 답이 그대로 선다 — 「읽는 중」은 처음뿐이다.
 */
function answerBody(
  answer: UseQueryResult<WorktreeTree>,
  rows: FileRow[],
  rowsBody: (items: FileRow[]) => ReactNode,
  note: (text: string) => ReactNode,
  empty: string,
): ReactNode {
  const { data } = answer;
  if (data?.kind === "worktreeMissing") return note("워크트리 없음");
  if (data?.kind === "unreadable") return note(`읽지 못했어요 — ${data.reason}`);
  if (data?.kind === "listed") return rows.length === 0 ? note(empty) : rowsBody(rows);
  if (answer.isError) return note(`읽지 못했어요 — ${String(answer.error)}`);
  return note("읽는 중…");
}

/** 구획의 안내 한 줄 — 트리 대신 선다. */
const sectionNote = (text: string) => <span className={NOTE}>{text}</span>;

/**
 * 펼친 걸린 폴더 아래의 안내 한 줄(「읽는 중」 · 까닭 · 비어 있음 · 싣지 않은 수) — 자식 행의 자리(높이 · 들여쓰기)에 선다.
 * 까닭은 길 수 있어 잘리고, 툴팁으로 전부 읽힌다.
 */
function FolderNote({ depth, text }: { depth: number; text: string }) {
  return (
    <div className="flex h-7 items-center pr-2 text-chat-meta text-fg-tertiary" style={treeIndent(depth)} title={text}>
      <span className="min-w-0 truncate">{text}</span>
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
 * 규격(DS `.at-ib` 28 · `fg-secondary`)은 `spec` 칸 머리의 spec 폴더 열기와 같다(`WorkPanel`). Tab 정류장임을 `tabIndex`로
 * 명시한다 — WebKit의 Tab은 `tabindex` 없는 버튼에 서지 않는다(`@/lib/roving` 머리말).
 */
export function FilesRefresh({ slug }: { slug: string }) {
  const queryClient = useQueryClient();
  return (
    <Hint
      text="새로고침"
      announce="name"
      type="button"
      tabIndex={0}
      onClick={() => void refreshWorktrees(queryClient, slug)}
      className="icon-button-quiet text-fg-secondary focus-ring"
    >
      <RotateCw className="size-4" />
    </Hint>
  );
}

export default FilesTree;

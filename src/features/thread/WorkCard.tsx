import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Archive,
  Check,
  ChevronRight,
  ExternalLink,
  File,
  FileText,
  Folder,
  GitPullRequest,
  MoreHorizontal,
  PanelRight,
  Plus,
  SquareTerminal,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { archivedDayText } from "@/features/archive/archive-days";
import { archiveQuery, useArchivedDocs } from "@/features/archive/hooks";
import type { ArchiveEntry } from "@/features/archive/types";
import { workChangesKey } from "@/features/files/hooks";
import { worksApi } from "@/features/works/api";
import { useWorks } from "@/features/works/hooks";
import { CopySubmenu, FinderSubmenu } from "@/features/works/WorkMenuItems";
import { useWorkMenuFlows } from "@/features/works/work-menu-actions";
import type { ProjectChanges, WorkView } from "@/features/works/types";
import { useThreads } from "./hooks";
import { lastSaid } from "./preview";
import { since } from "./since";
import { fillDraft, linesOf, threadRecordStore, workWritingStore, writingOf } from "./thread-store";
import type { ThreadSummary } from "./types";
import {
  changeSummary,
  docRows,
  fileKey,
  freshFiles,
  prRows,
  projectRows,
  readCardOpen,
  writeCardOpen,
  writerLine,
  type ChangeSummary,
  type DocRow,
  type PrRow,
  type ProjectRow,
} from "./work-card";

// **Work 카드**(v1 티켓 34 · 구현 스펙 §15 · S32 · S33 · 캔버스 WorkPanel · Screen-Review 보드) — Work에 이은 Thread의 오른쪽 위, 위
// 막대의 카드 버튼 바로 아래에 작게 떠 있다. 오른쪽은 Thread가 아니라 **Work의 자리**다 — 같은 Work의 어느 Thread에서나 같은 카드가
// 보이고(스토리 112), 카드는 대화를 따라가지 않고 Work의 지금 상태만 보인다.
//
//   머리(폴더 · 이름 · 브랜치 · Thread 수 · ⋯) — 누르면 이 Work의 Thread들과 「이 Work에서 새 Thread」
//   문서(spec 트리의 파일 · 쓰는 중이면 파란 점과 그 Agent) · 변경(Project마다 +/− · 새로 바뀐 파일이 잠깐 빛남) · Project(고치는 중 ·
//   읽기만) · PR(번호 · 상태 문장) — **비어 있는 칸은 그리지 않는다.**
//
// - 칸을 짓는 것은 순수 함수(`work-card.ts`)이고, 칸을 그리는 조각(`WorkCardSections`)은 훅을 부르지 않는다 — 정적 마크업으로 그
//   모양을 잰다(`WorkCard.test.tsx`).
// - **변경은 카드가 열릴 때와 `worktree:changed`마다 읽는다**(v1 티켓 33) — 앱 루트의 감시 배선(`useFollowWorktreeChanges`)이 그 Work의
//   변경 쿼리를 낡았다고 표시한다. PR은 카드가 열릴 때 읽는다(§12 — 턴 끝 · 60초마다는 v1 티켓 36).
// - 쓰는 중은 엔진의 `work:writing`이다(`workWritingStore` — 앱 루트가 쌓는다).
// - 줄을 누르면 카드가 넓어지는 일(문서 · diff · 트리)은 v1 티켓 35다 — 이 판의 줄은 보이기만 한다.
// - 더하기 둘(문서 추가 · Project 붙이기)은 이 Thread의 입력창에 Host에게 맡기는 말을 채운다 — 문서를 쓰고 Project를 붙이는 것은 Host다
//   (보드 「고칠 곳이 정해지면 Host가 Project를 붙입니다」, 결정.md 34). 보내는 것은 사람이다.
// - **보관된 Work는 보관됨 모양이다**(v1 티켓 38 · 보드 「보관된 Work」 — `ArchivedWorkCard`) — 보관 글리프 · 「보관됨 · 날짜」, 더하기 ·
//   ⋯ · 머리 메뉴가 없다. 「다시 열기」는 짓지 않는다(S25).

/** 「문서 추가」가 입력창에 채우는 말. */
export const ADD_DOC_ASK = "이 Work의 spec 폴더에 새 문서를 써 줘: ";
/** 「Project 붙이기」가 입력창에 채우는 말. */
export const ATTACH_PROJECT_ASK = "이 Work에 Project를 붙여 줘: ";

interface WorkCardProps {
  /** 지금 Thread — 머리 메뉴가 그 줄에 ✓를 달고, 더하기 둘이 그 입력창을 채운다. */
  thread: string;
  slug: string;
  /** 「이 Work에서 새 Thread」. */
  onNewThread: () => void;
}

/**
 * 그 Work의 카드가 열려 있나와 여닫기(S32) — 처음 보는 Work는 이 컴퓨터에 적어 둔 값(없거나 못 읽으면 열림)이고, 여닫으면 적는다. 적지
 * 못해도 이 화면이 떠 있는 동안은 고른 대로다. Work가 없으면 늘 닫혀 있다.
 */
export function useCardOpen(slug: string | null): [boolean, (open: boolean) => void] {
  const [chosen, setChosen] = useState<Readonly<Record<string, boolean>>>({});
  const open = slug !== null && (chosen[slug] ?? readCardOpen(slug));
  const set = useCallback(
    (next: boolean) => {
      if (slug === null) return;
      writeCardOpen(slug, next);
      setChosen((now) => ({ ...now, [slug]: next }));
    },
    [slug],
  );
  return [open, set];
}

/** Work 카드 — 그 Work를 목록에서 찾지 못하면(보관 · 지움 · 아직 읽는 중) 서지 않는다. */
export function WorkCard({ thread, slug, onNewThread }: WorkCardProps) {
  const { data: works } = useWorks();
  const work = works?.find((one) => one.slug === slug) ?? null;
  const { data: threads } = useThreads();
  const own = threads?.filter((one) => one.work === slug) ?? [];
  const changes = useChanges(slug);
  // PR은 카드가 열릴 때(마운트) 읽는다 — 창 포커스마다 `gh`를 부르지 않는다. 턴 끝 · 60초마다는 v1 티켓 36이다.
  const { data: prs } = useQuery({
    queryKey: ["work-card", slug, "prs"],
    queryFn: () => worksApi.prs(slug),
    refetchOnWindowFocus: false,
  });
  const writing = useStore(workWritingStore, (state) => writingOf(state, slug));
  if (!work) return null;
  return (
    <section
      aria-label={`Work 카드: ${work.title || slug}`}
      className={CARD}
    >
      <CardHead work={work} thread={thread} threads={own} onNewThread={onNewThread} />
      <WorkCardSections
        docs={docRows(work.specTree, writing)}
        changes={changes.summary}
        fresh={changes.fresh}
        flash={changes.flash}
        projects={projectRows(work)}
        prs={prRows(prs ?? [])}
        onAddDoc={() => fillDraft(thread, ADD_DOC_ASK)}
        onAttachProject={() => fillDraft(thread, ATTACH_PROJECT_ASK)}
        onOpenPr={(row) => void openUrl(row.url)}
      />
    </section>
  );
}

/** 카드의 면 — 진행 중이든 보관됐든 같다. */
const CARD =
  "flex max-h-full w-(--size-work-card) flex-col gap-1.5 overflow-y-auto rounded-2xl bg-surface-elevated p-1.5 shadow-card scroll-quiet";

/** 보관된 Work — 보관 목록에서 찾는다. 찾을 slug가 없으면(`null`) 목록을 읽지 않는다. */
export function useArchivedWork(slug: string | null): ArchiveEntry | null {
  const { data } = useQuery({ ...archiveQuery(), enabled: slug !== null });
  return data?.find((one) => one.slug === slug) ?? null;
}

/**
 * 보관된 Work의 카드(v1 티켓 38) — 보관 목록의 그 Work와 보관된 spec 트리로 선다. 보관은 worktree를 거두므로(core `archive_work`) 변경 ·
 * PR은 읽을 것이 없고, 쓰는 중도 없다. 보관 목록에서 찾지 못하면 서지 않는다.
 */
export function ArchivedWorkCard({ slug }: { slug: string }) {
  const entry = useArchivedWork(slug);
  const { data: docs } = useArchivedDocs(entry ? slug : null);
  if (!entry) return null;
  return <ArchivedCard entry={entry} docs={docs ? docRows(docs.specTree, []) : []} />;
}

/**
 * 보관된 카드의 몸(보드 「보관된 Work」) — 머리는 보관 글리프 · 이름 · 「보관됨 · 날짜」이고 누르는 자리가 아니다(⋯도 없다). 칸은 더하기
 * 없이 선다. **훅을 부르지 않는다** — 정적 마크업으로 잰다. 보관한 날을 모르면(손으로 옮긴 폴더) 「보관됨」만이다.
 */
export function ArchivedCard({ entry, docs }: { entry: ArchiveEntry; docs: DocRow[] }) {
  const title = entry.title || entry.slug;
  const day = archivedDayText(entry.archivedAt);
  return (
    <section aria-label={`Work 카드: ${title}`} className={CARD}>
      <div className="flex min-h-11.5 items-center gap-2.5 py-1 pr-0.5 pl-2.5">
        <Archive className="size-4 shrink-0 text-fg-secondary" aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-semibold">{title}</span>
          <span className="truncate text-xs text-fg-tertiary">{day ? `보관됨 · ${day}` : "보관됨"}</span>
        </span>
      </div>
      <WorkCardSections docs={docs} changes={null} fresh={NOTHING_FRESH} flash={0} projects={[]} prs={[]} onOpenPr={() => {}} />
    </section>
  );
}

const NOTHING_FRESH: ReadonlySet<string> = new Set();

/**
 * 변경 칸의 자료 — 읽은 답과, 앞 답과 견준 새로 바뀐 파일(`freshFiles`). 빛남은 답이 바뀔 때마다 한 번이다 — 그 답의 회차(`flash`)를
 * 줄의 열쇠에 넣어 같은 파일이 다시 바뀌면 다시 빛난다.
 */
function useChanges(slug: string): { summary: ChangeSummary | null; fresh: ReadonlySet<string>; flash: number } {
  // 창 포커스는 앱 루트가 워크트리 데이터째 다시 읽게 한다(`refreshAllWorktrees`) — 쿼리 스스로는 읽지 않는다(두 번 읽지 않게).
  const { data } = useQuery({
    queryKey: workChangesKey(slug),
    queryFn: () => worksApi.changes(slug),
    refetchOnWindowFocus: false,
  });
  const before = useRef<{ slug: string; data: ProjectChanges[] } | null>(null);
  const [lit, setLit] = useState<{ fresh: ReadonlySet<string>; flash: number }>({ fresh: new Set(), flash: 0 });
  useEffect(() => {
    if (!data) return;
    const was = before.current?.slug === slug ? before.current.data : undefined;
    before.current = { slug, data };
    const fresh = freshFiles(was, data);
    if (fresh.size > 0) setLit((now) => ({ fresh, flash: now.flash + 1 }));
  }, [data, slug]);
  return { summary: data ? changeSummary(data) : null, ...lit };
}

/**
 * 카드 머리(보드 `.wc-h`) — 폴더 · 이름(14/600) · 브랜치(고정폭) · Thread 수, 오른쪽 끝에 ⋯. 머리 전체가 누르는 자리이고(보드
 * `.btnish` — 트리거의 `::after`가 머리를 덮고 ⋯만 그 위에 선다), 누르면 이 Work의 Thread 목록과 「이 Work에서 새 Thread」가 열린다
 * (스토리 111). 메뉴가 열린 동안 머리가 켜진 면이다. 고정폭 브랜치는 보드의 11.5가 DS 글자 단계에 없어 머리 줄 Work 알약처럼
 * `text-2xs`다 — 12로 두면 「fix/session-expiry · Thread 1개」가 머리 폭(212)을 넘친다.
 */
function CardHead({
  work,
  thread,
  threads,
  onNewThread,
}: {
  work: WorkView;
  thread: string;
  threads: readonly ThreadSummary[];
  onNewThread: () => void;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const flows = useWorkMenuFlows();
  // 이름 바꾸기는 이 카드의 메뉴에 없다(§15 — 터미널로 열기 · 보관 · Finder ▸ · 복사 ▸).
  const actions = flows.actionsFor(work, () => {});
  return (
    <div
      className={cn(
        "relative flex min-h-11.5 items-center gap-2.5 rounded-lg py-1 pr-0.5 pl-2.5 transition-colors has-[[data-head]:hover]:bg-fill-hover",
        open && "bg-fill-hover",
      )}
    >
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger
          data-head=""
          aria-label={`이 Work의 Thread: ${work.title}`}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg text-left focus-ring after:absolute after:inset-0"
        >
          <Folder className="size-4 shrink-0 text-fg-secondary" aria-hidden />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-sm font-semibold">{work.title || work.slug}</span>
            <span className="truncate text-xs text-fg-tertiary">
              {work.branch && (
                <>
                  <span className="font-mono text-2xs">{work.branch}</span>
                  {" · "}
                </>
              )}
              Thread {threads.length}개
            </span>
          </span>
        </DropdownMenuTrigger>
        <DropdownMenuContent aria-label="이 Work의 Thread">
          {threads.map((one) => (
            <ThreadItem
              key={one.id}
              summary={one}
              current={one.id === thread}
              onOpen={() => void navigate({ to: "/threads/$id", params: { id: one.id } })}
            />
          ))}
          {threads.length > 0 && <DropdownMenuSeparator />}
          <DropdownMenuItem onClick={onNewThread} className="text-fg-secondary">
            <Plus />
            <span className="min-w-0 flex-1 truncate">이 Work에서 새 Thread</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <Hint
          text="Work 메뉴"
          announce="name"
          disabled={flows.busy}
          render={
            <DropdownMenuTrigger
              disabled={flows.busy}
              className="icon-button relative text-fg-secondary transition-colors quiet-hover focus-ring disabled:pointer-events-none disabled:opacity-50"
            />
          }
        >
          <MoreHorizontal className="size-4" />
        </Hint>
        <DropdownMenuContent align="end">
          {/* 지금 Work 화면(`/works/<slug>`) — 그 Work의 셸 탭이 서는 자리다(스토리 119). */}
          <DropdownMenuItem onClick={() => void navigate({ to: "/works/$slug", params: { slug: work.slug }, search: {} })}>
            <SquareTerminal />
            <span className="min-w-0 flex-1 truncate">터미널로 열기</span>
          </DropdownMenuItem>
          <FinderSubmenu work={work} actions={actions} />
          <CopySubmenu work={work} actions={actions} />
          <DropdownMenuSeparator />
          {/* 지금의 보관 흐름(확인 창 · 셸 거두기)을 그대로 부른다(§11 「보관」). */}
          <DropdownMenuItem onClick={actions.archive}>
            <Archive />
            <span className="min-w-0 flex-1 truncate">보관</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * 머리 메뉴의 Thread 한 줄(보드 「머리를 누름」) — 지금 Thread에 ✓와 「지금」, 다른 Thread는 마지막 말의 때(없으면 선 때)다. 기록은
 * 사이드바가 이미 읽어 둔 것이다(`threadRecordStore`).
 */
function ThreadItem({ summary, current, onOpen }: { summary: ThreadSummary; current: boolean; onOpen: () => void }) {
  const lines = useStore(threadRecordStore, (state) => linesOf(state, summary.id));
  const at = lastSaid(lines)?.at ?? summary.createdAt;
  return (
    <DropdownMenuItem onClick={current ? undefined : onOpen} aria-current={current ? "page" : undefined}>
      {current ? <Check /> : <span aria-hidden className="size-3.75 shrink-0" />}
      <span className="min-w-0 flex-1 truncate">{summary.title || "새 Thread"}</span>
      <span className="shrink-0 text-xs text-fg-tertiary">{current ? "지금" : since(at, Date.now())}</span>
    </DropdownMenuItem>
  );
}

interface SectionsProps {
  docs: DocRow[];
  changes: ChangeSummary | null;
  /** 새로 바뀐 파일(`fileKey`) — 그 줄이 잠깐 빛난다. */
  fresh: ReadonlySet<string>;
  /** 빛남의 회차 — 바뀐 답마다 오른다. */
  flash: number;
  projects: ProjectRow[];
  prs: PrRow[];
  /** 더하기 둘 — 받지 않으면 그 더하기가 서지 않는다(보관된 Work, v1 티켓 38). */
  onAddDoc?: () => void;
  onAttachProject?: () => void;
  onOpenPr: (row: PrRow) => void;
}

/**
 * 카드의 칸들 — 문서 · 변경 · Project · PR 차례다(§15). **훅을 부르지 않는다** — 정적 마크업으로 칸의 모양을 잰다. 비어 있는 칸은
 * 없다: 문서가 없으면 문서 칸이, 바뀐 파일이 없으면 변경 칸이, PR이 없으면 PR 줄이 서지 않는다. Project 칸만은 Project가 없어도
 * 「Project 붙이기」 한 줄로 선다(보드 「막 만든 Work」 — 고칠 곳이 정해지면 붙인다). 붙일 수 없으면(보관됨) 그 칸도 서지 않는다.
 */
export function WorkCardSections({ docs, changes, fresh, flash, projects, prs, onAddDoc, onAttachProject, onOpenPr }: SectionsProps) {
  const many = (changes?.groups.length ?? 0) > 1;
  return (
    <>
      {docs.length > 0 && (
        <Section name="문서" end={onAddDoc && <AddButton label="문서 추가" onClick={onAddDoc} />}>
          {docs.map((doc) => (
            <Row key={doc.path} data-doc={doc.path} icon={<FileText />} name={doc.path}>
              {doc.writer && (
                <>
                  <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent-solid writing-pulse" />
                  {writerLine(doc.writer.name)}
                </>
              )}
            </Row>
          ))}
        </Section>
      )}
      {changes && (
        <Section name="변경" end={<Counts additions={changes.additions} deletions={changes.deletions} className="pr-2" />}>
          {changes.groups.map((group) => (
            <div key={group.project} className="flex flex-col">
              {/* Project가 여럿일 때만 Project마다 머리 줄이 선다(보드 「Project가 셋」). */}
              {many && (
                <div className="flex h-6.5 items-center gap-1.5 px-2.5 text-xs text-fg-secondary">
                  <span className="min-w-0 truncate">{group.project}</span>
                  <Counts additions={group.additions} deletions={group.deletions} className="ml-auto" />
                </div>
              )}
              {group.files.map((file) => {
                const key = fileKey(group.project, file.path);
                const lit = fresh.has(key);
                return (
                  <Row
                    key={lit ? `${key}\u0000${flash}` : key}
                    data-change={file.path}
                    data-fresh={lit ? "" : undefined}
                    icon={<File />}
                    name={file.path.slice(file.path.lastIndexOf("/") + 1)}
                    title={file.path}
                    className={cn(lit && "row-flash")}
                  >
                    <Counts additions={file.additions} deletions={file.deletions} />
                  </Row>
                );
              })}
            </div>
          ))}
        </Section>
      )}
      {(projects.length > 0 || onAttachProject) && (
        <Section
          name="Project"
          end={projects.length > 0 && onAttachProject && <AddButton label="Project 붙이기" onClick={onAttachProject} />}
        >
          {projects.length === 0 ? (
            <button
              type="button"
              onClick={onAttachProject}
              className="flex h-7.5 w-full items-center gap-2 rounded-md px-2.5 text-left text-chat-meta text-fg-tertiary transition-colors quiet-hover focus-ring"
            >
              <Plus className="size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1 truncate">Project 붙이기</span>
            </button>
          ) : (
            projects.map((project) => (
              <Row key={project.project} data-project={project.project} icon={<Folder />} name={project.project}>
                {project.editing ? "고치는 중" : "읽기만"}
                <ChevronRight aria-hidden className="-mr-0.5 size-3 text-fg-tertiary" />
              </Row>
            ))
          )}
        </Section>
      )}
      {prs.length > 0 && (
        <div className="flex flex-col border-t-[0.5px] border-border pt-1.5">
          {prs.map((pr) => (
            <button
              key={`${pr.project}\u0000${pr.number}`}
              type="button"
              onClick={() => onOpenPr(pr)}
              className="flex h-7.5 w-full items-center gap-2 rounded-md px-2.5 text-left text-chat-meta transition-colors hover:bg-fill-hover focus-ring"
            >
              <GitPullRequest className="size-4 shrink-0 text-fg-tertiary" aria-hidden />
              <span className="min-w-0 flex-1 truncate">PR #{pr.number}</span>
              <span className={cn("shrink-0 text-xs text-fg-tertiary", pr.checking && "chat-shimmer")}>{pr.status}</span>
              <ExternalLink className="size-3 shrink-0 text-fg-tertiary" aria-hidden />
            </button>
          ))}
        </div>
      )}
    </>
  );
}

/** 칸 하나 — 머리 줄(12/18 옅은 글자 · 오른쪽 끝에 더하기나 합계)과 줄들(보드 `.ws` · `.ws-h`). */
function Section({ name, end, children }: { name: string; end?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={name} className="flex flex-col">
      <div className="flex h-7 items-center gap-1.5 pr-0.5 pl-2.5 text-xs text-fg-tertiary">
        <span>{name}</span>
        {end && <span className="ml-auto flex items-center">{end}</span>}
      </div>
      {children}
    </section>
  );
}

/** 칸 머리의 더하기(보드 `.ws-add` — 24 · 옅은 글리프). */
function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Hint
      text={label}
      announce="name"
      type="button"
      onClick={onClick}
      className="icon-button icon-button-xs text-fg-tertiary transition-colors quiet-hover focus-ring"
    >
      <Plus className="size-3.5" />
    </Hint>
  );
}

/** 칸의 줄 하나(보드 `.wr` — 30 · 13/18, 옅은 글리프 16 · 이름 · 오른쪽 끝의 옅은 메타 12/18). */
function Row({
  icon,
  name,
  title,
  className,
  children,
  ...data
}: {
  icon: ReactNode;
  name: string;
  title?: string;
  className?: string;
  children?: ReactNode;
} & Record<`data-${string}`, string | undefined>) {
  return (
    <div
      {...data}
      title={title}
      className={cn(
        "flex h-7.5 items-center gap-2 rounded-md px-2.5 text-chat-meta [&>svg:first-child]:size-4 [&>svg:first-child]:shrink-0 [&>svg:first-child]:text-fg-tertiary",
        className,
      )}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{name}</span>
      {children && <span className="flex shrink-0 items-center gap-1.5 text-xs text-fg-tertiary">{children}</span>}
    </div>
  );
}

/**
 * +/− 숫자(보드 `.add` · `.del`) — 0인 쪽은 적지 않는다(보드 「schema.prisma +4」). 셀 수 없는 파일(`null` — 바이너리 · 너무 큰 새
 * 파일)은 아무 숫자도 없다. 빼기는 마이너스 글자(−)다.
 */
function Counts({
  additions,
  deletions,
  className,
}: {
  additions: number | null;
  deletions: number | null;
  className?: string;
}) {
  if (!additions && !deletions) return null;
  return (
    <span className={cn("flex shrink-0 items-center gap-1 text-xs", className)}>
      {!!additions && <span className="text-diff-added">+{additions}</span>}
      {!!deletions && <span className="text-diff-deleted">−{deletions}</span>}
    </span>
  );
}

/**
 * 위 막대의 카드 버튼(보드 「열고 닫기」 — 막대 오른쪽 끝, 열리면 켜진 면). Work 없는 Thread에는 서지 않는다(스토리 114 — 부르는 쪽이
 * 가린다). 이름이 할 일을 말하고(「Work 카드 열기 · 닫기」) 눌림은 `aria-pressed`가 말한다.
 */
export function WorkCardToggle({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    <Hint
      text={open ? "Work 카드 닫기" : "Work 카드 열기"}
      announce="name"
      type="button"
      aria-pressed={open}
      onClick={onToggle}
      className={cn(
        "icon-button transition-colors focus-ring",
        open ? "toggle-on" : "text-fg-secondary quiet-hover",
      )}
    >
      <PanelRight className="size-4" />
    </Hint>
  );
}

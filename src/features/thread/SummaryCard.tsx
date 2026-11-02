import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Archive,
  CircleAlert,
  createLucideIcon,
  ExternalLink,
  File,
  FileText,
  Folder,
  GitMerge,
  GitPullRequest,
  GitPullRequestClosed,
  MoreHorizontal,
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
import { archiveQuery, useArchivedDocs } from "@/features/archive/hooks";
import type { ArchiveEntry } from "@/features/archive/types";
import { workChangesKey } from "@/features/files/hooks";
import { useReadingScope } from "@/features/services/hooks";
import { worksApi } from "@/features/works/api";
import { useWorks } from "@/features/works/hooks";
import { CopySubmenu, FinderSubmenu } from "@/features/works/WorkMenuItems";
import { useWorkMenuFlows } from "@/features/works/work-menu-actions";
import type { ProjectChanges, WorkView } from "@/features/works/types";
import type { CodeTarget } from "@/features/terminal/shell-registry";
import { workWritingStore, writingOf } from "./thread-store";
import type { DocWriting } from "./types";
import {
  changesTarget,
  changeSummary,
  docRows,
  fileKey,
  finishedDocs,
  freshFiles,
  prRows,
  sourceProjects,
  summarySections,
  workPrsKey,
  type ChangeSummary,
  type PrRow,
  type SourceRow,
  type SummarySection,
} from "./summary-card";
import { isOpened, type Opened, type RowTarget } from "./expanded";
import { ExpandedViewer } from "./ExpandedViewer";
import { motionMs } from "./motion";

// **요약 카드**(02 구현 스펙 §7 · 캔버스 SummarySheet · Summary · MainSummary 보드 — v1 Work 카드를 바꿨다) — 채팅 본문 판의 오른쪽 위에
// 위 · 오른쪽 8 띄워 떠 있는 300 폭 카드다. **높이는 내용만큼이다**(판 높이를 넘으면 그 안에서 구른다). 겉은 앱 틀의 카드와 같은 둥글기
// 8(`radius-card`) · 0.5 링에 띄운 그림자(`shadow-sheet` = `shadow-hairline` + `shadow-summary`)다(SummarySheet 규격 — 한때 둥글기 15 ·
// 0.5 테두리 #dadadb).
//
//   머리(Work 이름 13 `fg-secondary` · 「…」 = Work 메뉴)       ← Work에 이은 Thread만
//   「변경 사항」(± 글리프 · 끝에 +a −d) · 그 아래 PR 줄         ← Work에 이은 Thread만
//   ──
//   소스 / spec 문서 · Project(고치는 중 · 읽기만) — 셋을 넘으면 「모두 보기」(S21) · 쓰는 중인 문서는 맨 위
//
// - **세 갈래다** — Work에 이은 Thread(`WorkSummaryCard`), 보관된 Work의 Thread(`ArchivedSummaryCard` — 머리에 「보관됨」, 「…」 없이
//   보이기만), Work 없는 Thread(`LooseSummaryCard` — 소스만). 지워진 Work의 Thread에는 카드가 없다(v1 그대로).
// - **줄은 사이드바 · 패널과 같은 크기다**(SummarySheet 규격 「줄」 · 보드 `.ra-sumrow`) — 높이 30 · 글자 13 · 아이콘 15(16 칸 가운데
//   `fg-secondary`) · 사이 10 · 좌우 16, 끝 말은 12 `fg-tertiary`. 칸 머리(Work 이름 · 「소스」)는 38 · 13 `fg-secondary`, 칸 사이 선은 0.5
//   `border-heavy` · 좌우 16 · 위아래 6이다.
// - **소스의 Project는 읽는 범위다**(03 §7 · §2) — Work에 이은 Thread는 worktree가 선 Project(고치는 중) 뒤에 범위의 Project(읽기만), Work
//   없는 Thread는 범위의 Project뿐이다(`sourceProjects`). 범위는 core의 함수 하나가 세어 Session의 자리 · 머리말과 같은 값이다.
// - 칸을 짓는 것은 순수 함수(`summary-card.ts`의 `summarySections`)이고, 그리는 조각(`SummaryBody`)은 훅을 부르지 않는다 — 정적 마크업으로
//   잰다(`SummaryCard.test.tsx`).
// - **자료는 v1의 명령에 범위 명령 하나를 더해 읽는다**(`reading_scope` — 03) — 변경은 카드가 열릴 때와 `worktree:changed`마다(앱 루트의 감시 배선), PR은 열릴 때와
//   열린 동안 60초마다(엔진이 턴 끝에 남긴 `pr` 줄이 그 칸을 고친다 — v1 티켓 36), 쓰는 중은 엔진의 `work:writing`(`workWritingStore`),
//   소스의 Project는 범위 명령(`reading_scope` — Service · 등록부 · Work의 변화와 범위를 바꾼 기록 줄마다 다시 읽는다)이다.
// - **줄을 누르면 넓힌 카드다**(v1 티켓 35) — 「변경 사항」은 바뀐 첫 파일의 diff를, 소스의 문서는 문서 보기를, Project는 그 파일 트리를
//   연다. 넓힌 카드는 **같은 카드가 넓어진 것이다**(`SummaryCard` — 한 상자라 넓어지고 접혀도 새로 서지 않는다): 왼쪽 끝이 480까지,
//   높이가 판 끝까지 자라고 몸이 왼쪽 목록(264 · 오른쪽 0.5 선 — 「변경 사항」 아래에 바뀐 파일마다 줄이 서고 소스가 모두 선다)으로
//   좁아지며, 오른쪽에 그 파일의 보기(`ExpandedViewer`)가 옅음에서 선다(Motion 「카드가 넓어진다」 — 500ms spring 한 박자). 보기의 ×가
//   요약 카드로 돌린다. 카드 자리 · 대화 폭 · 사이드바 접기는 `ThreadScreen`이 든다. 넓힌 카드는 Work의 worktree · spec 폴더를 읽어 Work에
//   이은 Thread에만 선다 — 보관된 Work · Work 없는 Thread의 줄은 보이기만 한다.
// - **걷은 것** — 머리를 누르면 열리던 이 Work의 Thread 목록(S16 — 사이드바 Work 줄 펼치기가 그 길이다), 머리의 브랜치(넓힌 카드
//   diff 머리로) · Thread 수, 칸 머리의 더하기(문서 추가 · Project 붙이기 — S19), 「결과물」 칸과 누를 수 없는 「파일 또는 문서 만들기」
//   자리표시(restart 02b-8 · SummarySheet 규격).

/** 카드가 열린 동안 PR을 다시 읽는 간격(v1 §12 「카드가 열려 있는 동안 60초마다」). */
const PR_EVERY = 60_000;

/**
 * 요약 카드의 상자(보드 `.ra-sum` · `.ra-sumlist`) — 작은 카드든 넓힌 카드든 **한 상자다**. 넓어지면 높이가 판 끝까지 자라고(`min-height`
 * 0 → 100%) 목록이 카드 폭 그대로에서 왼쪽 264(`size-list`)로 좁아진다 — 둘 다 늘 길이라 카드 자리와 한 박자(500ms spring — Motion
 * 「카드가 넓어진다」)로 옮겨 간다. 폭은 카드 자리를 그대로 채운다(작은 카드면 자리가 300이다 — `ThreadScreen`의 `CardRoom`). 판 높이를
 * 넘으면 목록이 그 안에서 구른다. 동작 줄이기에서는 곧바로 바뀐다.
 */
function SummaryCard({ view, children }: { view?: ReactNode; children: ReactNode }) {
  const wide = view !== undefined;
  return (
    <section
      aria-label="요약"
      data-expanded={wide ? "" : undefined}
      className={cn(
        "pointer-events-auto flex max-h-full w-full overflow-hidden rounded-card bg-surface shadow-sheet",
        "transition-[min-height] duration-panel-open ease-spring motion-reduce:transition-none",
        wide ? "min-h-full" : "min-h-0",
      )}
    >
      <div
        className={cn(
          "flex min-w-0 flex-col overflow-y-auto pt-1 pb-2 scroll-quiet",
          "transition-[width] duration-panel-open ease-spring motion-reduce:transition-none",
          wide ? "w-(--size-list) flex-none border-r-[0.5px] border-border-heavy" : "w-full flex-auto",
        )}
      >
        {children}
      </div>
      {view}
    </section>
  );
}

interface WorkSummaryProps {
  /**
   * 지금 Thread — 소스의 Project는 이 Thread의 읽는 범위다. 없으면(작업공간의 새 채팅 탭 — 아직 채팅이 없다, restart 02a-11) 그 작업공간의
   * 읽는 범위다.
   */
  thread?: string;
  /** 넓힌 카드의 문서 인용이 가는 입력창의 글 열쇠 — 채팅은 그 채팅 id, 새 채팅 탭은 그 탭의 열쇠(`newChatKey`)다. */
  draftKey: string;
  slug: string;
  /** 「이 작업공간에서 새 채팅」(머리 「…」). */
  onNewThread: () => void;
  /** 넓힌 카드가 연 것(v1 티켓 35) — 없으면 작은 카드다. */
  opened: Opened | null;
  /** 줄 · 트리 · 문서 링크가 파일을 열었다 — 카드가 넓어져(이미 넓으면 그대로) 그것을 본다. */
  onOpen: (next: Opened) => void;
  /** Project 트리에서 바뀌지 않은 파일을 눌렀다 — 파일 탭으로 연다(restart 02a-12). */
  onOpenFile: (target: CodeTarget) => void;
  /** 보기의 ×(「카드로 접기」) — 작은 카드로 돌아온다. */
  onClose: () => void;
}

/**
 * Work에 이은 Thread의 요약 카드 — 그 Work를 목록에서 찾지 못하면(보관 · 지움 · 아직 읽는 중) 서지 않는다. 넓으면(`opened`) 몸이 왼쪽
 * 목록이 되고 오른쪽에 그 파일의 보기가 선다.
 */
export function WorkSummaryCard({ thread, draftKey, slug, onNewThread, opened, onOpen, onOpenFile, onClose }: WorkSummaryProps) {
  const { data: works } = useWorks();
  const work = works?.find((one) => one.slug === slug) ?? null;
  const changes = useChanges(slug);
  // PR은 카드가 열릴 때(마운트)와 열린 동안 60초마다 읽는다 — 창 포커스마다 `gh`를 부르지 않는다. 처음 보인 PR · 상태 변화는 엔진이 그
  // Work의 Thread에 `pr` 줄로 남기고 그 줄이 이 쿼리의 칸을 고친다(`followRecordLine`). react-query는 앞 읽기가 돌면 다음을 띄우지 않는다.
  const { data: prs } = useQuery({
    queryKey: workPrsKey(slug),
    queryFn: () => worksApi.prs(slug),
    refetchOnWindowFocus: false,
    refetchInterval: PR_EVERY,
  });
  const writing = useStore(workWritingStore, (state) => writingOf(state, slug));
  const written = useWritten(writing, slug);
  const { data: scope } = useReadingScope(thread === undefined ? { work: slug } : { thread });
  const [unfolded, setUnfolded] = useState(false);
  if (!work) return null;
  const target = changesTarget(changes.summary, work.projects);
  const expanded = opened !== null;
  return (
    <SummaryCard
      view={
        opened === null ? undefined : (
          <ExpandedViewer
            draftKey={draftKey}
            work={work}
            opened={opened}
            changes={changes.summary}
            onOpen={onOpen}
            onOpenFile={onOpenFile}
            onClose={onClose}
          />
        )
      }
    >
      <SummaryBody
        sections={summarySections({
          work: { title: work.title || slug, archived: false },
          changes: changes.summary,
          prs: prRows(prs ?? [], Date.now()),
          docs: docRows(work.specTree, writing),
          projects: sourceProjects(scope, work),
          raised: written.raised,
        })}
        menu={<WorkMenu work={work} onNewThread={onNewThread} />}
        changes={changes.summary}
        fresh={changes.fresh}
        written={written.lit}
        expanded={expanded}
        unfolded={unfolded}
        onUnfold={() => setUnfolded(true)}
        opened={opened}
        onChanges={target ? () => onOpen(target) : undefined}
        // Project 줄은 그 트리를 연다.
        onOpen={onOpen}
        onOpenPr={(row) => void openUrl(row.url)}
      />
    </SummaryCard>
  );
}

/** 보관된 Work — 보관 목록에서 찾는다. 찾을 slug가 없으면(`null`) 목록을 읽지 않는다. */
export function useArchivedWork(slug: string | null): ArchiveEntry | null {
  const { data } = useQuery({ ...archiveQuery(), enabled: slug !== null });
  return data?.find((one) => one.slug === slug) ?? null;
}

/**
 * 보관된 Work의 Thread의 요약 카드(02 §7 · v1 티켓 38) — 같은 요약 카드이고 머리 Work 이름 뒤에 「보관됨」이 붙는다. 「…」에는 지금 보관
 * 카드의 항목만 두는데 그것이 없어(「다시 열기」는 짓지 않는다 — v1 S25) 「…」가 서지 않는다. 보관은 worktree를 거두므로(core
 * `archive_work`) 변경 · PR은 읽을 것이 없고 쓰는 중도 없다 — 「변경 사항」 · 소스(보관된 spec 트리의 문서 · 그때의 Project)는 보이기만
 * 한다. 보관 목록에서 찾지 못하면 서지 않는다.
 */
export function ArchivedSummaryCard({ slug }: { slug: string }) {
  const entry = useArchivedWork(slug);
  const { data: docs } = useArchivedDocs(entry ? slug : null);
  const [unfolded, setUnfolded] = useState(false);
  if (!entry) return null;
  return (
    <SummaryCard>
      <SummaryBody
        sections={summarySections({
          work: { title: entry.title || entry.slug, archived: true },
          changes: null,
          prs: [],
          docs: docs ? docRows(docs.specTree, []) : [],
          // 보관은 worktree를 거둬 그 Project는 고치지도 읽지도 않는다 — 줄 끝 말이 없다(SummarySheet 「보관된 작업공간」).
          projects: entry.projects.map((project) => ({ project, editing: null })),
        })}
        {...STILL}
        unfolded={unfolded}
        onUnfold={() => setUnfolded(true)}
      />
    </SummaryCard>
  );
}

/**
 * Work 없는 Thread의 요약 카드(02 §7 · S20 · SummarySheet 「작업공간 밖 채팅」) — 머리 · 변경 사항 없이 소스만이다(Codex의 프로젝트 없는
 * 채팅). 소스는 이 Thread의 읽는 범위(03 §7)이고 끝은 「읽기만」이다. 넓어지지 않는다 — 넓힌 카드(파일 트리)는 Work의 worktree를 읽어
 * 여기서는 줄이 보이기만 한다.
 */
export function LooseSummaryCard({ thread }: { thread: string }) {
  const { data: scope } = useReadingScope({ thread });
  const [unfolded, setUnfolded] = useState(false);
  return (
    <SummaryCard>
      <SummaryBody
        sections={summarySections({
          work: null,
          changes: null,
          prs: [],
          docs: [],
          projects: sourceProjects(scope, null),
        })}
        {...STILL}
        unfolded={unfolded}
        onUnfold={() => setUnfolded(true)}
      />
    </SummaryCard>
  );
}

/**
 * 잠깐 빛나는 것 — 빛날 열쇠들과 그 회차다. 회차는 바뀐 답마다 올라 줄의 열쇠에 든다 — 같은 것이 다시 바뀌면 다시 빛난다. 새로 바뀐 파일
 * (`useChanges` — 열쇠는 `fileKey`)과 막 쓴 문서(`useWritten` — spec 기준 경로)가 같은 꼴이라 한 벌로 다닌다(02 코드 리뷰 냄새 — 한때
 * 열쇠와 회차가 따로 넘어가 몸의 props가 넷이었다).
 */
interface Lit {
  keys: ReadonlySet<string>;
  flash: number;
}

/** 빛나는 것이 없다 — 처음 읽기 전 · 보이기만 하는 카드. */
const UNLIT: Lit = { keys: new Set(), flash: 0 };

/**
 * 보이기만 하는 카드의 몸(보관된 Work · Work 없는 Thread) — 변경 · PR · 빛남 · 넓힌 카드가 없다. 두 카드가 같은 빈 값을 따로 적지 않게 한
 * 벌이다(02 코드 리뷰 냄새). 「모두 보기」 펼침만 카드가 든다.
 */
const STILL = {
  changes: null,
  fresh: UNLIT,
  written: UNLIT,
  expanded: false,
  opened: null,
  onOpenPr: () => {},
} as const satisfies Partial<BodyProps>;

/**
 * 변경의 자료 — 읽은 답과, 앞 답과 견준 새로 바뀐 파일(`freshFiles`). 빛남은 답이 바뀔 때마다 한 번이다 — 그 답의 회차(`flash`)를 줄의
 * 열쇠에 넣어 같은 파일이 다시 바뀌면 다시 빛난다.
 */
function useChanges(slug: string): { summary: ChangeSummary | null; fresh: Lit } {
  // 창 포커스는 앱 루트가 워크트리 데이터째 다시 읽게 한다(`refreshAllWorktrees`) — 쿼리 스스로는 읽지 않는다(두 번 읽지 않게).
  const { data } = useQuery({
    queryKey: workChangesKey(slug),
    queryFn: () => worksApi.changes(slug),
    refetchOnWindowFocus: false,
  });
  const before = useRef<{ slug: string; data: ProjectChanges[] } | null>(null);
  const [fresh, setFresh] = useState<Lit>(UNLIT);
  useEffect(() => {
    if (!data) return;
    const was = before.current?.slug === slug ? before.current.data : undefined;
    before.current = { slug, data };
    const keys = freshFiles(was, data);
    if (keys.size > 0) setFresh((now) => ({ keys, flash: now.flash + 1 }));
  }, [data, slug]);
  return { summary: data ? changeSummary(data) : null, fresh };
}

/** 올라온 문서가 없다. */
const NONE: ReadonlySet<string> = new Set();

/**
 * 막 쓴 문서(`finishedDocs`) — 쓰는 중 목록이 바뀔 때마다 앞 목록과 견준다. 빛남의 회차는 `useChanges`와 같은 규칙이다.
 *
 * **빛나는 동안은 소스 맨 위에 남는다**(`raised` — SummarySheet 보드의 `litDoc`). 쓰는 중이라 맨 위에 있던 문서가 쓰기를 마친 순간
 * 제자리(「모두 보기」 뒤일 수 있다)로 내려가면 빛이 보이지 않는다. 빛의 길이(`--duration-flash`)가 지나면 내려간다 — 토큰을 문서에서
 * 읽는다(`motionMs`). 다음 막 쓴 문서가 오면 그 문서로 갈아 다시 잰다.
 */
function useWritten(writing: readonly DocWriting[], slug: string): { lit: Lit; raised: ReadonlySet<string> } {
  const before = useRef<{ slug: string; writing: readonly DocWriting[] } | null>(null);
  const [lit, setLit] = useState<Lit>(UNLIT);
  const [raised, setRaised] = useState<ReadonlySet<string>>(NONE);
  const lower = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(lower.current), []);
  useEffect(() => {
    const was = before.current?.slug === slug ? before.current.writing : undefined;
    before.current = { slug, writing };
    const keys = finishedDocs(was, writing);
    if (keys.size === 0) return;
    setLit((now) => ({ keys, flash: now.flash + 1 }));
    setRaised(keys);
    window.clearTimeout(lower.current);
    lower.current = window.setTimeout(() => setRaised(NONE), motionMs("--duration-flash"));
  }, [writing, slug]);
  return { lit, raised };
}

/**
 * 머리의 「…」(보드 `.ra-sumhead .ra-ic-btn` — 24 · 둥글기 8 · 글리프 14 `fg-tertiary`, 가리키면 `fill-hover` 면에 `fg`) — v1 Work 카드 ⋯
 * 메뉴 그대로다(02 §7 · SummarySheet 「⋯ 메뉴 · 지금 Work 메뉴 그대로」): 이 Work에서 새 Thread(v1에서는 머리를 누르면 열리던 메뉴 끝에
 * 있었다) · 터미널로 열기 · Finder에서 열기 ▸ · 복사 ▸ · 보관. 이름 바꾸기는 없다.
 */
function WorkMenu({ work, onNewThread }: { work: WorkView; onNewThread: () => void }) {
  const navigate = useNavigate();
  const flows = useWorkMenuFlows();
  const actions = flows.actionsFor(work, () => {});
  return (
    <DropdownMenu>
      <Hint
        text="작업공간 메뉴"
        announce="name"
        disabled={flows.busy}
        render={
          <DropdownMenuTrigger
            disabled={flows.busy}
            className="icon-button icon-button-xs ml-auto text-fg-tertiary transition-colors quiet-hover focus-ring disabled:pointer-events-none disabled:opacity-50"
          />
        }
      >
        <MoreHorizontal className="size-3.5" />
      </Hint>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onNewThread}>
          <Plus />
          <span className="min-w-0 flex-1 truncate">이 작업공간에서 새 채팅</span>
        </DropdownMenuItem>
        {/* 지금 Work 화면(`/works/<slug>`) — 그 Work의 셸 탭이 서는 자리다. */}
        <DropdownMenuItem onClick={() => void navigate({ to: "/works/$slug", params: { slug: work.slug }, search: {} })}>
          <SquareTerminal />
          <span className="min-w-0 flex-1 truncate">터미널로 열기</span>
        </DropdownMenuItem>
        <FinderSubmenu work={work} actions={actions} />
        <CopySubmenu work={work} actions={actions} />
        <DropdownMenuSeparator />
        {/* 지금의 보관 흐름(확인 창 · 셸 거두기)을 그대로 부른다. */}
        <DropdownMenuItem onClick={actions.archive}>
          <Archive />
          <span className="min-w-0 flex-1 truncate">보관</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface BodyProps {
  sections: SummarySection[];
  /** 머리의 「…」 — 보관된 Work에는 없다. */
  menu?: ReactNode;
  /** Work의 변경 — 넓힌 카드의 목록에서 「변경 사항」 아래 파일 줄이 된다. */
  changes: ChangeSummary | null;
  /** 새로 바뀐 파일(열쇠는 `fileKey`) — 작은 카드에서는 「변경 사항」 줄이, 넓힌 카드에서는 그 파일 줄이 잠깐 빛난다. */
  fresh: Lit;
  /** 막 쓴 문서(열쇠는 spec 기준 경로) — 소스의 그 문서 줄이 잠깐 빛난다. */
  written: Lit;
  /** 넓힌 카드의 목록인가 — 「변경 사항」 아래에 파일 줄이 서고 소스가 모두 선다. */
  expanded: boolean;
  /** 「모두 보기」를 눌렀나 — 나머지 소스가 그 자리에 펴진다(S21). */
  unfolded?: boolean;
  onUnfold?: () => void;
  /** 넓힌 카드가 연 것 — 그 줄이 고른 면으로 선다. 작은 카드면 `null`이다. */
  opened: Opened | null;
  /** 「변경 사항」을 눌렀다 — 받지 않으면 그 줄은 보이기만 한다(보관된 Work · 열 것이 없음). */
  onChanges?: () => void;
  /** 소스 · 파일 줄을 눌렀다 — 받지 않으면 줄은 보이기만 한다(보관된 Work · Work 없는 Thread). */
  onOpen?: (row: RowTarget) => void;
  onOpenPr: (row: PrRow) => void;
}

/**
 * 요약 카드의 몸 — 칸들을 차례로 그린다(`summarySections`). **훅을 부르지 않는다** — 정적 마크업으로 잰다. 구분선은 앞에 칸이 있을 때
 * 소스 앞에 선다(보드 `.ra-sumsep` — Work 없는 Thread의 카드는 「소스」로 시작한다). 머리 바로 아래 「변경 사항」 앞에는 없다.
 *
 * **「모두 보기」를 누르면 그 줄이 걷히고 나머지 소스가 그 자리에서 아래 4에서 선다**(SummarySheet 움직임 「모두 보기」 — `row-in`, 200ms).
 * 넓힌 카드의 목록은 소스가 모두 선 채라 움직이지 않는다. 나머지 소스는 작은 카드 · 넓힌 카드에서 같은 자리에 서서, 카드가 넓어지고
 * 접혀도 새로 서지 않는다 — 들어서는 움직임은 그 줄이 처음 설 때 정해진다(`SourceLine`).
 */
export function SummaryBody({
  sections,
  menu,
  changes,
  fresh,
  written,
  expanded,
  unfolded = false,
  onUnfold,
  opened,
  onChanges,
  onOpen,
  onOpenPr,
}: BodyProps) {
  const sourceRow = (row: SourceRow, late: boolean) => (
    <SourceLine
      key={`${row.kind}\u0000${row.kind === "doc" ? row.path : row.project}`}
      row={row}
      late={late}
      lit={row.kind === "doc" && written.keys.has(row.path)}
      flash={written.flash}
      opened={opened}
      onOpen={onOpen}
    />
  );
  return (
    <>
      {sections.map((section, index) => {
        switch (section.kind) {
          case "head":
            return (
              <div key="head" className={HEAD}>
                <span className="min-w-0 truncate">{section.title}</span>
                {section.archived && <span className="shrink-0 text-xs text-fg-tertiary">보관됨</span>}
                {menu}
              </div>
            );
          case "changes": {
            const lit = !expanded && fresh.keys.size > 0;
            const many = (changes?.groups.length ?? 0) > 1;
            return (
              <div key="changes" className="flex shrink-0 flex-col">
                <Line
                  key={lit ? `changes\u0000${fresh.flash}` : "changes"}
                  data-changes=""
                  glyph={<ChangesGlyph />}
                  name="변경 사항"
                  className={cn(lit && "row-flash")}
                  on={false}
                  onPress={onChanges}
                >
                  <Counts additions={section.additions} deletions={section.deletions} />
                </Line>
                {expanded &&
                  changes?.groups.map((group) => (
                    <Fragment key={group.project}>
                      {/* Project가 여럿일 때만 Project마다 머리 줄이 선다(v1 보드 「Project가 셋」 · 보드 `.ra-sumpj` — 26 · 12 `fg-secondary`). */}
                      {many && (
                        <div className="flex h-6.5 items-center gap-1.5 pr-4 pl-10.5 text-xs text-fg-secondary">
                          <span className="min-w-0 flex-1 truncate">{group.project}</span>
                          <Counts additions={group.additions} deletions={group.deletions} />
                        </div>
                      )}
                      {group.files.map((file) => {
                        const key = fileKey(group.project, file.path);
                        const fileLit = fresh.keys.has(key);
                        const target = { kind: "change", project: group.project, path: file.path } as const;
                        return (
                          <Line
                            key={fileLit ? `${key}\u0000${fresh.flash}` : key}
                            data-change={file.path}
                            data-fresh={fileLit ? "" : undefined}
                            glyph={<File />}
                            name={file.path.slice(file.path.lastIndexOf("/") + 1)}
                            title={file.path}
                            className={cn("pl-10.5", fileLit && "row-flash")}
                            on={isOpened(opened, target)}
                            onPress={onOpen && (() => onOpen(target))}
                          >
                            <Counts additions={file.additions} deletions={file.deletions} />
                          </Line>
                        );
                      })}
                    </Fragment>
                  ))}
                {section.prs.map((pr) => (
                  <PrLine key={`${pr.project}\u0000${pr.number}`} pr={pr} onOpen={() => onOpenPr(pr)} />
                ))}
              </div>
            );
          }
          case "sources": {
            const all = expanded || unfolded;
            return (
              <Fragment key="sources">
                {index > 0 && <Separator />}
                <section aria-label="소스" className="flex shrink-0 flex-col">
                  <div className={HEAD}>소스</div>
                  {/* 읽는 Project가 없는 Work 없는 Thread — 빈 상자 대신 그 사실 한 줄이다(시안 밖 — 02b-8 결정). */}
                  {section.shown.length === 0 && <p className={cn(ROW, "text-fg-tertiary")}>읽는 Project가 없어요</p>}
                  {section.shown.map((row) => sourceRow(row, false))}
                  {all && section.hidden.map((row) => sourceRow(row, !expanded))}
                  {!all && section.hidden.length > 0 && (
                    <button
                      type="button"
                      data-ring-inset=""
                      onClick={onUnfold}
                      className={cn(ROW, "text-fg-tertiary transition-colors hover:text-fg-secondary focus-ring")}
                    >
                      <span className={GLYPH}>
                        <MoreHorizontal />
                      </span>
                      모두 보기
                    </button>
                  )}
                </section>
              </Fragment>
            );
          }
        }
      })}
    </>
  );
}

/** 칸 머리 — Work 이름 · 「소스」(보드 `.ra-sumhead` · `.ra-sumlabel` — 38 · 13 `fg-secondary` · 왼쪽 16 · 오른쪽 10 · 사이 6). */
const HEAD = "flex h-9.5 shrink-0 items-center gap-1.5 pr-2.5 pl-4 text-chat-meta whitespace-nowrap text-fg-secondary";

/** 칸 사이 구분선(보드 `.ra-sumsep` — 0.5 `border-heavy` · 좌우 16 · 위아래 6). */
function Separator() {
  return <div aria-hidden className="mx-4 my-1.5 h-[0.5px] shrink-0 bg-border-heavy" />;
}

/**
 * 소스의 줄 하나 — 문서는 쓰는 중(파란 점 · 「쓰는 중」) · 막 쓴 빛, Project는 끝에 「고치는 중」 · 「읽기만」(12 · `fg-tertiary`). 보관된
 * 작업공간의 Project는 끝 말이 없다. 줄의 글리프는 문서 `FileText`, Project는 앱의 Project 아이콘(`Folder` — 사이드바 「Projects」)이다.
 *
 * `late`는 「모두 보기」로 새로 선 줄인가다 — **처음 설 때의 값을 붙든다**. 그 뒤 카드가 넓어지고 접혀도 클래스가 바뀌지 않아 들어서는
 * 움직임이 다시 돌지 않는다.
 */
function SourceLine({
  row,
  late,
  lit,
  flash,
  opened,
  onOpen,
}: {
  row: SourceRow;
  late: boolean;
  lit: boolean;
  flash: number;
  opened: Opened | null;
  onOpen?: (row: RowTarget) => void;
}) {
  const [arrive] = useState(late);
  const motion = arrive && "row-in";
  if (row.kind === "doc") {
    const target = { kind: "doc", path: row.path } as const;
    return (
      <Line
        key={lit ? `${row.path}\u0000${flash}` : row.path}
        data-doc={row.path}
        glyph={<FileText />}
        name={row.path}
        className={cn(motion, lit && "row-flash")}
        on={isOpened(opened, target)}
        onPress={onOpen && (() => onOpen(target))}
      >
        {row.writer && (
          <>
            <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-accent-solid writing-pulse" />
            쓰는 중
          </>
        )}
      </Line>
    );
  }
  const target = { kind: "project", project: row.project } as const;
  return (
    <Line
      data-project={row.project}
      glyph={<Folder />}
      name={row.project}
      className={cn(motion)}
      on={isOpened(opened, target)}
      onPress={onOpen && (() => onOpen(target))}
    >
      {row.editing === null ? undefined : row.editing ? "고치는 중" : "읽기만"}
    </Line>
  );
}

/**
 * 카드 줄의 겉(보드 `.ra-sumrow` — 30 · 13 `fg` · 사이 10 · 좌우 16) — 줄(`Line`, PR 줄도 그것이다)과 「모두 보기」가 한 벌이다. 면 · 글자색은
 * `duration-basic`으로 옮겨 간다(`transition-colors`).
 */
const ROW = "flex h-7.5 w-full shrink-0 items-center gap-2.5 px-4 text-left text-chat-meta whitespace-nowrap";

/** 줄의 글리프 칸 — 16 칸 가운데 15 · `fg-secondary`(보드 `.ra-sumrow .g`). */
const GLYPH = "flex w-4 shrink-0 justify-center text-fg-secondary [&>svg]:size-3.75";

/**
 * 카드의 줄 하나(보드 `.ra-sumrow`) — 오른쪽 끝에 옅은 메타(12 · `fg-tertiary` · 사이 6 · 고른 너비 숫자). 누르면 넓힌 카드가 그것을
 * 연다 — 이름은 줄의 글 그대로다. 가리키면 `fill-hover`, 넓힌 카드가 연 줄은 고른 면(`selected-row` — `fill-selected`)이다. 누를 곳이
 * 없으면(보관 · Work 없는 Thread · 열 것이 없음) 보이기만 하는 줄이다. 카드 끝까지 차는 줄이라 키보드 링은 안쪽에 선다(`data-ring-inset`).
 */
function Line({
  glyph,
  name,
  title,
  className,
  children,
  on,
  onPress,
  ...data
}: {
  glyph: ReactNode;
  name: string;
  title?: string;
  className?: string;
  children?: ReactNode;
  on: boolean;
  onPress?: () => void;
} & Record<`data-${string}`, string | undefined>) {
  const body = (
    <>
      <span className={GLYPH}>{glyph}</span>
      <span className="min-w-0 flex-1 truncate text-fg">{name}</span>
      {children && <span className="flex shrink-0 items-center gap-1.5 text-xs text-fg-tertiary tabular-nums">{children}</span>}
    </>
  );
  if (!onPress) {
    return (
      <div {...data} title={title} className={cn(ROW, className)}>
        {body}
      </div>
    );
  }
  return (
    <button
      type="button"
      {...data}
      data-ring-inset=""
      title={title}
      aria-current={on ? "true" : undefined}
      onClick={onPress}
      className={cn(ROW, "transition-colors focus-ring", on ? "selected-row" : "hover:bg-fill-hover", className)}
    >
      {body}
    </button>
  );
}

/**
 * PR 줄 하나 — v1 Work 카드의 PR 줄 그대로다(S18 · 보드 `ic-pr` 줄): 글리프 · 「PR #번호」 · 상태 문장 · 바깥 열기, CI가 실패하면 그 아래 실패
 * 문장. 줄은 카드의 줄(`Line`)이다. 끝 메타(상태 12 · 바깥 열기 12)는 줄의 메타 칸에 서고, 둘 사이는 줄의 틈 10이다(메타 칸 틈 6 + 4).
 * 글리프는 줄의 색(`fg-secondary`)이고 CI 실패만 진한 `fg`다(보드 `.g.fail` — 빨강이 아니다).
 */
function PrLine({ pr, onOpen }: { pr: PrRow; onOpen: () => void }) {
  const Icon = PR_ICONS[pr.icon];
  return (
    <>
      <Line
        glyph={<Icon data-pr-icon={pr.icon} className={cn("shrink-0", pr.icon === "failed" && "text-fg")} aria-hidden />}
        name={`PR #${pr.number}`}
        on={false}
        onPress={onOpen}
      >
        <span className={cn("shrink-0", pr.checking && "chat-shimmer")}>{pr.status}</span>
        <ExternalLink className="ml-1 size-3 shrink-0" aria-hidden />
      </Line>
      {/* 무엇이 실패했는지(보드 `.ra-sumnote` — 이름 칸에 맞춰 42 들이고 12/18 `fg-secondary`). */}
      {pr.note && <p className="mr-4 mb-1.5 ml-10.5 text-xs text-pretty text-fg-secondary">{pr.note}</p>}
    </>
  );
}

/** PR 줄의 글리프 — 열린 PR · CI 실패(진한 ⓘ) · 병합됨 · 닫힘. */
const PR_ICONS = { open: GitPullRequest, failed: CircleAlert, merged: GitMerge, closed: GitPullRequestClosed } as const;

/**
 * +/− 숫자 — 0인 쪽은 적지 않는다(v1 「schema.prisma +4」). 셀 수 없는 파일(`null` — 바이너리 · 너무 큰 새 파일)은 아무 숫자도 없다.
 * 빼기는 마이너스 글자(−)다. 12px · 초록 · 빨강 diff 글자(S17). 둘 사이는 줄의 틈 10이다(보드 `.ra-sumrow .add` · `.del`이 줄의 칸).
 */
function Counts({ additions, deletions }: { additions: number | null; deletions: number | null }) {
  if (!additions && !deletions) return null;
  return (
    <span className="flex shrink-0 items-center gap-2.5 text-xs tabular-nums">
      {!!additions && <span className="text-diff-added">+{additions}</span>}
      {!!deletions && <span className="text-diff-deleted">−{deletions}</span>}
    </span>
  );
}

/**
 * 「변경 사항」 글리프 — 시안 `.si`의 ± 네모(16칸: 네모 2.5–13.5 · 둥글기 2.5, 위 + · 아래 −)를 lucide 24칸으로 1.5배 옮겼다. lucide에 같은
 * 모양이 없다. 선 굵기는 앱 기본(`LucideProvider`)을 그대로 받는다(머리 줄 `SummaryGlyph`와 같은 길).
 */
const ChangesGlyph = createLucideIcon("summary-changes", [
  ["rect", { x: "3.75", y: "3.75", width: "16.5", height: "16.5", rx: "3.75", key: "box" }],
  ["path", { d: "M12 7.2v5.7M9.15 10.05h5.7M9.15 16.5h5.7", key: "plus-minus" }],
]);

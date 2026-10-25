import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { shallow, useStore } from "@tanstack/react-store";
import { ArrowLeft, Book, Check, Folder, Layers, MoreHorizontal, Pencil, Plus, TriangleAlert, X } from "lucide-react";
import { PlainFrame } from "@/components/shell/PlainFrame";
import { navItem } from "@/components/shell/nav-items";
import { Button, buttonVariants } from "@/components/ui/button";
import { showProblem } from "@/components/ui/confirm-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { InlineRename } from "@/components/ui/inline-rename";
import { showUndoToast, Toaster } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { addProject } from "@/features/projects/add-store";
import { useProjects } from "@/features/projects/hooks";
import type { ProjectView } from "@/features/projects/types";
import { signalsOf } from "@/features/terminal/shell-attention";
import { terminalStore } from "@/features/terminal/terminal-store";
import { useWorkMarks } from "@/features/thread/hooks";
import { useWorks } from "@/features/works/hooks";
import { workMark } from "@/features/works/work-mark";
import { StatusMark } from "@/components/shell/status-mark";
import { useSpace, useUpdateSpace } from "./hooks";
import { SpaceGraph } from "./SpaceGraph";
import { addMenu, createdLine, spaceName, spaceWorks } from "./space-view";
import type { SpaceDetail as Detail, SpacePatch } from "./types";

// Space 상세(03 구현 스펙 §14 · 시안 F1-SpaceDetail · F4-SpaceEmpty). 머리 줄 「Space / 결제 서비스」, 판 안에 「← Space」 단추 · 제목과
// 만든 이 줄 · 관계 그래프 · 설명 · Project 표, 오른쪽 칸에 「함께 쓰는 Space」. 고치는 일(이름 · 설명 · 넣기 · 빼기)은 모두 core의 글 단위
// 고치기 하나로 그 칸만 바꾼다(`update_space`). 빼면 「되돌리기」 토스트가 잠깐 서고, 누르면 뺀 Project를 제자리에 다시 넣는다.
//
// 관계 그래프의 「편집」과 문제 상자의 「관계 편집에서 고치기」는 그 Space 파일을 글 그대로 고치는 화면(`/spaces/$slug/edit` — 04)으로 간다.
// 오른쪽 칸 「Work」 묶음은 이 Space에 이은 진행 중인 Work 줄이다(05 — 사이드바 Work 줄과 같은 상태 표시, 누르면 그 Work로).
//
// 이 판의 다른 티켓이 더할 자리: 머리 「Host와 고치기」 · 「새 Work」(06), ⋯ 「관계 편집 · 삭제…」(07).

export default function SpaceDetail({ slug }: { slug: string }) {
  const { data: space, isError, error } = useSpace(slug);
  const label = navItem("spaces").label;
  const navigate = useNavigate();
  const goList = () => void navigate({ to: "/spaces" });
  return (
    <PlainFrame
      label={`${label} 상세`}
      lead={<SpaceCrumb onOpen={goList} />}
      title={space ? { name: spaceName(space) } : undefined}
    >
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto px-10 pt-5.5 pb-20 scroll-quiet">
          <div className="mb-5.5 flex items-center gap-2">
            <Link
              to="/spaces"
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-separator-soft bg-surface pr-3.5 pl-2.5 text-sm text-fg transition-colors hover:bg-fill-soft focus-ring"
            >
              <ArrowLeft aria-hidden className="size-3.5 text-fg-icon" />
              {label}
            </Link>
          </div>
          {space ? (
            <SpaceBody key={space.slug} space={space} onOpenSpace={(to) => void navigate({ to: "/spaces/$slug", params: { slug: to } })} />
          ) : (
            isError && <p className="text-sm text-fg-tertiary">Space를 읽지 못했어요 — {String(error)}</p>
          )}
        </div>
        {/* 되돌리기 토스트의 자리 — 본문 왼쪽 아래(시안 `.toast` — 왼 40 · 아래 24). */}
        <Toaster className="bottom-6 left-10 translate-x-0" />
      </div>
    </PlainFrame>
  );
}

/** 머리 줄 이름 앞 「Space /」 — 누르면 목록이다(시안 `.tb-c .muted`). */
function SpaceCrumb({ onOpen }: { onOpen: () => void }) {
  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        className="rounded-md text-sm whitespace-nowrap text-fg-titlebar transition-colors hover:text-fg focus-ring"
      >
        {navItem("spaces").label}
      </button>
      <span aria-hidden className="shrink-0 text-sm text-fg-titlebar">
        /
      </span>
    </>
  );
}

function SpaceBody({ space, onOpenSpace }: { space: Detail; onOpenSpace: (slug: string) => void }) {
  const { data: registered = [] } = useProjects();
  const update = useUpdateSpace();
  // frontmatter가 닫히지 않았거나 YAML로 읽을 수 없으면 고칠 자리를 모른다 — 고치는 단추를 끈다(고치는 길은 관계 편집 — 04).
  const locked = space.problems.some((problem) => problem.kind === "unclosedFrontmatter" || problem.kind === "badYaml");

  const patch = async (change: SpacePatch): Promise<boolean> => {
    try {
      await update.mutateAsync({ slug: space.slug, patch: change });
      return true;
    } catch (e) {
      await showProblem(`Space를 고치지 못했어요: ${e}`);
      return false;
    }
  };
  const add = (project: string) => void patch({ add: [project] });
  const addNew = async () => {
    const view = await addProject();
    if (view) await patch({ add: [view.slug] });
  };
  const drop = async (project: string) => {
    // 되돌리면 제자리로 — 뺀 Project 바로 뒤에 있던 것 앞에 다시 선다(없었으면 끝).
    const next = space.projects[space.projects.indexOf(project) + 1];
    if (!(await patch({ remove: [project] }))) return;
    showUndoToast(`Space에서 뺐어요 — ${project}`, () => void patch({ add: [project], before: next }));
  };
  const menu = addMenu(space, registered);
  const addItems = <AddMenuItems candidates={menu.candidates} allIn={menu.allIn} onAdd={add} onAddNew={() => void addNew()} />;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_270px] items-start gap-12">
      <div className="min-w-0">
        {space.problems.length > 0 && <Problems space={space} />}
        <Title space={space} locked={locked} onRename={(name) => void patch({ name })} />
        <Section
          label="관계"
          aside={space.shared.length > 0 ? `함께 쓰는 Space ${space.shared.length}` : "다른 Space와 겹치지 않아요"}
          end={
            <Link to="/spaces/$slug/edit" params={{ slug: space.slug }} className={buttonVariants({ variant: "ghost", size: "top" })}>
              <Pencil aria-hidden />
              편집
            </Link>
          }
        >
          <SpaceGraph
            space={space}
            shared={space.shared}
            onOpenSpace={onOpenSpace}
            emptyAdd={
              <DropdownMenu>
                <DropdownMenuTrigger disabled={locked} className={buttonVariants({ variant: "outline", size: "top", className: "rounded-full" })}>
                  <Plus aria-hidden />
                  넣기
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-70">{addItems}</DropdownMenuContent>
              </DropdownMenu>
            }
          />
        </Section>
        <Description space={space} locked={locked} onSave={(description) => patch({ description })} />
        <Section
          label="Project"
          aside={String(space.projects.length)}
          after={
            <DropdownMenu>
              <DropdownMenuTrigger disabled={locked} className={buttonVariants({ variant: "ghost", size: "top" })}>
                <Plus aria-hidden />
                넣기
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-70">{addItems}</DropdownMenuContent>
            </DropdownMenu>
          }
        >
          <ProjectTable projects={space.projects} registered={registered} locked={locked} onDrop={(project) => void drop(project)} />
        </Section>
      </div>
      <aside aria-label="Space 정보" className="flex flex-col">
        <section className="pt-1 pb-4">
          <h2 className="mb-2 text-sm text-fg-secondary">함께 쓰는 Space</h2>
          {space.shared.length === 0 ? (
            <p className="text-sm text-fg-secondary">없음</p>
          ) : (
            space.shared.map((other) => (
              <button
                key={other.slug}
                type="button"
                onClick={() => onOpenSpace(other.slug)}
                className="-mx-1.5 flex min-h-8 w-[calc(100%+12px)] items-center gap-2.5 rounded-md px-1.5 text-left text-sm text-fg transition-colors hover:bg-fill-soft focus-ring"
              >
                <Layers aria-hidden className="size-4 shrink-0 text-fg-icon" />
                <span className="min-w-0 truncate">{other.name}</span>
                <span className="ml-auto shrink-0 font-mono text-xs text-fg-tertiary">{other.overlap.join(" · ")}</span>
              </button>
            ))
          )}
        </section>
        <SpaceWorks slug={space.slug} />
      </aside>
    </div>
  );
}

/**
 * 오른쪽 칸의 「Work」 묶음(§14 · 시안 F1-SpaceDetail `.rs`) — 머리 끝에 수, 이 Space에 이은 Work마다 📁 이름과 끝의 상태 표시 하나(사이드바 Work
 * 줄과 같은 것 — 그 Work의 Thread들 가운데 가장 센 것, 조용하면 셸 신호 · `workMark`). 누르면 그 Work 화면이다. 없으면 「아직 없음」.
 */
function SpaceWorks({ slug }: { slug: string }) {
  const { data: works = [] } = useWorks();
  const marks = useWorkMarks();
  const signals = useStore(terminalStore, (state) => signalsOf(state), shallow);
  const linked = spaceWorks(works, slug);
  return (
    // 앞 묶음과 1px 선으로 가르고 위아래 16이다(시안 `.rs` — 첫 묶음만 선 없이 위 4). 머리 끝의 수는 머리와 같은 글자다(`.rl .end`).
    <section aria-label="Work" className="border-t border-separator-soft py-4">
      <h2 className="mb-2 flex items-center text-sm text-fg-secondary">
        Work
        {linked.length > 0 && <span className="ml-auto">{linked.length}</span>}
      </h2>
      {linked.length === 0 ? (
        <p className="text-sm text-fg-secondary">아직 없음</p>
      ) : (
        linked.map((work) => (
          <Link
            key={work.slug}
            to="/works/$slug"
            params={{ slug: work.slug }}
            search={{}}
            data-work={work.slug}
            className="-mx-1.5 flex min-h-8 w-[calc(100%+12px)] items-center gap-2.5 rounded-md px-1.5 text-left text-sm text-fg transition-colors hover:bg-fill-soft focus-ring"
          >
            <Folder aria-hidden className="size-4 shrink-0 text-fg-icon" />
            <span className="min-w-0 truncate">{work.title || work.slug}</span>
            <span className="ml-auto flex shrink-0 items-center">
              <StatusMark kind={workMark(marks[work.slug] ?? [], signals[work.slug] ?? null)} />
            </span>
          </Link>
        ))
      )}
    </section>
  );
}

/** 묶음 하나 — 머리(18/26 이름 · 옅은 곁말 · 끝 칸)와 몸. 묶음 사이는 34다(시안 `.sec2` · `.h2r`). */
function Section({
  label,
  aside,
  before,
  after,
  end,
  children,
}: {
  label: string;
  aside?: string;
  before?: ReactNode;
  after?: ReactNode;
  end?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={label} className="mt-8.5">
      <div className="mb-3 flex min-h-7 items-center gap-2">
        <h2 className="text-heading-sm text-fg">{label}</h2>
        {before}
        {aside !== undefined && <span className="text-chat-meta text-fg-tertiary">{aside}</span>}
        {after}
        {end && <span className="ml-auto flex items-center gap-1.5">{end}</span>}
      </div>
      {children}
    </section>
  );
}

/** 문제가 있는 Space — 상세 위에 문제 줄들(줄 번호 · 말)이 선다. 고치는 길은 관계 편집이다 — 그 줄들이 편집기의 줄 끝에 그대로 선다. */
function Problems({ space }: { space: Detail }) {
  return (
    <section aria-label="문제" className="mb-6 rounded-xl border border-separator-soft px-4 py-3">
      <p className="flex items-center gap-2 text-sm text-danger">
        <TriangleAlert aria-hidden className="size-4 shrink-0" />이 Space 파일에 문제가 있어요
        <Link
          to="/spaces/$slug/edit"
          params={{ slug: space.slug }}
          className="ml-auto rounded-sm text-chat-meta text-link underline-offset-3 hover:underline focus-ring"
        >
          관계 편집에서 고치기
        </Link>
      </p>
      <ul className="mt-1.5 flex flex-col gap-1 pl-6 text-chat-meta text-danger">
        {space.problems.map((problem) => (
          <li key={`${problem.line}:${problem.kind}:${problem.project ?? ""}`}>
            <span className="font-mono">{problem.line}행</span> — {problem.message}
            {problem.project && <span className="font-mono"> ({problem.project})</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 제목(24) · 이름 고치기 연필과 아래 만든 이 줄(시안 `.ttl` · `.meta`). */
function Title({ space, locked, onRename }: { space: Detail; locked: boolean; onRename: (name: string) => void }) {
  const [renaming, setRenaming] = useState(false);
  const created = createdLine(space, new Date());
  return (
    <div>
      <h1 className="flex min-h-8 items-center gap-2.5 text-heading-lg font-medium text-fg">
        {renaming ? (
          <InlineRename
            value={spaceName(space)}
            label="Space 이름"
            emptyMeans="revert"
            fit="text"
            onCommit={onRename}
            onDone={() => setRenaming(false)}
            className="-ml-1 px-1"
          />
        ) : (
          <>
            <span className="min-w-0 truncate">{spaceName(space)}</span>
            <button
              type="button"
              aria-label="이름 바꾸기"
              disabled={locked}
              onClick={() => setRenaming(true)}
              className="rounded-sm p-0.5 text-fg-faint transition-colors hover:text-fg-secondary focus-ring disabled:opacity-40"
            >
              <Pencil aria-hidden className="size-3.5" />
            </button>
          </>
        )}
      </h1>
      <div className="mt-2 flex items-center gap-2 text-sm text-fg-secondary">
        {created.host && (
          <span aria-hidden className="flex size-5.5 items-center justify-center rounded-full bg-fg text-xs text-fg-inverse">
            H
          </span>
        )}
        <span className="text-fg">{created.by}</span>
        {created.when && <span>{created.when}</span>}
        <span aria-hidden>·</span>
        <span>Project {space.projects.length}</span>
      </div>
    </div>
  );
}

/** 설명 — 「Agent가 이 Space에서 일할 때 처음 읽어요」, 연필 → 저장 · 취소 → 「저장했어요」(스토리 150). */
function Description({ space, locked, onSave }: { space: Detail; locked: boolean; onSave: (text: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const save = async () => {
    if (draft === null) return;
    if (await onSave(draft)) {
      setDraft(null);
      setSaved(true);
    }
  };
  return (
    <Section
      label="설명"
      before={
        draft === null && (
          <button
            type="button"
            aria-label="설명 고치기"
            disabled={locked}
            onClick={() => {
              setDraft(space.description);
              setSaved(false);
            }}
            className="rounded-sm p-0.5 text-fg-faint transition-colors hover:text-fg-secondary focus-ring disabled:opacity-40"
          >
            <Pencil aria-hidden className="size-3.5" />
          </button>
        )
      }
      aside="Agent가 이 Space에서 일할 때 처음 읽어요"
    >
      {draft === null ? (
        <>
          <p className={cn("text-chat-body whitespace-pre-wrap", space.description ? "text-fg" : "text-fg-tertiary")}>
            {space.description || "아직 설명이 없어요. 연필을 눌러 적어 두세요."}
          </p>
          {saved && (
            <p role="status" className="mt-2.5 flex items-center gap-1 text-xs text-fg-tertiary">
              <Check aria-hidden className="size-3" />
              저장했어요
            </p>
          )}
        </>
      ) : (
        <>
          <textarea
            // 열자마자 쓴다 — 연필을 누른 손이 곧바로 적는다.
            autoFocus
            rows={4}
            aria-label="설명"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="이 Space에서 다루는 일과 Project들이 어떻게 이어지는지 적어 두세요"
            className="block w-full resize-none rounded-xl border border-border-heavy bg-surface px-3 py-2.5 text-chat-body text-fg outline-none placeholder:text-fg-placeholder focus-ring"
          />
          <div className="mt-2.5 flex items-center justify-end gap-1.5">
            <Button variant="ghost" size="top" onClick={() => setDraft(null)}>
              취소
            </Button>
            <Button size="top" onClick={() => void save()}>
              저장
            </Button>
          </div>
        </>
      )}
    </Section>
  );
}

/**
 * 「넣기」 메뉴의 줄들(스토리 152 · 153) — 「등록된 Project」 머리 아래 아직 묶이지 않은 Project(이름 · 경로), 다 넣었으면 「등록된 Project를
 * 모두 넣었어요」, 구분선 뒤 「새 Project 추가…」.
 */
function AddMenuItems({
  candidates,
  allIn,
  onAdd,
  onAddNew,
}: {
  candidates: readonly ProjectView[];
  allIn: boolean;
  onAdd: (slug: string) => void;
  onAddNew: () => void;
}) {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel>등록된 Project</DropdownMenuLabel>
        {candidates.map((project) => (
          <DropdownMenuItem key={project.slug} onClick={() => onAdd(project.slug)}>
            <Book />
            <span className="shrink-0">{project.name}</span>
            <span className="ml-auto min-w-0 truncate font-mono text-xs text-fg-tertiary">{project.path}</span>
          </DropdownMenuItem>
        ))}
        {allIn && <p className="px-2 py-1.5 text-xs text-fg-tertiary">등록된 Project를 모두 넣었어요</p>}
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem onClick={onAddNew}>
        <Plus />
        <span>새 Project 추가…</span>
      </DropdownMenuItem>
    </>
  );
}

/** 표의 칸 — 이름 · 경로 · 기준 브랜치 · ⋯(시안 `.tr`). */
const ROW = "grid grid-cols-[minmax(0,0.8fr)_minmax(0,1.3fr)_112px_28px] items-center gap-3 px-1";

/**
 * 묶인 Project의 표(스토리 151 · 156) — 이름 · 경로 · 기준 브랜치, 줄 ⋯는 「Project 보기 · Space에서 빼기」. 등록되지 않은 Project(손으로 적은
 * 줄)는 경로 자리에 그 말이 서고 「Space에서 빼기」만 남는다 — 그 줄을 빼서 문제를 걷는다.
 */
function ProjectTable({
  projects,
  registered,
  locked,
  onDrop,
}: {
  projects: readonly string[];
  registered: readonly ProjectView[];
  locked: boolean;
  onDrop: (project: string) => void;
}) {
  const navigate = useNavigate();
  return (
    <div role="table" aria-label="묶인 Project">
      <div role="row" className={cn(ROW, "h-9 border-b border-separator-soft text-chat-meta font-semibold text-fg")}>
        <span role="columnheader">이름</span>
        <span role="columnheader">경로</span>
        <span role="columnheader">기준 브랜치</span>
        <span role="columnheader" aria-hidden />
      </div>
      {projects.length === 0 && (
        <p className="px-1 py-3.5 text-sm text-fg-tertiary">아직 묶인 Project가 없어요 — 「넣기」로 묶어요.</p>
      )}
      {projects.map((slug) => {
        const project = registered.find((one) => one.slug === slug);
        return (
          <div key={slug} role="row" className={cn(ROW, "h-12 border-b-[0.5px] border-separator-soft text-sm transition-colors hover:bg-fill-soft")}>
            <span role="cell" className="flex min-w-0 items-center gap-2">
              <Book aria-hidden className="size-4 shrink-0 text-fg-icon" />
              {project ? (
                <Link
                  to="/projects/$slug"
                  params={{ slug }}
                  className="min-w-0 truncate rounded-sm text-fg underline-offset-3 hover:underline focus-ring"
                >
                  {project.name}
                </Link>
              ) : (
                <span className="min-w-0 truncate text-fg">{slug}</span>
              )}
            </span>
            <span role="cell" className="min-w-0 truncate font-mono text-xs text-fg-tertiary">
              {project ? project.path : "등록되지 않은 Project"}
            </span>
            <span role="cell" className="min-w-0">
              {project && (
                <code className="rounded-sm border-[0.5px] border-border bg-surface-code px-1.5 font-mono text-xs text-fg">
                  {project.baseBranch}
                </code>
              )}
            </span>
            <span role="cell" className="flex justify-end">
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={`${slug} 메뉴`}
                  className="icon-button text-fg-titlebar transition-colors quiet-hover focus-ring"
                >
                  <MoreHorizontal aria-hidden className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  {project && (
                    <>
                      <DropdownMenuItem onClick={() => void navigate({ to: "/projects/$slug", params: { slug } })}>
                        <Book />
                        <span>Project 보기</span>
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                    </>
                  )}
                  <DropdownMenuItem variant="destructive" disabled={locked} onClick={() => onDrop(slug)}>
                    <X />
                    <span>Space에서 빼기</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
          </div>
        );
      })}
    </div>
  );
}

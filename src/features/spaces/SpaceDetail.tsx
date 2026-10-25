import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { shallow, useStore } from "@tanstack/react-store";
import { Book, Folder, Layers, MoreHorizontal, Pencil, Plus, SquarePen, TriangleAlert, X } from "lucide-react";
import { DescriptionSection, DetailPanel, HeadCrumb, Section } from "@/components/catalog/DetailParts";
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
import { showUndoToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { addProject } from "@/features/projects/add-store";
import { useProjects } from "@/features/projects/hooks";
import type { ProjectView } from "@/features/projects/types";
import { signalsOf } from "@/features/terminal/shell-attention";
import { terminalStore } from "@/features/terminal/terminal-store";
import { useWorkMarks } from "@/features/thread/hooks";
import { useWorks } from "@/features/works/hooks";
import { workDoor } from "@/routes/-work-search";
import { workMark } from "@/features/works/work-mark";
import { StatusMark } from "@/components/shell/status-mark";
import { useSpace, useUpdateSpace } from "./hooks";
import { SpaceActions } from "./SpaceActions";
import { useSpaceDelete } from "./SpaceDeleteDialog";
import { SpaceGraph } from "./SpaceGraph";
import { addMenu, createdLine, spaceName, spaceStarts, spaceWorks } from "./space-view";
import type { SpaceDetail as Detail, SpacePatch, SpaceProblemKind } from "./types";

// Space 상세(03 구현 스펙 §14 · 시안 F1-SpaceDetail · F4-SpaceEmpty). 머리 줄 「Space / 결제 서비스」, 판 안에 「← Space」 단추 · 제목과
// 만든 이 줄 · 관계 그래프 · 설명 · Project 표, 오른쪽 칸에 「함께 쓰는 Space」. 고치는 일(이름 · 설명 · 넣기 · 빼기)은 모두 core의 글 단위
// 고치기 하나로 그 칸만 바꾼다(`update_space`). 빼면 「되돌리기」 토스트가 잠깐 서고, 누르면 뺀 Project를 제자리에 다시 넣는다.
//
// 관계 그래프의 「편집」과 문제 상자의 「관계 편집에서 고치기」는 그 Space 파일을 글 그대로 고치는 화면(`/spaces/$slug/edit` — 04)으로 간다.
// 오른쪽 칸 「Work」 묶음은 이 Space에 이은 진행 중인 Work 줄이다(05 — 사이드바 Work 줄과 같은 상태 표시, 누르면 그 Work로).
//
// 판 안 맨 위 「← Space」 줄 오른쪽에 ⋯와 시작 단추 둘이 선다(시안 F1-SpaceDetail `.topbar`). ⋯는 「관계 편집 · 삭제…」다(07) — 지우면 확인
// 창을 거쳐 목록으로 가고, 목록에 「… Space를 지웠어요 · 되돌리기」 토스트가 선다. 시작 단추는 「Host와 고치기」(이 Space를 붙인 Work 없는
// 새 대화에 고쳐 달라는 말, S17)와 「새 Work」(이 Space를 고른 「새 Work」 — 스토리 159)다(06) — 둘 다 첫 화면을 씨앗과 함께 열 뿐이고
// 보내기는 사람이 한다.

export default function SpaceDetail({ slug }: { slug: string }) {
  const { data: space, isError, error } = useSpace(slug);
  const label = navItem("spaces").label;
  const navigate = useNavigate();
  const goList = () => void navigate({ to: "/spaces" });
  // 상세에서 지우면 목록으로 간다(§14) — 되돌리기 토스트는 목록의 자리에 선다.
  const removing = useSpaceDelete(goList);
  return (
    <PlainFrame
      label={`${label} 상세`}
      lead={<HeadCrumb label={label} onOpen={goList} />}
      title={space ? { name: spaceName(space) } : undefined}
    >
      {/* 되돌리기 토스트는 본문 왼쪽 아래다(`DetailPanel`). ⋯ · 시작 단추는 「← Space」 줄 오른쪽 끝이다. */}
      <DetailPanel
        back={{ to: "/spaces", label }}
        end={
          <>
            {space && <SpaceActions space={space} onDelete={(one) => void removing.ask(one)} />}
            {space && <SpaceStarts space={space} />}
          </>
        }
        after={removing.dialog}
      >
        {space ? (
          <SpaceBody key={space.slug} space={space} onOpenSpace={(to) => void navigate({ to: "/spaces/$slug", params: { slug: to } })} />
        ) : (
          isError && <p className="text-sm text-fg-tertiary">Space를 읽지 못했어요 — {String(error)}</p>
        )}
      </DetailPanel>
    </PlainFrame>
  );
}

/**
 * 시작 단추 둘(§14 · 시안 F1-SpaceDetail — 맨 위 줄 오른쪽 끝 ⋯ 뒤, 사이 6) — 테두리 알약 「Host와 고치기」(S17)와 짙은 알약 「+ 새 Work」(스토리
 * 159). 시안 `.btn.lg`의 34 · 좌우 14 · 14px다.
 */
function SpaceStarts({ space }: { space: Detail }) {
  const navigate = useNavigate();
  const starts = spaceStarts(space);
  return (
    <>
      <Button variant="outline" size="lg" className="h-8.5" onClick={() => void navigate({ to: "/", search: starts.hostEdit })}>
        <SquarePen aria-hidden className="size-3.5" />
        Host와 고치기
      </Button>
      <Button size="lg" className="h-8.5" onClick={() => void navigate({ to: "/", search: starts.newWork })}>
        <Plus aria-hidden className="size-3.5" />새 Work
      </Button>
    </>
  );
}

/** 칸 단위로 고칠 자리를 찾을 수 없는 문제 — 닫히지 않은 frontmatter · YAML이 아님 · 글로 읽을 수 없는 파일. */
const UNEDITABLE: ReadonlySet<SpaceProblemKind> = new Set(["unclosedFrontmatter", "badYaml", "unreadable"]);

function SpaceBody({ space, onOpenSpace }: { space: Detail; onOpenSpace: (slug: string) => void }) {
  const { data: registered = [] } = useProjects();
  const update = useUpdateSpace();
  // frontmatter가 닫히지 않았거나 YAML · 글로 읽을 수 없으면 고칠 자리를 모른다 — 고치는 단추를 끈다(고치는 길은 관계 편집 — 04).
  const locked = space.problems.some((problem) => UNEDITABLE.has(problem.kind));

  const patch = async (change: SpacePatch): Promise<boolean> => {
    try {
      await update.mutateAsync({ slug: space.slug, patch: change });
      return true;
    } catch (e) {
      await showProblem(`Space를 고치지 못했어요 — ${e}`);
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
  const addItems = <AddMenuItems candidates={menu.candidates} note={menu.note} onAdd={add} onAddNew={() => void addNew()} />;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_270px] items-start gap-12">
      <div className="min-w-0">
        {space.problems.length > 0 && <Problems space={space} />}
        <Title space={space} locked={locked} onRename={(name) => void patch({ name })} />
        <Section
          label="관계"
          aside={space.shared.length > 0 ? `함께 쓰는 Space ${space.shared.length}` : "다른 Space와 겹치지 않아요"}
          end={
            <Link to="/spaces/$slug/edit" params={{ slug: space.slug }} tabIndex={0} className={buttonVariants({ variant: "ghost", size: "top" })}>
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
                <DropdownMenuContent width="pair">{addItems}</DropdownMenuContent>
              </DropdownMenu>
            }
          />
        </Section>
        <DescriptionSection
          text={space.description}
          aside="Agent가 이 Space에서 일할 때 처음 읽어요"
          placeholder="이 Space에서 다루는 일과 Project들이 어떻게 이어지는지 적어 두세요"
          locked={locked}
          onSave={(description) => patch({ description })}
        />
        <Section
          label="Project"
          aside={String(space.projects.length)}
          after={
            <DropdownMenu>
              <DropdownMenuTrigger disabled={locked} className={buttonVariants({ variant: "ghost", size: "top" })}>
                <Plus aria-hidden />
                넣기
              </DropdownMenuTrigger>
              <DropdownMenuContent width="pair">{addItems}</DropdownMenuContent>
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
            // 그 Work의 마지막 화면으로 간다 — 다른 문(사이드바 · ⌘K)과 같은 주소다(`workDoor`, 03 코드 리뷰 A1).
            {...workDoor(work.slug)}
            tabIndex={0}
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

/** 문제가 있는 Space — 상세 위에 문제 줄들(줄 번호 · 말)이 선다. 고치는 길은 관계 편집이다 — 그 줄들이 편집기의 줄 끝에 그대로 선다. */
function Problems({ space }: { space: Detail }) {
  return (
    <section aria-label="문제" className="mb-6 rounded-xl border border-separator-soft px-4 py-3">
      <p className="flex items-center gap-2 text-sm text-fg-problem">
        <TriangleAlert aria-hidden className="size-4 shrink-0" />이 Space 파일에 문제가 있어요
        <Link
          to="/spaces/$slug/edit"
          params={{ slug: space.slug }}
          tabIndex={0}
          className="ml-auto rounded-sm text-chat-meta text-link underline-offset-3 hover:underline focus-ring"
        >
          관계 편집에서 고치기
        </Link>
      </p>
      <ul className="mt-1.5 flex flex-col gap-1 pl-6 text-chat-meta text-fg-problem">
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

/**
 * 「넣기」 메뉴의 줄들(스토리 152 · 153) — 「등록된 Project」 머리 아래 아직 묶이지 않은 Project(이름 · 경로), 넣을 것이 없으면 그 까닭 한 줄
 * (「등록된 Project를 모두 넣었어요」 · 「등록된 Project가 없어요」), 구분선 뒤 「새 Project 추가…」.
 */
function AddMenuItems({
  candidates,
  note,
  onAdd,
  onAddNew,
}: {
  candidates: readonly ProjectView[];
  note: string | null;
  onAdd: (slug: string) => void;
  onAddNew: () => void;
}) {
  return (
    <>
      <DropdownMenuGroup>
        <DropdownMenuLabel>등록된 Project</DropdownMenuLabel>
        {candidates.map((project) => (
          <DropdownMenuItem key={project.slug} aria-label={project.name} aria-description={project.path} onClick={() => onAdd(project.slug)}>
            <Book />
            <span className="shrink-0">{project.name}</span>
            <span className="ml-auto min-w-0 truncate font-mono text-xs text-fg-tertiary">{project.path}</span>
          </DropdownMenuItem>
        ))}
        {note && <p className="px-2 py-1.5 text-xs text-fg-tertiary">{note}</p>}
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
                  tabIndex={0}
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
                  className="icon-button text-fg-row-act transition-colors quiet-hover focus-ring"
                >
                  <MoreHorizontal aria-hidden className="size-4" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" width="act-wide">
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

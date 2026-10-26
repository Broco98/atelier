import { Fragment, useEffect, useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { GitBranch, Pencil, TriangleAlert } from "lucide-react";
import { DescriptionSection, DetailPanel, HeadCrumb } from "@/components/catalog/DetailParts";
import { navItem } from "@/components/shell/nav-items";
import { PlainFrame } from "@/components/shell/PlainFrame";
import { Button } from "@/components/ui/button";
import { showProblem } from "@/components/ui/confirm-store";
import { InlineRename } from "@/components/ui/inline-rename";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectSeparator, SelectTrigger } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useProjects, useUpdateProject } from "./hooks";
import { NoticeBox } from "./NoticeBox";
import { baseNote, branchGroups, missingNotice, renameHint } from "./project-view";
import { useRelocate } from "./relocate";
import type { ProjectView } from "./types";

// Project 상세(03 구현 스펙 §16 · 시안 F1-ProjectDetail · F4-ProjBranch · F4-ProjRename · F4-ProjDetailMissing · F4-KitProject 「상세 조각」). Space
// 상세와 같은 짜임이다 — 머리 줄 「Projects / web-app」, 판 안에 「← Projects」 단추 · 제목 · 설명, 오른쪽 칸에 기준 브랜치와 경로. 설계 「상세는
// 기준 브랜치 · 경로 · 설명이다」 — 이 Project를 쓰는 Work 묶음은 두지 않는다(S21, 쓰는 Work는 제거 창이 말한다).
//
// 고치는 일(제목 · 설명 · 기준 브랜치)은 모두 core 고치기 하나다(`update_project`). 이름을 바꿔도 slug(파일 이름) · 경로는 그대로이고, 기준
// 브랜치는 그 저장소의 로컬 · 원격 목록에서만 고른다(core가 목록에 없는 값을 거절한다). 경로는 폴더를 찾을 수 없을 때의 「재설정」으로만
// 바뀐다.

export default function ProjectDetail({ slug }: { slug: string }) {
  const { data: projects = [], isPending, isFetching } = useProjects();
  const project = projects.find((one) => one.slug === slug) ?? null;
  const label = navItem("projects").label;
  const navigate = useNavigate();
  const goList = (replace = false) => void navigate({ to: "/projects", replace });

  // 보던 Project가 목록에서 빠졌다(다른 창 · 바깥에서 제거) — 목록으로 간다. 빈 상세가 남으면 뒤로가기 한 번이 아무 일도 하지 않으니
  // 이 칸을 갈아 쓴다(replace).
  const gone = !isPending && !isFetching && project === null;
  useEffect(() => {
    if (gone) goList(true);
    // goList는 의존성에 넣지 않는다 — navigate 하나만 닫아 잡고 그건 라우터가 고정해준다
  }, [gone]);

  return (
    <PlainFrame label={`${label} 상세`} lead={<HeadCrumb label={label} onOpen={() => goList()} />} title={project ? { name: project.name } : undefined}>
      {/* 토스트는 본문 왼쪽 아래다(`DetailPanel` — Space 상세와 같다). */}
      <DetailPanel back={{ to: "/projects", label }}>{project && <ProjectBody key={project.slug} project={project} />}</DetailPanel>
    </PlainFrame>
  );
}

function ProjectBody({ project }: { project: ProjectView }) {
  const update = useUpdateProject();
  const relocate = useRelocate();
  const patch = async (change: Parameters<typeof update.mutateAsync>[0]["patch"], failed: string): Promise<boolean> => {
    try {
      await update.mutateAsync({ slug: project.slug, patch: change });
      return true;
    } catch (e) {
      await showProblem(`${failed} — ${e}`);
      return false;
    }
  };
  return (
    // 두 칸 — 본문 칸 | 오른쪽 칸 270, 사이 48(시안 `.cols`).
    <div className="grid grid-cols-[minmax(0,1fr)_270px] items-start gap-12">
      <div className="min-w-0">
        <Title project={project} onRename={(name) => void patch({ name }, "이름을 바꾸지 못했어요")} />
        {project.missing && <MissingNotice project={project} onRelocate={() => void relocate(project)} />}
        <DescriptionSection
          text={project.description}
          aside="Agent가 이 Project를 이해할 때 읽어요"
          placeholder="이 Project가 무엇인지 한두 줄로 적어 두세요"
          onSave={(description) => patch({ description }, "설명을 저장하지 못했어요")}
        />
      </div>
      <aside aria-label="Project 정보" className="flex flex-col">
        <RailSection label="기준 브랜치" first>
          <BaseBranch project={project} onPick={(baseBranch) => patch({ baseBranch }, "기준 브랜치를 바꾸지 못했어요")} />
        </RailSection>
        <RailSection label="경로">
          <p
            className={cn(
              "font-mono text-code break-all",
              project.missing ? "text-fg-tertiary line-through decoration-fg-faint" : "text-fg",
            )}
          >
            {project.path}
          </p>
          {project.missing && (
            <div className="mt-2.5 flex items-center gap-2">
              <span className="flex items-center gap-1 text-xs text-fg-notice-warn-line">
                <TriangleAlert aria-hidden className="size-3.5 shrink-0" />
                Project를 찾을 수 없어요
              </span>
              <Button variant="outline" size="top" className="rounded-full text-fg" onClick={() => void relocate(project)}>
                재설정
              </Button>
            </div>
          )}
        </RailSection>
      </aside>
    </div>
  );
}

/** 오른쪽 칸의 묶음 — 흐린 이름 아래 값, 묶음 사이 선(시안 `.rs` · `.rl`). 첫 묶음은 선이 없고 위가 좁다. */
function RailSection({ label, first = false, children }: { label: string; first?: boolean; children: ReactNode }) {
  return (
    <section aria-label={label} className={cn("pb-4", first ? "pt-1" : "border-t border-separator-soft pt-4")}>
      <h2 className="mb-2 text-sm text-fg-secondary">{label}</h2>
      {children}
    </section>
  );
}

/**
 * 제목(24) — 누르면 그 자리에서 입력 칸이 되고(연필도 같다), 아래 「↵ 저장 · esc 취소 — 파일 이름(web-app.md)과 경로는 그대로예요」가 선다
 * (스토리 122 · 시안 F4-ProjRename). 비우면 원래 이름이다 — core가 빈 이름을 받지 않는다.
 */
function Title({ project, onRename }: { project: ProjectView; onRename: (name: string) => void }) {
  const [renaming, setRenaming] = useState(false);
  return (
    <div>
      <h1 className="flex min-h-8 items-center gap-2.5 text-heading-lg font-medium text-fg">
        {renaming ? (
          <InlineRename
            value={project.name}
            label="Project 이름"
            emptyMeans="revert"
            fit="text"
            onCommit={onRename}
            onDone={() => setRenaming(false)}
            className="-ml-2.5 h-10 min-w-88 items-center rounded-lg px-2.5"
          />
        ) : (
          <>
            <button
              type="button"
              aria-label={`${project.name} — 이름 바꾸기`}
              onClick={() => setRenaming(true)}
              className="min-w-0 truncate rounded-md text-left focus-ring"
            >
              {project.name}
            </button>
            <button
              type="button"
              aria-label="이름 바꾸기"
              onClick={() => setRenaming(true)}
              className="rounded-sm p-0.5 text-fg-faint transition-colors hover:text-fg-secondary focus-ring"
            >
              <Pencil aria-hidden className="size-3.5" />
            </button>
          </>
        )}
      </h1>
      {renaming && <p className="mt-2 text-xs text-fg-tertiary">{renameHint(project)}</p>}
    </div>
  );
}

/** 폴더를 찾을 수 없음(스토리 124 · 시안 F4-ProjDetailMissing) — 제목 아래 노란 안내 상자와 「재설정」. */
function MissingNotice({ project, onRelocate }: { project: ProjectView; onRelocate: () => void }) {
  const notice = missingNotice(project);
  return <NoticeBox tone="warn" title={notice.title} body={notice.body} action={{ label: "재설정", onClick: onRelocate }} className="mt-4" />;
}

/**
 * 기준 브랜치(스토리 119–121 · 125 · 시안 F4-ProjBranch) — 단추를 누르면 목록이 「로컬」 · 「원격 — origin」 묶음으로 서고, 아래 「목록에 있는
 * 브랜치만 고를 수 있어요」. 목록 밖 값 · 빈 값을 적는 칸은 없다. 원격 브랜치를 고르면 그 이름 그대로(`origin/release/2.5`) 적힌다(S19). 폴더를
 * 찾을 수 없으면 꺼진다. 단추 아래 한 줄이 이 값이 무엇을 정하는지, 방금 바꿨으면 그 뒤의 일을 말한다.
 */
function BaseBranch({ project, onPick }: { project: ProjectView; onPick: (branch: string) => Promise<boolean> }) {
  const [changed, setChanged] = useState(false);
  const groups = branchGroups(project.git);
  return (
    <>
      <Select
        value={project.baseBranch}
        disabled={project.missing}
        onValueChange={(branch) => {
          // 값이 바뀔 때만 저장한다 — 지금 값을 다시 고른 것은 닫기만 한다.
          if (typeof branch === "string" && branch !== project.baseBranch) {
            void onPick(branch).then((ok) => ok && setChanged(true));
          }
        }}
      >
        <SelectTrigger
          aria-label="기준 브랜치"
          className="h-8 gap-1.5 border border-border-heavy bg-surface pr-2 pl-2.5 text-fg hover:bg-fill-soft"
        >
          <GitBranch aria-hidden className="size-3.5 text-fg-icon" />
          <span className="font-mono">{project.baseBranch}</span>
        </SelectTrigger>
        <SelectContent
          className="w-62.5"
          footer={<p className="px-3.5 pt-1 pb-2.5 text-xs text-fg-tertiary">목록에 있는 브랜치만 고를 수 있어요</p>}
        >
          {groups.map((group, index) => (
            <Fragment key={group.label}>
              {index > 0 && <SelectSeparator className="mx-1.5 h-[0.5px] bg-separator" />}
              <SelectGroup className="p-0">
                <SelectLabel className="px-2 pt-1.5 pb-1 text-xs text-fg-tertiary">{group.label}</SelectLabel>
                {group.branches.map((branch) => (
                  <SelectItem key={branch} value={branch}>
                    <span className="flex min-w-0 items-center gap-2">
                      <GitBranch aria-hidden className="size-3.5 shrink-0 text-fg-icon" />
                      <span className="min-w-0 truncate font-mono text-xs">{branch}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectGroup>
            </Fragment>
          ))}
        </SelectContent>
      </Select>
      <p className="mt-2 text-xs text-fg-tertiary">{baseNote(project, changed)}</p>
    </>
  );
}

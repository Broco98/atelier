import { useRef, useState } from "react";
import { Folder, GitFork, GitMerge, ChevronRight, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useWorks } from "@/features/works/hooks";
import { formatCreated, StatusIcon } from "@/features/works/status";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUpdateProject } from "./hooks";
import type { ProjectView } from "./types";

interface ProjectDetailProps {
  project: ProjectView;
  // null = 선택 변경 없이 Works 화면으로 이동
  onOpenWork: (slug: string | null) => void;
}

function ProjectDetail({ project, onOpenWork }: ProjectDetailProps) {
  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-7 px-10 pb-12 pt-7">
      {project.missing && (
        <div className="flex items-center gap-2.5 rounded-[12px] border border-red-500 bg-red-500/[0.07] px-3.5 py-2.5">
          <span className="size-[7px] shrink-0 rounded-full bg-red-500" />
          <span className="shrink-0 text-[14px] font-medium text-red-600">
            경로를 찾을 수 없어요.
          </span>
          <span className="text-[13.5px] text-muted-foreground">
            폴더가 이동되었거나 삭제되었어요. 등록은 자동으로 삭제되지 않아요 — 경로를 복구하거나
            직접 제거하세요.
          </span>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        <h1>
          <TitleEditor key={project.slug} project={project} />
        </h1>
        <dl className="mt-1 flex flex-col gap-px">
          <PropertyRow icon={<Folder className="size-3.5" strokeWidth={1.8} />} label="경로">
            <span
              className={cn(
                "truncate font-mono text-[12.5px] text-muted-foreground",
                project.missing && "text-red-600 line-through",
              )}
            >
              {project.path}
            </span>
          </PropertyRow>
          {project.git?.remoteSlug && (
            <PropertyRow icon={<GitMerge className="size-3.5" strokeWidth={1.8} />} label="원격">
              <span className="truncate font-mono text-[12.5px] text-muted-foreground">
                {project.git.remoteSlug}
              </span>
            </PropertyRow>
          )}
          <PropertyRow icon={<GitFork className="size-3.5" strokeWidth={1.8} />} label="baseBranch">
            <BaseBranchControl key={project.slug} project={project} />
          </PropertyRow>
        </dl>
      </div>

      <DescriptionEditor key={project.slug} project={project} />

      <WorksSection projectSlug={project.slug} onOpenWork={onOpenWork} />
    </div>
  );
}

// 이 프로젝트에서 시작된 작업 목록 (목업 S2의 Works 란)
function WorksSection({
  projectSlug,
  onOpenWork,
}: {
  projectSlug: string;
  onOpenWork: (slug: string | null) => void;
}) {
  // 프로젝트는 **Atelier에만 있다**(결정 17) — Maison에는 이 화면으로 오는 길이 없다.
  const { data: works = [] } = useWorks("atelier");
  const related = works.filter((w) => w.projects.includes(projectSlug));

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center gap-2">
        <Zap className="size-3.5 shrink-0 text-tertiary" strokeWidth={1.7} />
        <h2 className="text-[14px] font-semibold text-muted-foreground">Works</h2>
        <span className="text-[12.5px] text-tertiary">이 프로젝트에서 시작된 작업</span>
        <button
          type="button"
          onClick={() => onOpenWork(null)}
          className="ml-auto flex items-center gap-1 rounded-[7px] px-1.5 py-0.5 text-[12px] font-medium text-tertiary transition-colors quiet-hover"
        >
          Works에서 모두 보기
          <ChevronRight className="size-3" strokeWidth={2} />
        </button>
      </div>
      <div className="flex flex-col overflow-hidden rounded-[12px] border">
        {related.length === 0 ? (
          <div className="px-3.5 py-4 text-[13px] text-tertiary">
            이 프로젝트로 시작된 작업이 아직 없어요.
          </div>
        ) : (
          related.map((work) => {
            const worktree = work.worktrees.find((t) => t.project === projectSlug);
            return (
              <button
                key={work.slug}
                type="button"
                onClick={() => onOpenWork(work.slug)}
                // 목록 "행"이라 농도 1이다 — 버튼(2)이 아니다. D1의 부등식에서 행 hover가
                // 한 단계 아래인 이유는 행 선택(2)에 자리를 내주기 위해서다
                className="flex items-center justify-between gap-3 border-b px-3.5 py-2.5 text-left transition-colors last:border-b-0 hover:bg-state-1"
              >
                <span className="flex min-w-0 items-center gap-[9px]">
                  <StatusIcon status={work.status} />
                  <span
                    className={cn(
                      "min-w-0 truncate text-[13.5px] font-medium",
                      work.status === "done" && "text-muted-foreground",
                    )}
                  >
                    {work.title}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2.5 text-[12px] text-tertiary">
                  {worktree?.exists && (
                    <span className="flex items-center gap-1.5 font-mono text-[11px]">
                      <GitFork className="size-3" strokeWidth={2} />
                      {work.branch}
                    </span>
                  )}
                  {formatCreated(work.createdAt)}
                  <ChevronRight className="size-3.5" strokeWidth={2} />
                </span>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}

// 표시 이름 인라인 편집 — slug는 바뀌지 않는다 (스펙 #3)
//
// 작업 이름 바꾸기 창(works/WorkRenameDialog.tsx)이 같은 입력 규칙을 쓴다 — Enter 확정, Escape 취소,
// 공백·동일 값 미저장, 두 번 커밋되는 것을 막는 finished 가드. 여기 로직을 고치면 그쪽도 같이 봐야 한다.
// **갈리는 것 하나**: 여기서는 blur가 확정이지만 그 창에서는 바깥 누르기가 취소다(판 3 P7) — 창 밖을 누른
// 것은 「그만두겠다」로 읽힌다. 이 인라인 편집기는 그대로 둔다(결정 8은 작업 이름 바꾸기에 한한다).
function TitleEditor({ project }: { project: ProjectView }) {
  const updateProject = useUpdateProject();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.name);
  const finished = useRef(false);

  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    setEditing(false);
    const value = draft.trim();
    if (commit && value && value !== project.name) {
      updateProject.mutate({ slug: project.slug, patch: { name: value } });
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        title="클릭해서 편집"
        onClick={() => {
          finished.current = false;
          setDraft(project.name);
          setEditing(true);
        }}
        className="-mx-2 -my-1 max-w-full truncate rounded-[10px] px-2 py-1 text-left text-[25px] font-semibold tracking-[-0.015em] transition-colors hover:bg-state-2"
      >
        {project.name}
      </button>
    );
  }
  return (
    <Input
      variant="inline-title"
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
    />
  );
}

function PropertyRow({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[30px] items-center gap-3.5">
      <dt className="flex w-[110px] shrink-0 items-center gap-[9px] text-[12.5px] text-tertiary">
        {icon}
        {label}
      </dt>
      <dd className="flex min-w-0 flex-1 items-center">{children}</dd>
    </div>
  );
}

function BaseBranchControl({ project }: { project: ProjectView }) {
  const updateProject = useUpdateProject();
  const branches = project.git?.localBranches ?? [];

  if (branches.length === 0) {
    return <InlineBranchEditor key={project.slug} project={project} />;
  }

  const options = branches.includes(project.baseBranch)
    ? branches
    : [project.baseBranch, ...branches];

  // **목록에서 고른다**(스토리 67·68). 방향키 · 글자 치기 · Esc 닫기와 트리거로 포커스 돌려주기는 부품(Select)이
  // 한다. 지금 값은 `listbox`의 선택됨으로 읽히고, 체크는 보이는 쪽의 말일 뿐이다. 카드는 트리거 아래로 뜬다
  // (부품의 기본 — 트리거 맞춤을 껐다, S32).
  return (
    // 칩의 글자를 위 줄의 값들과 같은 세로선에 세운다 — 칩의 좌우 안쪽(7px)만큼 당긴다.
    <div className="-ml-[7px] flex">
      <Select
        value={project.baseBranch}
        onValueChange={(branch) => {
          // **값이 바뀔 때만 저장한다**(지금 규칙). 지금 값을 다시 고른 것은 닫기만 한다.
          if (branch !== null && branch !== project.baseBranch) {
            updateProject.mutate({ slug: project.slug, patch: { baseBranch: branch } });
          }
        }}
      >
        {/* 이름은 「기준 브랜치」다 — 여는 버튼이 `combobox`가 되어 글자(지금 값)가 이름이 되지 못한다. 없는
            프로젝트의 입력칸과 같은 이름이다(S37). 두 칸은 한 프로젝트에 하나만 선다. */}
        <SelectTrigger aria-label="기준 브랜치" title="브랜치 목록에서 변경">
          <SelectValue className="font-mono" />
        </SelectTrigger>
        <SelectContent
          header={
            <div className="flex h-8 items-center justify-between border-b px-3">
              <span className="text-[12.5px] font-semibold text-muted-foreground">브랜치</span>
              <span className="text-[12px] text-tertiary">{options.length}개</span>
            </div>
          }
          footer={
            <div className="border-t px-3 py-2 text-[12px] leading-normal text-tertiary">
              baseBranch 설정만 바꿔요 — checkout은 하지 않아요
            </div>
          }
        >
          {options.map((branch) => (
            <SelectItem key={branch} value={branch}>
              <span className="font-mono text-muted-foreground">{branch}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

// git 브랜치 정보가 없을 때 — 클릭해서 직접 편집
function InlineBranchEditor({ project }: { project: ProjectView }) {
  const updateProject = useUpdateProject();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.baseBranch);
  const finished = useRef(false);

  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    setEditing(false);
    const value = draft.trim();
    if (commit && value && value !== project.baseBranch) {
      updateProject.mutate({ slug: project.slug, patch: { baseBranch: value } });
    }
  };

  if (!editing) {
    return (
      <button
        type="button"
        title="클릭해서 편집"
        onClick={() => {
          finished.current = false;
          setDraft(project.baseBranch);
          setEditing(true);
        }}
        className="-ml-[7px] flex h-[26px] items-center rounded-[9px] px-[7px] font-mono text-[12.5px] text-muted-foreground transition-colors quiet-hover"
      >
        {project.baseBranch}
      </button>
    );
  }
  return (
    <Input
      variant="inline-chip"
      className="w-[150px]"
      autoFocus
      // 이름표가 없던 칸이다(S37) — 옆 줄의 「baseBranch」 글자는 이 칸과 묶여 있지 않다. 목록이 서는 프로젝트의
      // 여는 버튼과 같은 이름이다.
      aria-label="기준 브랜치"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
    />
  );
}

function DescriptionEditor({ project }: { project: ProjectView }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.description);
  const updateProject = useUpdateProject();
  // 키보드로 편집을 끝낸 뒤 언마운트 blur가 한 번 더 들어와도 무시하기 위한 가드
  const finished = useRef(false);

  const startEditing = () => {
    finished.current = false;
    setDraft(project.description);
    setEditing(true);
  };

  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    setEditing(false);
    if (commit && draft !== project.description) {
      updateProject.mutate({ slug: project.slug, patch: { description: draft } });
    } else if (!commit) {
      setDraft(project.description);
    }
  };

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-baseline gap-2">
        <h2 className="text-[14px] font-semibold text-muted-foreground">설명</h2>
        <span className="text-[12.5px] text-tertiary">클릭해서 편집</span>
      </div>
      {editing ? (
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && e.metaKey) finish(true);
            if (e.key === "Escape") finish(false);
          }}
          rows={3}
          placeholder="이 프로젝트가 무엇인지, 왜 등록했는지 적어 주세요"
          className="min-h-[48px] resize-y rounded-[12px] border border-primary bg-background px-3.5 py-2.5 text-[14.5px] leading-[1.65] outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={startEditing}
          className={cn(
            "min-h-[48px] rounded-[12px] border px-3.5 py-2.5 text-left text-[14.5px] leading-[1.65] transition-colors hover:border-border-strong hover:bg-panel",
            !project.description && "italic text-tertiary",
          )}
        >
          {project.description || "아직 설명이 없어요. 이 프로젝트가 무엇인지 적어 주세요."}
        </button>
      )}
    </div>
  );
}

export default ProjectDetail;

import { useRef, useState, useEffect } from "react";
import { Folder, GitFork, GitMerge, Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUpdateProject } from "./hooks";
import type { ProjectView } from "./types";

interface ProjectDetailProps {
  project: ProjectView;
}

function ProjectDetail({ project }: ProjectDetailProps) {
  return (
    <div className="flex w-full max-w-[860px] flex-col gap-7 px-10 pb-12 pt-7">
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
    </div>
  );
}

// 표시 이름 인라인 편집 — slug는 바뀌지 않는다 (스펙 #3)
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
        className="-mx-2 -my-1 max-w-full truncate rounded-[10px] px-2 py-1 text-left text-[25px] font-semibold tracking-[-0.015em] transition-colors hover:bg-accent"
      >
        {project.name}
      </button>
    );
  }
  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
      className="-mx-2 -my-1 w-full rounded-[10px] border border-primary bg-background px-2 py-1 text-[25px] font-semibold tracking-[-0.015em] outline-none"
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
  const [open, setOpen] = useState(false);
  const branches = project.git?.localBranches ?? [];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (branches.length === 0) {
    return <InlineBranchEditor key={project.slug} project={project} />;
  }

  const options = branches.includes(project.baseBranch)
    ? branches
    : [project.baseBranch, ...branches];

  return (
    <div className="relative -ml-[7px] flex">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="브랜치 목록에서 변경"
        className="flex h-[26px] items-center gap-1.5 rounded-[9px] px-[7px] font-mono text-[12.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {project.baseBranch}
        <ChevronDown className="size-2.5" strokeWidth={2.2} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-[30px] z-40 w-[248px] overflow-hidden rounded-[13px] border border-border-strong bg-background shadow-lg">
            <div className="flex h-8 items-center justify-between border-b px-3">
              <span className="text-[12.5px] font-semibold text-muted-foreground">브랜치</span>
              <span className="text-[12px] text-tertiary">{options.length}개</span>
            </div>
            <div className="flex flex-col gap-px p-[5px]">
              {options.map((branch) => (
                <button
                  key={branch}
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    if (branch !== project.baseBranch) {
                      updateProject.mutate({ slug: project.slug, patch: { baseBranch: branch } });
                    }
                  }}
                  className="flex h-8 w-full items-center gap-2 rounded-[9px] px-[9px] text-left transition-colors hover:bg-accent"
                >
                  <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-muted-foreground">
                    {branch}
                  </span>
                  {branch === project.baseBranch && (
                    <Check className="size-3 shrink-0 text-primary" strokeWidth={2.4} />
                  )}
                </button>
              ))}
            </div>
            <div className="border-t px-3 py-2 text-[12px] leading-normal text-tertiary">
              baseBranch 설정만 바꿔요 — checkout은 하지 않아요
            </div>
          </div>
        </>
      )}
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
        className="-ml-[7px] flex h-[26px] items-center rounded-[9px] px-[7px] font-mono text-[12.5px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        {project.baseBranch}
      </button>
    );
  }
  return (
    <input
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        if (e.key === "Enter") finish(true);
        if (e.key === "Escape") finish(false);
      }}
      className="h-[26px] w-[150px] rounded-[9px] border border-primary bg-background px-[7px] font-mono text-[12.5px] outline-none"
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

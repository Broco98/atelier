import { useRef, useState } from "react";
import { Folder, GitBranch, GitMerge } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUpdateProject } from "./hooks";
import type { ProjectView } from "./types";

interface ProjectDetailProps {
  project: ProjectView;
}

function ProjectDetail({ project }: ProjectDetailProps) {
  return (
    <div className="mx-auto flex w-full max-w-[860px] flex-col gap-7 px-8 pb-12 pt-7">
      {project.missing && (
        <div className="flex items-center gap-2.5 rounded-[12px] border border-red-500 bg-red-500/[0.07] px-3.5 py-2.5">
          <span className="size-[7px] shrink-0 rounded-full bg-red-500" />
          <span className="shrink-0 text-[13px] font-medium text-red-600">
            경로를 찾을 수 없어요.
          </span>
          <span className="text-[12.5px] text-muted-foreground">
            폴더가 이동되었거나 삭제되었어요. 등록은 자동으로 삭제되지 않아요 — 경로를 복구하거나
            직접 제거하세요.
          </span>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        <h1 className="text-[21px] font-semibold tracking-[-0.01em]">{project.name}</h1>
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
          <PropertyRow icon={<GitBranch className="size-3.5" strokeWidth={1.8} />} label="baseBranch">
            <BaseBranchControl project={project} />
          </PropertyRow>
        </dl>
      </div>

      <DescriptionEditor key={project.slug} project={project} />
    </div>
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
      <dt className="flex w-[108px] shrink-0 items-center gap-[9px] text-[12.5px] text-tertiary">
        {icon}
        {label}
      </dt>
      <dd className="flex min-w-0 flex-1 items-center">{children}</dd>
    </div>
  );
}

// Task 8에서 팝오버 메뉴로 교체된다
function BaseBranchControl({ project }: { project: ProjectView }) {
  const updateProject = useUpdateProject();
  const branches = project.git?.localBranches ?? [];
  if (branches.length === 0) {
    return <span className="font-mono text-[12.5px] text-muted-foreground">{project.baseBranch}</span>;
  }
  const options = branches.includes(project.baseBranch)
    ? branches
    : [project.baseBranch, ...branches];
  return (
    <select
      value={project.baseBranch}
      onChange={(e) =>
        updateProject.mutate({ slug: project.slug, patch: { baseBranch: e.target.value } })
      }
      className="rounded-[9px] border bg-transparent px-2 py-1 font-mono text-[12.5px]"
    >
      {options.map((branch) => (
        <option key={branch} value={branch}>
          {branch}
        </option>
      ))}
    </select>
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
        <h2 className="text-[13px] font-semibold text-muted-foreground">설명</h2>
        <span className="text-[11.5px] text-tertiary">클릭해서 편집</span>
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
          rows={4}
          placeholder="이 프로젝트가 무엇인지, 왜 등록했는지 적어 주세요"
          className="min-h-[72px] resize-y rounded-[12px] border border-primary bg-background px-3.5 py-3 text-[13.5px] leading-[1.65] outline-none"
        />
      ) : (
        <button
          type="button"
          onClick={startEditing}
          className={cn(
            "min-h-[72px] rounded-[12px] border px-3.5 py-3 text-left text-[13.5px] leading-[1.65] transition-colors hover:border-border-strong hover:bg-panel",
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

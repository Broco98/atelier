import { useRef, useState } from "react";
import { confirm, message } from "@tauri-apps/plugin-dialog";
import { Folder, GitBranch, GitMerge } from "lucide-react";
import { cn } from "@/lib/utils";
import { projectsApi } from "./api";
import { useDeleteProject, useUpdateProject } from "./hooks";
import type { ProjectView } from "./types";

interface ProjectDetailProps {
  project: ProjectView;
  onDeleted: () => void;
}

function ProjectDetail({ project, onDeleted }: ProjectDetailProps) {
  const deleteProject = useDeleteProject();

  const handleRemove = async () => {
    const ok = await confirm(
      "코드 폴더는 삭제되지 않고 Atelier 목록에서만 제거됩니다.",
      { title: `'${project.name}' 제거`, kind: "warning" },
    );
    if (!ok) return;
    try {
      await deleteProject.mutateAsync(project.slug);
      onDeleted();
    } catch (e) {
      await message(`제거하지 못했습니다: ${e}`, { title: "오류", kind: "error" });
    }
  };

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-10 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-[-0.01em]">{project.name}</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={project.missing}
            onClick={() => projectsApi.openFolder(project.slug)}
            className="rounded-[7px] border px-3 py-1.5 text-[13px] font-medium transition-colors hover:bg-sidebar-accent disabled:opacity-40"
          >
            폴더 열기
          </button>
          <button
            type="button"
            onClick={handleRemove}
            className="rounded-[7px] px-3 py-1.5 text-[13px] font-medium text-red-500 transition-colors hover:bg-red-500/10"
          >
            제거
          </button>
        </div>
      </div>

      {project.missing && (
        <div className="rounded-[7px] bg-red-500/10 px-4 py-3 text-[13px] text-red-500">
          경로에 폴더가 없습니다. 폴더를 다시 만들거나 이 프로젝트를 제거하세요.
        </div>
      )}

      <dl className="flex flex-col gap-3">
        <PropertyRow icon={<Folder className="size-4" strokeWidth={1.7} />} label="경로">
          <span className="font-mono text-[13px]">{project.path}</span>
        </PropertyRow>
        {project.git?.remoteSlug && (
          <PropertyRow icon={<GitMerge className="size-4" strokeWidth={1.7} />} label="원격">
            <span className="font-mono text-[13px]">{project.git.remoteSlug}</span>
          </PropertyRow>
        )}
        <PropertyRow icon={<GitBranch className="size-4" strokeWidth={1.7} />} label="baseBranch">
          <BaseBranchControl project={project} />
        </PropertyRow>
      </dl>

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
    <div className="flex items-center gap-3">
      <dt className="flex w-36 items-center gap-2 text-[13px] text-muted-foreground">
        {icon}
        {label}
      </dt>
      <dd className="min-w-0 flex-1">{children}</dd>
    </div>
  );
}

function BaseBranchControl({ project }: { project: ProjectView }) {
  const updateProject = useUpdateProject();
  const branches = project.git?.localBranches ?? [];
  if (branches.length === 0) {
    return <span className="font-mono text-[13px]">{project.baseBranch}</span>;
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
      className="rounded-[7px] border bg-transparent px-2 py-1 font-mono text-[13px]"
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
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold">
        설명{" "}
        <span className="font-normal text-muted-foreground">클릭해서 편집</span>
      </span>
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
          className="rounded-[7px] border bg-transparent px-4 py-3 text-[13.5px] leading-relaxed outline-none focus:border-sidebar-primary"
        />
      ) : (
        <button
          type="button"
          onClick={startEditing}
          className={cn(
            "min-h-[76px] rounded-[7px] border px-4 py-3 text-left text-[13.5px] leading-relaxed transition-colors hover:border-sidebar-primary/40",
            !project.description && "text-muted-foreground",
          )}
        >
          {project.description || "설명을 입력하세요…"}
        </button>
      )}
    </div>
  );
}

export default ProjectDetail;

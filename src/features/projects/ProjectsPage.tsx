import { useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import ProjectList from "./ProjectList";
import { useCreateProject, useProjects } from "./hooks";

function ProjectsPage() {
  const { data: projects = [] } = useProjects();
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const createProject = useCreateProject();

  const selected =
    projects.find((p) => p.slug === selectedSlug) ?? projects[0] ?? null;

  const handleAdd = async () => {
    const folder = await open({ directory: true });
    if (typeof folder === "string") {
      const view = await createProject.mutateAsync(folder);
      setSelectedSlug(view.slug);
    }
  };

  return (
    <div className="flex min-h-0 flex-1">
      <ProjectList
        projects={projects}
        selectedSlug={selected?.slug ?? null}
        onSelect={setSelectedSlug}
        onAdd={handleAdd}
      />
      <div className="flex-1 overflow-y-auto">
        {selected && (
          /* Task 9에서 <ProjectDetail>로 교체 */
          <div className="p-8 text-2xl font-semibold">{selected.name}</div>
        )}
      </div>
    </div>
  );
}

export default ProjectsPage;

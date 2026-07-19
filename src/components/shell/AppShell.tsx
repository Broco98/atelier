import { useEffect, useState } from "react";
import Rail from "./Rail";
import SidebarToggle from "./SidebarToggle";
import ProjectsPage from "@/features/projects/ProjectsPage";
import type { NavKey } from "./nav-items";

const SIDEBAR_OPEN_KEY = "sidebar-open";

function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem(SIDEBAR_OPEN_KEY) !== "0",
  );
  const [activeKey, setActiveKey] = useState<NavKey>("projects");

  useEffect(() => {
    localStorage.setItem(SIDEBAR_OPEN_KEY, sidebarOpen ? "1" : "0");
  }, [sidebarOpen]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey && e.code === "KeyB") {
        e.preventDefault();
        setSidebarOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="relative flex h-screen bg-background text-foreground">
      <SidebarToggle open={sidebarOpen} onToggle={() => setSidebarOpen((open) => !open)} />
      <Rail open={sidebarOpen} activeKey={activeKey} onSelect={setActiveKey} />
      <main className="flex min-w-0 flex-1 flex-col">
        <header data-tauri-drag-region className="h-(--titlebar-height) shrink-0 border-b" />
        {activeKey === "projects" ? <ProjectsPage /> : <div className="flex-1" />}
      </main>
    </div>
  );
}

export default AppShell;

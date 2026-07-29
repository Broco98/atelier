import { useEffect, useState } from "react";
import Sidebar from "./Sidebar";
import SidebarToggle from "./SidebarToggle";
import StatusBar from "./StatusBar";
import useIsFullscreen from "./useIsFullscreen";
import ProjectsPage from "@/features/projects/ProjectsPage";
import WorksPage from "@/features/works/WorksPage";
import type { NavKey } from "./nav-items";

const SIDEBAR_OPEN_KEY = "sidebar-open";

function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(
    () => localStorage.getItem(SIDEBAR_OPEN_KEY) !== "0",
  );
  const [activeKey, setActiveKey] = useState<NavKey>("projects");
  // 페이지 간 이동(작업 ↔ 프로젝트)이 가능하도록 선택 상태는 셸이 소유한다
  const [projectSlug, setProjectSlug] = useState<string | null>(null);
  const [workSlug, setWorkSlug] = useState<string | null>(null);
  // 타이틀바 왼쪽 여백은 index.css의 [data-titlebar]가 계산한다 — 전체화면 여부만 여기서 알려준다
  const fullscreen = useIsFullscreen();

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
    <div
      data-titlebar={fullscreen ? "fullscreen" : "windowed"}
      className="relative flex h-screen flex-col bg-background text-foreground"
    >
      <div className="flex min-h-0 flex-1">
        <Sidebar open={sidebarOpen} activeKey={activeKey} onSelect={setActiveKey} />
        {activeKey === "projects" ? (
          <ProjectsPage
            sidebarOpen={sidebarOpen}
            selectedSlug={projectSlug}
            onSelect={setProjectSlug}
            onOpenWork={(slug) => {
              if (slug) setWorkSlug(slug);
              setActiveKey("works");
            }}
          />
        ) : (
          <WorksPage
            sidebarOpen={sidebarOpen}
            selectedSlug={workSlug}
            onSelect={setWorkSlug}
            onOpenProject={(slug) => {
              setProjectSlug(slug);
              setActiveKey("projects");
            }}
          />
        )}
      </div>
      <StatusBar />
      <SidebarToggle open={sidebarOpen} onToggle={() => setSidebarOpen((open) => !open)} />
    </div>
  );
}

export default AppShell;

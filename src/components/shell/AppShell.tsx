import { useEffect, useState, type ReactNode } from "react";
import Sidebar from "./Sidebar";
import SidebarToggle from "./SidebarToggle";
import StatusBar from "./StatusBar";
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

  // 키별로 "그 화면을 그리는 방법"을 담는다. 화면마다 요구하는 협력자가 다르므로
  // 컴포넌트가 아니라 렌더 함수를 담는다. navItems에 키가 늘면 여기 등록이 강제된다.
  const pages: Record<NavKey, () => ReactNode> = {
    projects: () => (
      <ProjectsPage
        sidebarOpen={sidebarOpen}
        selectedSlug={projectSlug}
        onSelect={setProjectSlug}
        onOpenWork={(slug) => {
          if (slug) setWorkSlug(slug);
          setActiveKey("works");
        }}
      />
    ),
    works: () => (
      <WorksPage
        sidebarOpen={sidebarOpen}
        selectedSlug={workSlug}
        onSelect={setWorkSlug}
        onOpenProject={(slug) => {
          setProjectSlug(slug);
          setActiveKey("projects");
        }}
      />
    ),
  };

  return (
    <div className="relative flex h-screen flex-col bg-background text-foreground">
      <div className="flex min-h-0 flex-1">
        <Sidebar open={sidebarOpen} activeKey={activeKey} onSelect={setActiveKey} />
        {pages[activeKey]()}
      </div>
      <StatusBar />
      <SidebarToggle open={sidebarOpen} onToggle={() => setSidebarOpen((open) => !open)} />
    </div>
  );
}

export default AppShell;

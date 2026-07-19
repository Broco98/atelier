import { useEffect, useState } from "react";
import { Zap } from "lucide-react";
import Sidebar from "./Sidebar";
import SidebarToggle from "./SidebarToggle";
import StatusBar from "./StatusBar";
import PlaceholderPage from "./PlaceholderPage";
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
    <div className="relative flex h-screen flex-col bg-background text-foreground">
      <div className="flex min-h-0 flex-1">
        <Sidebar open={sidebarOpen} activeKey={activeKey} onSelect={setActiveKey} />
        {activeKey === "projects" ? (
          <main className="flex min-w-0 flex-1 flex-col">
            {/* Task 6에서 ProjectsPage가 자체 브레드크럼을 가지면 이 래퍼를 제거한다 */}
            <header data-tauri-drag-region className="h-(--titlebar-height) shrink-0 border-b" />
            <ProjectsPage />
          </main>
        ) : (
          <PlaceholderPage
            root="Works"
            listHeader="Works"
            listHint="0"
            listEmpty={{
              icon: Zap,
              title: "작업이 없어요",
              body: "작업은 Claude Code에서 스킬로 시작돼요.",
            }}
            main={{
              icon: Zap,
              title: "아직 작업이 없어요",
              body: "작업이 시작되면 스펙 문서와 진행 상황이 여기에 나타나요.",
            }}
            sidebarOpen={sidebarOpen}
          />
        )}
      </div>
      <StatusBar />
      <SidebarToggle open={sidebarOpen} onToggle={() => setSidebarOpen((open) => !open)} />
    </div>
  );
}

export default AppShell;

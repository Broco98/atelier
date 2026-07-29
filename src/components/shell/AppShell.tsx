import { useEffect } from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import Sidebar from "./Sidebar";
import SidebarToggle from "./SidebarToggle";
import StatusBar from "./StatusBar";
import useIsFullscreen from "./useIsFullscreen";
import { shellStore, toggleSidebar } from "./shell-store";
import type { NavKey } from "./nav-items";

function AppShell() {
  const sidebarOpen = useStore(shellStore, (state) => state.sidebarOpen);
  // 타이틀바 왼쪽 여백은 index.css의 [data-titlebar]가 계산한다 — 전체화면 여부만 여기서 알려준다
  const fullscreen = useIsFullscreen();
  const navigate = useNavigate();
  // 어느 탭이 활성인지는 URL이 정한다 — 셸은 그것을 비출 뿐이다
  const activeKey = useRouterState({
    select: (state): NavKey =>
      state.location.pathname.startsWith("/works") ? "works" : "projects",
  });

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && !e.shiftKey && !e.altKey && !e.ctrlKey && e.code === "KeyB") {
        e.preventDefault();
        toggleSidebar();
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
        <Sidebar
          open={sidebarOpen}
          activeKey={activeKey}
          onSelect={(key) => void navigate({ to: key === "works" ? "/works" : "/projects" })}
        />
        <Outlet />
      </div>
      <StatusBar />
      <SidebarToggle open={sidebarOpen} onToggle={toggleSidebar} />
    </div>
  );
}

export default AppShell;

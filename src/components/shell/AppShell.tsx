import { useEffect } from "react";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import Sidebar from "./Sidebar";
import ShellControls from "./ShellControls";
import StatusBar from "./StatusBar";
import useIsFullscreen from "./useIsFullscreen";
import { shellStore, toggleSidebar } from "./shell-store";
import type { NavKey } from "./nav-items";

function AppShell() {
  const sidebarOpen = useStore(shellStore, (state) => state.sidebarOpen);
  // 타이틀바 왼쪽 여백은 index.css의 [data-titlebar]가 계산한다 — 전체화면 여부만 여기서 알려준다
  const fullscreen = useIsFullscreen();
  const navigate = useNavigate();
  // 어느 항목이 활성인지는 URL이 정한다 — 셸은 그것을 비출 뿐이다.
  // Works 화면에서는 활성 항목이 없다(nav에 Works가 없다). "지금 Works에 있다"는 것은
  // 사이드바 목록에서 그 작업 행이 강조되는 것으로 드러난다.
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const activeKey: NavKey | null = pathname.startsWith("/projects")
    ? "projects"
    : pathname.startsWith("/archive")
      ? "archive"
      : null;

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
          onSelect={(key) => {
            if (key === "archive") {
              // 아카이브의 무선택 주소는 **그 자체로 목록 화면**이라 상세에서 누르면 목록으로
              // 돌아간다. 여기서 활성 항목이 같은지로 막으면(상세에서도 활성은 Archive다)
              // 목록으로 가는 유일한 nav 경로가 죽는다. 막을 것은 완전히 같은 주소뿐이다.
              if (pathname === "/archive") return;
              void navigate({ to: "/archive" });
              return;
            }
            // Projects는 무선택 주소로 한 번 갔다가 항목 주소로 정규화된다. 이미 보고 있는
            // 화면이면 지금과 똑같은 위치가 히스토리에 한 칸 더 쌓일 뿐이다 —
            // 뒤로가기를 눌러도 화면이 그대로인 죽은 항목이 된다.
            if (activeKey === "projects") return;
            void navigate({ to: "/projects" });
          }}
        />
        <Outlet />
      </div>
      <StatusBar />
      <ShellControls sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />
    </div>
  );
}

export default AppShell;

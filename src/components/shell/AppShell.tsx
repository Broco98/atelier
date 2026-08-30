import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import AppDialog from "@/components/ui/AppDialog";
import { dialogStore } from "@/components/ui/confirm-store";
import SearchPalette from "@/features/search/SearchPalette";
import { searchHotkey } from "@/features/terminal/shell-registry";
import Sidebar from "./Sidebar";
import ShellControls from "./ShellControls";
import useIsFullscreen from "./useIsFullscreen";
import { menuHotkeyInit } from "./menu-hotkey";
import { shellStore, toggleSidebar } from "./shell-store";
import { navItems, type NavKey } from "./nav-items";

function AppShell() {
  const sidebarOpen = useStore(shellStore, (state) => state.sidebarOpen);
  // 타이틀바 왼쪽 여백은 index.css의 [data-titlebar]가 계산한다 — 전체화면 여부만 여기서 알려준다
  const fullscreen = useIsFullscreen();
  const navigate = useNavigate();
  // 어느 항목이 활성인지는 URL이 정한다 — 셸은 그것을 비출 뿐이다.
  // Works 화면에서는 활성 항목이 없다(nav에 Works가 없다). "지금 Works에 있다"는 것은
  // 사이드바 목록에서 그 작업 행이 강조되는 것으로 드러난다.
  // 파생을 select 안에서 끝낸다 — 밖에서 pathname을 구독하면 작업을 고를 때마다(주소의 slug가
  // 바뀔 때마다) 셸 전체가 리렌더한다. 여기서 걸러 두면 활성 항목이 실제로 바뀔 때만 돈다.
  const activeKey = useRouterState({
    select: (state): NavKey | null =>
      navItems.find((item) => state.location.pathname.startsWith(item.to))?.key ?? null,
  });
  // 설정은 `navItems`에 없다(결정 51) — 활성 판정도 따로 한 줄이다. 위 select에 합쳐
  // 객체 하나로 돌려주지 않는 이유는 그 주석과 같다: 매번 새 객체를 돌려주면 걸러내지 못해
  // 주소가 바뀔 때마다 셸 전체가 리렌더한다.
  const settingsActive = useRouterState({
    select: (state) => state.location.pathname.startsWith("/settings"),
  });

  // 네이티브 메뉴의 `atelier ▸ Settings…`(⌘,)가 여기로 온다(결정 51).
  // **이것이 셸에 포커스가 있어도 듣는 유일한 길이다** — OS 메뉴가 웹뷰보다 먼저 키를 먹어서
  // (결정 34가 ⌘W를 메뉴에서 손으로 빼야 했던 그 성질) 프런트의 keydown으로는 ⌘,를 잡을 수
  // 없다. 터미널을 쓰다 「글꼴이 작네」 하고 여는 흐름이 정확히 그 상황이라, 이번에는 그
  // 성질을 유리하게 쓴다.
  //
  // 배선은 `watcher.rs`가 `works:changed`를 쏘고 프런트가 `listen`으로 받는 그 길과 같다.
  // `navigate`는 라우터가 고정해 준다 (SidebarWorkList의 같은 주석).
  useEffect(() => {
    const unlisten = listen("settings:open", () => {
      void navigate({ to: "/settings" });
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [navigate]);

  // **프레임이 삼킨 단축키를 메뉴가 대신 받아 여기로 온다**(#153). 근거와 갈래는
  // `menu-hotkey.ts`가 든다 — 이 자리는 배선뿐이다. `settings:open` 바로 옆인 것은 그쪽도
  // 같은 성질이기 때문이다: OS 메뉴가 웹뷰보다 먼저 먹는 것을 유리하게 쓰는 길.
  useEffect(() => {
    const unlisten = listen<string>("hotkey:menu", ({ payload: code }) => {
      window.dispatchEvent(new KeyboardEvent("keydown", menuHotkeyInit(code)));
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

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

  // ⇧⇧로 검색을 연다(결정 3·4). ⌘B가 이미 이 자리에 있으므로 새 자리를 만들지 않는다.
  //
  // **판정은 순수 함수가 하고, 그것이 안 보는 둘을 여기서 든다.**
  //  - **직전 ⇧의 시각.** 리듀서라 상태를 밖에 둔다 — `useRef`인 것은 이 값이 화면에 안
  //    그려지기 때문이다. state로 두면 ⇧를 누를 때마다 앱 셸이 통째로 다시 그려진다.
  //  - **mousedown**(결정 30). 키만 보면 **⇧+클릭 두 번이 팔레트를 연다** — 그 사이에
  //    keydown이 하나도 안 끼기 때문이다. 본문에서 선택을 늘리는 흔한 동작이 그 모양이라
  //    무장을 비운다.
  //  - **떠 있는 확인 창.** 「어디서 눌렸나」(이벤트의 target)와 「화면에 무엇이 떠 있나」는
  //    다른 물음이고 주인도 다르다 — 이 앱의 창은 전역 스토어 하나가 든다. 구독하지 않고
  //    그 순간의 값만 읽는다: 창이 뜨고 지는 것으로 이 리스너를 다시 걸 이유가 없다.
  const armedAt = useRef<number | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (dialogStore.state !== null) {
        armedAt.current = null;
        return;
      }
      const arm = searchHotkey(e, armedAt.current);
      armedAt.current = arm.armedAt;
      if (arm.open) setSearchOpen(true);
    };
    const onMouseDown = () => {
      armedAt.current = null;
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("mousedown", onMouseDown);
    };
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
            // 이미 보고 있는 화면이면 아무것도 하지 않는다. 무선택 주소로 한 번 갔다가 항목 주소로
            // 정규화되는 경로라, 그냥 두면 지금과 똑같은 위치가 히스토리에 한 칸 더 쌓인다 —
            // 뒤로가기를 눌러도 화면이 그대로인 죽은 항목이 된다.
            // (두 목적지 모두 목록이 화면에 상주하므로 "목록으로 돌아가기"가 따로 필요 없다.)
            const target = navItems.find((item) => item.key === key);
            if (!target || key === activeKey) return;
            void navigate({ to: target.to });
          }}
          settingsActive={settingsActive}
          // `/settings`에는 정규화 리다이렉트가 없어서 위와 같은 가드가 필요 없다 —
          // 같은 위치로 가는 이동은 히스토리를 늘리지 않는다(router.test.ts).
          onOpenSettings={() => void navigate({ to: "/settings" })}
        />
        <Outlet />
      </div>
      <ShellControls sidebarOpen={sidebarOpen} onToggleSidebar={toggleSidebar} />
      {/* 검색도 여기 하나다 — 어느 화면에서 열든 같은 것이 뜬다. 확인 창 **앞에** 서는 것은
          층 순서다: 창이 떠 있는 동안에는 ⇧⇧가 안 먹으므로 둘이 겹칠 일이 없지만, 겹친다면
          답해야 하는 물음이 위여야 한다. */}
      {searchOpen && <SearchPalette onClose={() => setSearchOpen(false)} />}
      {/* 묻고 알리는 창은 **여기 하나뿐이다.** 부르는 쪽마다 그리면 두 물음이 겹칠 수 있고,
          그때 어느 것에 답했는지가 화면에서 사라진다. 사이드바 위에 서야 하므로 이 층이다. */}
      <AppDialog />
    </div>
  );
}

export default AppShell;

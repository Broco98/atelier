import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Outlet, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import AppDialog from "@/components/ui/AppDialog";
import { dialogStore } from "@/components/ui/confirm-store";
import SearchPalette from "@/features/search/SearchPalette";
import { SETTINGS_ENTRY, settingsItem, settingsPageOf } from "@/features/settings/pages";
import { searchHotkey } from "@/features/terminal/shell-registry";
import { quitShellCounts } from "@/features/terminal/terminal-store";
import { navItemsOf, navTargetOf } from "@/mode";
import Sidebar from "./Sidebar";
import ShellControls from "./ShellControls";
import useIsFullscreen from "./useIsFullscreen";
import { menuHotkeyInit } from "./menu-hotkey";
import { QUIT_REQUESTED_EVENT, quitApp, requestQuit } from "./quit-request";
import { navigatePlace } from "./navigate-place";
import {
  modeEntryTarget,
  modeSwitchTarget,
  shellMode,
  shellStore,
  toggleSidebar,
} from "./shell-store";
import type { NavKey } from "./nav-items";

function AppShell() {
  const sidebarOpen = useStore(shellStore, (state) => state.sidebarOpen);
  // 타이틀바 왼쪽 여백은 index.css의 [data-titlebar]가 계산한다 — 전체화면 여부만 여기서 알려준다
  const fullscreen = useIsFullscreen();
  const navigate = useNavigate();
  // 지금 어느 세계인가. **셋째 구독이고 값은 원시값이다** — 아래 둘과 한 select로 묶어
  // 객체 하나로 돌려주면 매번 새 객체라 걸러내지 못해 주소가 바뀔 때마다 셸 전체가
  // 리렌더한다(아래 두 주석이 지키는 그 최적화). 문자열 하나면 세계를 건널 때만 돈다.
  //
  // `modeOf`가 아니라 `shellMode`인 것은 **`/settings`가 세계 밖이기 때문**이다 — 접두사가
  // 없어 `modeOf`는 그 주소를 늘 Atelier로 눕히고, 그러면 Maison에서 설정을 거쳐 nav를 누른
  // 순간 아래 「nav 한 번에 세계를 안 떠난다」가 그 화면에서만 깨진다.
  const mode = useRouterState({ select: (state) => shellMode(state.location.pathname) });
  // 어느 항목이 활성인지는 URL이 정한다 — 셸은 그것을 비출 뿐이다.
  // Works 화면에서는 활성 항목이 없다(nav에 Works가 없다). "지금 Works에 있다"는 것은
  // 사이드바 목록에서 그 작업 행이 강조되는 것으로 드러난다.
  // 파생을 select 안에서 끝낸다 — 밖에서 pathname을 구독하면 작업을 고를 때마다(주소의 slug가
  // 바뀔 때마다) 셸 전체가 리렌더한다. 여기서 걸러 두면 활성 항목이 실제로 바뀔 때만 돈다.
  //
  // **훑는 배열이 모드의 것이다.** Atelier 배열로 `/maison/terminal`을 재면 접두사가 하나도
  // 안 맞아 활성 표시가 통째로 사라진다 — 그 세계에도 Terminal은 서 있는데.
  const activeKey = useRouterState({
    select: (state): NavKey | null =>
      navItemsOf(mode).find((item) => state.location.pathname.startsWith(item.to))?.key ?? null,
  });
  // 설정은 `navItems`에 없다(결정 51) — 판정도 따로 한 줄이다. 값은 **지금 선 설정 항목**이고
  // 설정 밖이면 `null`이다(UI개선 결정 21): 이 하나가 「사이드바가 설정 nav인가」와 「어느 항목이
  // 켜졌나」를 함께 답해서, 불리언에서 넓혀도 구독 수가 그대로다. 위 select에 합쳐 객체 하나로
  // 돌려주지 않는 이유는 그 주석과 같다: 매번 새 객체를 돌려주면 걸러내지 못해 주소가 바뀔 때마다
  // 셸 전체가 리렌더한다.
  const settingsPage = useRouterState({
    select: (state) => settingsPageOf(state.location.pathname),
  });
  // 문의 가드가 **부를 때** 주소를 읽는 데 쓴다(`navigatePlace`) — 구독이 아니다.
  const router = useRouter();

  // 네이티브 메뉴의 `atelier ▸ Settings…`(⌘,)가 여기로 온다(결정 51).
  // **이것이 셸에 포커스가 있어도 듣는 유일한 길이다** — OS 메뉴가 웹뷰보다 먼저 키를 먹어서
  // (결정 34가 ⌘W를 메뉴에서 손으로 빼야 했던 그 성질) 프런트의 keydown으로는 ⌘,를 잡을 수
  // 없다. 터미널을 쓰다 「글꼴이 작네」 하고 여는 흐름이 정확히 그 상황이라, 이번에는 그
  // 성질을 유리하게 쓴다.
  //
  // 배선은 `watcher.rs`가 `works:changed`를 쏘고 프런트가 `listen`으로 받는 그 길과 같다.
  // `router`는 라우터가 고정해 준다 (SidebarWorkList의 `navigate` 주석과 같다).
  //
  // **설정 안에서 누르면 아무 일도 없다**(UI개선 S18) — 가드는 이 문이 아니라 문 셋이 함께 지나는
  // `navigatePlace`에 있다.
  useEffect(() => {
    const unlisten = listen("settings:open", () => {
      void navigatePlace(router, { to: SETTINGS_ENTRY });
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [router]);

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

  // **앱을 끄려는 요청이 여기로 온다**(결정 14 · #223) — 지금은 빨간 버튼이고, #224가 ⌘Q·메뉴 Quit·Dock을
  // 같은 이벤트로 붙인다. 셸이 하나도 없어도 묻는다. 무엇을 세고 언제 무시하고 어디서 「묻는 중」을
  // 내리는지는 `quit-request.ts`가 전부 든다 — 이 자리는 배선뿐이고, 셸 목록을 쥔 스토어의 세기와
  // 끄는 명령을 건넨다. 다른 확인 창이 떠 있으면 스토어가 그것을 「아니오」로 접고 갈아 끼운다.
  useEffect(() => {
    const unlisten = listen(QUIT_REQUESTED_EVENT, () => {
      void requestQuit(quitShellCounts, quitApp);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  // ⌘B는 사이드바를 접고 편다. **확인 창이 떠 있어도 먹는다** — 아래 ⌘K와 갈리는 자리이고,
  // 그렇게 두는 근거는 이 키가 답을 요구하지 않기 때문이다(창은 그대로 서 있다). 그물은
  // L3 한 줄뿐이라(`search-palette.spec.ts`), 아래 게이트를 이 리스너로 끌어올리면 조용히
  // 죽는다.
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

  // ⌘K로 검색을 연다(팔레트 결정 1·2 — 이 파일에서 맨 `결정 N`은 앞 판들의 것이다).
  // ⌘B가 이미 이 자리에 있으므로 새 자리를 만들지 않는다.
  //
  // **여는 길이 이 키 하나는 아니다** — 셸 컨트롤 행의 검색 버튼이 아래에서 같은
  // `setSearchOpen`을 부르고, 네이티브 메뉴의 `View ▸ Search`가 합성 keydown으로 이 리스너에
  // 온다(팔레트 결정 3). 키 판정만 여기 있고, 떠 있는가는 이 state 하나가 안다.
  //
  // **판정은 순수 술어가 하고, 그것이 안 보는 하나를 여기서 든다 — 떠 있는 확인 창.**
  // 「무슨 키인가」와 「화면에 무엇이 떠 있나」는 다른 물음이고 주인도 다르다. 구독하지 않고
  // 그 순간의 값만 읽는다: 창이 뜨고 지는 것으로 이 리스너를 다시 걸 이유가 없다.
  //
  // **게이트가 이 키 가지 안에 있는 것이 중요하다.** ⇧⇧ 리스너는 그것을 핸들러 맨 위에
  // 뒀는데(무장을 함께 비워야 했다), 그 자리를 그대로 옮기면 **위 ⌘B가 확인 창 뒤에서 조용히
  // 함께 죽는다** — 지금은 먹고, 그것을 잡는 검사는 L3 한 줄뿐이다.
  //
  // ⇧⇧가 딛던 둘이 함께 사라졌다: 직전 ⇧의 시각을 드는 `useRef`와, ⇧+클릭 두 번을 막던
  // mousedown 무장 해제(옛 결정 30). 몸짓이 아니라 화음이라 무장이라는 상태 자체가 없다.
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!searchHotkey(e)) return;
      if (dialogStore.state !== null) return;
      e.preventDefault();
      // **여는 갈래뿐이다**(팔레트 결정 4). 이미 떠 있으면 이 setter가 아무것도 안 바꾼다 —
      // 토글이면 키가 두 번 도는 날 팔레트가 도로 닫히는데, 그것보다 이미 열린 것이 다시
      // 열리는 편이 낫다.
      setSearchOpen(true);
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
          mode={mode}
          onPickMode={(pick) => {
            // 목적지가 nav와 규칙이 다르다 — 그 세계의 **마지막 주소**이고 없으면 첫 화면이며,
            // 항목 주소면 그 항목의 마지막 화면이 씨앗으로 얹힌다. 규칙은 하나도 여기 없다
            // (`shell-store`의 `modeSwitchTarget`): 「같은 세계면 아무 데도 안 간다」도 그 씨앗도
            // 답의 일부라, 셋 중 하나라도 이 자리에서 다시 지으면 그 함수를 재는 검사들이 초록인
            // 채로 화면의 규칙만 갈린다. 그래서 **이동 전체를 받아 그대로 넘긴다.**
            //
            // 떠나온 세계로 **위 `mode`를 넘긴다** — 셸이 이미 든 값을 두고 주소를 다시 읽으면
            // 세계를 판정하는 자리가 둘이 된다. (설정에는 세그먼트가 없다 — UI개선 결정 21.)
            const go = modeSwitchTarget(mode, pick);
            if (!go) return;
            void navigate(go);
          }}
          activeKey={activeKey}
          onSelect={(key) => {
            // 이미 보고 있는 화면이면 아무것도 하지 않는다. 무선택 주소로 한 번 갔다가 항목 주소로
            // 정규화되는 경로라, 그냥 두면 지금과 똑같은 위치가 히스토리에 한 칸 더 쌓인다 —
            // 뒤로가기를 눌러도 화면이 그대로인 죽은 항목이 된다.
            // (두 목적지 모두 목록이 화면에 상주하므로 "목록으로 돌아가기"가 따로 필요 없다.)
            //
            // 목적지도 **그 세계의 배열**에서 나온다 — Maison에서 Terminal을 눌렀는데
            // Atelier의 `/terminal`로 가면 nav 한 번에 세계를 떠난다. 사이드바가 이제 같은
            // 배열을 그리므로(#183) 그 세계에 없는 key는 여기 올 일이 없고, 그래도 오면
            // `navTargetOf`가 `undefined`를 준다 — 아래 가드가 그때 아무 데도 안 간다.
            const target = navTargetOf(mode, key);
            if (!target || key === activeKey) return;
            void navigate({ to: target });
          }}
          settingsPage={settingsPage}
          // `/settings`는 첫 항목으로 치환되므로(UI개선 결정 22) 설정 안에서 보내면 보던 항목을
          // 떠나 칸이 쌓인다 — 설정 안에서는 이 버튼이 안 보이지만 ⌘,·팔레트와 **같은 문**을
          // 지나게 둔다(`navigatePlace`). 문마다 가드를 적으면 한 문이 잊는 날 그 문만 샌다.
          onOpenSettings={() => void navigatePlace(router, { to: SETTINGS_ENTRY })}
          // 항목끼리는 주소가 따로라 push다 — 뒤로가기가 앞 항목으로 간다(결정 22). 지금 항목을
          // 다시 눌러도 같은 위치로 가는 이동이라 칸이 안 는다(router.test.ts).
          onPickSettingsPage={(key) => void navigate({ to: settingsItem(key).to })}
          onLeaveSettings={() => {
            // 들어오기 직전 자리로 **한 번에** 간다(결정 27) — 항목을 몇 번 옮겼든 뒤로가기가
            // 아니라 push다. 넘기는 것은 **떠나온 모드 그대로**다: 설정은 세계를 안 실어 위
            // `mode`가 곧 떠나온 세계이고, 세그먼트 함수(`modeSwitchTarget`)를 부르면 같은
            // 세계라 늘 `null`이 나온다. 목적지 규칙은 하나도 여기 없다(`shell-store`).
            void navigate(modeEntryTarget(mode));
          }}
        />
        <Outlet />
      </div>
      {/* 검색 버튼이 부르는 것이 **바로 위 ⌘K 리스너가 부르는 그 setter다.** 여는 길을
          둘로 두면 「지금 떠 있는가」가 두 곳에 살고, 한쪽으로 연 팔레트를 다른 쪽이 모른다.
          이 버튼은 여는 갈래만 든다 — 떠 있는 동안에는 팔레트의 배경(z-50)이 이 행(z-20)을
          덮어 애초에 눌리지 않는다(ShellControls의 그 버튼 주석). */}
      <ShellControls
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
        onOpenSearch={() => setSearchOpen(true)}
      />
      {/* 검색도 여기 하나다 — 어느 화면에서 열든 같은 것이 뜬다. 확인 창 **앞에** 서는 것은
          층 순서다: 창이 떠 있는 동안에는 ⌘K가 안 먹으므로 둘이 겹칠 일이 없지만, 겹친다면
          답해야 하는 물음이 위여야 한다.

          **세계는 셸이 정한 것을 그대로 내린다** — 팔레트가 주소를 다시 되짚으면 `/settings`가
          늘 Atelier로 눕는다(위 `mode`의 주석이 든 그 성질). 여기 값은 이미 그것을 넘겼다. */}
      {searchOpen && <SearchPalette mode={mode} onClose={() => setSearchOpen(false)} />}
      {/* 묻고 알리는 창은 **여기 하나뿐이다.** 부르는 쪽마다 그리면 두 물음이 겹칠 수 있고,
          그때 어느 것에 답했는지가 화면에서 사라진다. 사이드바 위에 서야 하므로 이 층이다. */}
      <AppDialog />
    </div>
  );
}

export default AppShell;

import { useCallback, useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { Outlet, useNavigate, useRouter, useRouterState } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import AppDialog from "@/components/ui/AppDialog";
import { dialogStore } from "@/components/ui/confirm-store";
import SearchPalette, { armSearchPalette } from "@/features/search/SearchPalette";
import { navigateGuardingSettings } from "@/features/settings/navigate-guarding-settings";
import { useFollowLayoutChanges } from "@/features/spec-layout/hooks";
import { SETTINGS_ENTRY, settingsItem, settingsItemOf } from "@/features/settings/pages";
import { searchHotkey } from "@/features/terminal/shell-registry";
import { CLOSED_SHELL_NOTICE, CLOSED_SHELL_TOAST_ID, recallHotkey } from "@/features/terminal/shell-recall";
import { quitShellCounts, recalledShell } from "@/features/terminal/terminal-store";
import { invalidateWorks } from "@/features/works/hooks";
import { navigateThen } from "@/lib/arrival";
import Sidebar from "./Sidebar";
import ShellControls from "./ShellControls";
import AppToasts from "./AppToasts";
import ShellReclaim from "./ShellReclaim";
import ShellOwners from "./ShellOwners";
import { showAppToast } from "./app-toast";
import { endedNotice, PROCESSES_ENDED_EVENT, type ProcessesEnded } from "./processes-ended";
import { onViewProcesses } from "./processes-view";
import { startupNotices, startupReportStore } from "./startup-report";
import useGoToShell from "./useGoToShell";
import useIsFullscreen from "./useIsFullscreen";
import { menuHotkeyInit } from "./menu-hotkey";
import { QUIT_REQUESTED_EVENT, quitApp, requestQuit } from "./quit-request";
import { appReturnTarget, shellStore, toggleSidebar } from "./shell-store";
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
  // 설정은 `navItems`에 없다(결정 51) — 판정도 따로 한 줄이다. 값은 **지금 선 설정 항목**이고
  // 설정 밖이면 `null`이다(UI개선 결정 21): 이 하나가 「사이드바가 설정 nav인가」와 「어느 항목이
  // 켜졌나」를 함께 답해서, 불리언에서 넓혀도 구독 수가 그대로다. 위 select에 합쳐 객체 하나로
  // 돌려주지 않는다 — 매번 새 객체를 돌려주면 걸러내지 못해 주소가 바뀔 때마다 셸 전체가 리렌더한다.
  const currentSettingsItem = useRouterState({
    select: (state) => settingsItemOf(state.location.pathname),
  });
  // 문의 가드가 **부를 때** 주소를 읽는 데 쓴다(`navigateGuardingSettings`) — 구독이 아니다.
  const router = useRouter();

  // 네이티브 메뉴의 `atelier ▸ Settings…`(⌘,)가 여기로 온다(결정 51).
  // **이것이 셸에 포커스가 있어도 듣는 유일한 길이다** — OS 메뉴가 웹뷰보다 먼저 키를 먹어서
  // (결정 34가 ⌘W를 메뉴에서 손으로 빼야 했던 그 성질) 프런트의 keydown으로는 ⌘,를 잡을 수
  // 없다. 터미널을 쓰다 「글꼴이 작네」 하고 여는 흐름이 정확히 그 상황이라, 이번에는 그
  // 성질을 유리하게 쓴다.
  //
  // 배선은 `watcher.rs`가 `works:changed`를 쏘고 프런트가 `listen`으로 받는 그 길과 같다.
  // `router`는 라우터가 고정해 준다 (`-works-view.tsx`의 `goTo` 주석과 같다).
  //
  // **설정 안에서 누르면 아무 일도 없다**(UI개선 S18) — 가드는 이 문이 아니라 문 셋이 함께 지나는
  // `navigateGuardingSettings`에 있다.
  useEffect(() => {
    const unlisten = listen("settings:open", () => {
      void navigateGuardingSettings(router, { to: SETTINGS_ENTRY });
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [router]);

  // **work 목록이 바뀌었다는 알림을 듣는 자리가 여기 하나다**(프로세스 결정 18 ① · 티켓 14). 감시자(`watcher.rs`)가 works/
  // 아래가 바뀔 때마다 쏜다 — 에이전트가 spec을 쓰는 동안은 쉬지 않고 온다. 목록을 쓰는 훅이 저마다 들으면 부르는
  // 자리(사이드바 · 작업 화면 · 프로젝트 상세 · 아카이브 …)마다 구독이 붙어, 이벤트 한 번에 조회가 그 수만큼 돌았다(작업
  // 화면에서 넷). 셸은 어느 화면에서든 서 있으므로 여기서 한 번이면 다 덮는다. 조회 중에 온 것의 합치기, 옮기기 중 미룸,
  // 아카이브 목록은 무효화 문(`invalidateWorks`)이 든다 — 이 자리는 배선뿐이다. 이벤트의 모양이 바뀌어도
  // (감시자가 경로를 싣는 날) 여기 한 자리만 고친다. 이벤트에는 기다릴 사람이 없어 반환을 버린다.
  const queryClient = useQueryClient();
  useEffect(() => {
    const unlisten = listen("works:changed", () => {
      void invalidateWorks(queryClient);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, [queryClient]);

  // **프레임이 삼킨 단축키를 메뉴가 대신 받아 여기로 온다**(#153). 근거와 갈래는
  // `menu-hotkey.ts`가 든다 — 이 자리는 배선뿐이다. `settings:open`(위)과 같은 뿌리에서 듣는 것은 그쪽도
  // 같은 성질이기 때문이다: OS 메뉴가 웹뷰보다 먼저 먹는 것을 유리하게 쓰는 길.
  useEffect(() => {
    const unlisten = listen<string>("hotkey:menu", ({ payload: code }) => {
      window.dispatchEvent(new KeyboardEvent("keydown", menuHotkeyInit(code)));
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  // **레이아웃 폴더가 바뀌면 그것에서 나온 화면이 따라온다**(spec 레이아웃 결정 22) — 설정의 「spec
  // 레이아웃」, spec 패널 탭, 아카이브 문서 트리. 구독은 앱 전역에 하나라 뿌리인 여기서 한 번 부른다
  // (spec 레이아웃 구현 스펙 3절). 무엇을 지우는지는 그 훅이 든다 — 이 자리는 배선뿐이다.
  useFollowLayoutChanges();

  // **앱을 끄려는 요청이 여기로 온다**(결정 14 · #223) — 빨간 버튼도, ⌘Q·메뉴 Quit·Dock도(#224의
  // 델리게이트 훅) 같은 이벤트다. 셸이 하나도 없어도 묻는다. 무엇을 세고 언제 무시하고 어디서 「묻는 중」을
  // 내리는지, 끄기가 거절되면 어떻게 알리는지는 `quit-request.ts`가 전부 든다 — 이 자리는 배선뿐이고,
  // 셸 목록을 쥔 스토어의 세기와 끄는 명령을 건넨다. 다른 확인 창이 떠 있으면 스토어가 그것을
  // 「아니오」로 접고 갈아 끼운다.
  useEffect(() => {
    const unlisten = listen(QUIT_REQUESTED_EVENT, () => {
      void requestQuit(quitShellCounts, quitApp);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  // **시작 보고를 알리는 자리가 여기 하나다**(프로세스 결정 6 · 프로세스 스펙 S11). 묻는 것은 React보다 먼저
  // (`main.tsx`)이고 답은 스토어에 앉아 있다 — 셸이 선 뒤에 읽어야 토스트가 설 자리가 있다. 셸은 어느 화면에서든
  // 서 있으므로 부팅 첫 화면이 무엇이든 뜬다.
  //
  // **이펙트가 두 번 돌아도 토스트는 하나다** — StrictMode(dev)가 이 이펙트를 두 번 돌리는데, 알릴 말마다
  // 늘 같은 id가 붙어 있어(`startupNotices`) 두 번째는 새로 서지 않고 그 자리를 고친다. 순서도 맞다: 토스트
  // 자리(`AppToasts`)가 이 셸의 자식이라 그 Provider가 매니저에 붙는 이펙트가 이것보다 먼저 돈다.
  const startupReport = useStore(startupReportStore, (report) => report);
  useEffect(() => {
    if (startupReport) startupNotices(startupReport).forEach(showAppToast);
  }, [startupReport]);

  // **셸이 스스로 끝나며 그 셸에서 띄운 것을 끝냈을 때**(프로세스 스펙 S49 · P4 · 티켓 13). 사람이 끝내기를 고르지 않은
  // 길이라 알린다 — 셸은 어느 화면에서든 끝날 수 있어(최상위 터미널, 작업 화면의 탭) 토스트 자리와 같은 이 셸에서 듣는다.
  // 시작 보고와 달리 스토어를 거치지 않는다: 셸은 웹뷰가 뜬 뒤에 띄우므로 이 자리가 늘 먼저 서 있다. 무엇을 말할지는
  // `processes-ended.ts`가 든다 — 이 자리는 배선뿐이다.
  useEffect(() => {
    const unlisten = listen<ProcessesEnded>(PROCESSES_ENDED_EVENT, ({ payload }) => {
      const notice = endedNotice(payload);
      if (notice) showAppToast(notice);
    });
    return () => {
      void unlisten.then((fn) => fn());
    };
  }, []);

  // **`Processes`로 가는 문의 길을 건다**(프로세스 스펙 S15 · S14 · 티켓 32). 토스트의 [보기]와 띠의 주인 잃은 셸 줄은 React
  // 밖에서 짓거나(스토어 · 순수 모듈) 라우터를 안 쥐어 그 문(`viewProcesses`)을 두드리고, 라우터를 쥔 이 셸이 간다.
  // 「목적지를 짓고 → 닿음을 걸고 → 이동한다」의 순서는 `navigateThen`이 든다.
  //
  // **가서 할 일(토스트 내리기)은 닿은 순간이다**(`navigateThen`의 `processes` 칸 — develop 머지). 이 셸은 설정에도 서고, spec
  // 레이아웃 편집기의 떠날 때 확인이 이 이동을 막을 수 있다 — [계속 편집]이면 토스트가 남는다(`useGoToShell`과 같은 함수).
  useEffect(
    () => onViewProcesses((arrived) => navigateThen(router, { to: "/processes" }, arrived, "processes")),
    [router],
  );

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
  // **여는 길은 이 함수 하나다** — ⌘K(메뉴의 합성 keydown도 이리 온다)와 검색 버튼이 함께 부른다.
  // 여는 **그 순간** 팔레트의 첫 프레임 가드를 켠다(S24): 팔레트가 그려지고 포커스가 들어오기를
  // 기다리면, 그 사이에 친 글자가 셸로 간다. 켜는 것은 state보다 먼저다.
  //
  // **여는 갈래뿐이다**(팔레트 결정 4). 이미 떠 있으면 이 setter가 아무것도 안 바꾼다 — 토글이면
  // 키가 두 번 도는 날 팔레트가 도로 닫히는데, 그것보다 이미 열린 것이 다시 열리는 편이 낫다.
  // 떠 있는 채로 켠 가드는 다음 키에서 포커스가 이미 팔레트 안인 것을 보고 스스로 꺼진다.
  const openSearch = useCallback(() => {
    armSearchPalette();
    setSearchOpen(true);
  }, []);
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!searchHotkey(e)) return;
      if (dialogStore.state !== null) return;
      e.preventDefault();
      openSearch();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openSearch]);

  // ⌘J는 **방금 부른 셸로** 간다(프로세스 결정 16 · 프로세스 스펙 S59 · P3 · 티켓 23) — 가장 최근에 부르는 상태(기다림 · 확인할
  // 것)에 들어선 셸이다. 무엇을 기억하는지는 스토어가(`recalledShell` — 규칙은 `shell-recall.ts`), 가는 길은 띠의 줄과 같은
  // 함수가 든다(`useGoToShell`). 이 자리는 키와 게이트와 「닫혔다」 토스트뿐이다.
  //
  // **셸에 포커스가 있어도 먹는다.** xterm은 ⌘가 붙은 글자 키를 셸로 안 보내고 막지도 않아 창까지 올라오고, 메뉴의
  // `View ▸ Last Calling Shell`이 먼저 받으면 합성 keydown으로 이 리스너에 온다(`menu-hotkey.ts`).
  //
  // **확인 창이나 팔레트가 떠 있으면 안 먹는다.** 확인 창은 답을 기다리는 동안 화면을 옮기지 않는다(위 ⌘K의 게이트와 같다).
  // 팔레트는 제 입력칸에 포커스를 빌렸다가 닫힐 때 돌려주는데(`SearchPalette`), 그 사이에 셸로 가면 두 자리가 포커스를 다툰다 —
  // 셸에 준 포커스를 팔레트가 닫히며 옛 자리로 되돌린다. Esc로 닫고 누르면 된다.
  //
  // **떠날 때 확인이 걸린 편집기에서는 먹는다**(develop 머지) — 그 화면을 떠나는 다른 길처럼 이동이 그 물음을 지난다. [계속
  // 편집]이면 셸로 가는 길은 아무것도 남기지 않는다: 셸 켜기와 포커스 요청은 이동이 닿은 순간이다(`navigateThen`).
  //
  // **부른 셸이 없어도 키는 먹는다**(`preventDefault`) — 메뉴가 같은 키를 한 번 더 받아 합성 keydown이 돌아와도 같은 답이지만,
  // 한 번 누른 키가 두 번 도는 길을 열어 두지 않는다.
  //
  // **그 셸이 닫혔으면 토스트로 끝낸다**(fail-closed) — 먼저 부른 다른 셸로 대신 가지도, 옛 자리로 옮기지도 않는다.
  const goToShell = useGoToShell();
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (!recallHotkey(e)) return;
      if (dialogStore.state !== null || searchOpen) return;
      e.preventDefault();
      const target = recalledShell();
      if (target === null) return;
      if (target.kind === "closed") {
        showAppToast({ id: CLOSED_SHELL_TOAST_ID, text: CLOSED_SHELL_NOTICE });
        return;
      }
      goToShell(target.shell);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [goToShell, searchOpen]);

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
            //
            // 목적지는 사이드바가 그리는 **같은 배열**에서 나온다(#183). 없는 key가 오면
            // `undefined`다 — 아래 가드가 그때 아무 데도 안 간다.
            const target = navItems.find((item) => item.key === key)?.to;
            if (!target || key === activeKey) return;
            void navigate({ to: target });
          }}
          currentSettingsItem={currentSettingsItem}
          // `/settings`는 첫 항목으로 치환되므로(UI개선 결정 22) 설정 안에서 보내면 보던 항목을
          // 떠나 칸이 쌓인다 — 설정 안에서는 이 버튼이 안 보이지만 ⌘,·팔레트와 **같은 문**을
          // 지나게 둔다(`navigateGuardingSettings`). 문마다 가드를 적으면 한 문이 잊는 날 그 문만
          // 샌다.
          onOpenSettings={() => void navigateGuardingSettings(router, { to: SETTINGS_ENTRY })}
          // 항목끼리는 주소가 따로라 push다 — 뒤로가기가 앞 항목으로 간다(결정 22). 지금 항목을
          // 다시 눌러도 같은 위치로 가는 이동이라 칸이 안 는다(router.test.ts).
          onPickSettingsItem={(key) => void navigate({ to: settingsItem(key).to })}
          onLeaveSettings={() => {
            // 들어오기 직전 자리로 **한 번에** 간다(결정 27) — 항목을 몇 번 옮겼든 뒤로가기가
            // 아니라 push다. 목적지 규칙은 하나도 여기 없다(`shell-store`).
            void navigate(appReturnTarget());
          }}
        />
        <Outlet />
      </div>
      {/* 검색 버튼이 부르는 것이 **바로 위 ⌘K 리스너가 부르는 그 함수다.** 여는 길을
          둘로 두면 「지금 떠 있는가」가 두 곳에 살고, 한쪽으로 연 팔레트를 다른 쪽이 모른다.
          이 버튼은 여는 갈래만 든다 — 떠 있는 동안에는 팔레트의 배경(z-50)이 이 행(z-20)을
          덮어 애초에 눌리지 않는다(ShellControls의 그 버튼 주석). */}
      <ShellControls
        sidebarOpen={sidebarOpen}
        onToggleSidebar={toggleSidebar}
        onOpenSearch={openSearch}
      />
      {/* 검색도 여기 하나다 — 어느 화면에서 열든 같은 것이 뜬다. 창이 떠 있는 동안에는 ⌘K가
          안 먹지만, 팔레트가 먼저 떠 있을 때 물음이 오면(종료 요청) 둘이 겹친다 — 그때는 답해야
          하는 물음이 위다. 둘 다 `body` 끝의 포털로 서고 뜰 때 붙으므로, 나중에 뜬 확인 창이 늘
          위다. 포커스도 확인 창으로 가서, Esc 한 번은 확인 창만 닫는다. */}
      <SearchPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
      {/* 이 work의 토스트(프로세스 스펙 P2). 셸에 서서 어느 화면에서든 보인다 — 자리와 Provider의
          범위는 그 파일이 든다. */}
      <AppToasts />
      {/* 둘러보다 저절로 뜬 셸이 입력 없이 화면을 떠나면 닫는다(프로세스 결정 7). 떠남은 라우터의 owner로 재므로
          셸 한 자리에 선다 — 라우터 구독은 제 파일에 있다(위 구독 셋을 늘리지 않는다). */}
      <ShellReclaim />
      {/* MCP로 아카이브 · 삭제된 work의 셸을 다룬다(프로세스 결정 4 · 티켓 12) — 목록 쿼리의 결과를 구독해 주인 잃은 셸을
          찾는다. 쿼리 구독은 제 파일에 있다. */}
      <ShellOwners />
      {/* 묻고 알리는 창은 **여기 하나뿐이다.** 부르는 쪽마다 그리면 두 물음이 겹칠 수 있고,
          그때 어느 것에 답했는지가 화면에서 사라진다. 그리는 것은 포털이라 자리는 이 트리 밖이다. */}
      <AppDialog />
    </div>
  );
}

export default AppShell;

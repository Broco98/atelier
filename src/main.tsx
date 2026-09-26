import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { ToastProvider } from "@/components/ui/toast";
import { TooltipProvider } from "@/components/ui/tooltip";
import { router } from "./router";
import { queryClient } from "./query-client";
import { installScrollQuiet } from "./lib/scroll-quiet";
import { loadTerminalSettings } from "./features/terminal/terminal-settings";
import { loadNotifySettings } from "./features/terminal/notify-settings";
import "./index.css";

installScrollQuiet();

// 셸이 쓸 글꼴·크기·테마를 **앱이 뜰 때 한 번** 읽어 둔다(결정 52). 이펙트가 아니라 여기인
// 이유 둘: 이 값을 그리는 React 화면이 없고(읽는 쪽은 React 밖에 사는 xterm 인스턴스다),
// 렌더보다 먼저 걸어 두면 첫 셸이 뜨는 순간 값이 이미 와 있을 가능성이 가장 크다.
// 늦게 와도 이미 떠 있는 칸이 따라오고, 못 읽으면 기본값으로 간다 — 둘 다 그 모듈이 진다.
void loadTerminalSettings();
// 알림 구획도 같은 자리에서 한 번 읽는다(#206). 읽는 쪽이 React 밖이고(모듈 구독이 쏜다)
// 되읽을 신호가 없는 것까지 위와 같다 — 왜 한 번으로 안 합쳤는지는 그 모듈이 든다.
void loadNotifySettings();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      {/* 툴팁의 지연을 앱 전체가 **한 Provider**에서 나눠 쓴다(S3) — 한 번 뜬 뒤 옆 트리거로
          옮기면 바로 뜨는 것이 이 묶음 덕이다. registry의 `Tooltip`은 제 Provider를 싸지 않으므로
          이것이 없으면 지연이 트리거마다 따로 돈다. 600ms는 부품 파일의 기본값이다. */}
      <TooltipProvider>
        {/* 토스트도 Provider는 **여기 하나**다(S14). 자리(Viewport)는 화면마다 지금 토스트 자리에 두고 —
            작업 화면과 아카이브 화면 — 한 번에 한 화면만 서므로 늘 하나다. Tooltip과 달리 Viewport는
            Provider 밖에서 던진다. */}
        <ToastProvider>
          <RouterProvider router={router} />
        </ToastProvider>
      </TooltipProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);

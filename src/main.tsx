import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { queryClient } from "./query-client";
import { installScrollQuiet } from "./lib/scroll-quiet";
import { loadTerminalSettings } from "./features/terminal/terminal-settings";
import { loadNotifySettings } from "./features/terminal/notify-settings";
import { loadStartupReport } from "./components/shell/startup-report";
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
// 시작 보고(프로세스 스펙 S11)도 **여기서 한 번** 묻는다. 위 둘과 까닭이 하나 다르다: 이것을 그리는 React
// 화면은 있다(앱 셸의 토스트). 그래도 이펙트에 두지 않는 것은 StrictMode가 이펙트를 두 번 돌려 묻는 것도
// 두 번이 되기 때문이다 — 답은 스토어에 두고 셸이 서서 읽는다(`startup-report.ts`).
void loadStartupReport();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);

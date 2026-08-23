import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { router } from "./router";
import { queryClient } from "./query-client";
import { installScrollQuiet } from "./lib/scroll-quiet";
import { loadTerminalSettings } from "./features/terminal/terminal-settings";
import "./index.css";

installScrollQuiet();

// 셸이 쓸 글꼴·크기·테마를 **앱이 뜰 때 한 번** 읽어 둔다(결정 52). 이펙트가 아니라 여기인
// 이유 둘: 이 값을 그리는 React 화면이 없고(읽는 쪽은 React 밖에 사는 xterm 인스턴스다),
// 렌더보다 먼저 걸어 두면 첫 셸이 뜨는 순간 값이 이미 와 있을 가능성이 가장 크다.
// 늦게 와도 이미 떠 있는 칸이 따라오고, 못 읽으면 기본값으로 간다 — 둘 다 그 모듈이 진다.
void loadTerminalSettings();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>,
);

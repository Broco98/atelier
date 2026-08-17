import { defineConfig, devices } from "@playwright/test";

// 이 층 전용 포트다. 앱 dev 서버(1420)를 재사용하지 않는다.
//
// 이 저장소는 work마다 워크트리를 두고, vite는 어느 워크트리에서든 1420을 strictPort로
// 잡는다 — 머신에 dev 서버는 하나뿐이다. 그 하나를 재사용하면 L3가 **다른 브랜치의
// 코드**를 검사하고 초록을 준다. 실제로 그렇게 통과한 적이 있다(2026-08-17, 옆 워크트리의
// 서버를 물었다). 그래서 재사용을 끄고 전용 포트를 쓴다. 이 포트가 이미 잡혀 있으면
// `--strictPort`가 즉시 죽어 요란하게 실패한다 — 조용히 남의 코드를 검사하는 것보다 낫다.
const PORT = 1430;

// 앱은 macOS에서 WKWebView 위에 산다. 같은 엔진(WebKit)으로 봐야 이 층이 실물을
// 예측한다 — Chromium에서만 통과하는 CSS·히스토리 동작을 초록으로 넘기지 않는다.
export default defineConfig({
  testDir: "e2e",
  reporter: "list",
  forbidOnly: !!process.env.CI,
  use: { baseURL: `http://localhost:${PORT}` },
  projects: [{ name: "webkit", use: { ...devices["Desktop Safari"] } }],
  webServer: {
    command: `pnpm dev --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    // 포트를 잡고 있으면서 HTTP에 답하지 않는 프로세스가 있으면 여기서 끊는다.
    // 없으면 `pnpm verify`가 출력 없이 영원히 멈춘다.
    timeout: 60_000,
  },
});

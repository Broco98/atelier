import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, PORT } from "./e2e/dev-server";
import evidence from "./scripts/evidence-dir.json" with { type: "json" };

// 앱은 macOS에서 WKWebView 위에 산다. 같은 엔진(WebKit)으로 봐야 이 층이 실물을
// 예측한다 — Chromium에서만 통과하는 CSS·히스토리 동작을 초록으로 넘기지 않는다.
export default defineConfig({
  testDir: "e2e",
  // 기본값과 같지만 **적어 둔다.** verify.mjs가 매 실행 시작에 이 폴더를 비우므로,
  // 암묵적 기본값에 기대면 그쪽이 무엇을 지우는지 아무 데도 안 적힌 것이 된다.
  outputDir: evidence.evidenceDir,
  reporter: "list",
  forbidOnly: !!process.env.CI,
  // 실패한 순간의 화면. 나머지 증거(콘솔·DOM)는 e2e/evidence.ts가 같은 폴더에 넣는다.
  use: { baseURL: BASE_URL, screenshot: "only-on-failure" },
  projects: [{ name: "webkit", use: { ...devices["Desktop Safari"] } }],

  // 서버를 띄운 **뒤**, 그것이 이 워크트리의 것인지 확인하고 나서 테스트가 돈다.
  globalSetup: "./e2e/assert-own-server.ts",

  webServer: {
    // 앱 dev 서버(1420)를 재사용하지 않는다. 그것을 물면 L3가 다른 브랜치의 코드를
    // 검사하고 초록을 준다 — 2026-08-17에 실제로 그렇게 통과한 것이 리뷰에서 잡혔다.
    command: `pnpm dev --port ${PORT} --strictPort`,
    url: BASE_URL,
    reuseExistingServer: false,
    // 서버가 응답하기를 기다리는 한계. 넘으면 멈춰 있는 대신 실패한다.
    timeout: 60_000,
  },
});

import { expect, PAGES_PER_BROWSER, test } from "./evidence";

// **한 워커가 페이지를 64개 넘게 열어도 L3가 멎지 않는다.**
//
// macOS 27의 Playwright WebKit(1.62.1)은 페이지 하나를 열 때마다 브라우저 프로세스의 GCD 일꾼 스레드 하나를 놓아주지 않는다
// (`-[NSAnimation _runBlocking]`에서 끝나지 않는 채 남는다). 묶인 스레드가 커널 상한(`kern.wq_max_constrained_threads` = 64)에
// 닿으면 그 브라우저의 네트워크 일이 돌 스레드가 없어 **다음 `page.goto`가 응답 없이 멎는다** — 빈 DOM으로 30초를 다 쓴다.
// 워커 하나가 대략 60번째 테스트에서 그렇게 멎고, 실패한 워커는 새로 떠서 다시는 그 수에 못 닿으므로 전체 실행에서 워커마다
// 하나씩, 매번 다른 테스트가 빨개졌다. 부하 탓으로 읽히기 쉬운 모양이다.
//
// 이 검사는 그 수를 넘겨 연다. 페이지를 여는 길은 `context` 픽스처가 쓰는 그 길이다(`evidence.ts`의 `recyclingBrowser`).

/** 상한(64)을 넘기는 수. */
const PAGES = 70;

test("한 워커에서 페이지를 상한보다 많이 열어도 매번 주소의 응답이 온다 — 그 사이 브라우저를 갈아 끼운다", async ({
  recyclingBrowser,
}) => {
  test.setTimeout(180_000);
  const browsers = new Set<unknown>();
  for (let opened = 0; opened < PAGES; opened += 1) {
    const context = await recyclingBrowser.newContext();
    browsers.add(context.browser());
    const page = await context.newPage();
    // 앱 번들이 아니라 정적 파일이다 — 멎는 것은 앱이 아니라 브라우저의 네트워크 길이다.
    const response = await page.goto("/vite.svg", { timeout: 15_000 });
    expect(response?.ok(), `${opened + 1}번째 페이지`).toBe(true);
    await context.close();
  }
  // 문이 실제로 갈아 끼웠는가 — 갈아 끼우지 않고 다 왔다면 위의 응답들은 이 문을 잰 것이 아니다.
  expect(browsers.size).toBeGreaterThanOrEqual(Math.floor(PAGES / PAGES_PER_BROWSER));
});

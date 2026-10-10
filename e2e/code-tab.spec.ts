import { expect, test, type Page } from "./evidence";
import { WORKS } from "./fixtures";
import { awaitSpawned, installFixtureBackend, unknownIpcCalls } from "./harness";

// git-integration 판 01 티켓 04(#477) — **파일 탭이 주소로 열리고, `×`와 ⌘W로 닫힌다.**
//
// 파일 탭은 셸 탭과 한 묶음이다(결정 31). 주소 `?tab=code&code=<프로젝트>/<경로>`가 「묶음의 지금 탭이 그 파일이다」를 말하고
// (S12), 묶음에 없으면 끝에 연다(스토리 60). 닫기는 확인이 없다(스토리 37 · 50) — 셸의 ⌘W는 지금처럼 묻는다(스토리 51).
//
// 본문은 지금 있는 원문 보기(줄 번호, 강조 없음)다 — 강조는 08이 갈아 끼운다.

// 워크트리가 하나(`billing`)인 work — 셸이 저절로 뜨는 화면이다.
const [work] = WORKS;

const codeUrl = (ref: string, slug = work.slug) => `/works/${slug}?tab=code&code=${encodeURIComponent(ref)}`;

/** 묶음의 칸들 — 탭 줄 스크롤 상자 안, 왼쪽부터. 셸이든 파일이든 센다. */
const 묶음 = (page: Page) => page.locator("[data-tab-strip] > [data-tab]");
const 파일탭들 = (page: Page) => page.locator('[data-tab="code"]');
/** 그 파일 탭 — 정체(`<프로젝트>/<경로>`)로 집는다. */
const 파일탭 = (page: Page, ref: string) => page.locator(`[data-tab="code"][data-code="${ref}"]`);
/** 켜짐을 말하는 이름 버튼. */
const 파일탭이름 = (page: Page, ref: string) => 파일탭(page, ref).locator("button[aria-pressed]");
/** 코드 카드 — 접근 이름이 그 파일의 경로다(스토리 89). */
const 코드카드 = (page: Page, ref: string) => page.getByRole("main", { name: ref, exact: true });

/**
 * 앱 안에서 주소를 바꾼다 — 링크 · 팔레트 · 대화창이 하는 push와 같다. **다시 띄우지 않는다**: `page.goto`는 앱을 새로 세워
 * 메모리에만 사는 묶음(결정 33)을 지운다. 라우터의 기록(`@tanstack/history`)이 `pushState`를 감싸 듣고 있어 이 한 번으로
 * 화면이 따라오고, 뒤로가기도 이 자리를 센다.
 */
async function 주소로간다(page: Page, url: string): Promise<void> {
  await page.evaluate((next) => {
    const state = (window.history.state ?? {}) as Record<string, unknown>;
    const index = (typeof state.__TSR_index === "number" ? state.__TSR_index : 0) + 1;
    window.history.pushState({ ...state, __TSR_index: index, key: `t${index}`, __TSR_key: `t${index}` }, "", next);
  }, url);
}

test("주소가 가리키는 파일이 묶음 끝에 파일 탭으로 서고, 본문에 줄 번호 붙은 원문과 경로 줄이 뜬다", async ({ page }) => {
  await installFixtureBackend(page);
  // 셸 한 칸이 선 묶음에서 시작한다 — 「끝에 붙는다」를 재려면 앞에 칸이 있어야 한다.
  await page.goto(`/works/${work.slug}?tab=terminal`);
  await awaitSpawned(page, 1);

  await 주소로간다(page, codeUrl("billing/src/main.ts"));

  await expect(묶음(page)).toHaveCount(2);
  await expect(묶음(page).last()).toHaveAttribute("data-code", "billing/src/main.ts");
  await expect(파일탭이름(page, "billing/src/main.ts")).toHaveAttribute("aria-pressed", "true");
  // 셸 칸은 꺼진다 — 본문이 파일이다.
  await expect(묶음(page).first().locator("button[aria-pressed]")).toHaveAttribute("aria-pressed", "false");

  const card = 코드카드(page, "billing/src/main.ts");
  await expect(card).toBeVisible();
  // 경로 줄 — `<프로젝트> › 폴더 › 파일`(S17).
  await expect(card.getByRole("navigation", { name: "위치" })).toHaveText("billingsrcmain.ts");
  // 줄 번호 붙은 원문 — 줄마다 번호가 앞에 선다.
  await expect(card).toContainText(/1\s*const answer = 42;\s*2\s*\/\/ 끝까지 읽는다\s*3\s*export default "answer";/);
  // 셸 화면은 내려갔다 — 본문은 하나다.
  await expect(page.locator(".xterm")).toHaveCount(0);

  // **같은 주소로 다시 가도 탭은 하나다**(스토리 24) — 정체가 같으면 새로 서지 않는다.
  await page.locator('[data-tab="spec"]').click();
  await expect(card).toHaveCount(0);
  await 주소로간다(page, codeUrl("billing/src/main.ts"));
  await expect(card).toBeVisible();
  await expect(파일탭들(page)).toHaveCount(1);
  await expect(묶음(page)).toHaveCount(2);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

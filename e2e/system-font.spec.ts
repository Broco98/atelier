import { fontList, SYSTEM_MONO, SYSTEM_SANS } from "@/system-font";
import { expect, test, type Locator } from "./evidence";
import { PROJECTS, WORKS } from "./fixtures";
import { awaitSpawned, installFixtureBackend, unknownIpcCalls } from "./harness";

// codex-ds 티켓 02 — 앱 글자가 **시스템 글꼴**이다(codex-ds 결정 3: 글꼴도 캔버스 값). 글꼴 패키지(Geist · Pretendard)를
// 들이지 않고, 본문은 DS의 시스템 sans 줄, 코드 · 경로 값은 시스템 mono 줄로 그린다. 터미널만 번들한 글꼴 그대로다.
//
// **재는 것은 선언된 줄이지 그려진 얼굴이 아니다.** computed `font-family`는 어느 OS에서나 적힌 목록을 돌려준다 — macOS는
// SF Pro · SF Mono로, 리눅스(PR 게이트)는 제 sans-serif · 고정폭으로 그린다. 그려진 얼굴은 OS마다 달라 검사가 집을 수 없고,
// 글자 폭에 기대던 검사는 그래서 관계로 잰다(`works-sidebar`의 마퀴 · `terminal-tabs`의 탭 이름 · `tab-row.ts`의 탭 줄 바닥 ·
// `frame`의 편집기 카드 머리).
//
// 이 층에서만 보인다: 유틸리티(`font-sans` · `font-mono`)가 토큰을 읽어 실제 요소에 서는지는 진짜 CSS가 있어야 난다.

const [, plainWork, multiWork] = WORKS;
const [project] = PROJECTS;

// 견주는 두 줄은 DS(「Atelier」 2판 `tokens.json`의 `type.families`)에서 옮긴 것이다(`src/system-font.ts` — L2
// `theme-tokens`와 함께 쓴다). computed 값에서 이름에 따옴표를 붙일지는 엔진이 정하므로 따옴표를 떼고 견준다(`fontList`).
const 글꼴 = async (target: Locator) => fontList(await target.evaluate((el) => getComputedStyle(el).fontFamily));

test("본문 글자는 시스템 글꼴 줄이고, 코드 · 경로 값은 시스템 mono 줄이다", async ({ page }) => {
  await installFixtureBackend(page);

  // 프로젝트 화면 — 제목과 속성 이름은 본문, 경로 값은 mono다(DS 「글자」 표의 `code` — 경로 값).
  await page.goto(`/projects/${project.slug}`);
  const 상세 = page.getByLabel("프로젝트", { exact: true });
  const 경로 = 상세.getByText(project.path, { exact: true });
  await expect(경로).toBeVisible();
  expect(await 글꼴(page.locator("body"))).toBe(fontList(SYSTEM_SANS));
  expect(await 글꼴(상세.getByText("경로", { exact: true }))).toBe(fontList(SYSTEM_SANS));
  expect(await 글꼴(경로)).toBe(fontList(SYSTEM_MONO));

  // 문서 — 제목은 본문 줄, 코드 블록은 mono다.
  await page.goto(`/works/${multiWork.slug}?file=${encodeURIComponent("넓은.md")}`);
  const 제목 = page.getByRole("heading", { name: "넓은 문서" });
  await expect(제목).toBeVisible();
  expect(await 글꼴(제목)).toBe(fontList(SYSTEM_SANS));
  expect(await 글꼴(page.getByText("넓은줄".repeat(400), { exact: true }))).toBe(fontList(SYSTEM_MONO));

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **앱이 들이는 글꼴 얼굴은 터미널 두 벌뿐이다** — 글꼴 패키지를 다시 들이면 그 `@font-face`가 문서에 서서 여기가 빨개진다.
// 그리고 터미널은 그 얼굴을 기다려 연다(결정 55 — 앱 글꼴이 시스템 글꼴로 바뀌어도 터미널은 번들 글꼴 · 사용자 설정 그대로다).
//
// xterm이 받은 `fontFamily`는 이 층에서 DOM에 안 드러난다 — WebGL 렌더러가 캔버스에 그리고 글자 폭도 캔버스로 잰다. 그
// 옵션이 `FONT_FAMILY`(맨 앞이 번들 얼굴)라는 것은 `terminal-defaults.test.ts`가 들고, 여기는 그 얼굴이 실제로 청구됐는가를 잰다.
test("앱이 들이는 글꼴 얼굴은 터미널 두 벌뿐이고, 셸은 그 얼굴을 청구해 뜬다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);

  const 얼굴 = await page.evaluate(() =>
    [...document.fonts].map((face) => ({ family: face.family.replace(/['"]/g, ""), weight: face.weight, status: face.status })),
  );
  expect(얼굴.map((face) => `${face.family} ${face.weight}`).sort()).toEqual([
    "JetBrainsMonoNL Nerd Font 400",
    "JetBrainsMonoNL Nerd Font 700",
  ]);
  // 셸이 뜨기 전에 터미널이 Regular를 이름으로 청구해 기다렸다(`terminal-store`의 `loadFont`). 앱의 CSS는 이 얼굴을 어느
  // 요소에도 안 입히므로, 받아 둔 상태가 곧 터미널이 이 얼굴을 쓴다는 표다.
  expect(얼굴.find((face) => face.weight === "400")?.status).toBe("loaded");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

import { expect, test, type Locator, type Page } from "./evidence";
import { ARCHIVE, WORKS } from "./fixtures";
import { clipboardWrites, installFixtureBackend, recordClipboard, unknownIpcCalls, 첫글자, 칠한값, 토큰값, 토큰색 } from "./harness";

// codex-ds 티켓 15 — **문서 위에 경로 줄이 선다**(스펙 §4 「카드 머리 · 경로 줄」 · DS `PathBar` · 결정 12 · 13 · 27). 줄은 48(틈 8 ·
// 컨트롤 32 · 틈 8)이고 왼쪽에 경로 캡슐, 오른쪽에 보기 묶음(문서 | 원문)과 동그란 경로 복사가 선다. 캡슐 안 글자는 카드 + 20 —
// 아래 문서 글의 거터(20)와 **한 세로줄**이다. 캡슐의 끝 칸(지금 보는 파일)만 `fg` 500이고 앞 칸은 옅은 경로 `fg-tertiary`다(캔버스
// `.vh .path` — v1 티켓 46이 캡슐의 링과 함께 `fg-secondary`에서 내렸다). 닫기 ×는
// 미리보기에만 단다(결정 13). 넓힌 카드 보기의 머리 끝에 서는 ×는 「카드로 접기」다(restart 02a-12). **이 경로 줄은 이제 서는 자리가 없다** —
// 넓힌 카드는 보기 머리(아래)이고, Archive 상세에서는 restart 03-4가 걷었다(문서 | 원문 · 경로 복사는 문서 글의 우클릭 메뉴). 그 줄을 재던
// 도우미(`경로줄을잰다` — 높이 · 끝 칸만 진함 · 캡슐 글자 = 본문 글 x)도 함께 걷었다.
//
// 글자의 x는 **글자가 선 자리**로 잰다(`Range`의 상자) — 요소의 상자는 안쪽 여백을 품어 글자 자리가 아니다. 길이는 토큰에서
// 읽는다: 넓힌 카드 문서 글의 거터 28은 DS 간격 눈금(`--spacing` 4px)의 일곱 칸이다.

const [pinnedWork] = WORKS;
const [shipped] = ARCHIVE;

const 경로줄 = (card: Locator) => card.locator('[data-slot="path-bar"]');

async function 상자(target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error("상자를 못 읽었다");
  return { ...box, right: box.x + box.width, bottom: box.y + box.height };
}

/** DS 간격 눈금(`--spacing`)의 `칸` 칸 — 일곱 칸이 28이다. */
const 간격 = async (page: Page, 칸: number) => 칸 * parseFloat(await 토큰값(page, "width", "--spacing"));

// 작업공간의 문서는 넓힌 카드에서 연다(restart 02a-12 · 02a-13 — 문서 탭과 분할을 걷었다). 넓힌 카드 보기의 머리는 경로 줄이 아니라 보드의 보기
// 머리다(SummarySheet `.ra-vwhead` · restart 02b-8) — 38 · 안쪽 왼쪽 14 · 아래 0.5 `border-heavy` 선 · 13 글자에 경로가 「/」로 이은 조각이고, 앞 조각은
// `fg-tertiary`, 끝 조각(지금 보는 것)만 `fg` 400이다. 끝에는 렌더 | 원문 · 경로 복사 · 「카드로 접기」 ×가 선다(스토리 117). 머리 글자는 머리 왼쪽
// 14, 문서 글은 글 거터 28이라 한 세로줄이 아니다(restart 03-12a · 시안 MainWideDoc — 한때 거터 20. 그 전에는 48 경로 줄의 캡슐 글자와 문서 글이
// 한 세로줄이었다). Archive 상세에는 경로 줄이 없다(아래).
test("Works: 넓힌 카드의 문서 위에 보기 머리가 서고, 경로는 「/」로 이은 조각이며 끝 조각만 fg이고, 끝에 렌더 | 원문 · 경로 복사 · 「카드로 접기」가 선다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}?file=overview.md`);
  await expect(page.getByRole("heading", { name: "개요" })).toBeVisible();

  const card = page.locator('section[data-expanded] [data-viewer="doc"]');
  await expect(경로줄(card)).toHaveCount(0);
  const capsule = card.getByRole("navigation", { name: "위치", exact: true });
  const head = capsule.locator("..");
  await expect(capsule.locator("span")).toHaveText(["문서", "/", "overview.md"]);
  const [fg, tertiary] = [await 토큰색(page, "--fg"), await 토큰색(page, "--fg-tertiary")];
  expect(await 칠한값(capsule.locator("span").first(), "color", "font-size")).toEqual([tertiary, "13px"]);
  expect(await 칠한값(capsule.locator("span").last(), "color", "font-weight")).toEqual([fg, "400"]);

  // 보기의 맨 위 38 · 아래 0.5 선 · 경로 칸은 머리 안쪽 왼쪽 14, 문서 글은 보기 왼쪽 28(글 거터)이다.
  const [headBox, cardBox] = [await 상자(head), await 상자(card)];
  expect([headBox.y, headBox.height], "보기 맨 위 · 높이").toEqual([cardBox.y, 38]);
  expect(await 칠한값(head, "border-bottom-width", "border-bottom-color")).toEqual(["0.5px", await 토큰색(page, "--border-heavy")]);
  // 카드가 넓어지는 동안(500ms)은 보기가 옮겨 간다 — 다 선 자리를 읽는다.
  await expect.poll(async () => (await 상자(capsule)).x - (await 상자(card)).x, { message: "경로 칸 = 보기 + 14" }).toBe(14);
  const 거터 = await 간격(page, 7);
  await expect
    .poll(async () => Math.round(((await 첫글자(card.locator("article"))).x - (await 상자(card)).x) * 10) / 10, { message: "문서 글 = 보기 + 28" })
    .toBe(거터);

  const names = await head.getByRole("button").evaluateAll((all) => all.map((one) => one.getAttribute("aria-label") ?? one.textContent));
  expect(names).toEqual(["렌더", "원문", "경로 복사", "카드로 접기"]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// Archive 상세의 문서 글 위에는 경로 줄이 없다(restart 03-4 — 한때 48 경로 줄에 캡슐 「slug › record.md」 · 「문서로 보기 · 원문 보기」 · 경로 복사가
// 섰다). 경로 복사는 작업 화면 문서 글과 같은 우클릭(⇧F10) 메뉴의 「경로 복사」이고, 값은 그대로 그 문서의 아카이브 참조다 — 기록(`record.md`)은
// spec 밖, work 폴더 기준이다.
test("Archive: 상세 문서 글 위에 경로 줄이 없고, 글의 우클릭 메뉴 「경로 복사」가 그 문서의 아카이브 참조를 낸다", async ({ page }) => {
  await installFixtureBackend(page);
  await recordClipboard(page);
  await page.goto(`/archive/${shipped.slug}`);
  await expect(page.getByRole("heading", { name: "기록 — 치운 일" })).toBeVisible();

  const main = page.getByRole("main", { name: "Archive 상세", exact: true });
  await expect(경로줄(main)).toHaveCount(0);
  await expect(main.getByRole("navigation", { name: "위치", exact: true })).toHaveCount(0);
  await main.locator("[data-doc-text]").click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem")).toHaveText(["원문으로 보기", "경로 복사"]);
  await menu.getByRole("menuitem", { name: "경로 복사", exact: true }).click();
  await expect.poll(() => clipboardWrites(page)).toEqual([`~/.atelier/archive/${shipped.slug}/record.md`]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

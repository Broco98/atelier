import { expect, test, type Locator, type Page } from "./evidence";
import { ARCHIVE, WORKS } from "./fixtures";
import { clipboardWrites, installFixtureBackend, recordClipboard, unknownIpcCalls, 첫글자, 칠한값, 토큰값, 토큰색 } from "./harness";

// codex-ds 티켓 15 — **문서 위에 경로 줄이 선다**(스펙 §4 「카드 머리 · 경로 줄」 · DS `PathBar` · 결정 12 · 13 · 27). 줄은 48(틈 8 ·
// 컨트롤 32 · 틈 8)이고 왼쪽에 경로 캡슐, 오른쪽에 보기 묶음(문서 | 원문)과 동그란 경로 복사가 선다. 캡슐 안 글자는 카드 + 20 —
// 아래 문서 글의 거터(20)와 **한 세로줄**이다. 캡슐의 끝 칸(지금 보는 파일)만 `fg` 500이고 앞 칸은 옅은 경로 `fg-tertiary`다(캔버스
// `.vh .path` — v1 티켓 46이 캡슐의 링과 함께 `fg-secondary`에서 내렸다). 닫기 ×는
// 미리보기에만 단다(결정 13) — Archive 문서에는 없다. 넓힌 카드 보기의 머리 끝에 서는 ×는 「카드로 접기」다(restart 02a-12).
//
// 글자의 x는 **글자가 선 자리**로 잰다(`Range`의 상자) — 요소의 상자는 안쪽 여백을 품어 글자 자리가 아니다. 길이는 토큰에서
// 읽는다: 줄 높이는 `--size-pathbar`, 거터 20 · 위 24는 DS 간격 눈금(`--spacing` 4px)의 다섯 칸 · 여섯 칸(DS `space-5` · `space-6`)이다.

const [pinnedWork] = WORKS;
const [shipped] = ARCHIVE;

const 경로줄 = (card: Locator) => card.locator('[data-slot="path-bar"]');
const 캡슐 = (bar: Locator) => bar.getByRole("navigation", { name: "위치", exact: true });

async function 상자(target: Locator) {
  const box = await target.boundingBox();
  if (!box) throw new Error("상자를 못 읽었다");
  return { ...box, right: box.x + box.width, bottom: box.y + box.height };
}

/** DS 간격 눈금(`--spacing`)의 `칸` 칸 — `space-5`(20) · `space-6`(24). */
const 간격 = async (page: Page, 칸: number) => 칸 * parseFloat(await 토큰값(page, "width", "--spacing"));

/** 줄 안 버튼의 이름들 — 자리 차례대로다. ×가 있으면 여기 이름으로 선다. */
const 버튼들 = (bar: Locator) => bar.getByRole("button").evaluateAll((all) => all.map((one) => one.getAttribute("aria-label")));

/**
 * 경로 줄 하나의 규칙을 잰다 — 높이 · 캡슐 조각 · 끝 칸만 진함 · 캡슐 글자 x = 본문 글 x(= 카드 + 20) · 글이 줄 아래 24에서 시작.
 * `본문`은 그 카드 안 문서 글(예쁜 보기의 `article`)이다. `카드거터`가 `false`면 「카드 + 20」을 재지 않는다 — 넓힌 카드의 보기는 카드가
 * 아니라 카드 안 목록 옆의 칸이라 그 왼끝이 카드 끝이 아니다(한 세로줄은 그대로 잰다).
 */
async function 경로줄을잰다(page: Page, card: Locator, 조각: string[], { 카드거터 = true } = {}) {
  const bar = 경로줄(card);
  const capsule = 캡슐(bar);
  await expect(capsule.locator("span")).toHaveText(조각);

  const barBox = await 상자(bar);
  expect(barBox.height, "경로 줄 높이").toBe(parseFloat(await 토큰값(page, "height", "--size-pathbar")));

  // 끝 칸만 진하다 — 앞 칸은 `fg-tertiary` 400, 끝 칸은 `fg` 500.
  const [fg, tertiary] = [await 토큰색(page, "--fg"), await 토큰색(page, "--fg-tertiary")];
  const pieces = capsule.locator("span");
  const last = 조각.length - 1;
  for (let at = 0; at < 조각.length; at++) {
    expect(await 칠한값(pieces.nth(at), "color", "font-weight"), 조각[at]).toEqual(
      at === last ? [fg, "500"] : [tertiary, "400"],
    );
  }

  // 한 세로줄 — 캡슐 안 첫 글자와 문서 글의 첫 글자가 같은 x이고, 그 x가 카드 + 20이다.
  const cardBox = await 상자(card);
  const body = card.locator("article");
  const [inCapsule, inBody] = [await 첫글자(capsule), await 첫글자(body)];
  expect(inCapsule.x, "캡슐 글자 x = 본문 글 x").toBeCloseTo(inBody.x, 1);
  if (카드거터) expect(inBody.x - cardBox.x, "본문 글 = 카드 + 20").toBeCloseTo(await 간격(page, 5), 1);

  // 글은 경로 줄 아래 24에서 시작한다 — 첫 블록의 상자 위끝이다(줄 높이의 반행간은 글자 단계의 몫이라 상자로 잰다).
  const first = await 상자(body.locator(":scope > div > :not(button)").first());
  expect(first.y - barBox.bottom, "경로 줄 아래 → 첫 블록").toBeCloseTo(await 간격(page, 6), 1);
}

// 작업공간의 문서는 넓힌 카드에서 연다(restart 02a-12 · 02a-13 — 문서 탭과 분할을 걷었다). 넓힌 카드 보기의 머리는 경로 줄이 아니라 보드의 보기
// 머리다(SummarySheet `.ra-vwhead` · restart 02b-8) — 38 · 안쪽 왼쪽 14 · 아래 0.5 `border-heavy` 선 · 13 글자에 경로가 「/」로 이은 조각이고, 앞 조각은
// `fg-tertiary`, 끝 조각(지금 보는 것)만 `fg` 400이다. 끝에는 렌더 | 원문 · 경로 복사 · 「카드로 접기」 ×가 선다(스토리 117). 머리 글자는 머리 왼쪽
// 14, 문서 글은 글 거터 20이라 한 세로줄이 아니다(한때 48 경로 줄의 캡슐 글자와 문서 글이 한 세로줄이었다). Archive 문서는 경로 줄 그대로다(아래).
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

  // 보기의 맨 위 38 · 아래 0.5 선 · 경로 칸은 머리 안쪽 왼쪽 14, 문서 글은 보기 왼쪽 20(글 거터)이다.
  const [headBox, cardBox] = [await 상자(head), await 상자(card)];
  expect([headBox.y, headBox.height], "보기 맨 위 · 높이").toEqual([cardBox.y, 38]);
  expect(await 칠한값(head, "border-bottom-width", "border-bottom-color")).toEqual(["0.5px", await 토큰색(page, "--border-heavy")]);
  // 카드가 넓어지는 동안(500ms)은 보기가 옮겨 간다 — 다 선 자리를 읽는다.
  await expect.poll(async () => (await 상자(capsule)).x - (await 상자(card)).x, { message: "경로 칸 = 보기 + 14" }).toBe(14);
  const 거터 = await 간격(page, 5);
  await expect
    .poll(async () => Math.round(((await 첫글자(card.locator("article"))).x - (await 상자(card)).x) * 10) / 10, { message: "문서 글 = 보기 + 20" })
    .toBe(거터);

  const names = await head.getByRole("button").evaluateAll((all) => all.map((one) => one.getAttribute("aria-label") ?? one.textContent));
  expect(names).toEqual(["렌더", "원문", "경로 복사", "카드로 접기"]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("Archive: 문서 카드에 경로 줄이 서고, 경로 복사가 그 문서의 아카이브 참조를 낸다 — 캡슐 글자와 문서 글이 한 세로줄이다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await recordClipboard(page);
  await page.goto(`/archive/${shipped.slug}`);
  await expect(page.getByRole("heading", { name: "기록 — 치운 일" })).toBeVisible();

  // 아카이브의 경로는 work 폴더 기준이다 — 기록(`record.md`)은 spec 밖에 있다.
  const card = page.getByRole("main", { name: "아카이브 문서", exact: true });
  await 경로줄을잰다(page, card, [shipped.slug, "record.md"]);
  expect(await 버튼들(경로줄(card))).toEqual(["문서로 보기", "원문 보기", "경로 복사"]);

  await 경로줄(card).getByRole("button", { name: "경로 복사", exact: true }).click();
  await expect.poll(() => clipboardWrites(page)).toEqual([`~/.atelier/archive/${shipped.slug}/record.md`]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

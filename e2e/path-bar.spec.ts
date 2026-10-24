import { expect, test, type Locator, type Page } from "./evidence";
import { ARCHIVE, WORKS } from "./fixtures";
import { clipboardWrites, installFixtureBackend, recordClipboard, unknownIpcCalls, 첫글자, 칠한값, 토큰값, 토큰색, 툴팁 } from "./harness";

// codex-ds 티켓 15 — **문서 위에 경로 줄이 선다**(스펙 §4 「카드 머리 · 경로 줄」 · DS `PathBar` · 결정 12 · 13 · 27). 줄은 48(틈 8 ·
// 컨트롤 32 · 틈 8)이고 왼쪽에 경로 캡슐, 오른쪽에 보기 묶음(문서 | 원문)과 동그란 경로 복사가 선다. 캡슐 안 글자는 카드 + 20 —
// 아래 문서 글의 거터(20)와 **한 세로줄**이다. 캡슐의 끝 칸(지금 보는 파일)만 `fg` 500이고 앞 칸은 옅은 경로 `fg-tertiary`다(캔버스
// `.vh .path` — v1 티켓 46이 캡슐의 링과 함께 `fg-secondary`에서 내렸다). 닫기 ×는
// 미리보기에만 단다(결정 13) — spec 탭의 문서와 Archive 문서에는 없다. 분할의 spec 열 머리 끝에 서는 ×는 미리보기 ×가 아니라
// 그 열을 닫는 것이다(스펙 S14 · `CONTEXT.md` 「열」).
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
 * 경로 줄 하나의 규칙을 잰다 — 높이 · 캡슐 조각 · 끝 칸만 진함 · 캡슐 글자 x = 본문 글 x = 카드 + 20 · 글이 줄 아래 24에서 시작.
 * `본문`은 그 카드 안 문서 글(예쁜 보기의 `article`)이다.
 */
async function 경로줄을잰다(page: Page, card: Locator, 조각: string[]) {
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
  expect(inBody.x - cardBox.x, "본문 글 = 카드 + 20").toBeCloseTo(await 간격(page, 5), 1);

  // 글은 경로 줄 아래 24에서 시작한다 — 첫 블록의 상자 위끝이다(줄 높이의 반행간은 글자 단계의 몫이라 상자로 잰다).
  const first = await 상자(body.locator(":scope > div > :not(button)").first());
  expect(first.y - barBox.bottom, "경로 줄 아래 → 첫 블록").toBeCloseTo(await 간격(page, 6), 1);
}

test("Works: spec 문서 위 탭 줄 아래에 경로 줄이 서고, 캡슐 글자와 문서 글이 한 세로줄이며 끝 칸만 진하고 ×가 없다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}?file=overview.md`);
  await expect(page.getByRole("heading", { name: "개요" })).toBeVisible();

  const card = page.getByRole("main", { name: "문서", exact: true });
  await 경로줄을잰다(page, card, [pinnedWork.slug, "spec", "overview.md"]);

  // 탭 줄 바로 아래다 — 줄은 탭 줄을 이는 카드의 둘째 줄이다.
  const row = await 상자(card.locator("[data-tab-row]"));
  expect((await 상자(경로줄(card))).y, "탭 줄 아래").toBe(row.bottom);
  // 보기 묶음과 경로 복사뿐이다 — 늘 있는 spec 탭의 문서에는 닫기 ×가 없다(결정 13).
  expect(await 버튼들(경로줄(card))).toEqual(["문서로 보기", "원문 보기", "경로 복사"]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("Works 분할: spec 열의 머리가 경로 줄이고, 그 끝의 ×는 그 열을 닫는 것 하나다 — 캡슐 글자와 문서 글이 한 세로줄이다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}?file=overview.md&split=lr`);
  await expect(page.getByRole("heading", { name: "개요" })).toBeVisible();

  const card = page.locator('main [data-slot="card"][aria-label="문서"]');
  await 경로줄을잰다(page, card, [pinnedWork.slug, "spec", "overview.md"]);

  // 열 머리다 — 카드 맨 위에 서고 열을 집는 표식을 든다.
  const bar = 경로줄(card);
  await expect(bar).toHaveAttribute("data-column", "spec");
  expect((await 상자(bar)).y, "카드 맨 위").toBe((await 상자(card)).y);
  expect(await 버튼들(bar)).toEqual(["문서로 보기", "원문 보기", "경로 복사", "spec 열 닫기"]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 줄이 모자랄 때 — 경로가 캡슐에 다 안 들어가면 캡슐이 **32 원으로 접히고** 그 안에 아이콘 하나가 선다. 말줄임으로 끊긴 경로
// (「slug › spec › (」)는 어디를 보는지 말하지 못한다. 경로 전체는 가리키면 툴팁으로 뜨고, 스크린리더는 접혀도 「위치」 nav에서 그대로
// 듣는다. 분할의 spec 열은 가장 좁게(`useSplitRatio`의 `SPLIT_MIN` 0.25) 끌 수 있어 1280 창에서도 그 폭이 되고, 창을 넓히면 다시 펴진다.
test("Works 분할: spec 열을 가장 좁게 끌면 경로 캡슐이 아이콘 원으로 접히고 가리키면 경로가 뜨며, 넓히면 다시 펴진다 — 조작은 제 폭 그대로다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.addInitScript(() => localStorage.setItem("work-split-ratio", "0.25"));
  await page.goto(`/works/${pinnedWork.slug}?file=${encodeURIComponent("목업/조각.html")}&split=lr`);

  const bar = page.locator('[data-column="spec"]');
  const capsule = 캡슐(bar);
  const 조각 = [pinnedWork.slug, "spec", "목업", "조각.html"];
  /** 눈에 선 조각 — 조각에서 캡슐까지 겹친 불투명도가 0이면 글자가 칠해지지 않는다. */
  const 보이는조각 = () =>
    capsule.locator("span").evaluateAll((spans) =>
      spans
        .filter((span) => {
          let opacity = 1;
          for (let at: Element | null = span; at && at.tagName !== "NAV"; at = at.parentElement) {
            opacity *= parseFloat(getComputedStyle(at).opacity);
          }
          return opacity > 0;
        })
        .map((span) => span.textContent),
    );

  // 접힌 캡슐은 32 원이고 조각은 칠해지지 않는다. 경로는 그래도 「위치」 nav 안의 글자다 — 스크린리더가 듣는 것이다.
  await expect(capsule.locator("span")).toHaveText(조각);
  await expect.poll(async () => [(await 상자(capsule)).width, (await 상자(capsule)).height], "접힌 캡슐").toEqual([32, 32]);
  expect(await 보이는조각(), "접힌 캡슐에 칠해진 조각").toEqual([]);

  // 가리키면 경로 전체가 툴팁으로 뜬다 — 조각 사이는 캡슐의 꺾쇠와 같은 「›」다.
  await capsule.hover();
  await expect(툴팁(page)).toHaveText(조각.join(" › "));

  // 줄에 눌려 접히는 것은 캡슐뿐이다 — 조작은 제 폭이고 줄 끝까지 다 선다.
  const buttons = bar.getByRole("button");
  expect(
    await buttons.evaluateAll((all) => all.map((one) => [one.getAttribute("aria-label"), one.getBoundingClientRect().width])),
  ).toEqual([
    ["문서로 보기", 28],
    ["원문 보기", 28],
    ["경로 복사", 32],
    ["spec 열 닫기", 24],
  ]);
  expect((await 상자(buttons.last())).right, "× 오른쪽 끝 ≤ 줄 오른쪽 끝").toBeLessThanOrEqual((await 상자(bar)).right);

  // 창을 넓혀 경로가 다 들어가면 캡슐이 다시 펴진다 — 조각이 모두 칠해지고 캡슐은 원보다 넓다.
  await page.setViewportSize({ width: 2560, height: 900 });
  await expect.poll(보이는조각, "펴진 캡슐의 조각").toEqual(조각);
  expect((await 상자(capsule)).width, "펴진 캡슐").toBeGreaterThan(32);
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

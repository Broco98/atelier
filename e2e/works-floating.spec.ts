import { expect, test, type Locator } from "./evidence";
import { WORKS } from "./fixtures";
import { callCount, installFixtureBackend, ipcCallArgs, unknownIpcCalls } from "./harness";

// 판 3 — **작업 화면의 떠 있는 것**(S8, P14). 그 표면을 이미 다루는 spec 파일이 없는 것만 여기 모은다:
// 작업 ⋯ · 상태 메뉴 · 이름 바꾸기 창 · ⓘ 메타 · 작업 화면 토스트 · 전체화면 · Mermaid 「코드」 · 툴팁.
// 셸 열기 `+`는 셸 열기 spec(`shell-picker.spec.ts`)이, 아카이브 거르개는 아카이브 문서 spec이,
// 기준 브랜치는 프로젝트 목록 spec이 든다.
//
// **절마다 머리 주석 한 줄로 가른다**(`// ── 무엇 ──`). 표면이 늘어도 한 파일이라, 절 머리가 곧 목차다.
// 도우미는 이 파일 맨 위에 둔다 — 둘 이상의 절이 쓰는 것만. 한 절만 쓰는 것은 그 절 안에 둔다.
//
// 검사 규칙은 스펙 「좋은 검사」 그대로다. 역할과 이름으로 집고, 모양 수치는 재지 않는다. 계산된 스타일은
// 동작일 때만(애니메이션이 도는가, 동작 줄이기면 멎는가) 잰다. 메뉴(`modal`)가 열린 동안 바깥을 누르는
// 검사는 자리를 먼저 재고 `page.mouse.click`으로 누른다 — `locator.click()`은 메뉴의 가림막에 막힌다.

const [pinnedWork, , multiWork] = WORKS;

/**
 * 그 요소에 걸린 애니메이션의 이름. **동작을 재는 값이다** — 열림 애니메이션(결정 7)은 `data-open`에서
 * 붙어 열려 있는 동안 그대로 남으므로, 뜬 뒤 언제 재도 같다. 동작 줄이기면 전역 규칙이 `none`으로 덮는다.
 */
const 애니메이션 = (target: Locator) => target.evaluate((el) => getComputedStyle(el).animationName);

// ── 떠 있는 것의 애니메이션 (결정 7) ──
// 떠 있는 것은 100ms 페이드와 확대로 뜨고, 「동작 줄이기」면 그것이 꺼진다. 끄는 규칙은 부품마다가 아니라
// 전역 CSS 한 곳이라(`index.css`의 `[data-slot][class*="animate-"]`) 메뉴 하나로 잰다 — 메뉴는 판 3이 처음
// 들인 떠 있는 부품이고, 셸 열기 `+`가 그 첫 쓰는 자리다.

test("메뉴는 애니메이션으로 뜨고, 움직임을 끄면 애니메이션 없이 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${multiWork.slug}?tab=terminal`);
  const plus = page.getByRole("button", { name: "셸 열기" });
  const menu = page.getByRole("menu", { name: "셸 열기" });

  await plus.click();
  await expect(menu).toBeVisible();
  await expect.poll(() => 애니메이션(menu)).not.toBe("none");

  // 닫힌 것을 보고 다시 연다 — 닫히는 중인 카드에 잰 값이 섞이지 않게.
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: "reduce" });

  await plus.click();
  await expect(menu).toBeVisible();
  await expect.poll(() => 애니메이션(menu)).toBe("none");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 상태 메뉴 (스토리 46~48 · 51 · 52, S33) ──
// 머리행의 상태 배지가 라디오 메뉴를 연다. 배지는 여는 버튼이라 「메뉴를 연다」와 「열렸다/닫혔다」를 말하고,
// 지금 상태는 `menuitemradio`의 `aria-checked`로 읽힌다(체크 아이콘은 보이는 쪽의 말일 뿐이다). 고르면 닫힌다 —
// 라디오 항목의 부품 기본은 안 닫힘이라(S33) 그것을 여기서 잰다. 저장은 **값이 바뀔 때만**이다(지금 규칙).
//
// 배지와 줄의 이름은 상태의 라벨이고, 라벨은 상태 값 그대로다(`STATUS_META`). 픽스처 백엔드는 상태를 기억하지
// 않아 바꾼 뒤에도 목록이 `active`로 답한다 — 그래서 배지의 이름이 검사 도중에 흔들리지 않는다.
// 줄의 이름은 라벨 뒤에 설명(「진행 중」 등)이 붙어 라벨로 **시작하는 것**으로 집는다.
const 상태줄 = (menu: Locator, status: string) =>
  menu.getByRole("menuitemradio", { name: new RegExp(`^${status}\\b`) });

test("상태 배지는 메뉴를 연다고 말하고, 지금 상태가 선택됨이다 — 다른 상태를 고르면 바꾸는 IPC가 나가고 닫힌다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  const badge = page.getByRole("button", { name: pinnedWork.status, exact: true });
  const menu = page.getByRole("menu");

  await expect(badge).toHaveAttribute("aria-haspopup", "menu");
  await expect(badge).toHaveAttribute("aria-expanded", "false");
  await badge.click();
  await expect(menu).toBeVisible();
  await expect(badge).toHaveAttribute("aria-expanded", "true");

  // 넷이 다 라디오 줄이고, 지금 것 **하나만** 선택됨이다 — 지금 것만 재면 「전부 선택됨」도 초록이다.
  await expect(menu.getByRole("menuitemradio")).toHaveCount(4);
  await expect(menu.getByRole("menuitemradio", { checked: true })).toHaveCount(1);
  await expect(상태줄(menu, pinnedWork.status)).toHaveAttribute("aria-checked", "true");

  await 상태줄(menu, "review").click();

  await expect(menu).toHaveCount(0);
  await expect(badge).toHaveAttribute("aria-expanded", "false");
  await expect
    .poll(async () => (await ipcCallArgs(page, "set_work_status", "status")).map(({ args }) => args))
    .toEqual([{ mode: "atelier", slug: pinnedWork.slug, status: "review" }]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("상태 메뉴에서 지금 상태를 다시 고르면 닫히기만 하고 IPC는 안 나간다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  const badge = page.getByRole("button", { name: pinnedWork.status, exact: true });
  const menu = page.getByRole("menu");

  // 키보드로 연다 — ↓가 메뉴를 열고 첫 줄(`draft`)을 켠다. ↓ 한 번 더가 지금 상태(`active`)다.
  await badge.focus();
  await page.keyboard.press("ArrowDown");
  await expect(menu).toBeVisible();
  await page.keyboard.press("ArrowDown");
  await expect(상태줄(menu, pinnedWork.status)).toBeFocused();
  await page.keyboard.press("Enter");

  // 앵커: 골라서 닫혔다. 그다음에야 「안 나갔다」가 뜻을 갖는다 — 고르는 일이 아예 안 일어나도 0이다.
  await expect(menu).toHaveCount(0);
  await expect(badge).toBeFocused();
  expect(await callCount(page, "set_work_status")).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

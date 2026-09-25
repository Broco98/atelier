import { expect, test, type Locator } from "./evidence";
import { WORKS } from "./fixtures";
import { installFixtureBackend, unknownIpcCalls } from "./harness";

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

const [, , multiWork] = WORKS;

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

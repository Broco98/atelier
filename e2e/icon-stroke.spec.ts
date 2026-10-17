import { expect, test } from "./evidence";
import { WORKS } from "./fixtures";
import { installFixtureBackend, unknownIpcCalls } from "./harness";

// **아이콘 선은 한 자리에서 정해진다**(codex-ds 스펙 S3) — Codex 규격 16px에서 1.5px 선이다.
//
// **이 층에서만 보이는 것이다.** lucide가 svg에 적는 굵기는 viewBox 단위(24칸)라, 화면에 그려진 굵기는 아이콘 상자의
// 실제 폭을 곱해야 나온다(`굵기 × 폭 / 24`). 그 폭은 클래스(`size-4` · 부품의 `[&_svg]:size-4`)가 정하므로 진짜 CSS가
// 있어야 답이 난다 — 소스의 숫자를 읽는 vitest(`icon-stroke.test.ts`)는 호출부가 굵기를 고르지 않는다는 것까지만 본다.

test("16px 아이콘의 그려진 선이 1.5px다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${WORKS[0].slug}`);
  // 경로 줄의 경로 복사와 작업 패널 머리의 spec 폴더 열기(둘 다 카드 안 16px)가 섰으면 경로 줄의 원문 전환도 함께 서 있다. 머리 줄의
  // 창 컨트롤 · 머리 카드 아이콘 버튼은 15라(codex-ds 스펙 §3 — `frame.spec.ts`가 잰다) 아래 고르기에 들지 않는다.
  await expect(page.getByRole("button", { name: "경로 복사", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "spec 폴더 열기", exact: true })).toBeVisible();

  // 화면의 lucide 아이콘 가운데 그려진 폭이 16px인 것 모두. 선은 svg가 아니라 그 안의 도형이 그린다 — 도형의 계산된
  // 굵기(viewBox 단위)를 읽어 상자 폭으로 옮긴다. 둘째 자리에서 반올림해 소수 오차를 걷는다.
  const icons = await page.evaluate(() =>
    [...document.querySelectorAll<SVGSVGElement>("svg.lucide")].flatMap((svg) => {
      const width = svg.getBoundingClientRect().width;
      const shape = svg.querySelector("path, circle, line, rect, polyline, polygon, ellipse");
      if (width !== 16 || shape === null) return [];
      const drawn = (parseFloat(getComputedStyle(shape).strokeWidth) * width) / svg.viewBox.baseVal.width;
      return [{ icon: svg.getAttribute("class") ?? "", drawn: Math.round(drawn * 100) / 100 }];
    }),
  );

  // **먼저 잰 것이 있음을 센다** — 고를 아이콘이 하나도 없으면 아래 「어긋난 것 없음」이 저절로 초록이 된다.
  expect(icons.length).toBeGreaterThan(3);
  expect(icons.filter(({ drawn }) => drawn !== 1.5)).toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

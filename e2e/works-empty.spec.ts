import { expect, test, type Locator } from "./evidence";
import { installFixtureBackend, unknownIpcCalls, 칠한값, 토큰색 } from "./harness";

// codex-ds 티켓 24 — **고른 작업이 없을 때의 빈 화면이 DS 빈 화면 물음이다**(codex-ds 스펙 §6 「본문 카드」 · 스토리 64). 글리프 칸 없이
// 물음(`heading-lg`) · 설명 · 할 일이 카드 가운데 한 세로줄에 서고, 셋 사이는 16(`space-4`)이다. 문구는 지금 것이다 — 작업이 없을 때의
// 셋은 `work-sections.ts`의 표에서, 프로젝트가 없을 때의 셋은 `WorksPage.tsx`에서 온다(글자까지는 L2가 잰다).
//
// 빈 화면은 작업이 하나도 없을 때만 선다 — 하나라도 있으면 `/works`가 그 작업으로 고쳐 쓴다(`routes/works.index.tsx`).
//
// **이 층에서만 보인다.** 마크업 seam에는 CSS가 없어 글자 단계도 틈도 가운데도 안 나온다. 기대값의 수는 DS 값표의 것이다 — 물음은
// DS README 「글자」 표의 「빈 화면 물음」(`heading-lg` 24/28 · 600)이고, 설명은 읽는 글(`chat-body` 14/22.75) `fg-secondary`다.

/** 상자 넷의 위 · 아래 · 가운데 x. */
const 상자 = async (target: Locator) => {
  const box = await target.boundingBox();
  if (box === null) throw new Error("상자가 화면에 없다");
  return { top: box.y, bottom: box.y + box.height, midX: box.x + box.width / 2 };
};

const CASES = [
  {
    when: "프로젝트는 있고 작업이 없으면",
    overrides: { list_works: [] },
    물음: "아직 작업이 없어요",
    설명: /^작업은 Claude Code에서 시작돼요\./,
    할일: 'atelier로 "새 작업" 시작해줘',
  },
  {
    when: "프로젝트도 없으면",
    overrides: { list_works: [], list_projects: [] },
    물음: "먼저 프로젝트를 등록해요",
    설명: /^작업은 등록된 프로젝트 위에서 시작돼요\./,
    할일: "atelier에 이 폴더 등록해줘",
  },
] as const;

for (const one of CASES) {
  test(`${one.when} 빈 화면은 글리프 없이 물음(heading-lg) · 설명 · 할 일이 가운데 한 줄로 16씩 떨어져 선다`, async ({ page }) => {
    await installFixtureBackend(page, one.overrides);
    await page.goto("/works");
    const 빈화면 = page.locator("main [data-slot=empty]");
    const 물음 = 빈화면.getByText(one.물음, { exact: true });
    await expect(물음).toBeVisible();
    const 설명 = 빈화면.getByText(one.설명);
    const 할일 = 빈화면.getByText(one.할일, { exact: true });

    // 물음 — `heading-lg`. 설명 — 읽는 글 `chat-body` · `fg-secondary`.
    expect(await 칠한값(물음, "font-size", "line-height", "font-weight"), "물음").toEqual(["24px", "28px", "600"]);
    expect(await 칠한값(설명, "font-size", "line-height", "color"), "설명").toEqual([
      "14px",
      "22.75px",
      await 토큰색(page, "--fg-secondary"),
    ]);

    // 글리프 칸이 없다 — 물음이 빈 화면의 첫 것이다.
    await expect(빈화면.locator("svg")).toHaveCount(0);

    // 물음 → 설명 → 할 일, 사이는 16.
    const [위, 가운데, 아래, 판] = [await 상자(물음), await 상자(설명), await 상자(할일), await 상자(빈화면)];
    expect(Math.round(가운데.top - 위.bottom), "물음과 설명 사이").toBe(16);
    expect(Math.round(아래.top - 가운데.bottom), "설명과 할 일 사이").toBe(16);
    // 한 세로줄 — 셋의 가운데 x가 빈 화면의 가운데다. 위아래로도 가운데다.
    for (const [이름, 것] of [["물음", 위], ["설명", 가운데], ["할 일", 아래]] as const) {
      expect(Math.abs(것.midX - 판.midX), `${이름}의 가운데 x`).toBeLessThanOrEqual(1);
    }
    expect(Math.abs(위.top - 판.top - (판.bottom - 아래.bottom)), "위아래 가운데").toBeLessThanOrEqual(1);

    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

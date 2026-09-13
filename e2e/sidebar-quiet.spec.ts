import { expect, test, type Locator, type Page } from "./evidence";
import { WORKS } from "./fixtures";
import { awaitSpawned, installFixtureBackend, markAttention, unknownIpcCalls, 띠 } from "./harness";

// **사이드바를 조용하게**(UI개선 결정 23~25 · #227). 셋 다 진짜 CSS와 진짜 레이아웃이 있어야
// 답이 나는 것이라 이 층이 든다: hover 배경은 `:hover`가 실제로 걸려야 계산되고, 「선이 서도
// 한 픽셀도 안 밀린다」는 픽셀이 답이다.
//
// `works-sidebar.spec.ts`와 따로 사는 것은 그 파일이 행 끌기(05·06)의 검사를 함께 받기
// 때문이다 — 여기서 재는 것은 목록의 **테두리**뿐이다.

const [pinnedWork, plainWork] = WORKS;

const PINNED_HEADER = "고정 1";
const MAIN_HEADER = `작업 ${WORKS.filter((work) => !work.pinned).length}`;

const list = (page: Page) => page.locator("[data-worklist]");
/** 목록 윗 가장자리의 구분선. 목록 **밖**(스크롤하지 않는 부모)에 산다. */
const edge = (page: Page) => page.locator("[data-worklist-edge]");

/** 투명. WebKit은 `transparent`를 이 모양으로 돌려준다. */
const TRANSPARENT = "rgba(0, 0, 0, 0)";

/** 색의 알파. `rgb(...)`는 불투명이다. 칠해졌는가는 색이 아니라 이 값이 말한다. */
const alphaOf = (color: string) => {
  const parts = /rgba?\(([^)]*)\)/.exec(color)?.[1].split(",") ?? [];
  if (parts.length === 0) throw new Error(`색을 못 읽었다: ${color}`);
  return parts.length === 4 ? Number(parts[3]) : 1;
};

/** hover가 켠 트랜지션이 **끝날 때까지** 기다린다 — 도중에 재면 알파 0에서 출발한 값을 읽는다. */
const 멎을때까지 = (target: Locator) =>
  target.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished)).then(() => undefined),
  );

const styleOf = (target: Locator) =>
  target.evaluate((el) => {
    const style = getComputedStyle(el);
    return { background: style.backgroundColor, color: style.color };
  });

/** 넘치게 만든다 — 픽스처 work은 몇 개뿐이라 기본 높이로는 안 넘친다. */
const 넘치게 = async (page: Page) => {
  await expect.poll(() => list(page).evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThan(40);
};

test("구획 머리에 hover해도 배경이 안 칠해지고 글자만 진해진다 — 행의 hover 배경은 남는다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto("/projects");

  for (const name of [PINNED_HEADER, MAIN_HEADER]) {
    const header = page.getByRole("button", { name, exact: true });
    const label = header.locator("span").first();
    const 쉴때 = await styleOf(label);

    await header.hover();
    // **글자가 진해진다** — 누를 수 있다는 말은 남는다(결정 23). 트랜지션이 있어 기다린다.
    // 이것을 먼저 세는 것이 아래 「배경이 투명」이 hover가 안 걸려서 초록인 것을 막는다.
    await expect.poll(async () => (await styleOf(label)).color).not.toBe(쉴때.color);
    await 멎을때까지(header);
    expect(alphaOf((await styleOf(header)).background), `${name} 머리에 hover 배경이 칠해졌다`).toBe(0);
  }

  // **행은 그대로다** — 누르면 가는 목적지라 지금 무엇을 가리키는지 보여야 한다.
  const row = page.getByRole("button", { name: plainWork.title, exact: true }).locator("xpath=..");
  await row.hover();
  await expect.poll(async () => alphaOf((await styleOf(row)).background)).toBeGreaterThan(0);
  await 멎을때까지(row);
  expect(alphaOf((await styleOf(row)).background)).toBeGreaterThan(0);
  // 고정 행도 같은 규칙이다(두 구획이 같은 행을 쓴다) — 이름만 확인해 둔다.
  await expect(page.getByRole("button", { name: pinnedWork.title, exact: true })).toHaveCount(1);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("목록이 스크롤됐을 때만 윗 가장자리에 선이 서고, 맨 위로 돌아오면 사라진다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.setViewportSize({ width: 1280, height: 300 });
  await page.goto("/projects");
  await 넘치게(page);

  // **먼저 없음을 센다** — 맨 위에서는 선이 없다.
  await expect(edge(page)).toBeHidden();

  await list(page).evaluate((el) => el.scrollTo(0, 40));
  await expect(edge(page)).toBeVisible();
  // 선은 **목록의 윗변**에 선다 — 1px, 목록 폭 그대로.
  const 목록 = (await list(page).boundingBox())!;
  const 선 = (await edge(page).boundingBox())!;
  expect(선.height).toBe(1);
  expect(선.y).toBe(목록.y);
  expect(선.width).toBeGreaterThanOrEqual(목록.width);

  await list(page).evaluate((el) => el.scrollTo(0, 0));
  await expect(edge(page)).toBeHidden();

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("확인할 것 띠가 있으면 선이 띠 아래에 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.setViewportSize({ width: 1280, height: 360 });
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await markAttention(page, {
    agent: "claude",
    event: "Stop",
    at: Date.now(),
    payload: { last_assistant_message: "커밋할까요?" },
  });
  await expect(띠(page)).toHaveCount(1);
  await 넘치게(page);

  await list(page).evaluate((el) => el.scrollTo(0, 40));
  await expect(edge(page)).toBeVisible();

  const 띠상자 = (await 띠(page).boundingBox())!;
  const 선 = (await edge(page).boundingBox())!;
  const 목록 = (await list(page).boundingBox())!;
  expect(선.y).toBe(목록.y);
  expect(선.y).toBeGreaterThanOrEqual(띠상자.y + 띠상자.height);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **선이 생기고 사라져도 한 픽셀도 안 밀린다**(스토리 90). 스크롤 상자 자체에 테두리를 주면
// 오버레이 막대가 `clientTop`만큼 밀리고(`lib/scroll-quiet.ts`의 `show`) 콘텐츠가 1px 내려앉는다
// — 그 모양을 겨눈다. 선례는 `scrollbar.spec.ts`의 「자리를 안 먹는다」다.
test("선이 서도 스크롤 상자와 막대가 안 밀린다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.setViewportSize({ width: 1280, height: 300 });
  await page.goto("/projects");
  await 넘치게(page);

  const bar = page.locator('[data-scrollbar="vertical"]');
  const 잰다 = async (top: number) => {
    await list(page).evaluate((el, top) => el.scrollTo(0, top), top);
    await expect(bar).toHaveAttribute("data-on", "");
    // 선이 켜진 뒤(또는 꺼진 뒤)에 잰다 — 그 전에 재면 선이 없는 두 화면을 견준다.
    if (top > 0) await expect(edge(page)).toBeVisible();
    else await expect(edge(page)).toBeHidden();
    // 막대는 스크롤 이벤트마다 다시 앉는다 — 선이 서는 렌더 **뒤의** 자리를 보려고 한 번 더 굴린다.
    await list(page).evaluate((el) => el.dispatchEvent(new Event("scroll")));
    return list(page).evaluate((el) => {
      const box = el as HTMLElement;
      const bar = document.querySelector<HTMLElement>('[data-scrollbar="vertical"]')!;
      return {
        clientTop: box.clientTop,
        top: box.getBoundingClientRect().top,
        clientWidth: box.clientWidth,
        offsetWidth: box.offsetWidth,
        barX: new DOMMatrixReadOnly(getComputedStyle(bar).transform).m41,
      };
    });
  };

  const 내림 = await 잰다(40);
  const 맨위 = await 잰다(0);

  expect(내림.clientTop).toBe(0);
  expect(맨위.clientTop).toBe(0);
  expect(내림.clientWidth).toBe(내림.offsetWidth);
  expect(맨위.clientWidth).toBe(맨위.offsetWidth);
  expect(내림.top).toBe(맨위.top);
  expect(내림.barX).toBe(맨위.barX);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("바닥 Settings 위에는 늘 1px 선이 있다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/projects");

  // 사이드바 바닥의 칸 — 페이지 헤더에도 설정 버튼이 설 수 있어 사이드바로 좁힌다.
  const 칸 = page
    .locator("aside")
    .filter({ has: page.getByRole("button", { name: MAIN_HEADER, exact: true }) })
    .getByRole("button", { name: "Settings", exact: true })
    .locator("xpath=../..");
  const 테두리 = await 칸.evaluate((el) => {
    const style = getComputedStyle(el);
    return { width: style.borderTopWidth, style: style.borderTopStyle, color: style.borderTopColor };
  });
  expect(테두리).toMatchObject({ width: "1px", style: "solid" });
  expect(테두리.color).not.toBe(TRANSPARENT);

  // 스크롤과 무관하다 — 목록이 맨 위여도 선다(위에서 목록을 안 굴렸다).
  await expect(edge(page)).toBeHidden();

  expect(await unknownIpcCalls(page)).toEqual([]);
});

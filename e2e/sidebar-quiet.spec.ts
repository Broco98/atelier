import { expect, test, type Locator, type Page } from "./evidence";
import { MAIN_HEADER, PINNED_HEADER, WORKS } from "./fixtures";
import { awaitSpawned, installFixtureBackend, markAttention, unknownIpcCalls, 띠 } from "./harness";

// **사이드바를 조용하게**(UI개선 결정 23~25 · #227). 셋 다 진짜 CSS와 진짜 레이아웃이 있어야
// 답이 나는 것이라 이 층이 든다: hover 배경은 `:hover`가 실제로 걸려야 계산되고, 「선이 서도
// 한 픽셀도 안 밀린다」는 픽셀이 답이다.
//
// `works-sidebar.spec.ts`와 따로 사는 것은 그 파일이 이미 마퀴·고정·대비·폭 조절로 1500줄에
// 가깝기 때문이다(행 끌기 05·06은 `work-row-drag.spec.ts`에 산다) — 여기서 재는 것은 목록의
// **테두리**뿐이다.

const [pinnedWork, plainWork] = WORKS;

const list = (page: Page) => page.locator("[data-worklist]");
/** 목록 윗 가장자리의 구분선. 목록 **밖**(스크롤하지 않는 부모)에 산다. */
const edge = (page: Page) => page.locator("[data-worklist-edge]");
/** 사이드바 바닥의 Settings 칸. */
const foot = (page: Page) => page.locator("[data-sidebar-foot]");

/** 목록을 굴려 내리는 거리. 넘침을 기다리는 문턱도 이 값이다 — 덜 넘치면 이만큼 못 구른다. */
const SCROLL = 40;

/**
 * 색의 알파. 칠해졌는가는 색의 철자가 아니라 이 값이 말한다.
 *
 * **못 읽는 모양은 던진다**(fail-closed). 쉼표형 `rgb(r, g, b)`·`rgba(r, g, b, a)`와 공백형
 * `rgb(r g b / a)`만 받는다 — 그 밖을 불투명으로 치면 투명한 배경이 「칠해졌다」로 초록이 된다.
 */
const alphaOf = (color: string) => {
  const inner = /^rgba?\(([^)]*)\)$/.exec(color.trim())?.[1];
  if (inner === undefined) throw new Error(`색을 못 읽었다: ${color}`);
  if (inner.includes(",")) {
    const parts = inner.split(",");
    if (parts.length === 3) return 1;
    if (parts.length === 4) return Number(parts[3]);
    throw new Error(`색을 못 읽었다: ${color}`);
  }
  const [channels, alpha, ...rest] = inner.split("/");
  const count = channels.trim().split(/\s+/).length;
  if (count !== 3 || rest.length > 0) throw new Error(`색을 못 읽었다: ${color}`);
  if (alpha === undefined) return 1;
  const value = alpha.trim().endsWith("%") ? Number(alpha.trim().slice(0, -1)) / 100 : Number(alpha);
  if (Number.isNaN(value)) throw new Error(`색을 못 읽었다: ${color}`);
  return value;
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

/** 목록이 굴릴 만큼 넘칠 때까지 기다린다. 넘치게 하는 것은 부르는 쪽의 창 높이다 — 픽스처 work은 몇 개뿐이다. */
const 넘칠때까지 = async (page: Page) => {
  await expect.poll(() => list(page).evaluate((el) => el.scrollHeight - el.clientHeight)).toBeGreaterThanOrEqual(SCROLL);
};

/** hover하면 배경이 칠해진다 — 트랜지션이 끝난 뒤의 알파로 잰다. */
const hover배경이칠해진다 = async (target: Locator) => {
  await target.hover();
  await expect.poll(async () => alphaOf((await styleOf(target)).background)).toBeGreaterThan(0);
  await 멎을때까지(target);
  expect(alphaOf((await styleOf(target)).background)).toBeGreaterThan(0);
};

test("alphaOf는 투명을 투명으로 읽고, 못 읽는 모양은 던진다", () => {
  expect(alphaOf("rgb(1, 2, 3)")).toBe(1);
  expect(alphaOf("rgba(229, 229, 232, 0)")).toBe(0);
  expect(alphaOf("rgb(1 2 3 / 0)")).toBe(0);
  expect(alphaOf("rgb(1 2 3 / 50%)")).toBe(0.5);
  expect(alphaOf("rgb(1 2 3)")).toBe(1);
  expect(() => alphaOf("transparent")).toThrow();
  expect(() => alphaOf("color(srgb 1 1 1 / 0)")).toThrow();
  expect(() => alphaOf("rgb(1, 2)")).toThrow();
});

test("구획 머리에 hover해도 배경이 안 칠해지고 글자만 진해진다 — 행과 nav의 hover 배경은 남는다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto("/projects");

  for (const [name, word] of [
    [PINNED_HEADER, "고정"],
    [MAIN_HEADER, "작업"],
  ] as const) {
    const header = page.getByRole("button", { name, exact: true });
    const label = header.getByText(word, { exact: true });
    const 쉴때 = await styleOf(label);

    await header.hover();
    // **글자가 진해진다** — 누를 수 있다는 말은 남는다(결정 23). 트랜지션이 있어 기다린다.
    // 이것을 먼저 세는 것이 아래 「배경이 투명」이 hover가 안 걸려서 초록인 것을 막는다.
    await expect.poll(async () => (await styleOf(label)).color).not.toBe(쉴때.color);
    await 멎을때까지(header);
    expect(alphaOf((await styleOf(header)).background), `${name} 머리에 hover 배경이 칠해졌다`).toBe(0);
  }

  // **행은 그대로다** — 누르면 가는 목적지라 지금 무엇을 가리키는지 보여야 한다. 두 구획을 다 센다.
  for (const work of [plainWork, pinnedWork]) {
    await hover배경이칠해진다(page.getByRole("button", { name: work.title, exact: true }).locator("xpath=.."));
  }
  // **nav도 그대로다**(티켓 본문). 지금 화면(Projects)이 아닌 항목이라야 선택 배경과 안 섞인다.
  await hover배경이칠해진다(page.locator("aside nav").getByRole("button", { name: "Archive", exact: true }).locator("xpath=.."));

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("목록이 스크롤됐을 때만 윗 가장자리에 선이 서고, 맨 위로 돌아오면 사라진다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.setViewportSize({ width: 1280, height: 300 });
  await page.goto("/projects");
  await 넘칠때까지(page);

  // **먼저 없음을 센다** — 맨 위에서는 선이 없다.
  await expect(edge(page)).toBeHidden();

  await list(page).evaluate((el, top) => el.scrollTo(0, top), SCROLL);
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

// 굴린 채로 구획을 접어 내용이 상자에 들어가면 브라우저가 scrollTop을 0으로 끌어내린다.
// 선은 scroll 이벤트만 듣는다 — 그 끌어내림이 이벤트를 안 쏘면 맨 위에서 선이 남는다.
test("굴린 채로 구획을 접어 넘침이 없어지면 선도 사라진다", async ({ page }) => {
  await installFixtureBackend(page);
  // **창 높이가 좁은 창문 안에 있어야 한다** — 처음엔 `SCROLL`만큼 넘치고, `작업`을 접으면 안
  // 넘쳐야 한다. 행이 한 줄(32px)이 되면서 그 창문이 옮겨 갔다(목록 내용 188px → 접으면 122px,
  // 목록 상자 = 창 높이 − 243px → 365~391px). 두 줄 행(55px) 시절의 400은 그 밖이라 처음부터
  // 안 넘쳤다. 가운데 값을 고른다.
  await page.setViewportSize({ width: 1280, height: 380 });
  await page.goto("/projects");
  await 넘칠때까지(page);

  await list(page).evaluate((el, top) => el.scrollTo(0, top), SCROLL);
  await expect(edge(page)).toBeVisible();

  // Playwright의 click은 머리를 보이는 곳까지 굴려 놓고 누른다 — 그러면 scrollTop이 사람 손이
  // 아니라 검사 손으로 바뀐다. 굴린 자리 그대로 누르려고 DOM의 click을 쏜다.
  await page.getByRole("button", { name: MAIN_HEADER, exact: true }).evaluate((el: HTMLElement) => el.click());
  // 접힌 뒤 정말 굴릴 것이 없어졌는가를 먼저 센다 — 아니면 아래가 다른 이유로 빨개진다.
  await expect.poll(() => list(page).evaluate((el) => el.scrollHeight - el.clientHeight)).toBeLessThanOrEqual(0);
  await expect.poll(() => list(page).evaluate((el) => el.scrollTop)).toBe(0);
  await expect(edge(page)).toBeHidden();

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("알림 띠가 있으면 선이 띠 아래에 선다", async ({ page }) => {
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
  await 넘칠때까지(page);

  await list(page).evaluate((el, top) => el.scrollTo(0, top), SCROLL);
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
//
// 재는 것 넷이 각자 다른 병을 잡는다:
// - `clientTop` — 상자에 윗 테두리가 붙었다(막대의 y가 그만큼 밀린다).
// - 상자의 top · `clientWidth === offsetWidth` — 상자가 통째로 움직이거나 막대가 폭을 먹었다.
// - 콘텐츠의 원점(첫 머리의 y + scrollTop) — 선이 설 때만 안쪽 여백이 붙어 내용이 내려앉았다.
//   테두리가 아니라 패딩이면 clientTop도 상자 top도 그대로라 이것만 빨개진다.
// - 막대의 x — 수용 기준이 부른 값이다. 윗 테두리는 x를 안 바꾸니 그것의 그물은 아니고,
//   선이 좌우 테두리·폭 변화로 막대를 옆으로 미는 쪽을 잡는다. 막대의 y는 scrollTop마다
//   달라서 두 위치 사이에 견줄 수 없다.
test("선이 서도 스크롤 상자와 막대와 내용이 안 밀린다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.setViewportSize({ width: 1280, height: 300 });
  await page.goto("/projects");
  await 넘칠때까지(page);

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
      const first = box.querySelector<HTMLElement>("[data-section]")!;
      return {
        scrollTop: box.scrollTop,
        clientTop: box.clientTop,
        top: box.getBoundingClientRect().top,
        clientWidth: box.clientWidth,
        offsetWidth: box.offsetWidth,
        contentY: first.getBoundingClientRect().top + box.scrollTop,
        barX: new DOMMatrixReadOnly(getComputedStyle(bar).transform).m41,
      };
    });
  };

  const 내림 = await 잰다(SCROLL);
  const 맨위 = await 잰다(0);

  // 정말 두 자리에서 쟀는가 — 아니면 아래가 한 화면을 두 번 견준다.
  expect(내림.scrollTop).toBe(SCROLL);
  expect(맨위.scrollTop).toBe(0);
  expect(내림.clientTop).toBe(0);
  expect(맨위.clientTop).toBe(0);
  expect(내림.clientWidth).toBe(내림.offsetWidth);
  expect(맨위.clientWidth).toBe(맨위.offsetWidth);
  expect(내림.top).toBe(맨위.top);
  expect(내림.contentY).toBe(맨위.contentY);
  expect(내림.barX).toBe(맨위.barX);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("바닥 Settings 위에는 늘 1px 선이 있다 — 목록을 굴려도 그대로이고, 목록 윗선과 같은 폭이다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.setViewportSize({ width: 1280, height: 300 });
  await page.goto("/projects");
  await 넘칠때까지(page);
  await expect(foot(page)).toHaveCount(1);

  const 테두리 = () =>
    foot(page).evaluate((el) => {
      const style = getComputedStyle(el);
      return { width: style.borderTopWidth, style: style.borderTopStyle, color: style.borderTopColor };
    });
  const 칠해졌다 = (border: { width: string; style: string; color: string }) => {
    expect(border).toMatchObject({ width: "1px", style: "solid" });
    expect(alphaOf(border.color), `Settings 윗선이 투명하다: ${border.color}`).toBeGreaterThan(0);
  };

  // 맨 위 — 목록 윗선은 없어도 바닥 선은 선다.
  await expect(edge(page)).toBeHidden();
  칠해졌다(await 테두리());

  // 굴린 뒤 — 여전히 선다. 목록 윗선과 같은 폭이다.
  await list(page).evaluate((el, top) => el.scrollTo(0, top), SCROLL);
  await expect(edge(page)).toBeVisible();
  칠해졌다(await 테두리());
  const 칸 = (await foot(page).boundingBox())!;
  const 선 = (await edge(page).boundingBox())!;
  expect(선.x).toBe(칸.x);
  expect(선.width).toBe(칸.width);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

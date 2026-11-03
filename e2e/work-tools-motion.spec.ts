import { expect, test, type Locator, type Page } from "./evidence";

import { WORKS } from "./fixtures";
import { installFixtureBackend, processesTitle, unknownIpcCalls, workRow } from "./harness";
import { settle } from "./tab-row";
import type { SpecTreeItem } from "@/features/works/types";

// restart 02a-16 — **레일과 spec 패널이 들고 난다**(구현 스펙 「02a」 「레일과 패널은 작업공간에서만 서고 spec 한 칸만 있다」 · 시안 Shell 「규칙」
// 「작업공간을 떠나면 레일과 패널이 함께 500ms로 접혀요」 · Motion 「레일이 들고 난다」 · `.ra-panelwrap`). 02a-14 · 02a-14b · 02a-14c가
// 넘긴 「새로 잴 것」이다(`구현-노트/티켓-02a-15.md`).
//
// - 02a-14 — 작업공간을 떠나면 레일 · 패널 상자가 함께 0으로 접히고(500ms spring, 레일 보임은 500ms 뒤 꺼짐), 들어오면 0 → 32 · 348로
//   자란다. 작업공간끼리는 접히지 않는다. 접힌 레일에는 포커스가 닿지 않는다. 동작 줄이기면 트랜지션이 없다.
// - 02a-14b — 떠나는 동안 마지막 트리의 사본(`[data-held-body]`)이 상자 안에 보이고 접힘이 끝나면 걷힌다. 접히는 중에 돌아오면 곧바로 걷힌다.
//   구른 자리도 같다. 동작 줄이기면 다음 프레임에 걷힌다.
// - 02a-14c — 작업공간 안의 여닫기도 안쪽이 옅어지지 않고 상자에 잘리기만 한다. 편 뒤 0.5s에 안쪽 상한이 상자 폭으로 넘어간다.
//
// 움직임은 페이지 안에서 프레임(rAF)마다 읽는다 — 누름도 페이지 안에서 해서(`el.click()`) 첫 프레임과 누름 사이에 왕복이 끼지 않는다. 박자는
// 상자 폭이 처음 움직인 프레임부터 잰다(dev 서버가 처음 가는 화면을 변환하는 동안은 누름 뒤 늦게 시작한다). 접힌 레일 상자는
// `[aria-label="레일"]`(접히면 `group`이 `getByRole`에 안 잡힌다), 패널 상자는 `aside#work-panel`, 그 첫 자식이 안쪽 열이다.

test.use({ viewport: { width: 1440, height: 900 } });

const [pinnedWork, plainWork] = WORKS;

const 패널 = (page: Page) => page.getByRole("region", { name: "작업공간 패널", exact: true });
const 패널토글 = (page: Page) => page.getByRole("button", { name: /^작업공간 패널 (접기|펼치기)$/ });
const 레일 = (page: Page) => page.getByRole("group", { name: "레일", exact: true });
const 레일상자 = (page: Page) => page.locator('[aria-label="레일"]');
const 패널상자 = (page: Page) => page.locator("aside#work-panel");
const 안쪽열 = (page: Page) => page.locator("aside#work-panel > div").first();
const 프로세스줄 = (page: Page) =>
  page.getByRole("navigation", { name: "가는 곳", exact: true }).getByRole("button", { name: /^Processes/ });
const 작업공간줄 = (page: Page, work: (typeof WORKS)[number]) => workRow(page, work.slug).getByRole("button", { name: work.title, exact: true });

/** 한 프레임에 읽은 것. 폭은 그려진 폭(px)이다. */
interface 프레임 {
  /** 누른 때부터 흐른 ms. */
  t: number;
  path: string;
  /** 패널 상자(틈 8 + 카드)의 폭. */
  panel: number;
  panelLeft: number;
  panelRight: number;
  rail: number;
  railVisibility: string;
  /** 안쪽 열 — 옅음 · 그려진 폭 · 계산된 상한. */
  innerOpacity: string;
  innerWidth: number;
  innerMaxWidth: string;
  /** 상자 안 `overview.md` 트리 행의 수와 그 가로 자리(첫 행). */
  rows: number;
  rowLeft: number | null;
  rowRight: number | null;
  /** 남긴 사본의 수 · 몸 자리의 자식 수 · 사본 안에서 가장 많이 구른 자리. */
  held: number;
  slotKids: number;
  heldScroll: number;
}

/**
 * `target`을 누르고 `ms` 동안 프레임마다 읽는다. `back`이 있으면 누른 뒤 그 ms에 뒤로 간다. 누르기 전 한 장이 첫 프레임이다.
 */
async function 프레임을잰다(target: Locator, { ms = 2000, back }: { ms?: number; back?: number } = {}): Promise<프레임[]> {
  return target.evaluate(
    (el, { ms, back }) =>
      new Promise<프레임[]>((resolve) => {
        const frames: 프레임[] = [];
        let backed = false;
        let t0 = performance.now();
        const read = () => {
          const t = performance.now() - t0;
          const box = document.querySelector("aside#work-panel") as HTMLElement;
          const inner = box.firstElementChild as HTMLElement;
          const rail = document.querySelector('[aria-label="레일"]') as HTMLElement;
          const rows = box.querySelectorAll('[data-roving="overview.md"]');
          const held = Array.from(document.querySelectorAll("[data-held-body]"));
          const b = box.getBoundingClientRect();
          const r = rows[0]?.getBoundingClientRect();
          frames.push({
            t,
            path: location.pathname,
            panel: b.width,
            panelLeft: b.left,
            panelRight: b.right,
            rail: rail.getBoundingClientRect().width,
            railVisibility: getComputedStyle(rail).visibility,
            innerOpacity: getComputedStyle(inner).opacity,
            innerWidth: inner.getBoundingClientRect().width,
            innerMaxWidth: getComputedStyle(inner).maxWidth,
            rows: rows.length,
            rowLeft: r ? r.left : null,
            rowRight: r ? r.right : null,
            held: held.length,
            slotKids: document.querySelector("[data-work-panel-body]")?.childElementCount ?? -1,
            heldScroll: Math.max(0, ...held.flatMap((one) => [one, ...Array.from(one.querySelectorAll("*"))]).map((one) => one.scrollTop)),
          });
          if (back !== undefined && !backed && t >= back) {
            backed = true;
            history.back();
          }
          if (t < ms) requestAnimationFrame(read);
          else resolve(frames);
        };
        read();
        t0 = performance.now();
        (el as HTMLElement).click();
        requestAnimationFrame(read);
      }),
    { ms, back },
  );
}

/** 움직임의 자리 — 폭이 처음 움직인 프레임과 끝 값에 닿은 프레임(ms). `pick`이 그 폭을 고른다. */
function 박자(frames: 프레임[], pick: (frame: 프레임) => number, to: number): { start: number; end: number; moving: number } {
  const from = pick(frames[0]);
  const startAt = frames.findIndex((frame) => Math.abs(pick(frame) - from) > 0.5);
  if (startAt < 0) throw new Error(`움직이지 않았다 — ${from}`);
  const endAt = frames.findIndex((frame, at) => at >= startAt && Math.abs(pick(frame) - to) <= 0.5);
  if (endAt < 0) throw new Error(`${to}에 닿지 않았다 — 끝 ${pick(frames[frames.length - 1])}`);
  const moving = frames.filter((frame) => Math.abs(pick(frame) - from) > 0.5 && Math.abs(pick(frame) - to) > 0.5).length;
  return { start: frames[startAt].t, end: frames[endAt].t, moving };
}

/** 프레임마다 레일과 패널 상자의 남은 몫(폭 ÷ 다 선 폭)이 가장 크게 벌어진 값 — 같은 박자 · 곡선이면 한 프레임 어긋남 안쪽이다. */
const 몫차이 = (frames: 프레임[], full: { panel: number; rail: number }) =>
  Math.max(...frames.map((frame) => Math.abs(frame.panel / full.panel - frame.rail / full.rail)));

/**
 * Processes 화면에 한 번 다녀온다 — 처음 가는 화면은 dev 서버가 모듈을 변환하느라 누름 뒤 한참 늦게 서서(L3 전체에서 그 화면을 처음 여는
 * 시험이면 1초를 넘기고, 여러 워커가 함께 돌면 5초도 넘긴다) 잴 창(2s) 밖으로 밀린다. 다녀온 뒤 작업공간이 다시 설 때까지 기다린다.
 */
async function 프로세스를다녀온다(page: Page): Promise<void> {
  await 프로세스줄(page).click();
  // **기본 5초가 아니다** — 그 변환을 기다린다.
  await expect(processesTitle(page)).toBeVisible({ timeout: 20_000 });
  await page.goBack();
  await 작업공간에섰다(page);
}

/** 작업공간 화면이 섰다 — 기둥(레일 · 패널 상자)이 다 자랄 때까지 기다린다. */
async function 작업공간에섰다(page: Page): Promise<{ panel: number; rail: number }> {
  await expect(패널(page)).toBeVisible({ timeout: 20_000 });
  await expect(레일(page)).toBeVisible();
  const [panel, rail] = await settle(page, async () => [
    await 패널상자(page).evaluate((el) => el.getBoundingClientRect().width),
    await 레일상자(page).evaluate((el) => el.getBoundingClientRect().width),
  ]);
  return { panel, rail };
}

test("작업공간을 떠나면 레일과 spec 패널 상자가 함께 500ms로 접히고 레일 보임은 그 뒤 꺼진다 — 접히는 동안 마지막 트리가 상자 안에 옅어지지 않고 보이다가 접힘이 끝나면 걷히며, 접힌 레일에는 포커스가 닿지 않는다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  const full = await 작업공간에섰다(page);
  expect(full).toEqual({ panel: 348, rail: 32 });
  await 프로세스를다녀온다(page);

  const frames = await 프레임을잰다(프로세스줄(page));
  await expect(processesTitle(page)).toBeVisible();
  const panel = 박자(frames, (frame) => frame.panel, 0);
  const rail = 박자(frames, (frame) => frame.rail, 0);

  // 함께 접힌다 — 같은 프레임 언저리에서 시작하고, 프레임마다 남은 몫(폭 ÷ 처음 폭)이 같은 곡선을 탄다. 그 사이 여러 프레임에 걸친다(곧바로
  // 사라지지 않는다). 0에 닿는 때는 견주지 않는다 — 같은 곡선이라도 32와 348은 0.5 아래로 내려가는 프레임이 다르다.
  expect(Math.abs(rail.start - panel.start), "레일과 패널이 함께 접히기 시작한다").toBeLessThanOrEqual(40);
  expect(몫차이(frames, full), "레일과 패널이 같은 박자로 접힌다").toBeLessThanOrEqual(0.15);
  expect(panel.end - panel.start, "접힘은 500ms spring이다").toBeGreaterThanOrEqual(300);
  expect(panel.end - panel.start).toBeLessThanOrEqual(700);
  expect(panel.moving).toBeGreaterThanOrEqual(5);
  expect(rail.moving).toBeGreaterThanOrEqual(5);

  // 레일 보임 — 폭이 남은 동안은 보이고, 접힘이 시작되고 500ms 뒤에 꺼진다.
  for (const frame of frames.filter((one) => one.rail > 0.5)) expect(frame.railVisibility, `${Math.round(frame.t)}ms`).toBe("visible");
  const hidden = frames.find((frame) => frame.railVisibility === "hidden");
  expect(hidden, "레일 보임이 꺼진다").toBeDefined();
  expect(hidden!.t - rail.start).toBeGreaterThanOrEqual(450);

  // 접히는 동안(02a-14b) — 트리 행이 하나(사본) 상자 안에 보이고, 안쪽 열은 옅어지지 않으며 고정 폭이라 상자에 잘린다. 행의 왼쪽 끝은 상자
  // 왼쪽에서 틈 8 · 카드 안쪽 여백만큼 들어가 있어 상자가 그보다 좁아진 끝 몇 프레임에는 행이 다 잘려 안 보인다 — 그 프레임은 뺀다.
  const folding = frames.filter((frame) => frame.t >= panel.start && frame.panel > 0.5);
  expect(folding.length).toBeGreaterThanOrEqual(5);
  for (const frame of folding) {
    const at = `${Math.round(frame.t)}ms · 상자 ${frame.panel.toFixed(1)}`;
    expect(frame.held, `${at} — 사본이 선다`).toBe(1);
    expect(frame.rows, `${at} — 트리 행 하나`).toBe(1);
    if (frame.panel > 40) expect(frame.rowLeft!, `${at} — 행이 상자 안에 보인다`).toBeLessThan(frame.panelRight);
    expect(frame.innerOpacity, at).toBe("1");
    expect(Math.round(frame.innerWidth), `${at} — 안쪽은 고정 폭이다`).toBe(full.panel);
  }
  expect(
    folding.some((frame) => frame.rowRight! > frame.panelRight && frame.rowLeft! < frame.panelRight),
    "행이 상자 끝에 잘리는 프레임이 있다",
  ).toBe(true);

  // 접힘이 끝나면 사본이 걷히고 몸 자리가 빈다.
  const last = frames[frames.length - 1];
  expect([last.held, last.slotKids, last.rows, last.panel, last.rail]).toEqual([0, 0, 0, 0, 0]);
  await expect(레일상자(page)).toHaveAttribute("data-show", "false");

  // 접힌 레일 · 패널에는 포커스가 닿지 않는다.
  const focusable = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>('[aria-label="레일"] button, aside#work-panel button, aside#work-panel [tabindex]')).map((el) => {
      el.focus();
      return document.activeElement === el;
    }),
  );
  expect(focusable.length).toBeGreaterThan(0);
  expect(focusable.every((one) => !one), "접힌 레일 · 패널의 단추가 포커스를 받지 않는다").toBe(true);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("다른 화면에서 작업공간에 들어오면 레일과 spec 패널 상자가 함께 0 → 32 · 348로 자라고, 작업공간끼리 옮기면 접히지 않는다", async ({ page }) => {
  // 작업공간에서 Processes로 떠나 접힌 뒤 들어온다(두 화면의 모듈을 dev 서버가 다 변환해 둔 뒤다 — `프로세스를다녀온다`).
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await 작업공간에섰다(page);
  await 프로세스줄(page).click();
  await expect(processesTitle(page)).toBeVisible({ timeout: 20_000 });
  await expect(레일상자(page)).toHaveAttribute("data-show", "false");
  await settle(page, () => 패널상자(page).evaluate((el) => el.getBoundingClientRect().width));

  const frames = await 프레임을잰다(작업공간줄(page, pinnedWork));
  await expect(page).toHaveURL(new RegExp(`/works/${pinnedWork.slug}`));
  const panel = 박자(frames, (frame) => frame.panel, 348);
  const rail = 박자(frames, (frame) => frame.rail, 32);
  expect([frames[0].panel, frames[0].rail]).toEqual([0, 0]);
  expect(Math.abs(rail.start - panel.start), "레일과 패널이 함께 자라기 시작한다").toBeLessThanOrEqual(40);
  expect(몫차이(frames, { panel: 348, rail: 32 }), "레일과 패널이 같은 박자로 자란다").toBeLessThanOrEqual(0.15);
  expect(panel.end - panel.start, "자람은 500ms spring이다").toBeGreaterThanOrEqual(250);
  expect(panel.end - panel.start).toBeLessThanOrEqual(700);
  expect(panel.moving).toBeGreaterThanOrEqual(5);
  expect(rail.moving).toBeGreaterThanOrEqual(5);
  // 자라는 쪽은 보임이 곧바로 켜진다 — 폭이 생긴 프레임부터 보인다.
  for (const frame of frames.filter((one) => one.rail > 0.5)) expect(frame.railVisibility, `${Math.round(frame.t)}ms`).toBe("visible");
  const last = frames[frames.length - 1];
  expect([Math.round(last.panel), Math.round(last.rail)]).toEqual([348, 32]);
  await expect(레일상자(page)).toHaveAttribute("data-show", "true");
  await expect(패널(page).locator('[data-roving="overview.md"]')).toBeVisible();

  // 작업공간끼리 — 화면이 그대로라 기둥이 접히지 않는다. 몸만 그 작업공간의 것으로 바뀐다.
  const between = await 프레임을잰다(작업공간줄(page, plainWork), { ms: 900 });
  await expect(page).toHaveURL(new RegExp(`/works/${plainWork.slug}`));
  expect(Math.min(...between.map((frame) => frame.rail)), "레일이 접히지 않는다").toBeGreaterThanOrEqual(31.5);
  expect(Math.min(...between.map((frame) => frame.panel)), "패널 상자가 접히지 않는다").toBeGreaterThanOrEqual(347.5);
  expect(between.every((frame) => frame.held === 0), "작업공간끼리는 사본을 남기지 않는다").toBe(true);
  await expect(패널(page).locator('[data-roving="overview.md"]')).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("접히는 중에 뒤로 가기로 작업공간에 돌아오면 남긴 사본이 곧바로 걷히고 트리 행이 하나 서서 눌린다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  await 작업공간에섰다(page);

  // 떠나서 접히는 중(누른 뒤 250ms)에 뒤로 간다.
  await 프로세스를다녀온다(page);
  const frames = await 프레임을잰다(프로세스줄(page), { ms: 1500, back: 250 });
  await expect(page).toHaveURL(new RegExp(`/works/${pinnedWork.slug}`));

  const left = frames.findIndex((frame) => frame.path === "/processes");
  const returned = frames.findIndex((frame, at) => at > left && frame.path === `/works/${pinnedWork.slug}`);
  expect(left).toBeGreaterThanOrEqual(0);
  expect(returned, "돌아왔다").toBeGreaterThan(left);
  expect(
    frames.slice(left, returned).some((frame) => frame.held === 1 && frame.panel < 347.5),
    "돌아오기 전에 사본을 남긴 채 접히고 있었다",
  ).toBe(true);
  // 돌아온 뒤 — 몇 프레임 안에 사본이 걷히고, 그 뒤로는 다시 서지 않는다. 트리 행은 늘 하나다.
  const settled = frames.slice(returned + 3);
  expect(settled.length).toBeGreaterThan(0);
  for (const frame of settled) {
    expect(frame.held, `${Math.round(frame.t)}ms`).toBe(0);
    expect(frame.rows, `${Math.round(frame.t)}ms`).toBe(1);
  }
  expect(Math.round(frames[frames.length - 1].panel)).toBe(348);

  // 그 행은 살아 있는 트리다 — 누르면 그 문서가 넓힌 카드로 열린다.
  await expect(패널상자(page).locator('[data-roving="overview.md"]')).toHaveCount(1);
  await 패널(page).locator('[data-roving="overview.md"]').click();
  await expect(page.locator("section[data-expanded]")).toBeVisible();
  await expect.poll(() => new URL(page.url()).searchParams.get("file")).toBe("overview.md");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** 패널을 넘치게 하는 긴 트리 — 문서 마흔이 차례로 선다. */
const LONG_DOCS = Array.from({ length: 40 }, (_, at) => `문서-${String(at + 1).padStart(2, "0")}.md`);
const longFile = (path: string): SpecTreeItem => ({ name: path, path, kind: "file", icon: null, group: null, children: [] });

test("구른 트리는 접히는 동안 사본에서도 그 자리 그대로다", async ({ page }) => {
  await installFixtureBackend(page, {
    list_works: [
      {
        ...pinnedWork,
        specFiles: [...pinnedWork.specFiles, ...LONG_DOCS],
        specTree: { ...pinnedWork.specTree, items: [...pinnedWork.specTree.items, ...LONG_DOCS.map(longFile)] },
      },
      ...WORKS.slice(1),
    ],
  });
  await page.goto(`/works/${pinnedWork.slug}`);
  await 작업공간에섰다(page);
  await 프로세스를다녀온다(page);
  await expect(패널(page).locator(`[data-roving="${LONG_DOCS[39]}"]`)).toHaveCount(1);

  // 트리의 스크롤 상자를 240 굴린다.
  const scrolled = await 패널상자(page).evaluate((box) => {
    const scroller = Array.from(box.querySelectorAll<HTMLElement>("*")).find((el) => el.scrollHeight > el.clientHeight + 240);
    if (!scroller) return null;
    scroller.scrollTop = 240;
    return scroller.scrollTop;
  });
  expect(scrolled, "트리가 넘쳐 구른다").toBe(240);

  const frames = await 프레임을잰다(프로세스줄(page));
  await expect(processesTitle(page)).toBeVisible();
  const holding = frames.filter((frame) => frame.held > 0);
  expect(holding.length).toBeGreaterThanOrEqual(5);
  for (const frame of holding) expect(frame.heldScroll, `${Math.round(frame.t)}ms — 사본도 구른 자리다`).toBe(240);
  expect(frames[frames.length - 1].held).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("패널 토글로 여닫으면 안쪽 열이 옅어지지 않고 상자에 잘리기만 하며, 편 뒤 0.5s에 안쪽 상한이 상자 폭(`100%`)으로 넘어간다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  const full = await 작업공간에섰다(page);
  expect(await 안쪽열(page).evaluate((el) => getComputedStyle(el).maxWidth)).toBe("100%");

  // 닫는다 — 상자가 접히는 동안 안쪽은 옅음 1 · 고정 폭이고, 트리 행이 상자 끝에 잘린다.
  const closing = await 프레임을잰다(패널토글(page), { ms: 1000 });
  const fold = 박자(closing, (frame) => frame.panel, 0);
  expect(fold.moving).toBeGreaterThanOrEqual(5);
  const folding = closing.filter((frame) => frame.t >= fold.start && frame.panel > 0.5);
  for (const frame of folding) {
    const at = `${Math.round(frame.t)}ms · 상자 ${frame.panel.toFixed(1)}`;
    expect(frame.innerOpacity, at).toBe("1");
    expect(Math.round(frame.innerWidth), at).toBe(full.panel);
    expect(frame.rows, at).toBe(1);
  }
  expect(folding.some((frame) => frame.rowRight! > frame.panelRight && frame.rowLeft! < frame.panelRight), "행이 상자 끝에 잘리는 프레임이 있다").toBe(
    true,
  );
  // 작업공간 안의 여닫기는 사본을 남기지 않는다 — 몸은 상자 안에 마운트된 채다.
  expect(closing.every((frame) => frame.held === 0)).toBe(true);
  expect(closing[closing.length - 1].rail).toBe(32);
  await expect(패널토글(page)).toHaveAccessibleName("작업공간 패널 펼치기");

  // 연다 — 같은 모양으로 드러나고, 안쪽 상한은 0.5s 동안 그대로였다가 상자 폭으로 넘어간다.
  const opening = await 프레임을잰다(패널토글(page), { ms: 1000 });
  const grow = 박자(opening, (frame) => frame.panel, full.panel);
  expect(grow.moving).toBeGreaterThanOrEqual(5);
  for (const frame of opening.filter((one) => one.t >= grow.start && one.panel > 0.5)) {
    expect(frame.innerOpacity, `${Math.round(frame.t)}ms`).toBe("1");
    expect(Math.round(frame.innerWidth), `${Math.round(frame.t)}ms`).toBe(full.panel);
  }
  for (const frame of opening.filter((one) => one.t < 400)) expect(frame.innerMaxWidth, `${Math.round(frame.t)}ms`).not.toBe("100%");
  const after = opening.filter((one) => one.t > 750);
  expect(after.length).toBeGreaterThan(0);
  for (const frame of after) expect(frame.innerMaxWidth, `${Math.round(frame.t)}ms`).toBe("100%");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("동작 줄이기면 레일 · 패널 상자 · 안쪽 열에 트랜지션이 없어 여닫음 · 떠남이 곧바로 서고, 남긴 사본은 다음 프레임에 걷힌다", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await installFixtureBackend(page);
  await page.goto(`/works/${pinnedWork.slug}`);
  const full = await 작업공간에섰다(page);
  await 프로세스를다녀온다(page);
  const transitions = async () =>
    Promise.all([레일상자(page), 패널상자(page), 안쪽열(page)].map((one) => one.evaluate((el) => getComputedStyle(el).transitionProperty)));
  expect(await transitions()).toEqual(["none", "none", "none"]);

  // 패널 토글 — 사이 프레임 없이 닫히고 열린다. 닫힌 안쪽은 트랜지션을 적지 않는다(처음 값 `all 0s` — 움직임이 없다). 연 안쪽의 상한도 곧바로
  // 상자 폭이다.
  const closing = await 프레임을잰다(패널토글(page), { ms: 400 });
  expect(박자(closing, (frame) => frame.panel, 0).moving).toBe(0);
  expect(await transitions()).toEqual(["none", "none", "all"]);
  expect(await 안쪽열(page).evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("0s");
  const opening = await 프레임을잰다(패널토글(page), { ms: 400 });
  expect(박자(opening, (frame) => frame.panel, full.panel).moving).toBe(0);
  expect(opening[opening.length - 1].innerMaxWidth).toBe("100%");

  // 떠남 — 레일 · 패널이 사이 프레임 없이 접히고 레일 보임이 곧바로 꺼진다. 남긴 사본은 접힌 다음 프레임에 걷힌다.
  const frames = await 프레임을잰다(프로세스줄(page), { ms: 1500 });
  await expect(processesTitle(page)).toBeVisible();
  const panel = 박자(frames, (frame) => frame.panel, 0);
  expect(panel.moving).toBe(0);
  expect(박자(frames, (frame) => frame.rail, 0).moving).toBe(0);
  const folded = frames.findIndex((frame) => frame.t >= panel.start);
  expect(frames[folded].railVisibility).toBe("hidden");
  for (const frame of frames.slice(folded + 2)) expect(frame.held, `${Math.round(frame.t)}ms`).toBe(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

import { expect } from "./evidence";
import type { Page } from "./evidence";
import { openShell } from "./harness";

// 탭 줄을 재는 손잡이 — `terminal-tabs.spec.ts`(좁은 창의 줄)와 `tab-order.spec.ts`(끄는 동안의
// 줄)가 **같은 측정**으로 `spill ≤ 0`을 든다. 스펙 파일끼리는 import할 수 없어(Playwright가
// 테스트 파일을 두 번 등록한다) 여기로 옮겼다 — 몸통은 `terminal-tabs`에 있던 그대로다.

/** 셸 상한(결정 30). `shell-registry`의 `MAX_SHELLS`와 같은 수다 — 이 줄이 가장 붐비는 폭이다. */
export const MAX_SHELLS = 8;

/** 탭 줄이 바닥에 닿아 넓혀 둔 사이드바(400)가 눌려 서는 폭 — 최소 폭(240)과 400 사이 어디든 「본문 열이 바닥에 선다」는 같다. */
export const SQUEEZED_SIDEBAR = 300;

/**
 * **칸 하나 폭 상자**(`ShellTabs`의 상자 바닥 44px)를 세우는 창 폭 — 탭 줄이 바닥에 닿아 넓혀 둔 사이드바(`widenSidebar`)가
 * `SQUEEZED_SIDEBAR`로 눌려 서는 폭이다. 앱 창의 최소 폭(900, `tauri.conf.json`) **아래**다.
 *
 * 한때 900px 창에 작업 패널이 열린 기본 배치가 그 상자였다 — 줄이 받는 폭이 작업 패널에 깎여 칸 상자가 0px이 됐다. 지금은
 * 탭 줄이 본문 카드의 머리이고(codex-ds 스펙 §4) 그 카드가 줄의 바닥을 들며(`TAB_ROW_CARD`), 패널이 제 최소 폭까지 줄고도
 * 모자라면 본문 열의 바닥(탭 줄 + 열린 패널의 최소 폭 + 틈)이 레일 열과 함께 틀 뿌리의 바닥이 되어 사이드바를 민다. 그 바닥(work
 * 화면 터미널 본문 · 셸 둘 · 패널을 연 채 macOS 약 442 — 탭 줄 166 + 패널 268 + 틈 8, L3 WebKit 실측 2026-10-11)과 넓힌
 * 사이드바(400) · 레일 열을 더해도 900에 못 미친다. 바닥까지 눌린 상자를 지키는 장치(카드 · 열의 `min-w-min` · 상자의 `min-w-[44px]` · 끄는 동안 가장자리 구르기)는
 * 그대로라, 그 상자를 재는 검사는 사이드바를 넓혀 두고 이 폭에서 잰다.
 *
 * **수가 아니라 상자로 잰다.** 줄의 바닥에는 글자가 든다 — `spec` 탭과 머리 카드 할 일(상태 배지)의 글자가 시스템 글꼴이라
 * OS마다 폭이 다르다(codex-ds 결정 3). 한때 여기는 660이라는 수였는데(그때의 번들 글꼴로 잰 바닥 약 345), 바닥이 그 수와 갈리면
 * 사이드바가 안 눌리거나 최소 폭까지 눌려 이 폭을 딛는 검사가 다른 것을 잰다. 그래서 지금 화면의 바닥을 재서 창 폭을 낸다 — 틀의
 * 뿌리를 한 번 제 min-content 폭으로 세워 읽고 되돌린다. 그 폭이 뿌리의 `min-w-min`이 사이드바에게 요구하는 바로 그 값이다(머리 줄과
 * 아래 줄 — 본문 열의 바닥 + 레일 열 — 가운데 큰 쪽).
 *
 * 화면을 연 **뒤에**, 창이 넉넉한 채로 부른다 — 바닥은 그 화면의 줄이 정하고, 사이드바 · 틀 뿌리 말고 줄에 선 것의 폭(지금은 없다)은
 * 넘침 없는 배치에서 읽는다.
 */
export async function squeezedWidth(page: Page): Promise<number> {
  const { floor, rest } = await page.evaluate(() => {
    // 틀의 뿌리 — 머리 줄(문서의 `header`)과 그 아래 줄(본문 열 · 레일 열)을 이는 세로 상자다(`Frame`). 그 min-content가 탭 줄의
    // 바닥이다 — 탭 줄을 이는 카드의 바닥과 카드 줄의 다른 칸(열린 작업 패널의 최소 폭)을 더한 본문 열의 바닥에 레일 열을 더한 값이다
    // (`panel-layout`의 `TAB_ROW_COLUMN`). 머리 줄의 바닥(머리 카드의 할 일 · 패널 토글 자리)은 그보다 좁다.
    const column = document.querySelector("header")!.parentElement!;
    const now = column.getBoundingClientRect().width;
    const sidebar = document.querySelector("aside")!.getBoundingClientRect().width;
    const style = column.getAttribute("style");
    column.style.flex = "none";
    column.style.width = "min-content";
    const floor = column.getBoundingClientRect().width;
    if (style === null) column.removeAttribute("style");
    else column.setAttribute("style", style);
    return { floor, rest: window.innerWidth - sidebar - now };
  });
  return Math.ceil(floor + SQUEEZED_SIDEBAR + rest);
}

/** 사이드바를 넓혀 둔다(저장값 400 — 끄는 최대 폭). 페이지를 열기 **전에** 부른다 — 저장값은 사이드바가 설 때 한 번 읽힌다. */
export async function widenSidebar(page: Page): Promise<void> {
  await page.addInitScript(() => localStorage.setItem("sidebar-width", "400"));
}

export interface Row {
  width: number;
  spec: number;
  /** 줄 높이. 한 줄이면 `size-toolbar`(46px) 그대로다 — 넘겨 접히면 커진다. */
  height: number;
  /** 줄이 제 상자 밖으로 넘친 폭. **0이어야 한다** — 넘치면 오른쪽 끝 조작이 창 밖으로 밀린다. */
  spill: number;
  /** 창 전체의 가로 넘침. 스크롤 막대가 서는 그 값이다. */
  pageSpill: number;
  /**
   * 셸 칸 상자(결정 20). `scrollWidth > clientWidth`면 **그 안에서** 스크롤이 선 것이다 —
   * 줄이 넘친 것이 아니라 넘칠 몫을 이 상자가 받아 준 것이라, 위 `spill`은 그대로 0이다.
   */
  strip: { width: number; scrollWidth: number; clientWidth: number };
  /** 셸 칸들의 폭. 이것들이 서로 같아야 「균등」이다. */
  tabs: number[];
  /** 도는 칸의 로고+스피너 — 폭과, 제 칸 밖으로 삐져나온 양. */
  mark: { width: number; over: number } | null;
  /**
   * 오른쪽 끝 조작 묶음(`data-tab-actions`) — 폭과, 줄 밖으로 밀려난 양. 조작이 있는 줄은 분할의 터미널 열(그 열을 닫는 `×`)뿐이고,
   * 그 밖의 줄에는 묶음이 없어 `null`이다(상태 · ⋯ · 분할은 머리 카드에 선다).
   */
  actions: { width: number; over: number } | null;
  /**
   * 작업 화면 머리 카드 오른쪽의 할 일 | 보기 배치 묶음 — 상태 배지 · ⋯ | 분할(`data-head-actions` — `Frame`의 `HeadCard`). 탭 줄을
   * 재는 같은 순간에 잰다 — 줄이 바닥에 닿아 틀이 넓어지는 바로 그 폭에서 이 묶음이 밀려나거나 눌릴 수 있어서다. 머리 카드나 그
   * 묶음이 없는 화면(`/terminal`)은 `null`이다.
   * - `width` — 그려진 폭. `natural` — 제 max-content 폭(그 순간 한 번 세워 읽고 되돌린다). 둘이 같아야 「안 눌렸다」다.
   * - `over` — 머리 카드의 안쪽 오른쪽 끝(오른쪽 안쪽 여백 앞)을 넘은 양. `outside` — 창 오른쪽 끝을 넘은 양. 둘 다 **0 이하여야
   *   한다**. 뿌리가 스크롤하지 않아(`pageSpill`이 0이어도) 창 밖으로 밀린 조작은 이 값으로만 드러난다.
   */
  workActions: { width: number; natural: number; over: number; outside: number } | null;
}

/**
 * 줄을 통째로 잰다. **한 번의 evaluate로 끝낸다** — 폭을 하나씩 물어 오면 그 사이에
 * 레이아웃이 갈릴 수 있고, 실패했을 때 어느 값이 어느 순간의 것인지가 흐려진다.
 *
 * 줄은 **셸 칸 상자(`data-tab-strip`)를 든 머리**다(codex-ds 스펙 §11) — 본문 카드 맨 위에 선다. 조작 묶음은 그 줄의 자식이다.
 */
export async function rowOf(page: Page): Promise<Row> {
  return page.evaluate(() => {
    const strip = document.querySelector("[data-tab-strip]")!;
    const row = strip.parentElement!;
    const box = row.getBoundingClientRect();
    const cells = [...document.querySelectorAll('[data-tab="shell"]')];
    const mark = document.querySelector('[data-tab="shell"] [role="img"]');
    const markCell = mark?.closest('[data-tab="shell"]') ?? null;
    const actions = row.querySelector(":scope > [data-tab-actions]")?.getBoundingClientRect() ?? null;
    const head = document.querySelector<HTMLElement>('header [data-slot="head-card"]');
    const work = head?.querySelector<HTMLElement>("[data-head-actions]") ?? null;
    const workBox = work?.getBoundingClientRect() ?? null;
    let natural = 0;
    if (work) {
      const style = work.getAttribute("style");
      work.style.flex = "none";
      work.style.width = "max-content";
      natural = work.getBoundingClientRect().width;
      if (style === null) work.removeAttribute("style");
      else work.setAttribute("style", style);
    }
    const headEnd = head ? head.getBoundingClientRect().right - parseFloat(getComputedStyle(head).paddingRight) : 0;
    return {
      height: box.height,
      width: box.width,
      spec: document.querySelector('[data-tab="spec"]')?.getBoundingClientRect().width ?? 0,
      spill: row.scrollWidth - row.clientWidth,
      pageSpill: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      strip: {
        width: strip.getBoundingClientRect().width,
        scrollWidth: strip.scrollWidth,
        clientWidth: strip.clientWidth,
      },
      tabs: cells.map((cell) => cell.getBoundingClientRect().width),
      mark:
        mark && markCell
          ? {
              width: mark.getBoundingClientRect().width,
              over: mark.getBoundingClientRect().right - markCell.getBoundingClientRect().right,
            }
          : null,
      actions: actions && { width: actions.width, over: actions.right - box.right },
      workActions: workBox && {
        width: workBox.width,
        natural,
        over: workBox.right - headEnd,
        outside: workBox.right - document.documentElement.clientWidth,
      },
    };
  });
}

/**
 * **배치가 멈출 때까지 기다리고** 그 뒤의 값을 돌려준다 — 패널·사이드바가 접히고 펴지는 220ms, 창 폭이
 * 바뀐 직후에 잰 값은 곧 낡는다. 이 파일을 쓰는 스펙 셋이 **이 규칙 하나**로 기다린다.
 *
 * 멈춤의 기준이 둘이다: 도는 **CSS 트랜지션이 없고**, 그 상태에서 `interval` 간격으로 두 번 잰 값이
 * 같다. 「두 번 같다」만으로는 모자랐다 — 작업 패널 안쪽 열의 `max-width`는 **지연 220ms · 길이 0**
 * 이라 그 지연 동안 배치가 멈춰 보이고, 두 샘플이 그 창 안에 떨어지면 잘린 `×`를 잰 채 넘어갔다
 * (분할+패널 검사가 6번 중 2번 빨강). 지연 중인 트랜지션도 `getAnimations()`에 든다. 트랜지션만
 * 세는 것은 도는 칸의 스피너 같은 **끝없는 키프레임 애니메이션**이 있어서다.
 *
 * 트랜지션이 없어도 두 번은 잰다 — 누른 직후 React가 아직 안 그려 트랜지션이 서기 **전**일 수 있다.
 */
export async function settle<T>(page: Page, sample: () => Promise<T>, interval = 150): Promise<T> {
  let last: string | null = null;
  await expect
    .poll(
      async () => {
        const moving = await page.evaluate(() => document.getAnimations().some((one) => one instanceof CSSTransition));
        const now = moving ? null : JSON.stringify(await sample());
        const same = now !== null && now === last;
        last = now;
        return same;
      },
      { intervals: [interval] },
    )
    .toBe(true);
  return sample();
}

/**
 * 상한까지 셸을 채운다. `+`가 잠기는 것이 「정말 8칸이다」의 관찰 가능한 형태다(결정 30).
 *
 * 칸은 `openShell`로 **하나씩** 연다 — 칸이 서는 것과 그 칸이 pty를 갖는 것은 다른 순간이고
 * (`awaitSpawned`의 머리말), 안 기다리면 여덟 번의 왕복이 서로 겹쳐 **몇 번째 칸이 몇 번
 * pty를 받았는지가 실행마다 갈린다.** 픽스처가 부른 순서대로 id를 주기 시작한 뒤로
 * (`FIXTURE_INCREMENTING_KEYS`) 그 순서가 이 판의 전제가 됐다.
 */
export async function fillToCap(page: Page): Promise<void> {
  const tabs = page.locator('[data-tab="shell"]');
  // 이미 몇 칸이 서 있어도 상관없이 상한까지 채운다 — 부르는 자리마다 시작 칸 수가 다르다.
  await tabs.first().waitFor();
  for (let n = await tabs.count(); n < MAX_SHELLS; n += 1) await openShell(page);
  await expect(page.locator('[data-tab="new"]')).toHaveAttribute("aria-disabled", "true");
}

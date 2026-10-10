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
 * 한때 900px 창에 작업 패널이 열린 기본 배치가 그 상자였다 — 패널이 탭 줄 옆에 서서 줄의 폭을 나눠 가졌다. 패널이 탭 줄
 * 아래 카드 줄로 내려온 뒤로(ui-refresh 결정 4 · 27) 줄이 받는 폭은 창에서 사이드바만 뺀 나머지이고, 탭 줄의 바닥(work 화면
 * 기준 macOS 약 315 · Playwright 리눅스 이미지 약 309 — L3 WebKit 실측 2026-10-11)과 넓힌 사이드바(400)를 더해도 900에 못
 * 미친다. 바닥까지 눌린 상자를 지키는 장치(열의 `min-w-min` · 상자의 `min-w-[44px]` · 끄는 동안 가장자리 구르기)는
 * 그대로라, 그 상자를 재는 검사는 사이드바를 넓혀 두고 이 폭에서 잰다.
 *
 * **수가 아니라 상자로 잰다.** 줄의 바닥(본문 열의 min-content)에는 글자가 든다 — `spec` 탭과 조작 묶음의 글자가 시스템 글꼴이라
 * OS마다 폭이 다르다(codex-ds 결정 3). 한때 여기는 660이라는 수였는데(그때의 번들 글꼴로 잰 바닥 약 345), 바닥이 그 수와 갈리면
 * 사이드바가 안 눌리거나 최소 폭까지 눌려 이 폭을 딛는 검사가 다른 것을 잰다. 그래서 지금 화면의 바닥을 재서 창 폭을 낸다 — 본문
 * 열을 한 번 제 min-content 폭으로 세워 읽고 되돌린다. 그 폭이 열의 `min-w-min`이 사이드바에게 요구하는 바로 그 값이다.
 *
 * 화면을 연 **뒤에**, 창이 넉넉한 채로 부른다 — 바닥은 그 화면의 줄이 정하고, 사이드바 · 본문 열 말고 줄에 선 것(레일 열)의 폭은
 * 넘침 없는 배치에서 읽는다.
 */
export async function squeezedWidth(page: Page): Promise<number> {
  const { floor, rest } = await page.evaluate(() => {
    // 본문 열 — 바탕 줄(문서의 첫 `header`)을 이는 열이다(`panel-layout`의 `TAB_ROW_COLUMN`).
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
  /** 줄 높이. 한 줄이면 `--titlebar-height`(44px) 그대로다 — 넘겨 접히면 커진다. */
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
  /** 오른쪽 끝 조작 — 폭과, 줄 밖으로 밀려난 양. */
  actions: { width: number; over: number };
}

/**
 * 줄을 통째로 잰다. **한 번의 evaluate로 끝낸다** — 폭을 하나씩 물어 오면 그 사이에
 * 레이아웃이 갈릴 수 있고, 실패했을 때 어느 값이 어느 순간의 것인지가 흐려진다.
 *
 * 조작 묶음은 **헤더의 마지막 자식**이다(`WorksPage.test.tsx`가 같은 자리를 그렇게 짚는다).
 */
export async function rowOf(page: Page): Promise<Row> {
  return page.evaluate(() => {
    const header = document.querySelector("header")!;
    const box = header.getBoundingClientRect();
    const strip = document.querySelector("[data-tab-strip]")!;
    const cells = [...document.querySelectorAll('[data-tab="shell"]')];
    const mark = document.querySelector('[data-tab="shell"] [role="img"]');
    const markCell = mark?.closest('[data-tab="shell"]') ?? null;
    const actions = header.lastElementChild!.getBoundingClientRect();
    return {
      height: box.height,
      width: box.width,
      spec: document.querySelector('[data-tab="spec"]')?.getBoundingClientRect().width ?? 0,
      spill: header.scrollWidth - header.clientWidth,
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
      actions: { width: actions.width, over: actions.right - box.right },
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

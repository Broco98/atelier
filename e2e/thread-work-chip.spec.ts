import { expect, test, type Page } from "./evidence";

import { answerByArg, FIXTURE_THREAD, SEARCH_RESULTS } from "./fixtures";
import { installFixtureBackend, ipcCallArgs, unknownIpcCalls } from "./harness";
import { summaryOf } from "./thread-records";
import { RECENT_HITS, REFUND, WORLD_PROJECTS, WORLD_SPACES, WORLD_WORKS } from "./thread-space-world";
import type { ThreadView } from "@/features/thread/types";

// 03 흐름 「트레이」(F4-KitComposer)의 Work 칩 조각 — **Work 칩이 스위치 둘(「새 Work」 · 「Work 없이 대화」)과 최근 Work를 고르고, 고른 것이
// 칩 이름 · 입력창 안내 · 정도 칩을 바꾸며 첫 말과 함께 가고, 마지막에 고른 스위치 쪽을 기억한다**(03 구현 스펙 §5 · 티켓 02 · S2 ·
// 스토리 14–21 · v1 티켓 31 · S18). v1 티켓 40이 세운 이 spec을 02의 「새 Work가 기본」 · 「Work 없이 대화」 스위치로 고쳤다. 트레이의 나머지
// (두 자리 · 씨앗 · 잠긴 칩 · Space 칩 · 범위 줄 · `@` 없음 · `/agent` 없음)는 같은 흐름의 `thread-tray`가 잰다 — 같은 것을 두 번 재지 않는다.
//
// 첫 말 뒤의 일(새 Work 제안 · 그 Work의 자리에서 뜨는 Session)은 엔진의 몫이다 — L1(`thread_work.rs` 머리말 · `thread_host.rs` ·
// `thread_policy.rs`)이 잰다. 여기서는 고른 것이 그 인자로 나가는 데까지다. Work · Space는 시안의 세계다(`thread-space-world`).

test.use({ viewport: { width: 1440, height: 900 } });

const picked = REFUND;
const linked: ThreadView = { ...FIXTURE_THREAD, work: picked.slug };

const 사이드바 = (page: Page) => page.locator("aside[data-sidebar]");
const 입력칸 = (page: Page) => page.getByRole("textbox", { name: "보낼 말", exact: true });
const 첫화면 = (page: Page) => page.getByRole("heading", { name: "무엇을 만들까요?", exact: true });
const 트레이 = (page: Page) => page.locator('[data-slot="composer-tray"]');
const 워크칩 = (page: Page, name: string) => page.getByRole("button", { name: `어디서 일할지 ${name}`, exact: true });
const 메뉴 = (page: Page) => page.getByRole("menu");
const 갈래 = (page: Page, name: string) => page.getByRole("menuitemradio", { name, exact: true });

/** 고른 것이 바꾸는 글 — 빈 입력창의 안내(02 결정 — v1 그대로 고른 것을 따른다). */
async function shows(page: Page, placeholder: string) {
  await expect(입력칸(page)).toHaveAttribute("placeholder", placeholder);
}

/**
 * 첫 말을 보낸다 — 새 Thread가 그 주소에 서고(본문이 그 Thread다), 사이드바의 「새 Thread」로 첫 화면에 돌아온다. 주소만 바뀐 채 Thread
 * 화면이 아직 서지 않았을 때 누르면 첫 화면이 「시작하는 중」으로 남는다 — 사람은 선 Thread를 보고 누른다(02 구현 노트 티켓-13b 「앱의 틈」).
 */
async function sendAndReturn(page: Page, text: string) {
  await 입력칸(page).fill(text);
  await 입력칸(page).press("Enter");
  await expect(page).toHaveURL(`/threads/${FIXTURE_THREAD.id}`);
  await expect(page.getByRole("main", { name: linked.title, exact: true })).toBeVisible();
  await 사이드바(page).getByRole("button", { name: "새 Thread", exact: true }).click();
  await expect(첫화면(page)).toBeVisible();
}

/** 시안의 세계 — Work 넷(셋은 Space가 있다) · Space 셋 · Project 셋. 최근 Work는 빈 질의 검색의 Work 줄이다. */
const WORLD = {
  list_projects: WORLD_PROJECTS,
  list_spaces: WORLD_SPACES,
  list_works: WORLD_WORKS,
  search: answerByArg("query", { "": RECENT_HITS }, { otherwise: SEARCH_RESULTS }),
};
/** 그 Work의 Space 이름 — 최근 Work 줄 끝의 흐린 곁말이다(없으면 빈 글). */
const spaceNameOf = (slug: string | undefined) => WORLD_SPACES.find((one) => one.slug === slug)?.name ?? "";

test("새 Thread의 Work 칩이 새 Work · Work 없이 대화 · 최근 Work를 고르고, 고른 것이 칩 · 안내 · 정도 칩을 바꾸며 첫 말과 함께 가고, 마지막 스위치 쪽을 기억한다", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    ...WORLD,
    thread_list: [summaryOf(linked)],
    thread_get: answerByArg("thread", { [linked.id]: linked }),
    thread_work_mode: answerByArg("work", { [picked.slug]: "edits" }),
  });
  await page.goto("/");
  // **기본 5초가 아니다** — 워커의 첫 페이지면 dev 서버가 첫 화면을 처음 변환하는 것을 기다린다.
  await expect(첫화면(page)).toBeVisible({ timeout: 20_000 });

  // 처음은 「새 Work」다 — 기억한 쪽이 없다(S2 · 스토리 14). 칩은 입력창 밖 트레이의 첫 칩이다.
  await shows(page, "만들 기능이나 고칠 문제를 적어 주세요");
  await expect(트레이(page).getByRole("button").first()).toHaveAccessibleName("어디서 일할지 새 Work");

  // 메뉴(F4-KitComposer 「Work 칩 메뉴」) — 칩 아래로 트레이 밖 6에 연다. 위에 스위치 둘(설명 한 줄 · 지금 것에 ✓), 구분선 아래 「최근 Work —
  // 그 Work에 새 Thread로」와 진행 중인 Work가 그 차례로 서고, 줄 끝에 그 Work의 Space 이름이 흐리게 선다(Space 없는 Work는 없다). 옛
  // 「Thread N개」는 없다.
  await 워크칩(page, "새 Work").click();
  await expect(메뉴(page)).toBeVisible();
  const trayBox = (await 트레이(page).boundingBox())!;
  const menuBox = (await 메뉴(page).boundingBox())!;
  expect(menuBox.y - (trayBox.y + trayBox.height)).toBeCloseTo(6, 0);
  await expect(page.getByRole("menuitemradio")).toHaveText([
    "새 Work첫 말로 Work를 만들고 그 안에서 시작해요",
    "Work 없이 대화묻고 답하기 · 나중에 Host 제안으로 Work가 될 수 있어요",
    ...WORLD_WORKS.map((one) => `${one.title}${spaceNameOf(one.space)}`),
  ]);
  await expect(갈래(page, "새 Work")).toHaveAttribute("aria-checked", "true");
  await expect(갈래(page, "Work 없이 대화")).toHaveAttribute("aria-checked", "false");
  await expect(갈래(page, "Work 없이 대화")).toHaveAccessibleDescription("묻고 답하기 · 나중에 Host 제안으로 Work가 될 수 있어요");
  await expect(메뉴(page).getByRole("group", { name: "최근 Work — 그 Work에 새 Thread로", exact: true })).toBeVisible();
  await expect(갈래(page, picked.title)).toHaveAccessibleDescription("결제 서비스");
  await expect(갈래(page, "문서 사이트 이전")).toHaveAccessibleDescription("");

  // 「Work 없이 대화」 — 칩 · 안내가 바뀐다. 아직 아무 Work도 읽지 않는다. 고른 스위치 쪽은 이 컴퓨터에 남아 다시 켜도 그쪽이다(S2).
  await 갈래(page, "Work 없이 대화").click();
  await expect(워크칩(page, "Work 없이 대화")).toBeVisible();
  await shows(page, "무엇이든 요청하세요");
  await page.reload();
  await expect(첫화면(page)).toBeVisible({ timeout: 20_000 });
  await expect(워크칩(page, "Work 없이 대화")).toBeVisible();
  await shows(page, "무엇이든 요청하세요");
  expect(await ipcCallArgs(page, "thread_work_mode", "work")).toEqual([]);

  // 최근 Work — 그 Work의 지금 물어보는 정도를 읽어 정도 칩이 그 값이 된다(S18). 안내가 그 Work의 이름을 부른다.
  await 워크칩(page, "Work 없이 대화").click();
  await 갈래(page, picked.title).click();
  await expect(워크칩(page, picked.title)).toBeVisible();
  await shows(page, `${picked.title}에서 무엇을 할까요?`);
  await expect
    .poll(async () => (await ipcCallArgs(page, "thread_work_mode", "work")).map(({ args }) => args))
    .toEqual([{ work: picked.slug }]);
  await expect(page.getByRole("button", { name: "물어보는 정도 편집은 허용", exact: true })).toBeVisible();
  await sendAndReturn(page, "환불 버튼 문구를 고쳐 줘");

  // 첫 화면으로 돌아오면 마지막에 고른 스위치 쪽(「Work 없이 대화」)이다 — 최근 Work는 기억하지 않는다(스토리 19). 「새 Work」를 골라 보내면
  // 이제 그쪽을 기억하고, 「Work 없이 대화」로 바꿔 보낸다.
  await expect(워크칩(page, "Work 없이 대화")).toBeVisible();
  await 워크칩(page, "Work 없이 대화").click();
  await 갈래(page, "새 Work").click();
  await sendAndReturn(page, "결제 내역 내보내기를 만들어 줘");
  await expect(워크칩(page, "새 Work")).toBeVisible();
  await 워크칩(page, "새 Work").click();
  await 갈래(page, "Work 없이 대화").click();
  await sendAndReturn(page, "오늘 할 일을 정리해 줘");

  // 고른 것이 첫 말과 함께 갔다 — 최근 Work는 그 slug로, 정도는 고르지 않았으니 `null`(엔진이 그 Work의 정도를 쓴다)이다. Space 칩에서 고르지
  // 않았으니 `space`도 `null`이다(이은 Work의 Space를 건드리지 않는다 — Space 칩은 `thread-tray`가 잰다).
  expect((await ipcCallArgs(page, "thread_start", "text")).map(({ args }) => args)).toEqual([
    { text: "환불 버튼 문구를 고쳐 줘", attachments: [], link: { kind: "work", slug: picked.slug }, mode: null, model: null, effort: null, space: null },
    { text: "결제 내역 내보내기를 만들어 줘", attachments: [], link: { kind: "new-work" }, mode: null, model: null, effort: null, space: null },
    { text: "오늘 할 일을 정리해 줘", attachments: [], link: { kind: "no-work" }, mode: null, model: null, effort: null, space: null },
  ]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("Work가 하나도 없으면 Work 칩 메뉴는 스위치 둘 아래 「아직 Work가 없어요」 한 줄이다", async ({ page }) => {
  await installFixtureBackend(page, {
    ...WORLD,
    list_works: [],
    search: answerByArg("query", { "": { hits: [] } }, { otherwise: SEARCH_RESULTS }),
  });
  await page.goto("/");
  await expect(첫화면(page)).toBeVisible({ timeout: 20_000 });

  // F4-KitComposer 「Work 칩 메뉴 — Work가 없을 때」 — 최근 Work 묶음(머리 · 줄)이 서지 않고 그 자리에 한 줄이 선다(스토리 21).
  await 워크칩(page, "새 Work").click();
  await expect(메뉴(page).getByText("아직 Work가 없어요", { exact: true })).toBeVisible();
  await expect(page.getByRole("menuitemradio")).toHaveText([/^새 Work/, /^Work 없이 대화/]);
  await expect(메뉴(page).getByText("최근 Work — 그 Work에 새 Thread로", { exact: true })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(메뉴(page)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

import { expect, test, type Page } from "./evidence";

import { answerByArg, FIXTURE_THREAD, SEARCH_RESULTS, WORKS } from "./fixtures";
import { installFixtureBackend, ipcCallArgs, unknownIpcCalls } from "./harness";
import { summaryOf } from "./thread-records";
import type { SearchResults } from "@/features/search/types";
import type { ThreadView } from "@/features/thread/types";

// v1 티켓 40(PR ④ e2e) 흐름 하나 — **새 Thread의 Work 칩이 어디서 일할지 세 갈래(Work 없이 · 새 Work로 시작 · 최근 Work)를 고르고,
// 고른 것이 칩 이름 · 입력창 안내를 바꾸며 첫 말과 함께 간다**(v1 티켓 31 · 구현 스펙 §11 「Work 칩」 · §14 · 스토리 94–96). 최근 Work를
// 고르면 물어보는 정도 칩이 그 Work의 지금 정도를 보인다(S18). 첫 화면의 부제(「Host가 답합니다. …」 · 갈래마다의 부제)는 v1 티켓 46이
// 걷었다 — 칩과 안내가 고른 것을 이미 말한다. 칩은 02 티켓 10으로 입력창 밑 트레이에 선다 — 그 자리는 흐름 「Thread 화면」이 잰다.
//
// 첫 말 뒤의 일(새 Work 제안 · 그 Work의 자리에서 뜨는 Session)은 엔진의 몫이다 — L1(`thread_work.rs` 머리말 · `thread_host.rs` ·
// `thread_policy.rs`)이 잰다. 여기서는 고른 것이 그 인자로 나가는 데까지다.

/** 최근 Work — 빈 질의 검색의 Work 줄 차례 그대로다(`recentWorks`). 셋째 Work에 이은 Thread가 하나 있다. */
const RECENT: SearchResults = {
  hits: WORKS.map((one) => ({ kind: "work" as const, slug: one.slug, title: one.title, archived: false })),
};
const [, , picked] = WORKS;
const linked: ThreadView = { ...FIXTURE_THREAD, work: picked.slug };

const 사이드바 = (page: Page) => page.locator("aside[data-sidebar]");
const 입력칸 = (page: Page) => page.getByRole("textbox", { name: "보낼 말", exact: true });
const 첫화면 = (page: Page) => page.getByRole("heading", { name: "무엇을 만들까요?", exact: true });
const 워크칩 = (page: Page, name: string) => page.getByRole("button", { name: `어디서 일할지 ${name}`, exact: true });
const 갈래 = (page: Page, name: string) => page.getByRole("menuitemradio", { name, exact: true });

/** 고른 것이 바꾸는 글 — 빈 입력창의 안내(Screen-Home 보드의 세 갈래). */
async function shows(page: Page, placeholder: string) {
  await expect(입력칸(page)).toHaveAttribute("placeholder", placeholder);
}

/**
 * 첫 말을 보낸다 — 새 Thread가 그 주소에 서고(본문이 그 Thread다), 사이드바의 「새 Thread」로 첫 화면에 돌아온다. 주소만 바뀐 채 Thread
 * 화면이 아직 서지 않았을 때 누르면 첫 화면이 「시작하는 중」으로 남는다 — 사람은 선 Thread를 보고 누른다(구현 노트 티켓-13b 「앱의 틈」).
 */
async function sendAndReturn(page: Page, text: string) {
  await 입력칸(page).fill(text);
  await 입력칸(page).press("Enter");
  await expect(page).toHaveURL(`/threads/${FIXTURE_THREAD.id}`);
  await expect(page.getByRole("main", { name: linked.title, exact: true })).toBeVisible();
  await 사이드바(page).getByRole("button", { name: "새 Thread", exact: true }).click();
  await expect(첫화면(page)).toBeVisible();
}

test("새 Thread의 Work 칩이 Work 없이 · 새 Work로 시작 · 최근 Work를 고르고, 고른 것이 칩 · 안내 · 정도 칩을 바꾸며 첫 말과 함께 간다", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    search: answerByArg("query", { "": RECENT }, { otherwise: SEARCH_RESULTS }),
    thread_list: [summaryOf(linked)],
    thread_get: answerByArg("thread", { [linked.id]: linked }),
    thread_work_mode: answerByArg("work", { [picked.slug]: "edits" }),
  });
  await page.goto("/");
  // **기본 5초가 아니다** — 워커의 첫 페이지면 dev 서버가 첫 화면을 처음 변환하는 것을 기다린다.
  await expect(첫화면(page)).toBeVisible({ timeout: 20_000 });

  // 처음은 Work 없이다. 메뉴는 두 갈래 뒤에 최근 Work를 그 차례로 세우고, Work마다 이은 Thread 수를 단다.
  await shows(page, "무엇이든 요청하세요");
  await expect(page.getByText("Host가 답합니다", { exact: false })).toHaveCount(0);
  await 워크칩(page, "Work 없음").click();
  await expect(page.getByRole("menuitemradio")).toHaveCount(2 + WORKS.length);
  await expect(page.getByRole("menuitemradio").first()).toHaveAccessibleName("Work 없이");
  await expect(갈래(page, "Work 없이")).toHaveAttribute("aria-checked", "true");
  await expect(갈래(page, "새 Work로 시작")).toHaveAccessibleDescription("첫 메시지로 Host가 Work를 만들어요");
  await expect(갈래(page, picked.title)).toContainText("Thread 1개");

  // 새 Work로 시작 — 칩 · 안내가 바뀐다. 아직 아무 Work도 읽지 않는다.
  await 갈래(page, "새 Work로 시작").click();
  await expect(워크칩(page, "새 Work")).toBeVisible();
  await shows(page, "만들 기능이나 고칠 문제를 적어 주세요");
  expect(await ipcCallArgs(page, "thread_work_mode", "work")).toEqual([]);

  // 최근 Work — 그 Work의 지금 물어보는 정도를 읽어 정도 칩이 그 값이 된다. 안내가 그 Work의 이름을 부른다.
  await 워크칩(page, "새 Work").click();
  await 갈래(page, picked.title).click();
  await expect(워크칩(page, picked.title)).toBeVisible();
  await shows(page, `${picked.title}에서 무엇을 할까요?`);
  await expect
    .poll(async () => (await ipcCallArgs(page, "thread_work_mode", "work")).map(({ args }) => args))
    .toEqual([{ work: picked.slug }]);
  await expect(page.getByRole("button", { name: "물어보는 정도 편집은 허용", exact: true })).toBeVisible();
  await sendAndReturn(page, "환불 버튼 문구를 고쳐 줘");

  // 첫 화면으로 돌아오면 다시 Work 없이다 — 새 Work로 시작해 보내고, Work 없이 그대로도 보낸다.
  await expect(워크칩(page, "Work 없음")).toBeVisible();
  await 워크칩(page, "Work 없음").click();
  await 갈래(page, "새 Work로 시작").click();
  await sendAndReturn(page, "결제 내역 내보내기를 만들어 줘");
  await sendAndReturn(page, "오늘 할 일을 정리해 줘");

  // 고른 것이 첫 말과 함께 갔다 — 최근 Work는 그 slug로, 정도는 고르지 않았으니 `null`(엔진이 그 Work의 정도를 쓴다)이다.
  expect((await ipcCallArgs(page, "thread_start", "text")).map(({ args }) => args)).toEqual([
    { text: "환불 버튼 문구를 고쳐 줘", attachments: [], link: { kind: "work", slug: picked.slug }, mode: null, model: null, effort: null },
    { text: "결제 내역 내보내기를 만들어 줘", attachments: [], link: { kind: "new-work" }, mode: null, model: null, effort: null },
    { text: "오늘 할 일을 정리해 줘", attachments: [], link: { kind: "no-work" }, mode: null, model: null, effort: null },
  ]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

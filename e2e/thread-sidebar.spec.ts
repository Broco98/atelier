import { expect, test, type Locator, type Page } from "./evidence";

import { answerByArg, FIXTURE_THREAD, PINNED_HEADER, SEARCH_RESULTS } from "./fixtures";
import { installFixtureBackend, unknownIpcCalls, 검색어칸, 검색팔레트를연다, 사람메뉴항목, 사람줄 } from "./harness";
import { record, summaryOf } from "./thread-records";
import type { SearchResults } from "@/features/search/types";

// v1 티켓 10(PR ① e2e) 흐름 둘 — **사이드바가 위 줄(새 Thread · 내 차례 · Library) · Work · Thread · 사람 줄 차례로 서고, 지금 화면들
// (Projects · Space · Terminal · Processes · Archive · Settings)은 사람 메뉴로 가며, ⌘K가 Thread를 찾아 데려간다**(v1 티켓 07 · 42 · 구현 스펙 §13 ·
// S27 · S29). Space는 03 티켓 03이 Projects 바로 뒤에 더했다(03 구현 스펙 §4). 맨 위의 검색 칸은 v1 티켓 46이 걷었다 — 검색은 창 컨트롤의 🔍와 ⌘K다. 맨 위의 「전체 | 내 차례」 마디는 02 티켓 04가 걷어
// 「내 차례」가 위 줄의 한 행이 됐다 — 위 줄의 모양(자리 · ⌘N)은 틀과 사이드바 spec(`frame-sidebar.spec.ts`)이 잰다.
//
// Thread는 L1이 축복한 「새 Thread 두 턴」(`thread-two-turns.jsonl`)의 것이다 — 앱을 다시 켠 꼴이라 떠 있는 Session이 없다. 팔레트의 답은
// 질의 하나에만 Thread 줄을 심는다 — 좁혀지는 규칙은 코어 단위(`search.rs`)의 몫이고, 이 층은 그 줄을 고르면 그 Thread로 가는지를 잰다.

const thread = FIXTURE_THREAD;
const QUERY = "hello";
const THREAD_HIT: SearchResults = { hits: [{ kind: "thread", id: thread.id, title: thread.title, archived: false }] };

const 사이드바 = (page: Page) => page.locator("aside[data-sidebar]");
const 위 = async (target: Locator) => (await target.boundingBox())!.y;

test("사이드바가 위 줄 · Work · Thread · 사람 줄 차례로 서고, 사람 메뉴가 지금 화면으로, ⌘K가 Thread로, 새 Thread가 첫 화면으로 데려간다", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    thread_list: [summaryOf(thread)],
    thread_get: answerByArg("thread", { [thread.id]: thread }),
    thread_read_record: answerByArg("thread", { [thread.id]: record("thread-two-turns") }),
    search: answerByArg("query", { [QUERY]: THREAD_HIT }, { otherwise: SEARCH_RESULTS }),
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "무엇을 만들까요?", exact: true })).toBeVisible({ timeout: 20_000 });

  // 차례 — 위 줄 셋(새 Thread · 내 차례 · Library) · Work 묶음 · Thread 묶음 · 맨 아래 사람 줄. 지금 화면들로 가는 nav 줄도, 검색 칸도,
  // 「전체」 칸도 없다. 나를 기다리는 Thread가 없어 「내 차례」에는 수가 안 붙는다.
  const 위줄 = 사이드바(page).locator("nav").first();
  const 새Thread = 위줄.getByRole("button", { name: "새 Thread", exact: true });
  const 내차례 = 위줄.getByRole("button", { name: "내 차례", exact: true });
  const Library = 위줄.getByRole("button", { name: "Library", exact: true });
  const Work묶음 = 사이드바(page).getByRole("button", { name: PINNED_HEADER, exact: true });
  const Thread묶음 = 사이드바(page).getByRole("region", { name: "Thread", exact: true });
  const 줄 = Thread묶음.getByRole("button").filter({ hasText: thread.title });
  await expect(줄).toBeVisible();
  const 차례 = [];
  for (const one of [새Thread, 내차례, Library, Work묶음, Thread묶음, 사람줄(page)]) 차례.push(await 위(one));
  expect(차례, "위에서 아래로 새 Thread · 내 차례 · Library · Work · Thread · 사람 줄").toEqual([...차례].sort((a, b) => a - b));
  for (const gone of ["검색", "전체", "Projects", "Space", "Terminal", "Processes", "Archive", "Settings"]) {
    await expect(사이드바(page).getByRole("button", { name: gone, exact: true })).toHaveCount(0);
  }

  // 사람 메뉴 — 이름(「홍길동」)의 줄을 누르면 지금 화면 다섯과 구분선 뒤 Settings가 위로 뜬다. 고르면 그 화면이고, 다시 열면 그 항목이 「지금」이다.
  await expect(사람줄(page)).toHaveAccessibleName("홍길동 — 사람 메뉴");
  await 사람줄(page).click();
  await expect(사람메뉴항목(page)).toHaveText([/^Projects/, /^Space/, /^Terminal/, /^Processes/, /^Archive/, /^Settings/]);
  await 사람메뉴항목(page).filter({ hasText: /^Processes/ }).click();
  await expect(page).toHaveURL("/processes");
  await expect(page.getByRole("heading", { name: "Processes", exact: true })).toBeVisible();
  await 사람줄(page).click();
  await expect(사람메뉴항목(page).filter({ hasText: /^Processes/ })).toHaveAttribute("aria-current", "page");
  // Escape는 메뉴가 포커스를 받은 뒤에 누른다 — 뜨는 도중이면 닫기를 듣는 자리가 아직 없다.
  await expect(page.getByRole("menu")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);

  // ⌘K — Thread 줄을 고르면 그 Thread다. 사이드바의 그 줄이 켜진다.
  await 검색팔레트를연다(page);
  await 검색어칸(page).fill(QUERY);
  const 팔레트줄 = page.getByRole("option").filter({ hasText: thread.title });
  await expect(팔레트줄).toBeVisible();
  await 팔레트줄.click();
  await expect(page).toHaveURL(`/threads/${thread.id}`);
  await expect(page.getByRole("main", { name: thread.title, exact: true })).toBeVisible();
  await expect(줄).toHaveAttribute("aria-current", "page");

  // 새 Thread — 첫 화면으로 돌아간다.
  await 새Thread.click();
  await expect(page).toHaveURL("/");
  await expect(page.getByRole("heading", { name: "무엇을 만들까요?", exact: true })).toBeVisible();
  await expect(줄).not.toHaveAttribute("aria-current", "page");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

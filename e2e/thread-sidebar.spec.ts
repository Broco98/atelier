import { expect, test, type Locator, type Page } from "./evidence";

import { answerByArg, FIXTURE_THREAD, PINNED_HEADER, SEARCH_RESULTS } from "./fixtures";
import { installFixtureBackend, unknownIpcCalls, 검색어칸, 검색팔레트를연다, 설정줄, 위칸, 위칸줄 } from "./harness";
import { record, summaryOf } from "./thread-records";
import type { SearchResults } from "@/features/search/types";

// v1 티켓 10(PR ① e2e) 흐름 둘 — **사이드바가 위 칸(새 채팅 · 내 차례 · 지금 화면 다섯) · Work · Thread · 맨 아래 설정 줄 차례로 서고, ⌘K가
// Thread를 찾아 데려간다**(v1 티켓 07 · 42 · 구현 스펙 §13 · S27 · S29 · restart 02a-3). 지금 화면 다섯(Services · Projects · Terminal ·
// Processes · Archive)은 한때 바닥 사람 줄이 여는 메뉴의 항목이었다 — 02a-3이 위 칸의 줄로 올리고 설정을 맨 아래 줄로 세웠다. 맨 위의 검색 칸은 v1 티켓 46이 걷었다 — 검색은 창 컨트롤의 🔍와 ⌘K다. 맨 위의 「전체 | 내 차례」 마디는 02 티켓 04가 걷어
// 「내 차례」가 위 줄의 한 행이 됐다 — 위 줄의 모양(자리 · ⌘N)은 틀과 사이드바 spec(`frame-sidebar.spec.ts`)이 잰다.
//
// Thread는 L1이 축복한 「새 채팅 두 턴」(`thread-two-turns.jsonl`)의 것이다 — 앱을 다시 켠 꼴이라 떠 있는 Session이 없다. 팔레트의 답은
// 질의 하나에만 Thread 줄을 심는다 — 좁혀지는 규칙은 코어 단위(`search.rs`)의 몫이고, 이 층은 그 줄을 고르면 그 Thread로 가는지를 잰다.

const thread = FIXTURE_THREAD;
const QUERY = "hello";
const THREAD_HIT: SearchResults = { hits: [{ kind: "thread", id: thread.id, title: thread.title, archived: false }] };

const 사이드바 = (page: Page) => page.locator("aside[data-sidebar]");
const 위 = async (target: Locator) => (await target.boundingBox())!.y;

test("사이드바가 위 칸 · Work · Thread · 설정 줄 차례로 서고, 위 칸 줄이 지금 화면으로, ⌘K가 Thread로, 새 Thread가 첫 화면으로 데려간다", async ({
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

  // 차례 — 위 칸(새 채팅 · 내 차례 · 지금 화면 다섯) · Work 묶음 · Thread 묶음 · 맨 아래 설정 줄. 검색 칸도, 「전체」 칸도 없다. 나를
  // 기다리는 Thread가 없어 「내 차례」에는 수가 안 붙는다.
  const 위줄 = 위칸(page);
  const 새Thread = 위줄.getByRole("button", { name: "새 채팅", exact: true });
  const 내차례 = 위줄.getByRole("button", { name: "내 차례", exact: true });
  const Work묶음 = 사이드바(page).getByRole("button", { name: PINNED_HEADER, exact: true });
  const Thread묶음 = 사이드바(page).getByRole("region", { name: "채팅", exact: true });
  const 줄 = Thread묶음.getByRole("button").filter({ hasText: thread.title });
  await expect(줄).toBeVisible();
  const 차례 = [];
  for (const one of [새Thread, 내차례, 위칸줄(page, "Archive"), Work묶음, Thread묶음, 설정줄(page)]) 차례.push(await 위(one));
  expect(차례, "위에서 아래로 새 채팅 · 내 차례 · 지금 화면 · Work · Thread · 설정 줄").toEqual([...차례].sort((a, b) => a - b));
  for (const gone of ["검색", "전체", "Library", "Settings"]) {
    await expect(사이드바(page).getByRole("button", { name: gone, exact: true })).toHaveCount(0);
  }
  // 사람 줄 · 메뉴는 없다(02a-3).
  await expect(사이드바(page).getByRole("button", { name: /사람 메뉴$/ })).toHaveCount(0);

  // 위 칸 — 새 채팅 · 내 차례 뒤에 지금 화면 다섯이 줄로 선다. 누르면 그 화면이고, 그 줄이 「지금」이다.
  await expect(위줄.getByRole("button")).toHaveText([
    /^새 채팅/,
    /^내 차례/,
    /^Services/,
    /^Projects/,
    /^Terminal/,
    /^Processes/,
    /^Archive/,
  ]);
  await 위칸줄(page, "Processes").click();
  await expect(page).toHaveURL("/processes");
  await expect(page.getByRole("heading", { name: "Processes", exact: true })).toBeVisible();
  await expect(위칸줄(page, "Processes")).toHaveAttribute("aria-current", "page");

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

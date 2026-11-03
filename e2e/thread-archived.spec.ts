import { expect, test, type Page } from "./evidence";

import { answerByArg, ARCHIVE, ARCHIVED_DOCS, FIXTURE_THREAD, SEARCH_RESULTS, WORKS } from "./fixtures";
import {
  archiveByMcp,
  installFixtureBackend,
  ipcCallArgs,
  replaceAnswer,
  unknownIpcCalls,
  workRow,
  검색어칸,
  검색팔레트를연다,
} from "./harness";
import { atHome, fireSummary, lineOf, record, sentPayloads, specWrites, summaryOf, titleThrough, workView } from "./thread-records";
import type { ArchiveEntry } from "@/features/archive/types";
import type { SearchResults } from "@/features/search/types";
import type { ThreadView } from "@/features/thread/types";

// v1 티켓 40(PR ④ e2e) 흐름 하나 — **Work를 보관하면 그 Work에 이은 Thread는 읽기만이 된다**(v1 티켓 38 · 구현 스펙 §4 · §5 · §11 「보관」 ·
// §15 · S25 · S43 · 스토리 103). 입력창 자리가 안내로 바뀌고, 요약 카드는 보관됨 모양이며(02 구현 스펙 §7 · 티켓 07 — v1 Work 카드를
// 바꿨다), 사이드바에서 그 Work와 Thread가 빠지고, ⌘K로 찾으면 「보관됨」이다.
//
// Thread는 L1이 축복한 진짜 claude 2.1.309의 Work 만들기 턴(`thread-work`, v1 티켓 39)이 끝난 자리다. 보관은 요약 카드 머리 「…」(Work 메뉴)의 「보관」(지금의
// 보관 흐름)으로 하고, 그 뒤의 일 — core가 Work를 `archive/`로 옮기고 감시가 엔진에 알려 그 Session을 끄고 요약에 읽기만을 싣는 것 —
// 은 L1(`thread_archive.rs`)이 잰다. 이 층은 그 결과(목록 · 보관 목록 · 요약 이벤트)를 흘린다.

const lines = atHome(record("thread-work"));
const MADE = lineOf(lines, "work", "created").payload as { slug: string; title: string; branch: string; projects: string[] };
const LAST = lines[lines.length - 1].seq;
const DOCS = Object.keys(specWrites(lines, MADE.slug));
const view: ThreadView = { ...FIXTURE_THREAD, title: titleThrough(lines, LAST), work: MADE.slug, lastSeq: LAST };
const made = workView(MADE, { docs: DOCS });
const SHELVED: ArchiveEntry = {
  slug: MADE.slug,
  title: MADE.title,
  status: "active",
  archivedAt: "2026-10-24T05:10:00Z",
  projects: MADE.projects,
  branch: MADE.branch,
};
/** ⌘K에 그 Thread의 이름을 치면 — 보관된 Work의 Thread 줄이다(core `search.rs` · S43). */
const FOUND: SearchResults = { hits: [{ kind: "thread", id: view.id, title: view.title, archived: true }] };

const 흐름 = (page: Page) => page.getByRole("main");
const 입력칸 = (page: Page) => page.getByRole("textbox", { name: "보낼 말", exact: true });
/** 요약 카드 — 영역 이름에 Work 이름이 없다(머리 글자가 말한다). */
const 카드 = (page: Page) => page.getByRole("region", { name: "요약", exact: true });
const 사이드바 = (page: Page) => page.locator("aside[data-sidebar]");

test("요약 카드 「…」에서 보관하면 그 Thread는 읽기만이 되어 입력창 자리가 안내로 바뀌고, 카드는 보관됨 모양이며, 사이드바에서 빠지고 ⌘K로 찾으면 「보관됨」이다", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    list_works: [...WORKS, made],
    list_archived_docs: answerByArg("slug", {
      ...ARCHIVED_DOCS,
      [MADE.slug]: { docs: DOCS.map((one) => `spec/${one}`), specTree: made.specTree },
    }),
    thread_list: [summaryOf(view)],
    thread_get: answerByArg("thread", { [view.id]: view }),
    thread_read_record: answerByArg("thread", { [view.id]: lines }),
    thread_mark_read: answerByArg("thread", { [view.id]: { ...summaryOf(view), lastRead: LAST } }),
    search: answerByArg("query", { [view.title]: FOUND }, { otherwise: SEARCH_RESULTS }),
  });
  await page.goto(`/threads/${view.id}`);
  // 살아 있는 작업공간에 이은 Thread는 그 작업공간 화면의 채팅 탭에 선다(restart 02a-4). 탭 칸 이름도 그 채팅 이름이라 흐름의 글은 뒤쪽을
  // 집는다. **기본 5초가 아니다** — 워커의 첫 페이지면 dev 서버가 첫 화면을 처음 변환하는 것을 기다린다.
  await expect(page).toHaveURL(`/works/${MADE.slug}?tab=chat&thread=${view.id}`, { timeout: 20_000 });
  await expect(흐름(page).getByText(sentPayloads(lines)[0].text, { exact: true }).last()).toBeVisible({ timeout: 20_000 });
  await expect(입력칸(page)).toBeVisible();
  await expect(workRow(page, MADE.slug)).toBeVisible();

  // 요약 카드 머리 「…」(Work 메뉴)의 「보관」 — 지금의 보관 흐름(확인 창)이 그 Work를 보관한다. 카드는 처음엔 닫혀 있어(restart 02a-9) 창 머리의
  // 「요약 카드」로 연다.
  await page.getByRole("button", { name: "요약 카드", exact: true }).click();
  await expect(카드(page)).toContainText(MADE.title);
  await 카드(page).getByRole("button", { name: "작업공간 메뉴", exact: true }).click();
  await page.getByRole("menuitem", { name: "보관", exact: true }).click();
  const confirm = page.getByRole("alertdialog", { name: `'${MADE.title}' 아카이빙`, exact: true });
  await confirm.getByRole("button", { name: "아카이빙", exact: true }).click();
  await expect
    .poll(async () => (await ipcCallArgs(page, "archive_work", "slug")).map(({ args }) => args))
    .toEqual([{ slug: MADE.slug }]);

  // Work가 보관 목록으로 옮겨 갔고, 엔진이 그 Thread를 읽기만으로 돌려 요약을 낸다. 다시 읽는 답도 읽기만이다.
  const shelved: ThreadView = { ...view, readOnly: "archived" };
  await replaceAnswer(page, "list_archive", [...ARCHIVE, SHELVED]);
  await replaceAnswer(page, "thread_get", answerByArg("thread", { [view.id]: shelved }));
  await replaceAnswer(page, "thread_list", [summaryOf(shelved)]);
  await replaceAnswer(page, "thread_mark_read", answerByArg("thread", { [view.id]: { ...summaryOf(shelved), lastRead: LAST } }));
  await archiveByMcp(page, [...WORKS, made], MADE.slug);
  await fireSummary(page, shelved);

  // 읽기만이 된 채팅은 작업공간 화면을 떠나 `/threads/<id>`에 선다(restart 02a-4 — 살아 있는 작업공간의 채팅만 채팅 탭이다).
  await expect(page).toHaveURL(`/threads/${view.id}`);

  // 입력창 자리가 안내로 바뀐다 — 보낼 칸이 없다. 턴이 돌지 않으니 멈추기도 없다.
  const notice = page.getByRole("status").filter({ hasText: "보관된 작업공간의 채팅은 읽기만 돼요" });
  await expect(notice).toBeVisible();
  await expect(입력칸(page)).toHaveCount(0);
  await expect(notice.getByRole("button")).toHaveCount(0);

  // 요약 카드는 보관됨 모양이다 — 머리에 보관 목록의 이름과 「보관됨」, 소스의 문서는 보이기만 하고, 더하기 · 「…」가 없다. 오른쪽 자리는 채팅마다의
  // 값이라(restart 02a-9 — `/threads/<id>`의 처음 값은 빈 자리) 머리 줄의 작업공간 이름으로 다시 연다(S13).
  const crumb = page.getByRole("button", { name: `작업공간 열기: ${MADE.title}`, exact: true });
  await expect(crumb).toBeVisible();
  if ((await 카드(page).count()) === 0) await crumb.click();
  await expect(카드(page)).toContainText(`${MADE.title}보관됨`);
  await expect(카드(page).locator("[data-doc]")).toHaveText(DOCS);
  await expect(카드(page).locator("button[data-doc]")).toHaveCount(0);
  for (const name of ["문서 추가", "Project 붙이기", "작업공간 메뉴"]) {
    await expect(카드(page).getByRole("button", { name, exact: true })).toHaveCount(0);
  }
  await expect(page.getByRole("button", { name: `작업공간 열기: ${MADE.title}`, exact: true })).toBeVisible();

  // 사이드바에서 그 Work와 Thread가 빠진다 — Thread 묶음에도 서지 않는다.
  await expect(workRow(page, MADE.slug)).toHaveCount(0);
  await expect(사이드바(page).getByText(view.title, { exact: true })).toHaveCount(0);

  // ⌘K로 그 이름을 찾으면 Thread 줄 끝에 「보관됨」이 선다.
  await 검색팔레트를연다(page);
  await 검색어칸(page).fill(view.title);
  await expect(page.getByRole("option", { name: new RegExp(`^${view.title.replace(/[()]/g, "\\$&")}.*보관됨$`) })).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

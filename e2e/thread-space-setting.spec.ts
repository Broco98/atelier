import { expect, test, type Locator, type Page } from "./evidence";

import { answerByArg, FIXTURE_THREAD, SEARCH_RESULTS } from "./fixtures";
import { fireEventToAll, installFixtureBackend, ipcCallArgs, replaceAnswer, unknownIpcCalls, 주소로간다 } from "./harness";
import { lineOf, linesAfter, linesThrough, record, seqOf, streamLines, summaryOf, threadOf } from "./thread-records";
import {
  PAYMENTS,
  RECENT_HITS,
  REFUND,
  SCOPE_BY_SPACE,
  SCOPES,
  SETTLEMENT,
  TOOLS,
  WORLD_PROJECTS,
  WORLD_SPACE_DETAILS,
  WORLD_SPACES,
  WORLD_WORKS,
} from "./thread-space-world";
import type { RecordLine, ThreadView } from "@/features/thread/types";

// 03 티켓 13 흐름 「대화 속 Space와 설정」(캔버스 v52 F4-KitChat) — **Host가 다루는 Project로 Space를 붙일 때 물을 땐 지금의 질문 카드로
// 묻고(답하면 한 줄로 접힌다), 「알아서」면 묻지 않고 회색 한 줄만 남기며, Space가 바뀔 때마다 흐름에 그 한 줄이 선다. 대화로 한 설정은 결과
// 카드 한 장이고 「열기」가 그 화면으로 간다. git이 아닌 폴더는 화면 추가 창과 같은 질문 카드로 묻는다. Work 없는 대화의 머리 줄은 「흐린
// Space / 이름」이고, Work 화면 머리 줄의 흐린 Space는 Space 메뉴를 연다**(03 구현 스펙 §9 · §10 · §11 · §12 · 티켓 05 · 06 · 07 · 08 · 12).
// 상황 모음판의 칸이 곧 경우다 — 같은 것을 두 번 재지 않는다.
//
//   여기서 잰다     Space 질문 카드(머리 · 물음 · 선택지 · 「나중에」 · 키) · 답한 뒤 접힌 줄 · Space 줄 다섯(넣음 · 바꿈 · 뺌 · 지워짐 · 되돌림)과
//                   줄이 오면 따라오는 머리 줄 · 결과 카드 넷과 「열기」 · 「관계 보기」(목록에 없으면 꺼짐) · Project 추가 질문 카드와 답한 뒤 ·
//                   머리 줄 셋(Work 없음 · Space 없음 / Work 없음 · Space 있음 / Work 화면 · Space 메뉴) · Work 만들기 카드의 Space 줄
//   다른 spec이 잰다 트레이의 Space 칩 · 범위 줄(흐름 「트레이」 — `thread-tray`) · Work 만들기 카드의 나머지와 받아들인 뒤(`thread-work`) ·
//                   지우기 확인 창 · 토스트(흐름 「Space」 — 13c) · 「지우기를 부탁받음」(Host의 말 — 진짜 앱 손 점검, 13d)
//
// 줄은 L1이 축복한 기록을 그대로 쏜다(스토리 137) — Host가 물은 Space 카드(`thread-space-ask`) · 「알아서」 붙임(`thread-space-attached`) · 사람이
// 칩으로 붙이고 뺀 대화(`thread-space`) · 이은 Space가 지워지고 되돌려진 대화(`thread-space-deleted`) · 대화로 한 설정 넷(`thread-setting`) ·
// git이 아닌 폴더의 추가(`thread-project-add`). Work 만들기 카드의 Space 줄만 축복한 장면이 없어, Work 만들기 기록(`thread-work`)의 물음 줄에
// L1(`thread_work.rs` 「thread의 space는 work 만들기 카드에 서고 …」)이 잰 그 칸 하나를 더한다. 세계는 그 기록의 세계와 이름이 같은 시안의
// 세계다(`thread-space-world`). 기하는 시안 창(1440 × 900)에서 잰다.

test.use({ viewport: { width: 1440, height: 900 } });

/** 카드는 선 직후 잠깐 키를 받지 않는다(`ToolQuestionCard`의 `ARMING_MS`). */
const ARMING_MS = 300;

const 흐름 = (page: Page) => page.getByRole("main");
const 입력칸 = (page: Page) => page.getByRole("textbox", { name: "보낼 말", exact: true });
const 머리줄 = (page: Page) => page.locator('[data-slot="screen-head"]');
const 사이드바 = (page: Page) => page.locator("aside[data-sidebar]");
const Space줄 = (page: Page) => 흐름(page).locator('[data-system="space"]');
const 메뉴 = (page: Page) => page.getByRole("menu");

type Box = { x: number; y: number; width: number; height: number; right: number; bottom: number };
const 상자 = (target: Locator): Promise<Box> =>
  target.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
  });
const 모양 = (target: Locator, props: readonly string[]) =>
  target.evaluate((el, names) => {
    const style = getComputedStyle(el);
    return Object.fromEntries(names.map((name) => [name, style.getPropertyValue(name)]));
  }, props);
/** 지금 주소의 경로 — 한글 slug는 퍼센트로 적히므로 풀어서 읽는다. */
const 경로 = (page: Page) => decodeURIComponent(new URL(page.url()).pathname);

/** 시안의 세계 — 기록의 Project 셋 · Space 셋 · Work 넷. 「열기」 · 흐린 Space가 가는 Space 상세도 그 세계다. */
const WORLD = {
  list_projects: WORLD_PROJECTS,
  list_spaces: WORLD_SPACES,
  get_space: answerByArg("slug", WORLD_SPACE_DETAILS),
  list_works: WORLD_WORKS,
  search: answerByArg("query", { "": RECENT_HITS }, { otherwise: SEARCH_RESULTS }),
};

/** Work 없는 Thread의 읽는 범위 — 그 Thread의 Space로 센 것이다(core `reading_scope`의 규칙 1). 머리 줄의 흐린 Space가 이것을 읽는다. */
const scopeOfThread = (view: ThreadView) => (view.space ? SCOPE_BY_SPACE[view.space] : undefined) ?? SCOPES.all;

/** 그 Thread들을 열 수 있게 답한다 — Thread마다 제 기록 · 제 범위다. 더 덮어쓸 답은 함께 준다. */
async function withThreads(page: Page, threads: readonly { view: ThreadView; lines: readonly RecordLine[] }[], more: Record<string, unknown> = {}) {
  const byId = <T>(of: (one: { view: ThreadView; lines: readonly RecordLine[] }) => T) =>
    Object.fromEntries(threads.map((one) => [one.view.id, of(one)]));
  await installFixtureBackend(page, {
    ...WORLD,
    reading_scope: answerByArg("thread", byId(({ view }) => scopeOfThread(view)), { otherwise: SCOPES.all }),
    thread_list: threads.map(({ view }) => summaryOf(view)),
    thread_get: answerByArg("thread", byId(({ view }) => view)),
    thread_read_record: answerByArg("thread", byId(({ view, lines }) => linesThrough(lines, view.lastSeq))),
    thread_mark_read: answerByArg("thread", byId(({ view }) => ({ ...summaryOf(view), lastRead: view.lastSeq }))),
    ...more,
  });
}

/** 그 Thread를 연다. **기본 5초가 아니다** — 워커의 첫 페이지면 dev 서버가 첫 화면을 처음 변환하는 것을 기다린다. */
async function openThread(page: Page, view: ThreadView) {
  await page.goto(`/threads/${view.id}`);
  await expect(page.getByRole("main", { name: view.title, exact: true })).toBeVisible({ timeout: 20_000 });
}

// ── Space 질문 카드 ────────────────────────────────────────────────────────────────────────────────────────────────────────

const asking = record("thread-space-ask");
const SPACE_ASKED = lineOf(asking, "question", "asked");
const SPACE_REQUEST = (SPACE_ASKED.payload as { requestId: string }).requestId;

test("Space 질문 카드 — Host가 물으면 입력창 자리에 「Host · 질문」 카드가 추천 · 다른 후보 · Space 없이를 세우고, ↵ · ↓↵ · 3 · esc가 그 답으로 가며, 답하면 한 줄로 접힌다", async ({
  page,
}) => {
  const view = threadOf("20261025-090000", asking, { live: true, lastSeq: SPACE_ASKED.seq });
  await withThreads(page, [{ view, lines: asking }]);
  await openThread(page, view);

  // 카드(F4-KitChat 「질문 카드」) — 따로 그린 카드가 아니라 지금의 질문 카드다. 머리 · 물음 · 아래 한 줄, 번호 줄은 추천(Host가 넘긴 Space)
  // 먼저 · 다른 후보 · 「Space 없이」(등록된 전부를 읽는다)다. 바닥은 「↑↓ 고르기 · esc 닫기」와 「나중에」 · 「고르기 ↵」.
  const card = page.getByRole("group", { name: "어느 Space에서 할까요?", exact: true });
  await expect(card).toBeVisible();
  await expect(입력칸(page)).toHaveCount(0);
  await expect(card).toContainText("Host · 질문");
  await expect(card).toContainText("Space를 고르면 그 안의 Project만 읽어요 · 나중에 바꿀 수 있어요");
  await expect(card.getByRole("button")).toHaveText([
    "1결제 서비스추천web-app · api-server",
    "2사내 도구api-server · backoffice",
    "3Space 없이등록된 Project 3개를 모두 읽어요",
    /^나중에/,
    /^고르기/,
  ]);
  await expect(card.getByRole("button").first()).toHaveAttribute("aria-current", "true");
  await expect(card).toContainText("↑↓ 고르기 · esc 닫기");

  // 기다리는 동안 — 턴 머리줄이 무엇을 기다리는지 말하고, 사이드바의 그 줄은 「내 차례」다.
  await expect(흐름(page).getByText("Space 답을 기다려요", { exact: true })).toBeVisible();
  const row = 사이드바(page).getByRole("region", { name: "Thread", exact: true }).getByRole("button").filter({ hasText: view.title });
  await expect(row).toHaveAttribute("data-status", "mine");

  // 키 — ↵는 켜진 줄(추천), ↓↵는 다음 줄, 숫자는 그 줄, esc는 「나중에」다(마지막 줄 「Space 없이」가 아니다 — 범위를 바꾸는 답이다). 한
  // 번 답한 카드는 줄이 올 때까지 잠기므로 갈래마다 다시 연다.
  const keys: { press: string[]; answer: { choice: string; space: string | null } }[] = [
    { press: ["Enter"], answer: { choice: "space", space: PAYMENTS.slug } },
    { press: ["ArrowDown", "Enter"], answer: { choice: "space", space: TOOLS.slug } },
    { press: ["3"], answer: { choice: "none", space: null } },
    { press: ["Escape"], answer: { choice: "later", space: null } },
  ];
  for (const [at, { press, answer }] of keys.entries()) {
    if (at > 0) {
      await page.reload();
      await expect(card).toBeVisible({ timeout: 20_000 });
    }
    await card.focus();
    await page.waitForTimeout(ARMING_MS);
    for (const key of press) await page.keyboard.press(key);
    await expect
      .poll(async () => (await ipcCallArgs(page, "thread_answer_space", "thread")).map(({ args }) => args))
      .toEqual([{ thread: view.id, request: SPACE_REQUEST, ...answer }]);
  }

  // 답한 뒤(「답한 뒤」) — 카드는 물음 · 고른 답 · ✓ 한 줄로 접히고 되돌리기 단추가 없다. 카드로 고른 Space는 Space 줄을 따로 남기지 않는다 —
  // 접힌 줄이 그 결정이다. 그 줄이 `set_space` 도구 줄의 자리를 대신해 턴에 펼칠 것이 없다(「N초 동안 작업」이 서지 않는다).
  await streamLines(page, view.id, linesAfter(asking, SPACE_ASKED.seq));
  await expect(card).toHaveCount(0);
  const folded = 흐름(page).locator('[data-answered="space"]');
  await expect(folded).toHaveText("어느 Space에서 할까요?결제 서비스");
  await expect(folded).toHaveAttribute("data-choice", "space");
  await expect(folded.getByRole("button")).toHaveCount(0);
  await expect(Space줄(page)).toHaveCount(0);
  await expect(흐름(page).getByText("hello from turn", { exact: true })).toBeVisible();
  await expect(흐름(page).getByRole("button", { name: /초 동안 작업$/ })).toHaveCount(0);
  await expect(folded).toBeVisible();
  await expect(입력칸(page)).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── Space 줄 ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const attached = record("thread-space-attached");
const picked = record("thread-space");
const deleted = record("thread-space-deleted");
/** 그 기록의 n번째 Space 줄. */
const spaceLine = (lines: readonly RecordLine[], nth: number) => seqOf(lines, "space", nth);

test("Space 줄 다섯 — 「알아서」 넣음 · 사람이 바꿈 · 뺌 · 지워짐 · 되돌림이 흐름 가운데 회색 한 줄로 서고(이름만 굵게), 줄이 오면 머리 줄의 Space가 따라온다", async ({
  page,
}) => {
  const auto = threadOf("20261025-100000", attached, { lastSeq: attached[attached.length - 1].seq });
  const manual = threadOf("20261025-110000", picked, { live: true, lastSeq: spaceLine(picked, 1) - 1 });
  const gone = threadOf("20261025-120000", deleted, { lastSeq: deleted[deleted.length - 1].seq });
  await withThreads(page, [
    { view: auto, lines: attached },
    { view: manual, lines: picked },
    { view: gone, lines: deleted },
  ]);

  // 「알아서」 모드 — 묻지 않고 넣고 한 줄만(「**결제 서비스** Space에 넣었어요 — web-app · api-server를 읽어요」). 붙인 범위는 다음 말부터라
  // 그 턴 뒤(턴 사이)에 선다. 줄은 대화 열 가운데 13 · 옅은 글자, 이름만 본문색 500이다(F4-KitChat `.sysl`).
  await openThread(page, auto);
  const line = Space줄(page);
  await expect(line).toHaveText(["결제 서비스 Space에 넣었어요 — web-app · api-server를 읽어요"]);
  await expect(line.locator("b")).toHaveText(["결제 서비스"]);
  await expect(line.locator("svg")).toHaveCount(1);
  expect(await 모양(line, ["font-size", "color"])).toEqual({ "font-size": "13px", color: "rgba(26, 28, 31, 0.5)" });
  expect(await 모양(line.locator("b"), ["font-weight", "color"])).toEqual({ "font-weight": "500", color: "rgb(26, 28, 31)" });
  // 열의 가운데 — 요약 카드를 비켜난 대화 열(입력창과 같은 폭)의 가운데다.
  const [lineBox, column] = [await 상자(line), await 상자(입력칸(page).locator("xpath=ancestor::form[1]"))];
  expect(lineBox.x + lineBox.width / 2).toBeCloseTo(column.x + column.width / 2, 0);
  expect(lineBox.y).toBeGreaterThan((await 상자(흐름(page).getByText("hello from turn", { exact: true }))).bottom);

  // 사람이 칩으로 바꿈 · 뺌 — 떠 있는 대화에 줄이 온다. 줄이 오면 그 Thread와 범위를 다시 읽어 머리 줄이 「흐린 Space / 이름」으로 따라오고,
  // 빼면 이름만으로 돌아간다(07 — 칸을 고친 것은 엔진이라 화면의 고치기 응답이 없다. 흐린 Space는 범위가 싣는 Space다 — 03 코드 리뷰 P14).
  await openThread(page, manual);
  await expect(머리줄(page).getByRole("button", { name: /^Space 열기: / })).toHaveCount(0);
  await replaceAnswer(page, "thread_get", answerByArg("thread", { [manual.id]: { ...manual, space: PAYMENTS.slug } }));
  await replaceAnswer(page, "reading_scope", answerByArg("thread", { [manual.id]: SCOPES.payments }, { otherwise: SCOPES.all }));
  await streamLines(page, manual.id, linesThrough(linesAfter(picked, manual.lastSeq), spaceLine(picked, 1)));
  await expect(Space줄(page)).toHaveText(["Space를 결제 서비스로 바꿨어요 — 다음 차례부터 web-app · api-server를 읽어요"]);
  await expect(Space줄(page).locator("b")).toHaveText(["결제 서비스"]);
  await expect(머리줄(page).getByRole("button", { name: `Space 열기: ${PAYMENTS.name}`, exact: true })).toBeVisible();
  await replaceAnswer(page, "thread_get", answerByArg("thread", { [manual.id]: manual }));
  await replaceAnswer(page, "reading_scope", answerByArg("thread", { [manual.id]: SCOPES.all }, { otherwise: SCOPES.all }));
  await streamLines(page, manual.id, linesAfter(picked, spaceLine(picked, 1)));
  await expect(Space줄(page)).toHaveText([
    "Space를 결제 서비스로 바꿨어요 — 다음 차례부터 web-app · api-server를 읽어요",
    "Space를 뺐어요 — 다음 차례부터 등록된 Project 3개를 읽어요",
  ]);
  await expect(Space줄(page).nth(1).locator("b")).toHaveCount(0);
  await expect(머리줄(page).getByRole("button", { name: /^Space 열기: / })).toHaveCount(0);

  // Space가 지워짐 · 되돌림 — Space 삭제로 「Space 없음」이 된 대화는 굵은 것 없는 한 줄이고, 되돌리면 이름이 굵은 줄이 다시 읽는 Project를 말한다.
  await openThread(page, gone);
  await expect(Space줄(page)).toHaveText([
    "Space를 결제 서비스로 바꿨어요 — 다음 차례부터 web-app · api-server를 읽어요",
    "결제 서비스 Space가 지워져 Space 없이 이어가요 — 대화는 그대로예요",
    "결제 서비스 Space를 되돌렸어요 — 다시 web-app · api-server를 읽어요",
  ]);
  await expect(Space줄(page).nth(1).locator("b")).toHaveCount(0);
  await expect(Space줄(page).nth(2).locator("b")).toHaveText("결제 서비스");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 결과 카드 ───────────────────────────────────────────────────────────────────────────────────────────────────────────

const setting = record("thread-setting");
/** 대화로 추가한 Project — 등록부가 그것을 싣기 전과 뒤를 가른다. */
const LANDING = { ...WORLD_PROJECTS[0], slug: "landing-page", name: "landing-page", path: "~/MyProjects/landing-page" };

test("결과 카드 넷 — 대화로 한 설정마다 그 턴 안 도구 줄 뒤에 한 장씩 서고(접힌 턴에도), 「열기」 · 「관계 보기」가 그 화면으로 가며, 목록에 없는 것은 꺼진다", async ({
  page,
}) => {
  const view = threadOf("20261025-130000", setting, { lastSeq: setting[setting.length - 1].seq });
  // 「정산」은 이 턴이 만든 Space다 — 감시가 목록을 다시 읽은 뒤라 목록에 있다. landing-page는 아직 등록부를 다시 읽지 않았다.
  await withThreads(page, [{ view, lines: setting }]);
  await openThread(page, view);

  // 카드 넷(F4-KitChat 「대화로 한 설정 — 결과 카드」) — Project 추가 · Project 고침 · Space 고침 · Space 만듦이 한 차례로, 첫 줄 · 둘째 줄은
  // 엔진이 지어 실은 글 그대로다. 「6초 동안 작업」 아래 · 턴 끝 답 앞이다(F4-ThreadNoWork).
  const cards = 흐름(page).locator("[data-result]");
  await expect(cards).toHaveCount(4);
  expect(await cards.evaluateAll((all) => all.map((one) => one.getAttribute("data-result")))).toEqual([
    "project-added",
    "project-edited",
    "space-edited",
    "space-created",
  ]);
  await expect(cards).toHaveText([
    "Project를 추가했어요 — landing-page~/MyProjects/landing-page · git 레포 · 기준 브랜치 main열기",
    "web-app의 기준 브랜치를 main으로 바꿨어요새 Work부터 main에서 갈라져요열기",
    "결제 서비스에 backoffice를 넣었어요Project 3 · 함께 쓰는 Space 1관계 보기",
    "Space를 만들었어요 — 정산api-server · ~/.atelier/spaces/정산.md열기",
  ]);
  await expect(흐름(page).getByRole("region", { name: "Project를 추가했어요 — landing-page", exact: true })).toBeVisible();
  const headline = 흐름(page).getByRole("button", { name: /초 동안 작업$/ });
  const answer = 흐름(page).getByText("hello from turn", { exact: true });
  expect((await 상자(headline)).bottom).toBeLessThanOrEqual((await 상자(cards.first())).y);
  expect((await 상자(cards.last())).bottom).toBeLessThanOrEqual((await 상자(answer)).y);

  // 목록에 없는 것은 꺼진다(「그사이 사라졌어요」) — 등록부를 다시 읽으면(감시의 `projects:changed`) 켜지고, 「열기」가 그 Project 상세로 간다.
  const open = (title: string) =>
    흐름(page).getByRole("region", { name: title, exact: true }).getByRole("button", { name: /^(열기|관계 보기)$/ });
  await expect(open("Project를 추가했어요 — landing-page")).toBeDisabled();
  await expect(open("Project를 추가했어요 — landing-page")).toHaveAttribute("title", "그사이 사라졌어요");
  for (const title of ["web-app의 기준 브랜치를 main으로 바꿨어요", "결제 서비스에 backoffice를 넣었어요", "Space를 만들었어요 — 정산"]) {
    await expect(open(title)).toBeEnabled();
  }
  await replaceAnswer(page, "list_projects", [...WORLD_PROJECTS, LANDING]);
  await fireEventToAll(page, "projects:changed", null);
  await expect(open("Project를 추가했어요 — landing-page")).toBeEnabled();

  // 「열기」는 Project 상세로, 「관계 보기」는 Space 상세(그래프)로, Space 만듦의 「열기」도 그 Space 상세로 간다. 뒤로 가면 이 Thread다.
  const goes = async (title: string, path: string) => {
    await open(title).click();
    await expect.poll(() => 경로(page)).toBe(path);
    await page.goBack();
    await expect(page.getByRole("main", { name: view.title, exact: true })).toBeVisible();
  };
  await goes("Project를 추가했어요 — landing-page", "/projects/landing-page");
  await goes("web-app의 기준 브랜치를 main으로 바꿨어요", "/projects/web-app");
  await goes("결제 서비스에 backoffice를 넣었어요", `/spaces/${PAYMENTS.slug}`);
  await goes("Space를 만들었어요 — 정산", `/spaces/${SETTLEMENT.slug}`);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── Project 추가 질문 카드 ─────────────────────────────────────────────────────────────────────────────────────────────────

const adding = record("thread-project-add");
const ADD_ASKED = lineOf(adding, "question", "asked");
const ADD_REQUEST = (ADD_ASKED.payload as { requestId: string }).requestId;
const ADD_QUESTION = "notes는 git 저장소가 아니에요. 어떻게 할까요?";

test("Project 추가 카드 — git이 아닌 폴더를 부탁받으면 화면 추가 창과 같은 질문을 「나중에」 없이 묻고, 답하면 접힌 줄 뒤에 결과 카드가 선다", async ({
  page,
}) => {
  const view = threadOf("20261025-140000", adding, { live: true, lastSeq: ADD_ASKED.seq });
  await withThreads(page, [{ view, lines: adding }]);
  await openThread(page, view);

  // 카드(F4-KitChat 「git이 아닌 폴더를 부탁받음」) — 「git init 하고 추가」(추천 · 빈 레포를 만들고 기준 브랜치 main) · 「추가하지 않기」, 바닥은
  // 「고르기 ↵」 하나다(미루면 Host가 할 일이 없다 — 12 결정).
  const card = page.getByRole("group", { name: ADD_QUESTION, exact: true });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Host · 질문");
  await expect(card.getByRole("button")).toHaveText(["1git init 하고 추가추천빈 레포를 만들고 기준 브랜치 main", "2추가하지 않기", /^고르기/]);
  await expect(card.getByRole("button", { name: /^나중에/ })).toHaveCount(0);
  // 기다리는 동안 — Space 카드와 같다: 턴 머리줄이 무엇을 기다리는지 말하고, 사이드바의 그 줄은 「내 차례」다.
  await expect(흐름(page).getByText("Project 추가 답을 기다려요", { exact: true })).toBeVisible();
  const row = 사이드바(page).getByRole("region", { name: "Thread", exact: true }).getByRole("button").filter({ hasText: view.title });
  await expect(row).toHaveAttribute("data-status", "mine");

  // 키 — ↵는 추천(init), 2는 「추가하지 않기」, esc도 마지막 줄 「추가하지 않기」다(「나중에」가 없다).
  const keys: { press: string; choice: string }[] = [
    { press: "Enter", choice: "init" },
    { press: "2", choice: "decline" },
    { press: "Escape", choice: "decline" },
  ];
  for (const [at, { press, choice }] of keys.entries()) {
    if (at > 0) {
      await page.reload();
      await expect(card).toBeVisible({ timeout: 20_000 });
    }
    await card.focus();
    await page.waitForTimeout(ARMING_MS);
    await page.keyboard.press(press);
    await expect
      .poll(async () => (await ipcCallArgs(page, "thread_answer_project_add", "thread")).map(({ args }) => args))
      .toEqual([{ thread: view.id, request: ADD_REQUEST, choice }]);
  }

  // 답한 뒤 — 카드가 걷히고 그 자리에 물음과 고른 답 한 줄, 그 뒤에 결과 카드, 그 뒤에 답이다. 펼칠 것이 없어 「N초 동안 작업」은 없다.
  await streamLines(page, view.id, linesAfter(adding, ADD_ASKED.seq));
  await expect(card).toHaveCount(0);
  const folded = 흐름(page).locator('[data-answered="project-add"]');
  await expect(folded).toHaveText(`${ADD_QUESTION}git init 하고 추가`);
  await expect(folded).toHaveAttribute("data-choice", "init");
  const result = 흐름(page).locator('[data-result="project-added"]');
  await expect(result).toHaveText("Project를 추가했어요 — notes~/MyProjects/notes · git 레포 · 기준 브랜치 main열기");
  const answer = 흐름(page).getByText("hello from turn", { exact: true });
  expect((await 상자(folded)).bottom).toBeLessThanOrEqual((await 상자(result)).y);
  expect((await 상자(result)).bottom).toBeLessThanOrEqual((await 상자(answer)).y);
  await expect(흐름(page).getByRole("button", { name: /초 동안 작업$/ })).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── 머리 줄 ────────────────────────────────────────────────────────────────────────────────────────────────────────────

const twoTurns = record("thread-two-turns");

test("머리 줄 — Work 없는 대화는 「흐린 Space / 이름」(누르면 Space 상세)이고 Space가 없으면 이름만이며, Work 화면은 흐린 Space가 Space 메뉴를 열어 그 Work의 Space를 바꾼다", async ({
  page,
}) => {
  const last = twoTurns[twoTurns.length - 1].seq;
  const bare: ThreadView = { ...FIXTURE_THREAD, id: "20261025-150000", title: "환불 금액 확인", lastSeq: last };
  const spaced: ThreadView = { ...bare, id: "20261025-160000", space: PAYMENTS.slug };
  await withThreads(page, [
    { view: bare, lines: twoTurns },
    { view: spaced, lines: twoTurns },
  ]);

  // Work 없음 · Space 없음 — 이름만이다. 빈 자리를 말하지 않는다(Work 화면의 흐린 「Space 없음」과 다르다).
  await openThread(page, bare);
  await expect(머리줄(page).getByText(bare.title, { exact: true })).toBeVisible();
  await expect(머리줄(page).getByRole("button", { name: /^Space 열기: / })).toHaveCount(0);
  await expect(머리줄(page).getByText("/", { exact: true })).toHaveCount(0);

  // Work 없음 · Space 있음 — 흐린 Space(14 · #898a8b) 8 「/」(그림 — 이름에 들지 않는다) 8 이름. 흐린 Space를 누르면 Space 상세다.
  await openThread(page, spaced);
  const crumb = 머리줄(page).getByRole("button", { name: `Space 열기: ${PAYMENTS.name}`, exact: true });
  const slash = 머리줄(page).getByText("/", { exact: true });
  const name = 머리줄(page).getByText(spaced.title, { exact: true });
  await expect(crumb).toHaveText(PAYMENTS.name);
  await expect(slash).toHaveAttribute("aria-hidden", "true");
  expect(await 모양(crumb, ["font-size", "color"])).toEqual({ "font-size": "14px", color: "rgb(137, 138, 139)" });
  const [crumbBox, slashBox, nameBox] = [await 상자(crumb), await 상자(slash), await 상자(name)];
  expect(slashBox.x - crumbBox.right).toBeCloseTo(8, 0);
  expect(nameBox.x - slashBox.right).toBeCloseTo(8, 0);
  await crumb.click();
  await expect.poll(() => 경로(page)).toBe(`/spaces/${PAYMENTS.slug}`);
  await expect(page.getByRole("main").getByText(PAYMENTS.name, { exact: true }).first()).toBeVisible();

  // Work 화면 · Space 있음 — 흐린 Space를 누르면 Space 메뉴다(「Work 화면 · Space 메뉴」): 맨 위 「Space 빼기 · 등록된 Project 3개를 모두
  // 읽어요」, Space 목록(지금 것 ✓), 「Space 관리」. 고르면 그 Work의 Space가 바뀐다(그 Work의 Thread마다 Space 줄 — L1).
  await 주소로간다(page, `/works/${REFUND.slug}`);
  const workSpace = page.locator('[data-slot="work-space"]');
  await expect(workSpace).toBeVisible();
  await expect(workSpace).toHaveAccessibleName(`Space: ${PAYMENTS.name}`);
  await expect(workSpace).toHaveText(PAYMENTS.name);
  await expect(workSpace).toHaveAttribute("aria-haspopup", "menu");
  // 글자색은 손을 치운 뒤 전이가 끝난 값이다 — 앞 화면에서 누른 자리 밑에 이 단추가 설 수 있다(hover는 본문색).
  await page.mouse.move(720, 600);
  await expect.poll(async () => 모양(workSpace, ["font-size", "color"])).toEqual({ "font-size": "14px", color: "rgb(137, 138, 139)" });
  await workSpace.click();
  const drop = 메뉴(page).getByRole("menuitem", { name: "Space 빼기", exact: true });
  await expect(drop).toHaveAccessibleDescription("등록된 Project 3개를 모두 읽어요");
  await expect(메뉴(page).getByRole("menuitemradio")).toHaveText([
    "결제 서비스web-app · api-server",
    "사내 도구api-server · backoffice",
    "정산Project 없음",
  ]);
  await expect(메뉴(page).getByRole("menuitemradio", { name: PAYMENTS.name, exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(메뉴(page).getByRole("menuitem", { name: /^Space 관리/ })).toBeVisible();
  await 메뉴(page).getByRole("menuitemradio", { name: TOOLS.name, exact: true }).click();
  await expect
    .poll(async () => (await ipcCallArgs(page, "thread_set_work_space", "work")).map(({ args }) => args))
    .toEqual([{ work: REFUND.slug, space: TOOLS.slug }]);
  await workSpace.click();
  await 메뉴(page).getByRole("menuitem", { name: "Space 빼기", exact: true }).click();
  await expect
    .poll(async () => (await ipcCallArgs(page, "thread_set_work_space", "work")).map(({ args }) => args))
    .toEqual([
      { work: REFUND.slug, space: TOOLS.slug },
      { work: REFUND.slug, space: null },
    ]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// ── Work 만들기 카드 ─────────────────────────────────────────────────────────────────────────────────────────────────────

const making = record("thread-work");
const WORK_ASKED = lineOf(making, "question", "asked");
/** Work 없이 한 대화의 Space가 실린 제안 줄 — 카드 줄에 이 칸이 실리는 것은 L1(`thread_work.rs`)이 잰다. */
const WORK_ASKED_IN_SPACE: RecordLine = {
  ...WORK_ASKED,
  payload: { ...(WORK_ASKED.payload as Record<string, unknown>), space: { slug: PAYMENTS.slug, name: PAYMENTS.name } },
};

test("Work 만들기 카드 — Work 없이 한 대화에 Space가 있으면 카드에 「◇ 결제 서비스 · Space」 한 줄이 선다(받아들이면 그 Space가 새 Work로 옮겨 간다)", async ({
  page,
}) => {
  const view = threadOf("20261025-170000", making, { live: true, lastSeq: WORK_ASKED.seq - 1, space: PAYMENTS.slug });
  await withThreads(page, [{ view, lines: making }], {
    reading_scope: answerByArg("thread", { [view.id]: SCOPES.payments }),
  });
  await openThread(page, view);
  await streamLines(page, view.id, [WORK_ASKED_IN_SPACE]);

  const card = page.getByRole("group", { name: "이 일을 Work로 묶을까요?", exact: true });
  await expect(card).toBeVisible();
  const line = card.locator('[data-slot="proposal-space"]');
  await expect(line).toHaveText(`${PAYMENTS.name} · Space`);
  await expect(line.locator("svg")).toHaveCount(1);
  expect(await 모양(line, ["font-size", "color"])).toEqual({ "font-size": "12px", color: "rgba(26, 28, 31, 0.5)" });
  // 줄은 물음 · 까닭 아래, Project 고르기 위다(구현 스펙 §9 — 지금 카드에 Space 줄만 더한다).
  const [lineBox, projects] = [await 상자(line), await 상자(card.getByText("Project", { exact: true }))];
  expect(lineBox.bottom).toBeLessThanOrEqual(projects.y);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

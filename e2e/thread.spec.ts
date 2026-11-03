import { expect, test, type Page } from "./evidence";

import { answerByArg, FIXTURE_THREAD } from "./fixtures";
import { installFixtureBackend, ipcCallArgs, unknownIpcCalls } from "./harness";
import { linesAfter, linesThrough, record, sentPayloads, seqOf, streamLines, summaryOf } from "./thread-records";
import type { ThreadView } from "@/features/thread/types";

// v1 티켓 10(PR ① e2e) 흐름 하나 — **앱을 열면 새 Thread가 뜨고, 보낸 말에 Runtime의 답이 흘러 턴 끝에 「N초 동안 작업」 구분선으로
// 접히며, 다시 켜도 같은 Thread가 기록으로 이어진다**(v1 티켓 05 · 구현 스펙 §13 · §14 · S26). 펼칠 것 없이 답만 한 턴에는 구분선이
// 서지 않는다(02 구현 스펙 §8 · 02 티켓 09 — 이 판의 「도구 없는 턴의 구분선 사라짐」은 여기서 한 번 잰다).
//
// 엔진은 목업 백엔드의 답과 이 검사가 쏘는 기록 줄 이벤트로 선다. 줄은 L1이 축복한 「새 채팅 두 턴」(`thread-two-turns.jsonl`)을
// 그대로 쏜다(`thread-records.ts`) — 첫 턴은 답만 하고(「hello from turn」, 4초), 둘째 턴은 `Write` · `Read` · `Bash` 뒤에 「5」로 답한다
// (10초). 보낼 글도 그 기록의 `sent` 줄에서 읽는다 — 화면에 선 말과 엔진이 적은 말이 같은 사실이다(스토리 137).

const twoTurns = record("thread-two-turns");
const [first, second] = sentPayloads(twoTurns);
const FIRST_SENT = seqOf(twoTurns, "sent", 1);
const FIRST_END = seqOf(twoTurns, "turn-end", 1);
const SECOND_SENT = seqOf(twoTurns, "sent", 2);
/** 둘째 턴의 첫 도구(`Write`)가 선 줄 — 그다음 줄이 그 도구의 끝이다. */
const WRITE_STARTED = twoTurns.find(
  (line) => line.seq > SECOND_SENT && (line.payload as { update?: { sessionUpdate?: string } }).update?.sessionUpdate === "tool_call",
)!.seq;

/**
 * 첫 말로 막 선 Thread — Runtime의 Session이 이 앱에 떠 있고 기록은 첫 `sent`까지다. 엔진은 Session이 열린 뒤에 새 id를 돌려주므로 그때
 * 적힌 줄(들어옴 · 띄움 · 열림 · 명령 목록 · 보낸 말)을 화면이 기록 읽기로 받고, 그 뒤는 기록 줄 이벤트로 받는다.
 */
const started: ThreadView = { ...FIXTURE_THREAD, live: true, lastSeq: FIRST_SENT };
/** 앱을 다시 켠 뒤의 Thread — 떠 있는 Session이 없고 기록은 두 턴 끝까지다. */
const reopened: ThreadView = { ...FIXTURE_THREAD, live: false, lastSeq: twoTurns[twoTurns.length - 1].seq };

const 입력칸 = (page: Page) => page.getByRole("textbox", { name: "보낼 말", exact: true });
const 흐름 = (page: Page) => page.getByRole("main");
const 접힌턴 = (page: Page, headline: string) => 흐름(page).getByRole("button", { name: headline, exact: true });
const 도구줄 = (page: Page, phrase: string) => 흐름(page).getByRole("group", { name: phrase, exact: true });

test("첫 화면에서 보낸 말로 새 Thread가 서고, Runtime의 답이 흐르다 턴 끝에 「N초 동안 작업함」으로 접히며(말만 한 턴은 머리 없이), 도구 줄이 진행형에서 「동사 대상」이 된다", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    thread_get: answerByArg("thread", { [started.id]: started }),
    thread_read_record: answerByArg("thread", { [started.id]: linesThrough(twoTurns, FIRST_SENT) }),
  });
  await page.goto("/");
  // **기본 5초가 아니다** — 워커의 첫 페이지면 dev 서버가 첫 화면을 처음 변환하는 것을 기다린다.
  await expect(page.getByRole("heading", { name: "무엇을 만들까요?", exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL("/");

  // 첫 말 — 씨앗이 없어 작업공간 없는 Thread로 선다. 정도는 고르지 않아도 기본 「편집 자동」을 파일에 적으려고 함께 가고, 고르지 않은 모델 ·
  // 생각 깊이 · 범위는 `null`이다. 새 id의 주소로 갈아 선다(히스토리를 늘리지 않는다).
  await 입력칸(page).fill(first.text);
  await 입력칸(page).press("Enter");
  expect((await ipcCallArgs(page, "thread_start", "text")).map(({ args }) => args)).toEqual([
    { text: first.text, attachments: [], link: { kind: "no-work" }, runtime: "claude-code", mode: "edits", model: null, effort: null, service: null, project: null, quote: null },
  ]);
  await expect(page).toHaveURL(`/threads/${started.id}`);
  await expect(흐름(page).getByText(first.text, { exact: true })).toBeVisible();
  await expect(입력칸(page)).toHaveValue("");

  // 흐르는 답 — 첫 턴은 도구 없이 답만 했다. 말만 하는 턴은 도는 동안에도 머리가 없고 답만 흐른다(restart 02b-1 · States 보드 — 첫 조각
  // 전에는 「생각 중」이다). 턴이 끝나도 펼칠 것이 없어 머리가 서지 않는다(02 §8). 끝난 마지막 답 아래에 「답 복사」가 선다.
  await streamLines(page, started.id, linesThrough(linesAfter(twoTurns, FIRST_SENT), FIRST_END - 1));
  await expect(흐름(page).getByText("hello from turn", { exact: true })).toBeVisible();
  await expect(흐름(page).locator("[data-work-divider]")).toHaveCount(0);
  await streamLines(page, started.id, linesThrough(linesAfter(twoTurns, FIRST_END - 1), FIRST_END));
  await expect(흐름(page).getByRole("button", { name: "답 복사", exact: true })).toBeVisible();
  await expect(흐름(page).getByText(/동안 작업 중입니다$/)).toHaveCount(0);
  await expect(흐름(page).locator("[data-work-divider]")).toHaveCount(0);
  await expect(흐름(page).getByText("hello from turn", { exact: true })).toBeVisible();

  // 이어 말하기 — 같은 Thread로 간다. 도구 줄은 하는 동안 진행형이고 끝나면 과거형이다.
  await 입력칸(page).fill(second.text);
  await 입력칸(page).press("Enter");
  expect((await ipcCallArgs(page, "thread_send", "text")).map(({ args }) => args)).toEqual([
    { thread: started.id, text: second.text, attachments: [], quote: null },
  ]);
  await streamLines(page, started.id, linesThrough(linesAfter(twoTurns, FIRST_END), WRITE_STARTED));
  await expect(흐름(page).getByText(second.text, { exact: true })).toBeVisible();
  // 도는 도구 줄은 「대상 진행형」이다(restart 02b-4 · Tools 보드 — 새 파일은 「만드는 중」).
  await expect(도구줄(page, "notes.txt 만드는 중")).toBeVisible();
  await streamLines(page, started.id, linesAfter(twoTurns, WRITE_STARTED));

  // 둘째 턴 끝 — 「10초 동안 작업함」 머리로 접혀 도구 줄이 숨고 답 「5」만 남는다. 머리를 누르면 세 도구가 「동사 대상」으로 펼쳐진다
  // (restart 02b-1 · 02b-4).
  const 둘째 = 접힌턴(page, "10초 동안 작업함");
  await expect(둘째).toHaveAttribute("aria-expanded", "false");
  await expect(흐름(page).getByText("5", { exact: true })).toBeVisible();
  await expect(도구줄(page, "생성됨 notes.txt")).toHaveCount(0);
  const 꺾쇠 = 둘째.locator("svg");
  expect(await 꺾쇠.evaluate((el) => getComputedStyle(el).rotate)).toBe("none");
  await 둘째.click();
  await expect(둘째).toHaveAttribute("aria-expanded", "true");
  for (const phrase of ["생성됨 notes.txt", "읽음 notes.txt", "실행 완료 wc -c notes.txt"]) {
    await expect(도구줄(page, phrase)).toBeVisible();
  }
  // 머리의 모양(States 보드 `.ra-whblock` · restart 02b-1) — 글은 `fg-tertiary`이고, 선은 단추 밖 형제(0.5 `border-heavy`)로 글 줄 아래 9에
  // 열 폭으로 그어진다. 선에서 펼친 첫 줄까지 12다. 끝의 꺾쇠 12는 펼치면 `ease-enter`로 90° 돈다. 도구 줄 앞 글리프는 14다.
  const 선 = 둘째.locator("xpath=../div[@aria-hidden]");
  // 누른 뒤 마우스가 머리 위에 남으면 `hover:text-fg-secondary`로 0.7까지 전이한다 — 쉬는 색을 재려고 마우스를 비키고 전이가 끝나기를 기다린다.
  await page.mouse.move(0, 0);
  await expect.poll(() => 둘째.evaluate((el) => getComputedStyle(el).color)).toBe("rgba(26, 28, 31, 0.5)");
  expect(
    await 선.evaluate((el) => {
      const box = el.getBoundingClientRect();
      return [box.height, getComputedStyle(el).backgroundColor];
    }),
  ).toEqual([0.5, "rgba(26, 28, 31, 0.12)"]);
  const 위 = (target: typeof 선) => target.evaluate((el) => el.getBoundingClientRect().top);
  const 아래 = (target: typeof 선) => target.evaluate((el) => el.getBoundingClientRect().bottom);
  expect(Math.round((await 위(선)) - (await 아래(둘째)))).toBe(9);
  await expect.poll(() => 꺾쇠.evaluate((el) => getComputedStyle(el).rotate)).toBe("90deg");
  expect(await 꺾쇠.evaluate((el) => getComputedStyle(el).transitionTimingFunction)).toBe("cubic-bezier(0.19, 1, 0.22, 1)");
  expect(await 꺾쇠.evaluate((el) => el.getBoundingClientRect().width)).toBe(12);
  const 첫줄 = 도구줄(page, "생성됨 notes.txt");
  await expect.poll(async () => Math.round((await 위(첫줄)) - (await 아래(선)))).toBe(12);
  expect(await 첫줄.locator("[data-glyph]").evaluate((el) => el.getBoundingClientRect().width)).toBe(14);
  // 마지막 턴의 끝난 편집을 세는 입력창 위 알약은 작업공간 밖 채팅에는 서지 않는다(restart 02a-7 — 바뀐 파일은 작업공간의 것이다). 이 채팅은 첫
  // 화면에서 작업공간 없이 보냈다.
  await expect(page.getByRole("group", { name: "1개 파일 변경됨", exact: true })).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("다시 켜면 앱은 새 Thread로 열리고, 사이드바의 그 Thread를 누르면 두 턴이 기록에서 접힌 채 서며, 보낸 말이 같은 Thread로 간다", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    thread_list: [summaryOf(reopened)],
    thread_get: answerByArg("thread", { [reopened.id]: reopened }),
    thread_read_record: answerByArg("thread", { [reopened.id]: twoTurns }),
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "무엇을 만들까요?", exact: true })).toBeVisible({ timeout: 20_000 });

  // 사이드바 Thread 줄 — 제목 한 줄이다(02 티켓 05 — 마지막 말 미리보기는 걷었다).
  const 줄 = page.getByRole("region", { name: "채팅", exact: true }).getByRole("button").filter({ hasText: first.text });
  await expect(줄).toHaveText(first.text);
  await 줄.click();
  await expect(page).toHaveURL(`/threads/${reopened.id}`);
  await expect(줄).toHaveAttribute("aria-current", "page");

  // 두 턴이 접힌 채 선다 — 떠 있는 Session이 없으니 도는 턴도 「작업 중」도 없다. 구분선은 도구를 쓴 둘째 턴에만 있다.
  await expect(흐름(page).locator("[data-work-divider]")).toHaveText(["10초 동안 작업함"]);
  await expect(접힌턴(page, "10초 동안 작업함")).toHaveAttribute("aria-expanded", "false");
  for (const text of [first.text, "hello from turn", second.text, "5"]) {
    await expect(흐름(page).getByText(text, { exact: true })).toBeVisible();
  }
  await expect(흐름(page).getByText(/동안 작업 중입니다$/)).toHaveCount(0);

  // `/model`은 모델 칩 메뉴를 연다(구현 스펙 §14 · 코드 리뷰 1차 B8) — 입력칸은 비고, 메뉴는 기록이 연 Session의 모델들이다.
  await 입력칸(page).fill("/model");
  await 입력칸(page).press("Enter");
  await expect(page.getByRole("menuitemradio").first()).toBeVisible();
  await expect(입력칸(page)).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menuitemradio")).toHaveCount(0);

  // 이어 말하면 같은 Thread로 간다 — 엔진이 같은 Session으로 되살린다(L1 `thread_host.rs`).
  await 입력칸(page).fill("고마워");
  await 입력칸(page).press("Enter");
  expect((await ipcCallArgs(page, "thread_send", "text")).map(({ args }) => args)).toEqual([
    { thread: reopened.id, text: "고마워", attachments: [], quote: null },
  ]);
  expect(await ipcCallArgs(page, "thread_start", "text")).toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

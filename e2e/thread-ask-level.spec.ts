import { expect, test, type Page } from "./evidence";

import { answerByArg, FIXTURE_THREAD } from "./fixtures";
import { installFixtureBackend, ipcCallArgs, unknownIpcCalls } from "./harness";
import { linesAfter, linesThrough, record, sentPayloads, seqOf, streamLines } from "./thread-records";
import type { ThreadView } from "@/features/thread/types";

// v1 티켓 28(PR ③ e2e) 흐름 하나 — **입력창의 물어보는 정도 칩으로 고른 정도가 첫 말과 함께 가서 묻지 않고 허용한 편집이 방패 줄로
// 남고, 선 Thread에서 정도를 바꾸면 「Policy를 … 바꿈」 줄이 서고 다음 편집부터 그 정도로 묻는다**(v1 티켓 23 · 구현 스펙 §9 S18 ·
// §14 입력창 아래 줄 · 스토리 84 · 86).
//
// 줄은 L1이 축복한 「편집은 허용으로 세운 Thread를 매번 묻기로 바꾼」 기록(`thread-ask-level.jsonl`)을 그대로 쏜다 — 첫 턴의 파일 쓰기는
// 판정이 묻지 않고 허용하고(`decided` · 「편집은 허용」), 사람이 정도를 바꾼 `mode` 줄 뒤 둘째 턴의 파일 쓰기는 「매번 묻기」로 묻는다.
// 보낸 말 · seq는 그 기록에서 읽는다(스토리 137).

const level = record("thread-ask-level");
const [first, second] = sentPayloads(level);
const FIRST_SENT = seqOf(level, "sent", 1);
const FIRST_END = seqOf(level, "turn-end", 1);
const MODE = seqOf(level, "mode", 1);
const ASKED = level.find((line) => line.kind === "permission" && (line.payload as { state: string }).state === "asked")!.seq;

/** 「편집은 허용」으로 막 선 Thread — Host의 Session이 이 앱에 떠 있고 기록은 첫 `sent`까지다. */
const started: ThreadView = { ...FIXTURE_THREAD, title: first.text, askLevel: "edits", live: true, lastSeq: FIRST_SENT };

const 입력칸 = (page: Page) => page.getByRole("textbox", { name: "보낼 말", exact: true });
const 흐름 = (page: Page) => page.getByRole("main");
const 정도칩 = (page: Page, name: string) => page.getByRole("button", { name: `물어보는 정도 ${name}`, exact: true });
const 정도 = (page: Page, name: string) => page.getByRole("menuitemradio", { name, exact: true });

test("새 Thread에서 칩으로 고른 「편집은 허용」이 첫 말과 함께 가 첫 편집이 방패 줄로 남고, 선 Thread에서 「매번 묻기」로 바꾸면 그 줄이 서고 다음 편집을 카드로 묻는다", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    thread_get: answerByArg("thread", { [started.id]: started }),
    thread_read_record: answerByArg("thread", { [started.id]: linesThrough(level, FIRST_SENT) }),
  });
  await page.goto("/");
  // **기본 5초가 아니다** — 워커의 첫 페이지면 dev 서버가 첫 화면을 처음 변환하는 것을 기다린다.
  await expect(page.getByRole("heading", { name: "무엇을 만들까요?", exact: true })).toBeVisible({ timeout: 20_000 });

  // 빈 Thread의 칩은 「매번 묻기」다(Work 없이). 메뉴는 넷을 설명과 함께 보이고, 고르면 칩만 바뀐다 — 아직 Thread가 없다.
  await 정도칩(page, "매번 묻기").click();
  await expect(page.getByRole("menuitemradio")).toHaveText([/^매번 묻기/, /^편집은 허용/, /^계획만/, /^알아서/]);
  await expect(정도(page, "매번 묻기")).toHaveAttribute("aria-checked", "true");
  await expect(정도(page, "편집은 허용")).toHaveAccessibleDescription("파일은 알아서, 명령은 묻습니다");
  await 정도(page, "편집은 허용").click();
  await expect(정도칩(page, "편집은 허용")).toBeVisible();
  expect(await ipcCallArgs(page, "thread_set_mode", "thread")).toEqual([]);

  // 첫 말 — 고른 정도가 함께 간다. 고르지 않은 모델 · 생각 깊이는 `null`이다.
  await 입력칸(page).fill(first.text);
  await 입력칸(page).press("Enter");
  expect((await ipcCallArgs(page, "thread_start", "text")).map(({ args }) => args)).toEqual([
    { text: first.text, attachments: [], link: { kind: "no-work" }, mode: "edits", model: null, effort: null },
  ]);
  await expect(page).toHaveURL(`/threads/${started.id}`);
  await expect(정도칩(page, "편집은 허용")).toBeVisible();

  // 첫 턴 — 판정이 파일 쓰기를 묻지 않고 허용한다. 카드는 서지 않고, 펼친 턴의 그 도구 줄 앞에 방패 줄이 까닭(정도 이름)과 선다.
  await streamLines(page, started.id, linesThrough(linesAfter(level, FIRST_SENT), FIRST_END));
  await expect(page.getByRole("group", { name: /될까요\?$/ })).toHaveCount(0);
  const 첫턴 = 흐름(page).getByRole("button", { name: /초 동안 작업함$/ });
  await 첫턴.click();
  await expect(첫턴).toHaveAttribute("aria-expanded", "true");
  const 방패 = 흐름(page).locator("[data-auto-allowed]");
  await expect(방패).toHaveCount(1);
  await expect(방패).toContainText("자동으로 허용함");
  await expect(방패).toContainText("allowed.txt");
  await expect(방패).toContainText("편집은 허용");
  await expect(흐름(page).getByRole("group", { name: "allowed.txt 작성함", exact: true })).toBeVisible();

  // 선 Thread에서 「매번 묻기」로 — 곧바로 바꾸기가 가고, 엔진이 적은 `mode` 줄이 「Policy를 매번 묻기로 바꿈」으로 선다.
  await 정도칩(page, "편집은 허용").click();
  await expect(정도(page, "편집은 허용")).toHaveAttribute("aria-checked", "true");
  await 정도(page, "매번 묻기").click();
  await expect
    .poll(async () => (await ipcCallArgs(page, "thread_set_mode", "thread")).map(({ args }) => args))
    .toEqual([{ thread: started.id, mode: "always" }]);
  await streamLines(page, started.id, linesThrough(linesAfter(level, FIRST_END), MODE));
  await expect(흐름(page).locator('[data-system="mode"]')).toHaveText("Policy를 매번 묻기로 바꿈");
  await expect(정도칩(page, "매번 묻기")).toBeVisible();

  // 다음 편집부터 그 정도다 — 둘째 턴의 파일 쓰기는 카드로 묻고, 카드가 왜 묻는지 「매번 묻기」를 말한다.
  await 입력칸(page).fill(second.text);
  await 입력칸(page).press("Enter");
  expect((await ipcCallArgs(page, "thread_send", "text")).map(({ args }) => args)).toEqual([
    { thread: started.id, text: second.text, attachments: [], quote: null },
  ]);
  await streamLines(page, started.id, linesThrough(linesAfter(level, MODE), ASKED));
  await expect(흐름(page).getByText(second.text, { exact: true })).toBeVisible();
  const card = page.getByRole("group", { name: "Host가 이 파일을 고쳐도 될까요?", exact: true });
  await expect(card).toContainText("Policy · 매번 묻기");
  await expect(card.getByRole("figure", { name: /denied\.txt 변경$/ })).toBeVisible();
  await expect(흐름(page).locator("[data-auto-allowed]")).toHaveCount(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

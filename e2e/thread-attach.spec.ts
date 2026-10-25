import { expect, test, type Page } from "./evidence";

import { answerByArg, FIXTURE_THREAD } from "./fixtures";
import { fireEvent, installFixtureBackend, ipcCallArgs, unknownIpcCalls } from "./harness";
import { linesAfter, linesThrough, record, sentPayloads, seqOf, streamLines } from "./thread-records";
import type { ThreadView } from "@/features/thread/types";

// v1 티켓 10(PR ① e2e) 흐름 셋 — **창에 끌어다 놓은 파일 · 폴더가 입력창에 칩으로 서고, 보내면 그 절대 경로가 말과 함께 가서 내 말풍선 위에
// 칩으로 남는다**(v1 티켓 06 · 구현 스펙 §14 S30 · §4 `sent`).
//
// 경로는 Tauri의 끌어다 놓기 이벤트가 준다(웹뷰의 HTML5 drop은 경로가 없다) — 이 검사가 그 이벤트를 쏜다. 경로를 잰 답(`describe_attachments`)과
// 말풍선의 칩은 L1이 축복한 「첨부한 첫 말」(`thread-attach.jsonl`)의 `sent` 줄 그대로다 — 파일 하나(`error.log`, 12KB)와 폴더 하나(`재현
// 화면`)를 붙인 말에 Host가 답한 한 턴이다. 화면이 칩으로 그리는 꼴과 엔진이 적는 꼴이 같은 사실이다(스토리 137).

const attach = record("thread-attach");
const [sent] = sentPayloads(attach);
const attached = sent.attachments!;
const paths = attached.map((one) => one.path);
const SENT = seqOf(attach, "sent");
const [logName, folderName] = ["error.log", "재현 화면"];

/** 첫 말로 막 선 Thread — 기록은 첨부한 `sent`까지다. 그 뒤는 기록 줄 이벤트로 흐른다. */
const started: ThreadView = { ...FIXTURE_THREAD, title: sent.text, live: true, lastSeq: SENT };

const 입력칸 = (page: Page) => page.getByRole("textbox", { name: "보낼 말", exact: true });
const 칩들 = (page: Page) => page.getByRole("list", { name: "첨부", exact: true });
/** 창 위에서 끄는 자리 — 입력창 위 아무 데나. 앱은 자리를 보지 않고 경로만 쓴다. */
const position = { x: 400, y: 300 };

test("끌어다 놓은 파일 · 폴더가 입력창에 칩으로 서고 뺄 수 있으며, 보내면 경로가 말과 함께 가서 말풍선 위에 칩으로 남는다", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    describe_attachments: attached,
    thread_get: answerByArg("thread", { [started.id]: started }),
    thread_read_record: answerByArg("thread", { [started.id]: linesThrough(attach, SENT) }),
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "무엇을 만들까요?", exact: true })).toBeVisible({ timeout: 20_000 });

  // 끌고 들어오면 입력창 자리에 「놓으면 첨부합니다」가 서고, 놓으면 그 경로를 엔진이 재서 칩이 선다.
  await fireEvent(page, "tauri://drag-enter", { paths, position });
  await expect(page.getByRole("status").filter({ hasText: "놓으면 첨부합니다" })).toBeVisible();
  await fireEvent(page, "tauri://drag-drop", { paths, position });
  await expect(page.getByRole("status").filter({ hasText: "놓으면 첨부합니다" })).toHaveCount(0);
  expect((await ipcCallArgs(page, "describe_attachments", "paths")).map(({ args }) => args)).toEqual([{ paths }]);
  await expect(칩들(page).getByRole("listitem")).toHaveText([new RegExp(`^${logName}`), folderName]);

  // 빼기 — 그 칩만 걷힌다. 같은 것을 다시 놓으면 겹치지 않고 다시 선다.
  await 칩들(page).getByRole("button", { name: `${folderName} 빼기`, exact: true }).click();
  await expect(칩들(page).getByRole("listitem")).toHaveText([new RegExp(`^${logName}`)]);
  await fireEvent(page, "tauri://drag-drop", { paths, position });
  await expect(칩들(page).getByRole("listitem")).toHaveText([new RegExp(`^${logName}`), folderName]);

  // 보내면 경로만 간다 — 내용은 싣지 않는다. 입력창의 칩은 걷히고 말풍선 위에 같은 칩이 선다.
  await 입력칸(page).fill(sent.text);
  await 입력칸(page).press("Enter");
  expect((await ipcCallArgs(page, "thread_start", "text")).map(({ args }) => args)).toEqual([
    { text: sent.text, attachments: paths, link: { kind: "no-work" }, mode: null, model: null, effort: null },
  ]);
  await expect(page).toHaveURL(`/threads/${started.id}`);
  const 흐름 = page.getByRole("main");
  await expect(흐름.getByText(sent.text, { exact: true })).toBeVisible();
  await expect(칩들(page)).toHaveCount(1);
  await expect(칩들(page).getByRole("listitem")).toHaveText([new RegExp(`^${logName}`), folderName]);

  // Host의 답이 그 아래로 흐르고 턴이 끝나도(끝난 답 아래 「답 복사」) 칩은 말풍선 위에 남는다.
  await streamLines(page, started.id, linesAfter(attach, SENT));
  await expect(흐름.getByRole("button", { name: "답 복사", exact: true })).toBeVisible();
  await expect(흐름.getByText("hello from turn", { exact: true })).toBeVisible();
  await expect(칩들(page).getByRole("listitem")).toHaveText([new RegExp(`^${logName}`), folderName]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

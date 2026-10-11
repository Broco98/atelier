import { expect, test, type Page } from "./evidence";

import { answerByArg, WORKS } from "./fixtures";
import { installFixtureBackend, ipcCallArgs, unknownIpcCalls } from "./harness";
import {
  claudeStoppedTurn,
  conversationRow,
  fireQueue,
  linesAfter,
  linesThrough,
  record,
  selfContinuedTurn,
  sentLine,
  streamLines,
} from "./chat-records";

// three-axes 티켓 20 — **턴 도중의 말이 대기 줄에 쌓이고, 멈추기 · 지금 보내기가 화면에서 된다**(스토리 45 · 49 · 50 · 52 · 53 · 55).
//
// 대화 호스트는 목업 백엔드의 답과 이 검사가 쏘는 기록 줄 · 대기 줄 이벤트로 선다. Codex의 멈춤은 L1이 남긴 「멈춘 뒤 늦은 줄」
// 기록(S26, `late-after-cancel`)을 그대로 쏜다: 보낸 말 → 답 → 20초 명령의 도구 호출(열림) → 턴 끝(`cancelled`, 우리가 멈춤, 3초)
// → 턴 밖에서 늦게 온 그 명령의 출력 → 그 명령의 끝. Claude 꼴의 멈춤과 스스로 이어 간 턴은 S26 목록 밖이라 손으로 지은 자료다
// (`chat-records.ts`). 재는 것은 역할 · 접근성 이름 · 보이는 글 · 나간 명령의 인자다.

const plainWork = WORKS[1];

const 레일 = (page: Page) => page.getByRole("group", { name: "레일", exact: true });
const 레일칸 = (page: Page, name: "spec" | "chat" | "info") => 레일(page).getByRole("button", { name, exact: true });
const 작업패널 = (page: Page) => page.getByRole("region", { name: "작업 패널", exact: true });
const 입력칸 = (page: Page) => 작업패널(page).getByRole("textbox", { name: "보낼 말", exact: true });
const 단추 = (page: Page, name: string) => 작업패널(page).getByRole("button", { name, exact: true });
const 머리줄 = (page: Page, name: string) => 단추(page, name);

const late = record("late-after-cancel");
const seqOf = (kind: string) => late.find((line) => line.kind === kind)!.seq;
/** 멈춘 턴의 끝 줄 — 그 앞까지가 도는 턴이다. */
const END_SEQ = seqOf("turn-end");
const COMMAND = `python3 -c "import time; time.sleep(20); print('slept-fake')"`;

/** 그 work에 선 Codex 대화 — 기록 읽기는 `read`까지를 답한다. */
const codex = conversationRow({ id: "c-late-codex", agent: "codex", name: "Codex", lastSeq: END_SEQ - 1 });

async function openChat(page: Page, read = linesThrough(late, END_SEQ - 1), row = codex): Promise<void> {
  await installFixtureBackend(page, {
    chat_list: answerByArg("work", { [plainWork.slug]: [row] }, { otherwise: [] }),
    chat_read_record: answerByArg("conversation", { [row.id]: read }),
  });
  await page.goto(`/works/${plainWork.slug}`);
  await 레일칸(page, "chat").click();
  await expect(입력칸(page)).toBeVisible({ timeout: 20_000 });
}

test("멈추기: 턴이 도는 동안 보내기 자리에 멈추기가 서고, 누르면 멈추기 명령이 가고, `cancelled` 턴 끝에 「3초 후에 중단했습니다」 머리줄이 선다", async ({
  page,
}) => {
  await openChat(page);
  // 도는 턴 — 입력칸이 비어 있으면 보내기 원 대신 멈추기다.
  await expect(작업패널(page).getByText("I'll run the exact command", { exact: false })).toBeVisible();
  await expect(단추(page, "보내기")).toHaveCount(0);
  await 단추(page, "멈추기").click();
  expect((await ipcCallArgs(page, "chat_stop", "work")).map(({ args }) => args)).toEqual([
    { work: plainWork.slug, conversation: codex.id },
  ]);

  // 멈춘 턴의 끝 — 우리가 멈춘 `cancelled`라 「N초 후에 중단했습니다」(S24). 턴이 끝나 멈추기는 보내기로 돌아간다.
  await streamLines(page, plainWork.slug, codex.id, linesThrough(linesAfter(late, END_SEQ - 1), END_SEQ));
  await expect(머리줄(page, "3초 후에 중단했습니다")).toHaveAttribute("aria-expanded", "false");
  await expect(단추(page, "멈추기")).toHaveCount(0);
  await expect(단추(page, "보내기")).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** 도구 줄 — 그 명령(도구 제목)을 이름으로 단 묶음이다. */
const 도구줄 = (page: Page, title: string) => 작업패널(page).getByRole("group", { name: title, exact: true });

test("멈춘 뒤의 도구 줄(Codex): 멈출 때 열려 있던 명령이 접힌 턴 아래 「멈춘 뒤에도 도는 중」으로 남고, 턴 밖에서 늦게 온 출력이 그 줄에 붙고, 끝나면 「멈춘 뒤에 끝남」이다", async ({
  page,
}) => {
  await openChat(page, linesThrough(late, END_SEQ));
  // 멈춘 턴은 머리줄 아래로 접혔다 — 그래도 멈출 때 열려 있던 명령은 접힌 턴 아래에 남는다(결정 28 · 스토리 55).
  await expect(머리줄(page, "3초 후에 중단했습니다")).toHaveAttribute("aria-expanded", "false");
  const row = 도구줄(page, COMMAND);
  await expect(row).toBeVisible();
  await expect(row).toContainText("멈춘 뒤에도 도는 중");
  await expect(row).toContainText("턴은 3초 후에 멈췄어요 — 명령은 끝까지 돌아요");
  // 출력 줄은 아직 없다(명령 글에도 `slept-fake`가 들어 있어 출력은 그 글 한 줄로 집는다).
  const 출력 = row.getByText("slept-fake", { exact: true });
  await expect(출력).toHaveCount(0);

  // 턴 밖에서 늦게 온 출력이 그 줄에 붙는다 — 새 턴이 서지 않는다(보낸 말도 머리줄도 하나다).
  const [output, exit] = linesAfter(late, END_SEQ);
  await streamLines(page, plainWork.slug, codex.id, [output]);
  await expect(출력).toBeVisible();
  await expect(row).toContainText("멈춘 뒤에도 도는 중");
  await expect(작업패널(page).getByText("20초 걸리는 명령을 돌려 줘", { exact: true })).toHaveCount(1);

  // 명령의 끝 — 줄이 「멈춘 뒤에 끝남」으로 바뀌고, 출력은 그대로 붙어 있다.
  await streamLines(page, plainWork.slug, codex.id, [exit]);
  await expect(row).toContainText("멈춘 뒤에 끝남");
  await expect(row).not.toContainText("멈춘 뒤에도 도는 중");
  await expect(출력).toBeVisible();
  await expect(작업패널(page).getByRole("button", { name: /후에 중단했습니다|동안 작업함/ })).toHaveCount(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("멈춘 뒤의 도구 줄(Claude 꼴): 멈춤과 함께 `failed`로 닫힌 줄은 「멈춤」이고, 접힌 턴 아래에 남지 않는다", async ({ page }) => {
  // Claude 꼴은 엔진 이름이 아니라 ACP 모양으로 가른다 — 대화는 Claude지만 가르는 것은 멈춘 턴 끝 바로 앞의 `failed` update다.
  const claude = conversationRow({ id: "c-hand-claude", agent: "claude", name: "Claude", lastSeq: 0 });
  await openChat(page, [], claude);
  await streamLines(page, plainWork.slug, claude.id, claudeStoppedTurn(1, "40초 기다려 줘", "sleep 40", 6000));

  const header = 머리줄(page, "6초 후에 중단했습니다");
  await expect(header).toHaveAttribute("aria-expanded", "false");
  // 닫힌 줄이라 접힌 턴 아래에 남지 않는다 — 머리줄을 펴면 선다.
  await expect(도구줄(page, "sleep 40")).toHaveCount(0);
  await header.click();
  const row = 도구줄(page, "sleep 40");
  await expect(row).toBeVisible();
  await expect(row).toContainText("멈춤");
  await expect(row).not.toContainText("멈춘 뒤");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("스스로 이어 간 턴: 보낸 말 없이 선 턴의 머리줄에 「스스로 이어 감」 표지가 서고, 사용자 메시지는 서지 않는다", async ({
  page,
}) => {
  const claude = conversationRow({ id: "c-hand-self", agent: "claude", name: "Claude", lastSeq: 0 });
  await openChat(page, [], claude);
  // 사람이 보낸 턴 하나가 끝난 뒤 — 에이전트가 백그라운드 작업 알림으로 스스로 턴을 연다(턴 밖 update).
  const turn = claudeStoppedTurn(1, "dev 서버를 띄워 줘", "pnpm dev", 2000).slice(0, 2);
  await streamLines(page, plainWork.slug, claude.id, [
    ...turn,
    { seq: 3, at: "2026-10-10T11:00:03.000+09:00", kind: "turn-end", payload: { stopReason: "end_turn", durationMs: 2000, cancelledByUs: false, outOfTurn: false } },
  ]);
  await expect(머리줄(page, "2초 동안 작업함")).toBeVisible();
  await expect(작업패널(page).getByText("스스로 이어 감", { exact: true })).toHaveCount(0);

  // 도는 동안 — 걸린 시간 머리줄 옆에 표지가 서고, 턴이 돌므로 보내기 자리는 멈추기다.
  const [update, end] = selfContinuedTurn(4, "dev 서버가 떴어요 — http://localhost:5173", 4000);
  await streamLines(page, plainWork.slug, claude.id, [update]);
  await expect(작업패널(page).getByText("dev 서버가 떴어요", { exact: false })).toBeVisible();
  await expect(작업패널(page).getByText("스스로 이어 감", { exact: true })).toBeVisible();
  await expect(단추(page, "멈추기")).toBeVisible();

  // 턴 밖 끝 — 머리줄이 접히고 표지가 남는다. 사용자 메시지는 처음 보낸 말 하나뿐이다.
  await streamLines(page, plainWork.slug, claude.id, [end]);
  await expect(머리줄(page, "4초 동안 작업함")).toBeVisible();
  await expect(작업패널(page).getByText("스스로 이어 감", { exact: true })).toHaveCount(1);
  await expect(작업패널(page).getByText("dev 서버가 떴어요", { exact: false })).toBeVisible();
  await expect(작업패널(page).getByText("dev 서버를 띄워 줘", { exact: true })).toHaveCount(1);
  await expect(단추(page, "멈추기")).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

const 대기줄 = (page: Page) => 작업패널(page).getByRole("list", { name: "대기 중인 말", exact: true });
/** 대기 줄의 한 말 — 그 글을 든 줄이다. */
const 대기말 = (page: Page, text: string) => 대기줄(page).getByRole("listitem").filter({ hasText: text });

test("대기 줄: 도는 동안 보낸 말이 입력창 위 「대기 중」에 서고, 고치기 · 지우기 · 지금 보내기가 대기 id를 실어 명령으로 가고, 대기 줄 바뀜 이벤트가 오면 대기 줄이 바뀐다", async ({
  page,
}) => {
  // 대화 목록이 실어 온 대기 줄로 처음 그린다 — 대기 줄은 호스트 메모리에만 있어 기록에 없다.
  const first = { id: "q-1", text: "테스트도 같이 돌려 줘", sendNow: false };
  await openChat(page, linesThrough(late, END_SEQ - 1), { ...codex, queue: [first] });
  await expect(대기말(page, first.text)).toBeVisible();
  await expect(대기말(page, first.text)).toContainText("대기 중");

  // 도는 동안 친 말은 보내기 명령으로 간다(호스트가 대기 줄 끝에 넣는다). 입력칸은 비워지고, 대기 줄은 이벤트가 바꾼다.
  await expect(입력칸(page)).toHaveAttribute("placeholder", "이어서 말하면 대기 줄에 쌓여요");
  await 입력칸(page).fill("decisions.md에도 반영");
  // 글이 있으면 멈추기 앞에 보내기가 함께 선다 — 멈추기는 턴이 도는 내내 그 자리다.
  await expect(단추(page, "보내기")).toBeEnabled();
  await expect(단추(page, "멈추기")).toBeVisible();
  await 입력칸(page).press("Enter");
  expect((await ipcCallArgs(page, "chat_send", "work")).map(({ args }) => args)).toEqual([
    { work: plainWork.slug, conversation: codex.id, text: "decisions.md에도 반영" },
  ]);
  await expect(입력칸(page)).toHaveValue("");
  const second = { id: "q-2", text: "decisions.md에도 반영", sendNow: false };
  await fireQueue(page, plainWork.slug, codex.id, [first, second]);
  await expect(대기줄(page).getByRole("listitem")).toHaveCount(2);
  expect(await 대기줄(page).getByRole("listitem").evaluateAll((all) => all.map((el) => el.dataset.queued))).toEqual([
    "q-1",
    "q-2",
  ]);

  // 고치기 — 그 줄이 글칸이 되고, Enter로 고친 글이 대기 id와 함께 간다. 이벤트가 오면 줄의 글이 바뀐다.
  await 대기말(page, second.text).getByRole("button", { name: "대기 중인 말 고치기", exact: true }).click();
  const 고칠말 = 대기줄(page).getByRole("textbox", { name: "고칠 말", exact: true });
  await expect(고칠말).toHaveValue(second.text);
  await 고칠말.fill("decisions.md와 overview.md에도 반영");
  await 고칠말.press("Enter");
  expect((await ipcCallArgs(page, "chat_edit_queued", "work")).map(({ args }) => args)).toEqual([
    { work: plainWork.slug, conversation: codex.id, queued: "q-2", text: "decisions.md와 overview.md에도 반영" },
  ]);
  await expect(고칠말).toHaveCount(0);
  const edited = { ...second, text: "decisions.md와 overview.md에도 반영" };
  await fireQueue(page, plainWork.slug, codex.id, [first, edited]);
  await expect(대기말(page, edited.text)).toBeVisible();

  // 지우기 — 대기 id가 간다. 이벤트가 오면 줄이 사라진다.
  await 대기말(page, first.text).getByRole("button", { name: "대기 중인 말 지우기", exact: true }).click();
  expect((await ipcCallArgs(page, "chat_delete_queued", "work")).map(({ args }) => args)).toEqual([
    { work: plainWork.slug, conversation: codex.id, queued: "q-1" },
  ]);
  await fireQueue(page, plainWork.slug, codex.id, [edited]);
  await expect(대기말(page, first.text)).toHaveCount(0);

  // 지금 보내기 — 대기 id가 간다. 호스트가 그 말을 「지금 보내기」로 세우고 턴을 멈춘다 — 그 말은 멈춤을 기다린다.
  await 대기말(page, edited.text).getByRole("button", { name: "지금 보내기", exact: true }).click();
  expect((await ipcCallArgs(page, "chat_send_now", "work")).map(({ args }) => args)).toEqual([
    { work: plainWork.slug, conversation: codex.id, queued: "q-2" },
  ]);
  await fireQueue(page, plainWork.slug, codex.id, [{ ...edited, sendNow: true }]);
  await expect(대기말(page, edited.text)).toContainText("멈추고 보내는 중");
  await expect(대기말(page, edited.text).getByRole("button", { name: "지금 보내기", exact: true })).toHaveCount(0);

  // 멈춘 턴이 끝나면 그 말이 먼저 간다 — 대기 줄에서 빠지고 사용자 메시지로 선다.
  await streamLines(page, plainWork.slug, codex.id, [late.find((line) => line.seq === END_SEQ)!]);
  await expect(머리줄(page, "3초 후에 중단했습니다")).toBeVisible();
  await streamLines(page, plainWork.slug, codex.id, [sentLine(END_SEQ + 1, edited.text, true)]);
  await fireQueue(page, plainWork.slug, codex.id, []);
  await expect(대기줄(page)).toHaveCount(0);
  await expect(작업패널(page).getByText(edited.text, { exact: true })).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

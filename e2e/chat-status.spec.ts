import { expect, test, type Page } from "./evidence";

import { WORKS } from "./fixtures";
import { ipcCallArgs, unknownIpcCalls } from "./harness";
import { conversationRow, linesAfter, linesThrough, record, sessionLine, streamLines } from "./chat-records";
import { openWorkChat, 대화탭, 대화탭줄, 레일칸, 입력칸, 작업패널 } from "./chat-screen";
import type { Conversation, RecordLine } from "@/features/chat/types";

// three-axes 티켓 23 — **대화 상태 점이 서고, 다시 켜면 기록으로 그려지고, 닫기 · 종료가 하던 일을 묻는다.**
//
// 상태(S23)는 화면이 기록에서 계산한다 — 이어 붙이는 중(띄우거나 되살리는 중) · 일하는 중(턴이 돈다) · 나를 기다림(답하지 않은
// 권한 요청) · 끝남(턴이 끝났는데 그 대화를 아직 보지 않았다). 그래서 이 층은 L1이 남긴 기록(S26)과 그 꼴로 지은 손 자료를 쏘고,
// 대화 탭의 접근성 이름 · 상태 점 · 레일 칸의 설명 · 흐름의 상태 줄을 잰다. 종료 확인의 셈은 `quit-confirm.spec.ts` 옆에서 잰다.

const [, plainWork] = WORKS;

/** 대화 탭의 상태 점 — 색만이 신호여선 안 되므로 그림은 숨고(`aria-hidden`) 이름이 말한다. 점의 갈래는 표식이 든다. */
const 상태점 = (page: Page, conversation: string) => 대화탭줄(page).locator(`[data-conversation="${conversation}"] [data-status]`);

/** 그 work의 대화창을 연다 — 대화 목록은 `rows`, 기록 읽기는 대화 id마다 `reads`다. 맨 앞 대화가 켜진다. */
const openChat = (page: Page, rows: Conversation[], reads: Record<string, readonly RecordLine[]>): Promise<void> =>
  openWorkChat(page, rows, reads, { ready: 대화탭줄 });

// L1이 남긴 「Codex 권한」(S26) — 열림 셋 뒤에 보낸 말 · 답 · 도구 호출 · 권한 물음(seq 8) · 답을 기다리는 동안의 생각 · 답(seq 11) ·
// 도구 끝 · 답 · 턴 끝(seq 14).
const permission = record("permission");
const seqOf = (lines: readonly RecordLine[], match: (line: RecordLine) => boolean) => lines.find(match)!.seq;
const OPENED = seqOf(permission, (line) => line.kind === "session" && (line.payload as { state: string }).state === "opened");
const ASKED = seqOf(permission, (line) => line.kind === "permission" && (line.payload as { state: string }).state === "asked");
const ANSWERED = seqOf(permission, (line) => line.kind === "permission" && (line.payload as { state: string }).state === "answered");

const codex = conversationRow({ id: "c-status-codex", agent: "codex", name: "Codex", lastSeq: OPENED });
const claude = conversationRow({ id: "c-status-claude", agent: "claude", name: "Claude" });

test("상태 점: 대화 탭에 일하는 중 · 나를 기다림 · 끝남 · 이어 붙이는 중이 기록대로 서고, 접근성 이름이 그 상태를 말한다", async ({ page }) => {
  await openChat(page, [codex, claude], { [codex.id]: linesThrough(permission, OPENED), [claude.id]: [] });
  // 쉬는 대화에는 점이 없고 이름은 대화 이름 그대로다.
  await expect(대화탭(page, "Codex")).toHaveAttribute("aria-pressed", "true");
  await expect(상태점(page, codex.id)).toHaveCount(0);

  // 보낸 말 → 일하는 중.
  await streamLines(page, plainWork.slug, codex.id, linesThrough(linesAfter(permission, OPENED), OPENED + 1));
  await expect(대화탭(page, "Codex — 일하는 중")).toHaveAttribute("aria-pressed", "true");
  await expect(상태점(page, codex.id)).toHaveAttribute("data-status", "working");

  // 답하지 않은 권한 요청 → 나를 기다림. 턴도 돌지만 사람이 답할 차례가 위다.
  await streamLines(page, plainWork.slug, codex.id, linesThrough(linesAfter(permission, OPENED + 1), ASKED));
  await expect(대화탭(page, "Codex — 나를 기다림")).toBeVisible();
  await expect(상태점(page, codex.id)).toHaveAttribute("data-status", "waiting");
  await expect(상태점(page, codex.id)).toHaveAttribute("aria-hidden", "true");

  // 답하면 다시 일하는 중.
  await streamLines(page, plainWork.slug, codex.id, linesThrough(linesAfter(permission, ASKED), ANSWERED));
  await expect(대화탭(page, "Codex — 일하는 중")).toBeVisible();

  // 다른 대화를 보는 동안 턴이 끝났다 → 끝남. 그 대화를 보면 사라진다(스토리 8).
  await 대화탭(page, "Claude").click();
  await streamLines(page, plainWork.slug, codex.id, linesAfter(permission, ANSWERED));
  await expect(대화탭(page, "Codex — 끝남")).toHaveAttribute("aria-pressed", "false");
  await expect(상태점(page, codex.id)).toHaveAttribute("data-status", "done");
  await 대화탭(page, "Codex — 끝남").click();
  await expect(대화탭(page, "Codex")).toHaveAttribute("aria-pressed", "true");
  await expect(상태점(page, codex.id)).toHaveCount(0);

  // 띄우는 중(되살리기 포함) → 이어 붙이는 중. 열리면 걷힌다.
  await streamLines(page, plainWork.slug, claude.id, [sessionLine(1, { state: "spawning" })]);
  await expect(대화탭(page, "Claude — 이어 붙이는 중")).toBeVisible();
  await expect(상태점(page, claude.id)).toHaveAttribute("data-status", "connecting");
  await streamLines(page, plainWork.slug, claude.id, [
    sessionLine(2, { state: "opened", how: "new", agentVersion: "0.18.0", modes: null, models: null, configOptions: [] }),
  ]);
  await expect(대화탭(page, "Claude")).toBeVisible();
  await expect(상태점(page, claude.id)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** 탭 줄의 `chat` 탭 — 레일 칸과 이름이 같아 탭 줄의 칸 표식으로 집는다. */
const chat탭 = (page: Page) => page.locator('header [data-tab="chat"]');
const 레일기다림 = "나를 기다리는 대화가 있어요";
const 레일끝남 = "끝났는데 아직 보지 않은 대화가 있어요";

test("레일: `chat` 칸의 점은 대화창이 안 보일 때만 서서 기다림 · 끝남을 말하고, 끝남은 그 대화를 보면 사라진다", async ({ page }) => {
  await openChat(page, [codex], { [codex.id]: linesThrough(permission, OPENED) });
  await streamLines(page, plainWork.slug, codex.id, linesThrough(linesAfter(permission, OPENED), OPENED + 1));
  await expect(대화탭(page, "Codex — 일하는 중")).toBeVisible();
  // 대화창이 보이는 동안은 레일에 점이 없다 — 대화 탭의 점이 말한다.
  await expect(레일칸(page, "chat")).not.toHaveAttribute("aria-description");

  // 트리로 간다 — 대화창이 가려졌다. 일하는 중에는 레일이 조용하다(부르지 않는다).
  await 레일칸(page, "spec").click();
  await expect(레일칸(page, "chat")).not.toHaveAttribute("aria-description");
  await streamLines(page, plainWork.slug, codex.id, linesThrough(linesAfter(permission, OPENED + 1), ASKED));
  await expect(레일칸(page, "chat")).toHaveAttribute("aria-description", 레일기다림);

  // 대화창을 다시 보이면 점이 걷힌다 — 그래도 대답할 물음은 그대로라 탭은 기다린다.
  await 레일칸(page, "chat").click();
  await expect(레일칸(page, "chat")).not.toHaveAttribute("aria-description");
  await expect(대화탭(page, "Codex — 나를 기다림")).toBeVisible();

  // 가려진 동안 턴이 끝났다 → 끝남.
  await 레일칸(page, "spec").click();
  await streamLines(page, plainWork.slug, codex.id, linesAfter(permission, ASKED));
  await expect(레일칸(page, "chat")).toHaveAttribute("aria-description", 레일끝남);

  // 그 대화를 보면 끝남이 사라진다 — 다시 가려도 점은 돌아오지 않는다.
  await 레일칸(page, "chat").click();
  await expect(대화탭(page, "Codex")).toHaveAttribute("aria-pressed", "true");
  await 레일칸(page, "spec").click();
  await expect(레일칸(page, "chat")).not.toHaveAttribute("aria-description");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("레일: 대화창이 `chat` 탭으로 가운데에 떠 있으면 레일 점은 서지 않고, 보이는 대화의 턴 끝은 끝남이 되지 않는다", async ({ page }) => {
  await openChat(page, [codex], { [codex.id]: linesThrough(permission, OPENED) });
  await chat탭(page).click();
  const 가운데 = page.getByRole("main", { name: "대화", exact: true });
  await expect(가운데.getByRole("group", { name: "대화 탭", exact: true })).toBeVisible();

  await streamLines(page, plainWork.slug, codex.id, linesThrough(linesAfter(permission, OPENED), ASKED));
  await expect(가운데.getByRole("button", { name: "Codex — 나를 기다림", exact: true })).toBeVisible();
  await expect(레일칸(page, "chat")).not.toHaveAttribute("aria-description");
  await streamLines(page, plainWork.slug, codex.id, linesAfter(permission, ASKED));
  await expect(가운데.getByRole("button", { name: "Codex", exact: true })).toBeVisible();
  await expect(레일칸(page, "chat")).not.toHaveAttribute("aria-description");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// L1이 남긴 「되살리기」(S26, 티켓 10) — 어제의 한 턴(seq 1~12, 세션 fake-session)을 남기고 앱을 다시 켠 뒤 말을 보내자, 되살릴 길이
// 없어 새 세션(fake-session-2)으로 열렸다: 띄우는 중(13) · 계정 · 열림 `how: fresh`(15) · 보낸 말(16) … 턴 끝(24).
const resume = record("resume");
const YESTERDAY_END = seqOf(resume, (line) => line.kind === "turn-end");
const RESPAWN = YESTERDAY_END + 1;
const FRESH = seqOf(resume, (line) => line.kind === "session" && (line.payload as { how?: string }).how === "fresh");
const 흐름 = (page: Page) => 작업패널(page);
const 머리줄 = (page: Page, name: string) => 흐름(page).getByRole("button", { name, exact: true });
const 새로시작함 = "새로 시작함 — 앞의 맥락을 잇지 못해 새 세션으로 열었어요";

/** 앱을 다시 켠 뒤의 대화 — 대화 목록이 「에이전트가 떠 있지 않다」고 말한다(`live: false`). */
const restarted = conversationRow({ id: "c-status-resume", agent: "codex", name: "Codex", lastSeq: YESTERDAY_END, live: false });

test("다시 켬: 대화 탭과 어제의 기록이 기록 읽기로 그대로 서고, 말을 보내면 이어 붙이는 중을 지나 새 세션이면 「새로 시작함」 상태 줄이 선다", async ({
  page,
}) => {
  await openChat(page, [restarted], { [restarted.id]: linesThrough(resume, YESTERDAY_END) });
  await expect(대화탭(page, "Codex")).toHaveAttribute("aria-pressed", "true");
  await expect(흐름(page).getByText("어제의 말", { exact: true })).toBeVisible();
  await expect(머리줄(page, "8초 동안 작업함")).toBeVisible();
  await expect(흐름(page).getByText(새로시작함)).toHaveCount(0);

  await 입력칸(page).fill("오늘의 말");
  await 입력칸(page).press("Enter");
  // 호스트가 되살린다 — 띄우는 중 줄이 오면 이어 붙이는 중이다.
  await streamLines(page, plainWork.slug, restarted.id, linesThrough(linesAfter(resume, YESTERDAY_END), RESPAWN));
  await expect(대화탭(page, "Codex — 이어 붙이는 중")).toBeVisible();
  // 새 세션으로 열렸다 — 대화 안에 한 줄이 선다. 어제의 턴 뒤, 오늘의 말 앞이다.
  await streamLines(page, plainWork.slug, restarted.id, linesThrough(linesAfter(resume, RESPAWN), FRESH));
  await expect(흐름(page).getByText(새로시작함)).toBeVisible();
  await expect(대화탭(page, "Codex")).toBeVisible();
  await streamLines(page, plainWork.slug, restarted.id, linesAfter(resume, FRESH));
  await expect(머리줄(page, "8초 동안 작업함")).toHaveCount(2);
  const order = await 흐름(page)
    .getByText(/^(어제의 말|오늘의 말|새로 시작함 — .+)$/)
    .evaluateAll((all) => all.map((el) => el.textContent));
  expect(order).toEqual(["어제의 말", 새로시작함, "오늘의 말"]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("다시 켬: 앱을 끌 때 돌던 턴은 다시 켜면 끝난 턴이다 — 일하는 중으로 남지 않는다. 같은 기록이라도 새로고침(에이전트가 떠 있다)이면 일하는 중이다", async ({
  page,
}) => {
  // 어제의 턴이 도구를 돌리던 중에 앱이 꺼졌다 — 턴 끝 줄이 없다.
  const cutMidTurn = linesThrough(resume, YESTERDAY_END - 3);
  await openChat(page, [{ ...restarted, lastSeq: YESTERDAY_END - 3 }], { [restarted.id]: cutMidTurn });
  await expect(대화탭(page, "Codex")).toHaveAttribute("aria-pressed", "true");
  await expect(상태점(page, restarted.id)).toHaveCount(0);
  await expect(머리줄(page, "멈췄어요 — 앱이 꺼지며 끊겼어요")).toBeVisible();
  await expect(작업패널(page).getByRole("button", { name: "멈추기", exact: true })).toHaveCount(0);

  // 화면 새로고침이면 호스트에서 그 턴이 아직 돈다.
  await openChat(page, [{ ...restarted, lastSeq: YESTERDAY_END - 3, live: true }], { [restarted.id]: cutMidTurn });
  await expect(대화탭(page, "Codex — 일하는 중")).toHaveAttribute("aria-pressed", "true");
  await expect(작업패널(page).getByRole("button", { name: "멈추기", exact: true })).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("상태 줄: 에이전트 프로세스가 죽으면 그 까닭이, 잰 적 없는 판이면 판 경고가 대화 안에 한 줄로 선다", async ({ page }) => {
  await openChat(page, [restarted], { [restarted.id]: linesThrough(resume, YESTERDAY_END) });
  await expect(머리줄(page, "8초 동안 작업함")).toBeVisible();

  await streamLines(page, plainWork.slug, restarted.id, [
    sessionLine(RESPAWN, {
      state: "died",
      reason: "에이전트 프로세스가 끝났습니다 (종료 코드 101)",
      stderrTail: ["thread 'main' panicked at codex-rs/core/src/turn.rs:42"],
    }),
  ]);
  await expect(흐름(page).getByText("에이전트 프로세스가 끝났습니다 (종료 코드 101) · 다음 말에서 다시 띄워요")).toBeVisible();

  await streamLines(page, plainWork.slug, restarted.id, [
    sessionLine(RESPAWN + 1, { state: "spawning" }),
    sessionLine(RESPAWN + 2, { state: "version-warning", agentVersion: "3.0.0", supportedMajor: 2 }),
    sessionLine(RESPAWN + 3, { state: "opened", how: "resumed", agentVersion: "3.0.0", modes: null, models: null, configOptions: [] }),
  ]);
  await expect(흐름(page).getByText("확인하지 않은 에이전트 판이에요(3.0.0 — 확인한 판은 2.x). 그대로 이어 가요")).toBeVisible();
  // 이어 붙였으니(`resumed`) 「새로 시작함」은 없다.
  await expect(흐름(page).getByText(새로시작함)).toHaveCount(0);
  await expect(대화탭(page, "Codex")).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

const 닫기창 = (page: Page) => page.getByRole("alertdialog", { name: "대화 닫기", exact: true });

test("닫기: 턴이 도는 대화의 × 는 확인 창을 먼저 띄우고, 취소하면 닫지 않는다 — 쉬는 대화의 × 는 묻지 않고 바로 닫는다", async ({ page }) => {
  await openChat(page, [codex, claude], { [codex.id]: linesThrough(permission, OPENED + 1), [claude.id]: [] });
  await expect(대화탭(page, "Codex — 일하는 중")).toBeVisible();

  await 대화탭줄(page).getByRole("button", { name: "Codex 닫기", exact: true }).click();
  const dialog = 닫기창(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAccessibleDescription("에이전트가 일하는 중이에요 — 닫으면 그 턴이 끊겨요. 닫을까요?");
  // 셸 닫기 확인과 같은 손버릇이다(S25) — 진행 버튼이 「닫기」이고 기본 포커스도 거기다.
  await expect(dialog.getByRole("button", { name: "닫기", exact: true })).toBeFocused();
  await dialog.getByRole("button", { name: "취소", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(대화탭(page, "Codex — 일하는 중")).toBeVisible();
  expect(await ipcCallArgs(page, "chat_close", "work")).toEqual([]);

  // 답하지 않은 승인이 걸려 있어도 묻는다. 「닫기」면 닫는다.
  await streamLines(page, plainWork.slug, codex.id, linesThrough(linesAfter(permission, OPENED + 1), ASKED));
  await expect(대화탭(page, "Codex — 나를 기다림")).toBeVisible();
  await 대화탭줄(page).getByRole("button", { name: "Codex 닫기", exact: true }).click();
  await expect(닫기창(page)).toHaveAccessibleDescription("답하지 않은 승인이 있어요 — 닫으면 그 물음이 거둬져요. 닫을까요?");
  await 닫기창(page).getByRole("button", { name: "닫기", exact: true }).click();
  await expect(대화탭줄(page).locator(`[data-conversation="${codex.id}"]`)).toHaveCount(0);
  expect((await ipcCallArgs(page, "chat_close", "work")).map(({ args }) => args)).toEqual([
    { work: plainWork.slug, conversation: codex.id },
  ]);

  // 쉬는 대화는 묻지 않는다. (마지막 대화를 닫으면 대화창이 기본값 대화를 하나 연다 — 처음 비었을 때 한 번, 티켓 17. 그래서 닫힌 것은
  // 대화 id로 잰다.)
  await 대화탭줄(page).getByRole("button", { name: "Claude 닫기", exact: true }).click();
  await expect(대화탭줄(page).locator(`[data-conversation="${claude.id}"]`)).toHaveCount(0);
  await expect(닫기창(page)).toHaveCount(0);
  expect((await ipcCallArgs(page, "chat_close", "work")).map(({ args }) => args)).toEqual([
    { work: plainWork.slug, conversation: codex.id },
    { work: plainWork.slug, conversation: claude.id },
  ]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

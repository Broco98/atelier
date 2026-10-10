import { expect, test, type Page } from "./evidence";

import { answerByArg, WORKS } from "./fixtures";
import { installFixtureBackend, ipcCallArgs, replaceAnswer, unknownIpcCalls, workRow } from "./harness";
import { conversationRow, handTurn, linesAfter, linesThrough, record, streamLines } from "./chat-records";

// three-axes 티켓 17 — **레일 `chat` 칸에 대화창이 서고, 말을 보내면 답이 흘러 머리줄로 접힌다.**
//
// 이 층(L3)이 대화창의 주 지점이다(three-axes 구현 스펙 Testing Decisions). 대화 호스트는 목업 백엔드의 답과 이 검사가 쏘는 기록
// 줄 이벤트로 선다 — 기록 줄은 L1이 남긴 「Codex 한 턴」 파일을 그대로 쏜다(S26, `chat-records.ts`). 재는 것은 역할 · 접근성
// 이름 · 보이는 글 · 나간 명령의 인자다.

const [pinnedWork, plainWork] = WORKS;

const 레일 = (page: Page) => page.getByRole("group", { name: "레일", exact: true });
/** 레일 칸 — 탭 줄의 칸과 이름이 갈리도록 레일 묶음 안에서 집는다. */
const 레일칸 = (page: Page, name: "spec" | "chat" | "info") => 레일(page).getByRole("button", { name, exact: true });
const 토글 = (page: Page) => page.getByRole("button", { name: /^작업 패널 (접기|펼치기)$/ });
const 작업패널 = (page: Page) => page.getByRole("region", { name: "작업 패널", exact: true });
const 입력칸 = (page: Page) => 작업패널(page).getByRole("textbox", { name: "보낼 말", exact: true });
/** spec 몸이 섰다는 표식 — 트리의 폴더 행. */
const 트리폴더 = (page: Page) => 작업패널(page).getByRole("button", { name: "증거", exact: true });

const codex = conversationRow({ id: "c-codex", agent: "codex", name: "Codex" });

test("레일: `chat` 칸이 spec · chat · info 순서로 서고 aria-pressed로 켜지며, 다시 누르면 패널이 닫히고, spec과 오가도 입력 글이 남는다", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    chat_list: answerByArg("work", { [pinnedWork.slug]: [codex] }, { otherwise: [] }),
  });
  await page.goto(`/works/${pinnedWork.slug}`);
  await expect(트리폴더(page)).toBeVisible();
  expect(await 레일(page).getByRole("button").evaluateAll((all) => all.map((el) => el.getAttribute("aria-label")))).toEqual([
    "spec",
    "chat",
    "info",
  ]);
  // 작업 화면을 여는 것만으로는 대화창이 대화 호스트를 부르지 않는다 — 대화창은 처음 보일 때 목록을 읽는다.
  expect(await ipcCallArgs(page, "chat_list", "work")).toEqual([]);

  await 레일칸(page, "chat").click();
  await expect(레일칸(page, "chat")).toHaveAttribute("aria-pressed", "true");
  await expect(레일칸(page, "spec")).toHaveAttribute("aria-pressed", "false");
  await expect(입력칸(page)).toBeVisible();
  await expect(트리폴더(page)).toHaveCount(0);

  await 입력칸(page).fill("overview를 고쳐 줘");
  await 레일칸(page, "spec").click();
  await expect(트리폴더(page)).toBeVisible();
  await expect(입력칸(page)).toHaveCount(0);
  await 레일칸(page, "chat").click();
  await expect(입력칸(page)).toHaveValue("overview를 고쳐 줘");

  // 켜진 `chat`을 다시 누르면 패널이 닫힌다 — 켜진 칸이 없어진다. 대화는 끄지 않는다(닫기 명령이 나가지 않는다).
  await 레일칸(page, "chat").click();
  await expect(토글(page)).toHaveAttribute("aria-expanded", "false");
  await expect(레일칸(page, "chat")).toHaveAttribute("aria-pressed", "false");
  expect(await ipcCallArgs(page, "chat_close", "work")).toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

const 대화탭줄 = (page: Page) => 작업패널(page).getByRole("group", { name: "대화 탭", exact: true });
/** 대화 탭 — 이름 버튼이 켜짐(`aria-pressed`)을 말한다. */
const 대화탭 = (page: Page, name: string) => 대화탭줄(page).getByRole("button", { name, exact: true });

test("대화 탭: 대화 없는 work에서 대화창을 처음 열면 기본 에이전트 대화 하나가 열리고, + 는 묻지 않고 둘째 대화를, × 는 그 대화의 닫기를 부른다", async ({
  page,
}) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);
  await expect(트리폴더(page).or(작업패널(page).getByText("아직 spec 파일이 없어요"))).toBeVisible();
  expect(await ipcCallArgs(page, "chat_new", "work"), "대화창이 보이기 전에는 열지 않는다").toEqual([]);

  // 처음 열면 설정의 기본 에이전트(처음은 Claude Code)로 대화 하나가 열려 있다 — 호스트가 지은 이름 「Claude」.
  await 레일칸(page, "chat").click();
  await expect(대화탭(page, "Claude")).toHaveAttribute("aria-pressed", "true");
  expect((await ipcCallArgs(page, "chat_new", "work")).map(({ args }) => args)).toEqual([
    { work: plainWork.slug, agent: "claude" },
  ]);
  await expect(입력칸(page)).toHaveAttribute("placeholder", "Claude Code에게 요청하세요");

  // `spec`에 다녀와도 다시 열지 않는다 — 처음 한 번이다.
  await 레일칸(page, "spec").click();
  await 레일칸(page, "chat").click();
  await expect(대화탭(page, "Claude")).toBeVisible();
  expect(await ipcCallArgs(page, "chat_new", "work")).toHaveLength(1);

  // `+`는 묻지 않고 기본값으로 둘째 대화를 연다. 이름은 호스트가 「Claude 2」로 짓는다. 새 대화가 켜진다.
  await replaceAnswer(page, "chat_new", conversationRow({ id: "c-claude-2", agent: "claude", name: "Claude 2" }));
  await 대화탭줄(page).getByRole("button", { name: "새 대화", exact: true }).click();
  await expect(대화탭(page, "Claude 2")).toHaveAttribute("aria-pressed", "true");
  await expect(대화탭(page, "Claude")).toHaveAttribute("aria-pressed", "false");
  expect((await ipcCallArgs(page, "chat_new", "work")).map(({ args }) => args)).toEqual([
    { work: plainWork.slug, agent: "claude" },
    { work: plainWork.slug, agent: "claude" },
  ]);
  // 순서는 만든 순서다.
  expect(
    await 대화탭줄(page)
      .locator("button[aria-pressed]")
      .evaluateAll((all) => all.map((el) => el.textContent)),
  ).toEqual(["Claude", "Claude 2"]);

  // ×는 그 대화의 닫기를 부른다 — work와 대화 id가 실린다. 닫힌 탭은 사라지고 남은 대화가 켜진다.
  await 대화탭줄(page).getByRole("button", { name: "Claude 2 닫기", exact: true }).click();
  await expect(대화탭(page, "Claude 2")).toHaveCount(0);
  expect((await ipcCallArgs(page, "chat_close", "work")).map(({ args }) => args)).toEqual([
    { work: plainWork.slug, conversation: "c-claude-2" },
  ]);
  await expect(대화탭(page, "Claude")).toHaveAttribute("aria-pressed", "true");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// L1이 남긴 「Codex 한 턴」(S26) — 열림 줄 셋(띄우는 중 · 계정 · 열림) 뒤에 보낸 말(머리말 블록 + 사람의 블록) · 생각 · 답 · 도구 호출 ·
// 모르는 kind · 마지막 답 · 사용량 · 턴 끝(end_turn, 8초)이다.
const codexOneTurn = record("codex-one-turn");
const SENT_SEQ = codexOneTurn.find((line) => line.kind === "sent")!.seq;
const sentText = (codexOneTurn.find((line) => line.kind === "sent")!.payload as { text: string }).text;
/** 대화 목록에 이미 선 Codex 대화 — 기록 읽기는 보낸 말 앞(열림 줄)까지를 답한다. */
const opened = conversationRow({ id: "c-codex-one-turn", agent: "codex", name: "Codex", lastSeq: SENT_SEQ - 1 });

/** 그 work의 대화창을 연다 — 대화 목록은 `opened` 하나, 기록 읽기는 `read`다. */
async function openCodexChat(page: Page, read = linesThrough(codexOneTurn, SENT_SEQ - 1)): Promise<void> {
  await installFixtureBackend(page, {
    chat_list: answerByArg("work", { [plainWork.slug]: [opened] }, { otherwise: [] }),
    chat_read_record: answerByArg("conversation", { [opened.id]: read }),
  });
  await page.goto(`/works/${plainWork.slug}`);
  await 레일칸(page, "chat").click();
  await expect(대화탭(page, "Codex")).toHaveAttribute("aria-pressed", "true");
}

const 흐름 = (page: Page) => 작업패널(page);
const 머리줄 = (page: Page, name: string) => 흐름(page).getByRole("button", { name, exact: true });

test("흐름: 보낸 말이 머리말 없이 사용자 메시지로 서고, 「생각 중」 → 마크다운 답이 흐르고, 턴 끝에 「8초 동안 작업함」 머리줄 아래로 접히며 턴 끝 메시지만 펼쳐져 있다", async ({
  page,
}) => {
  await openCodexChat(page);
  // 사람이 친 글이 보내기 명령으로 간다 — 화면 글은 기록의 `sent`가 정하므로 그 글을 그대로 친다.
  await 입력칸(page).fill(sentText);
  await 입력칸(page).press("Enter");
  expect((await ipcCallArgs(page, "chat_send", "work")).map(({ args }) => args)).toEqual([
    { work: plainWork.slug, conversation: opened.id, text: sentText },
  ]);
  await expect(입력칸(page)).toHaveValue("");

  // 보낸 말 — 호스트가 적은 `sent` 줄이 사용자 메시지로 선다. 실제로 보낸 블록의 머리말(work slug · 제목 · specDir)은 기록에만 있다.
  const [sent, thought, firstAnswer, ...rest] = linesAfter(codexOneTurn, SENT_SEQ - 1);
  await streamLines(page, plainWork.slug, opened.id, [sent]);
  await expect(흐름(page).getByText(sentText, { exact: true })).toBeVisible();
  await expect(흐름(page).getByText(/Atelier work 안에서 열린 대화다/)).toHaveCount(0);
  await expect(흐름(page).getByText("생각 중", { exact: true })).toBeVisible();

  // 생각 → 「생각 중」. 답 → 마크다운 본문(인라인 코드가 코드로 선다).
  await streamLines(page, plainWork.slug, opened.id, [thought]);
  await expect(흐름(page).getByText("생각 중", { exact: true })).toBeVisible();
  await streamLines(page, plainWork.slug, opened.id, [firstAnswer]);
  await expect(흐름(page).getByText("Plan: run", { exact: false })).toBeVisible();
  await expect(흐름(page).locator("code", { hasText: "echo atelier" }).first()).toBeVisible();
  await expect(흐름(page).getByText("생각 중", { exact: true })).toHaveCount(0);

  // 나머지(도구 호출 · 모르는 kind · 마지막 답 · 사용량 · 턴 끝). 모르는 kind가 화면을 멈추지 않는다.
  await streamLines(page, plainWork.slug, opened.id, rest);
  const header = 머리줄(page, "8초 동안 작업함");
  await expect(header).toHaveAttribute("aria-expanded", "false");
  // 턴 끝 메시지(마지막 도구 호출 뒤의 답)만 펼쳐 둔다 — 생각과 앞선 답은 머리줄 아래로 접힌다.
  await expect(흐름(page).getByText("it printed", { exact: false })).toBeVisible();
  await expect(흐름(page).getByText("Plan: run", { exact: false })).toHaveCount(0);
  await expect(흐름(page).getByText("Reading the request", { exact: false })).toHaveCount(0);

  // 머리줄을 누르면 펼친다 — 생각과 앞선 답이 다시 선다. 다시 누르면 접힌다.
  await header.click();
  await expect(header).toHaveAttribute("aria-expanded", "true");
  await expect(흐름(page).getByText("Plan: run", { exact: false })).toBeVisible();
  await expect(흐름(page).getByText("Reading the request", { exact: false })).toBeVisible();
  await expect(흐름(page).getByText("it printed", { exact: false })).toBeVisible();
  await header.click();
  await expect(흐름(page).getByText("Plan: run", { exact: false })).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("흐름: 답의 코드 블록이 고정폭 상자로 서고, 언어가 머리에 적힌다", async ({ page }) => {
  // L1 자료의 답에는 코드 블록이 없다 — 같은 꼴로 손으로 지은 턴을 「Codex 한 턴」 뒤에 잇는다.
  await openCodexChat(page, codexOneTurn);
  await expect(머리줄(page, "8초 동안 작업함")).toBeVisible();
  const last = codexOneTurn[codexOneTurn.length - 1].seq;
  await streamLines(page, plainWork.slug, opened.id, handTurn(last + 1, "다시 돌려 줘", "돌린 명령:\n\n```sh\necho atelier\n```\n\n끝.", 3000));
  await expect(머리줄(page, "3초 동안 작업함")).toBeVisible();
  const block = 흐름(page).locator("pre", { hasText: "echo atelier" });
  await expect(block).toBeVisible();
  await expect(block).toHaveText("echo atelier");
  await expect(흐름(page).getByRole("figure").filter({ has: page.locator("pre", { hasText: "echo atelier" }) })).toContainText("sh");
  await expect(흐름(page).getByRole("button", { name: "코드 복사", exact: true })).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("work 사이: 다른 work에 가 있는 동안 흐른 줄이, 돌아오면 다 보인다", async ({ page }) => {
  const other = conversationRow({ id: "c-pinned-codex", agent: "codex", name: "Codex" });
  await installFixtureBackend(page, {
    chat_list: answerByArg("work", { [plainWork.slug]: [opened], [pinnedWork.slug]: [other] }),
    chat_read_record: answerByArg("conversation", { [opened.id]: linesThrough(codexOneTurn, SENT_SEQ), [other.id]: [] }),
  });
  await page.goto(`/works/${plainWork.slug}`);
  await 레일칸(page, "chat").click();
  await expect(흐름(page).getByText(sentText, { exact: true })).toBeVisible();

  // 다른 work로 간다 — 작업 패널은 그대로 `chat`이고 그 work의 대화가 선다. 앞 work의 대화는 호스트에서 계속 돈다.
  await workRow(page, pinnedWork.slug).click();
  await expect(page).toHaveURL(new RegExp(`/works/${pinnedWork.slug}`));
  await expect(흐름(page).getByText(sentText, { exact: true })).toHaveCount(0);
  await streamLines(page, plainWork.slug, opened.id, linesAfter(codexOneTurn, SENT_SEQ));
  await expect(흐름(page).getByText("it printed", { exact: false })).toHaveCount(0);

  // 돌아오면 그사이 쏜 줄이 다 보인다 — 턴 끝 머리줄과 턴 끝 메시지.
  await workRow(page, plainWork.slug).click();
  await expect(page).toHaveURL(new RegExp(`/works/${plainWork.slug}`));
  await expect(머리줄(page, "8초 동안 작업함")).toBeVisible();
  await expect(흐름(page).getByText("it printed", { exact: false })).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** 알림 자리에 새로 선 알림을 센다 — 쏘기 전에 붙인다. 알림은 새 줄로 갈아 끼워 서므로 더해진 요소 수가 알림 수다. */
async function countAnnouncements(page: Page): Promise<() => Promise<string[]>> {
  await page.evaluate(() => {
    const region = document.querySelector('[role="status"][aria-label="대화 알림"]');
    if (!region) throw new Error("대화 알림 자리가 없다");
    const seen: string[] = [];
    (window as unknown as { __CHAT_ANNOUNCED__: string[] }).__CHAT_ANNOUNCED__ = seen;
    new MutationObserver((records) => {
      for (const one of records) {
        for (const node of one.addedNodes) if (node.textContent) seen.push(node.textContent);
      }
    }).observe(region, { childList: true, subtree: true, characterData: true });
  });
  return () => page.evaluate(() => [...(window as unknown as { __CHAT_ANNOUNCED__: string[] }).__CHAT_ANNOUNCED__]);
}

test("접근성: 흐르는 답은 조각마다 알리지 않고, 턴 끝 알림이 한 번만 온다", async ({ page }) => {
  await openCodexChat(page, linesThrough(codexOneTurn, SENT_SEQ));
  const announced = await countAnnouncements(page);
  await streamLines(page, plainWork.slug, opened.id, linesAfter(codexOneTurn, SENT_SEQ));
  await expect(머리줄(page, "8초 동안 작업함")).toBeVisible();

  // 흐르는 답은 알림 영역 밖이다 — 조각마다 읽히지 않는다.
  const answer = 흐름(page).getByText("it printed", { exact: false });
  expect(await answer.evaluate((el) => el.closest('[aria-live], [role="status"], [role="log"], [role="alert"]'))).toBeNull();
  // 턴 끝에 한 번 — 대화 이름과 머리줄을 말한다.
  await expect.poll(announced).toHaveLength(1);
  expect((await announced())[0]).toContain("Codex · 8초 동안 작업함");

  // 다시 그려도(패널 칸을 오가도) 다시 알리지 않는다. 기록 읽기로 그린 지난 턴 끝도 알리지 않는다.
  await 레일칸(page, "spec").click();
  await 레일칸(page, "chat").click();
  await expect(머리줄(page, "8초 동안 작업함")).toBeVisible();
  expect(await announced()).toHaveLength(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

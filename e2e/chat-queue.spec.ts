import { expect, test, type Page } from "./evidence";

import { WORKS } from "./fixtures";
import { ipcCallArgs, unknownIpcCalls } from "./harness";
import { conversationRow, fireQueue, linesAfter, linesThrough, record, renumber, sentLine, streamLines } from "./chat-records";
import type { RecordLine } from "@/features/chat/types";
import { openWorkChat, 대화탭, 대화탭줄, 입력칸, 작업패널 } from "./chat-screen";

// three-axes 티켓 20 — **턴 도중의 말이 대기 줄에 쌓이고, 멈추기 · 지금 보내기가 화면에서 된다**(스토리 45 · 49 · 50 · 52 · 53 · 55).
//
// 대화 호스트는 목업 백엔드의 답과 이 검사가 쏘는 기록 줄 · 대기 줄 이벤트로 선다. Codex의 멈춤은 L1이 남긴 「멈춘 뒤 늦은 줄」
// 기록(S26, `late-after-cancel`)을 그대로 쏜다: 보낸 말 → 답 → 20초 명령의 도구 호출(열림) → 턴 끝(`cancelled`, 우리가 멈춤, 3초)
// → 턴 밖에서 늦게 온 그 명령의 출력 → 그 명령의 끝. Claude 꼴의 멈춤 · 스스로 이어 간 턴 · 죽음 · 되살림 · 권한이 걸린 채 멈춤도
// L1이 그 갈래를 지나며 남긴 기록이다 — 다른 기록의 줄은 이 대화의 끝에 seq를 다시 매겨 잇는다. 대기 줄은 기록에 없어(호스트
// 메모리) 손으로 쏜다. 재는 것은 역할 · 접근성 이름 · 보이는 글 · 나간 명령의 인자다.

const plainWork = WORKS[1];

const 단추 = (page: Page, name: string) => 작업패널(page).getByRole("button", { name, exact: true });
const 머리줄 = (page: Page, name: string) => 단추(page, name);

const late = record("late-after-cancel");
const seqOf = (kind: string) => late.find((line) => line.kind === kind)!.seq;
/** 멈춘 턴의 끝 줄 — 그 앞까지가 도는 턴이다. */
const END_SEQ = seqOf("turn-end");
const COMMAND = `python3 -c "import time; time.sleep(20); print('slept-fake')"`;

const stateOf = (line: RecordLine) => (line.payload as { state?: string }).state;

// L1이 남긴 「Codex 죽음」(S26, `revive.rs`) — 그 죽음 줄(까닭 · stderr 꼬리) 하나를 이 대화의 끝에 잇는다.
const died = record("codex-died").find((line) => line.kind === "session" && stateOf(line) === "died")!;

// L1이 남긴 「되살리기」(S26, 티켓 10) — 어제의 한 턴 뒤, 앱을 다시 켜고 말을 보내자 새 프로세스가 띄우는 중 · 계정 · 열림을 적고
// 그 말(「오늘의 말」)을 보냈다.
const resume = record("resume");
const YESTERDAY_END = resume.find((line) => line.kind === "turn-end")!.seq;
const TODAY_SENT = resume.filter((line) => line.kind === "sent")[1].seq;
/** 되살리기가 적는 새 프로세스의 줄들 — 띄우는 중부터 열림까지. */
const respawned = linesThrough(linesAfter(resume, YESTERDAY_END), TODAY_SENT - 1);
/** 되살린 프로세스의 줄들과 그 뒤에 간 말. */
const revived = linesThrough(linesAfter(resume, YESTERDAY_END), TODAY_SENT);

/** 그 work에 선 Codex 대화 — 기록 읽기는 `read`까지를 답한다. */
const codex = conversationRow({ id: "c-late-codex", agent: "codex", name: "Codex", lastSeq: END_SEQ - 1 });

function openChat(page: Page, read = linesThrough(late, END_SEQ - 1), row = codex): Promise<void> {
  // 대화 탭을 기다린다 — 답하지 않은 권한 물음까지 읽은 대화는 입력칸 대신 승인 카드가 서 있다(티켓 21). 도는 대화의 탭 이름에는 상태가
  // 붙는다(「Codex — 일하는 중」, 티켓 23).
  return openWorkChat(page, [row], { [row.id]: read }, {
    ready: (page) => 대화탭줄(page).getByRole("button", { name: new RegExp(`^${row.name}( — |$)`) }),
  });
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
  // 멈춘 턴은 머리줄 아래로 접혔다 — 그래도 멈출 때 열려 있던 명령은 접힌 턴 아래에 남는다(three-axes 결정 28 · 스토리 55).
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

test("멈춘 뒤의 도구 줄(에이전트가 끝남): 돌던 명령은 에이전트가 끝나면 스피너와 「명령은 끝까지 돌아요」가 걷히고 「멈춘 뒤에 끊김」이다 — 앱을 다시 켠 뒤에도 같다", async ({
  page,
}) => {
  await openChat(page, linesThrough(late, END_SEQ));
  const row = 도구줄(page, COMMAND);
  await expect(row).toContainText("멈춘 뒤에도 도는 중");
  await expect(row.locator('[data-slot="spinner"]')).toHaveCount(1);

  // 에이전트 프로세스가 죽었다 — 그 그룹의 명령도 함께 끝나 늦은 update는 더 오지 않는다(three-axes 결정 19).
  await streamLines(page, plainWork.slug, codex.id, renumber([died], END_SEQ + 1));
  await expect(row).toContainText("멈춘 뒤에 끊김");
  await expect(row).not.toContainText("멈춘 뒤에도 도는 중");
  await expect(row).not.toContainText("명령은 끝까지 돌아요");
  await expect(row.locator('[data-slot="spinner"]')).toHaveCount(0);

  // 앱을 다시 켠 꼴 — 대화 목록이 「에이전트가 떠 있지 않다」고 말하면 그 기록을 적던 프로세스는 이미 없다(티켓 23).
  await openChat(page, linesThrough(late, END_SEQ), { ...codex, lastSeq: END_SEQ, live: false });
  await expect(도구줄(page, COMMAND)).toContainText("멈춘 뒤에 끊김");
  await expect(도구줄(page, COMMAND).locator('[data-slot="spinner"]')).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("멈춘 뒤의 도구 줄(다시 켠 뒤 되살림): 다시 켜기 전 프로세스의 돌던 명령은 되살린 뒤 대화 목록이 「떠 있다」고 말해도 「멈춘 뒤에 끊김」이다 — 새 프로세스의 띄우는 중 줄이 끊는다", async ({
  page,
}) => {
  // 앱을 다시 켜고 그 대화를 되살렸다 — 기록에는 다시 켜기 전의 멈춘 턴 뒤로 새 프로세스의 띄우는 중 · 계정 · 열림이 서고, 대화 목록은 이제
  // 「떠 있다」(`live: true`)고 말한다. 끊김은 목록의 칸이 아니라 기록 안의 표지로 정한다.
  const read = [...linesThrough(late, END_SEQ), ...renumber(respawned, END_SEQ + 1)];
  await openChat(page, read, { ...codex, lastSeq: read[read.length - 1].seq, live: true });
  const row = 도구줄(page, COMMAND);
  await expect(row).toContainText("멈춘 뒤에 끊김");
  await expect(row).not.toContainText("멈춘 뒤에도 도는 중");
  await expect(row).not.toContainText("명령은 끝까지 돌아요");
  await expect(row.locator('[data-slot="spinner"]')).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("도는 턴의 도구 줄(다시 켠 뒤 말을 보내 되살림): 다시 켜기 전에 돌던 턴과 도구 줄은 되살린 뒤에도 끊긴 채다 — 「… 실행 중」으로 돌아가지 않는다", async ({
  page,
}) => {
  // 도구를 돌리던 중에 앱이 꺼졌고(턴 끝 줄이 없다), 다시 켠 뒤 말을 보내 되살렸다 — 띄우는 중 · 계정 · 열림 · 보낸 말.
  const read = [...linesThrough(late, END_SEQ - 1), ...renumber(revived, END_SEQ)];
  await openChat(page, read, { ...codex, lastSeq: read[read.length - 1].seq, live: true });
  await expect(작업패널(page).getByText("오늘의 말", { exact: true })).toBeVisible();
  const header = 머리줄(page, "멈췄어요 — 앱이 꺼지며 끊겼어요");
  await expect(header).toBeVisible();
  await header.click();
  const row = 도구줄(page, `${COMMAND} 실행하지 못함`);
  await expect(row).toBeVisible();
  await expect(row).toContainText("끊김");
  await expect(도구줄(page, `${COMMAND} 실행 중`)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("도는 턴의 도구 줄(에이전트가 끝남): 끝을 받지 못한 도구 줄은 진행형으로 남지 않고 「~하지 못함」과 상자의 「끊김」이다", async ({
  page,
}) => {
  await openChat(page);
  await expect(도구줄(page, `${COMMAND} 실행 중`)).toBeVisible();
  await streamLines(page, plainWork.slug, codex.id, renumber([died], END_SEQ));
  const header = 머리줄(page, "멈췄어요 — 에이전트가 끝났어요");
  await expect(header).toBeVisible();
  await header.click();
  const row = 도구줄(page, `${COMMAND} 실행하지 못함`);
  await expect(row).toBeVisible();
  await expect(row).toContainText("끊김");
  await expect(도구줄(page, `${COMMAND} 실행 중`)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// L1이 남긴 「Claude 멈춤」(S26, `claude_control.rs`) — 열림 · 명령 목록 뒤 40초 명령을 돌리는 턴을 멈췄다. Claude는 interrupt가 돌던
// 도구까지 멈춘다(three-axes 결정 28 · 워크플로 실측 2.1.282 `interrupt-sigint`): 그 도구의 `failed` update 뒤에 턴 끝(`cancelled`, 우리가
// 멈춤)이 온다. 그 뒤로 다음 말의 턴이 돈다.
const claudeStopped = record("claude-stopped");
const CLAUDE_SENT = claudeStopped.find((line) => line.kind === "sent")!.seq;
const CLAUDE_COMMAND = `python3 -c "import time; time.sleep(40); print('slept')"`;
/** 그 기록의 멈춘 턴 — 보낸 말부터 턴 끝까지. */
const claudeStoppedTurn = linesThrough(
  linesAfter(claudeStopped, CLAUDE_SENT - 1),
  claudeStopped.find((line) => line.kind === "turn-end")!.seq,
);
/** 열림 · 명령 목록까지 읽은 Claude 대화. */
const freshClaude = (id: string) => conversationRow({ id, agent: "claude", name: "Claude", lastSeq: CLAUDE_SENT - 1 });

test("멈춘 뒤의 도구 줄(Claude 꼴): 멈춤과 함께 `failed`로 닫힌 줄은 「멈춤」이고, 접힌 턴 아래에 남지 않는다", async ({ page }) => {
  // Claude 꼴은 엔진 이름이 아니라 ACP 모양으로 가른다 — 대화는 Claude지만 가르는 것은 멈춘 턴 끝 앞의 `failed` update다.
  const claude = freshClaude("c-stopped-claude");
  await openChat(page, linesThrough(claudeStopped, CLAUDE_SENT - 1), claude);
  await streamLines(page, plainWork.slug, claude.id, claudeStoppedTurn);

  const header = 머리줄(page, "8초 후에 중단했습니다");
  await expect(header).toHaveAttribute("aria-expanded", "false");
  // 닫힌 줄이라 접힌 턴 아래에 남지 않는다 — 머리줄을 펴면 선다.
  await expect(도구줄(page, CLAUDE_COMMAND)).toHaveCount(0);
  await header.click();
  const row = 도구줄(page, CLAUDE_COMMAND);
  await expect(row).toBeVisible();
  await expect(row).toContainText("멈춤");
  await expect(row).not.toContainText("멈춘 뒤");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** 멈춘 턴의 도구 호출(`tool_call`) 몸을 갈아 끼운다 — 가짜가 내지 못하는 ACP 원문 모양만 손으로 얹고, 우리 줄(보낸 말 · 턴 끝)은 기록 그대로다. */
function withToolCall(lines: readonly RecordLine[], call: Record<string, unknown>): RecordLine[] {
  return lines.map((line) => {
    const payload = line.payload as { update?: { sessionUpdate?: string; toolCallId?: string } };
    if (line.kind !== "update" || payload.update?.sessionUpdate !== "tool_call") return line;
    const update = { sessionUpdate: "tool_call", toolCallId: payload.update.toolCallId, ...call };
    return { ...line, payload: { ...payload, update } };
  });
}

test("멈춘 뒤의 도구 줄(제목이 빈 codex 배열 명령): 멈춘 줄의 이름도 도는 줄 문구처럼 셸 감싸개를 벗긴 명령이다", async ({ page }) => {
  // codex는 제목을 비우고 명령을 배열(`["/bin/zsh", "-lc", …]`)로 줄 때가 있다(실측 함정 49). 도는 동안의 문구(「echo atelier 실행 중」)와
  // 멈춘 뒤의 이름이 같은 명령 글이어야 한다. 그 도구 호출 몸만 손으로 짓고, 멈춘 턴은 「Claude 멈춤」 기록 그대로다.
  const claude = freshClaude("c-bare-claude");
  await openChat(page, linesThrough(claudeStopped, CLAUDE_SENT - 1), claude);
  const bare = { kind: "execute", title: "", status: "in_progress", rawInput: { command: ["/bin/zsh", "-lc", "echo atelier"] } };
  await streamLines(page, plainWork.slug, claude.id, withToolCall(claudeStoppedTurn, bare));

  await 머리줄(page, "8초 후에 중단했습니다").click();
  const row = 도구줄(page, "echo atelier");
  await expect(row).toBeVisible();
  await expect(row).toContainText("멈춤");
  await expect(도구줄(page, "/bin/zsh -lc echo atelier")).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("멈춘 뒤의 도구 줄(권한을 기다리던 명령): 멈추기로 권한 요청이 거둬진 도구는 돌지 않았으니 「멈춤」이다", async ({ page }) => {
  // L1이 남긴 「권한이 걸린 채 멈춤」 기록(S26 — `permission.rs`)의 물음 · 답을 기다리는 동안의 생각 둘까지 읽고, 그 뒤를 쏜다: 멈추기로
  // 거둬짐(`stopped`) → 멈춘 턴의 끝. 진짜 codex-acp는 권한을 기다리는 도구를 `in_progress`로 두고 닫는 update를 보내지 않는다(실측 G2 cancel).
  const stopped = record("permission-stopped");
  const withdrawn = stopped.find((line) => line.kind === "permission" && stateOf(line) === "withdrawn")!.seq;
  const conversation = conversationRow({ id: "c-perm-codex", agent: "codex", name: "Codex", lastSeq: withdrawn - 1 });
  await openChat(page, linesThrough(stopped, withdrawn - 1), conversation);
  // 권한을 기다리는 동안은 입력창 자리에 승인 카드가 서 있다 — 멈추기도 그 카드에 있다.
  await expect(작업패널(page).getByRole("group", { name: "이 명령을 실행하도록 허용할까요?", exact: true })).toBeVisible();
  await streamLines(page, plainWork.slug, conversation.id, linesAfter(stopped, withdrawn - 1));
  const header = 머리줄(page, "8초 후에 중단했습니다");
  await expect(header).toBeVisible();
  const title = "printf 'g2' > /tmp/fake-outside/g2.txt";
  await expect(도구줄(page, title)).toHaveCount(0);
  await header.click();
  await expect(도구줄(page, title)).toContainText("멈춤");
  await expect(도구줄(page, title)).not.toContainText("멈춘 뒤");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// L1이 남긴 「스스로 이어 간 턴」(S26, `claude_background.rs`) — 사람이 보낸 두 턴(둘째는 백그라운드 명령을 걸고 곧바로 끝남) 뒤에,
// 백그라운드 작업이 끝나 claude가 보낸 말 없이 스스로 턴을 열었다: 시작 표지 → 답 → 턴 밖 끝(`outOfTurn`).
const selfTurn = record("claude-self-turn");
const SECOND_END = selfTurn.filter((line) => line.kind === "turn-end")[1].seq;
const SELF_STARTED = selfTurn.find((line) => {
  const update = (line.payload as { update?: { _meta?: { atelier?: { outOfTurn?: { state?: string } } } } }).update;
  return update?._meta?.atelier?.outOfTurn?.state === "started";
})!.seq;
const SELF_ANSWERED = selfTurn.find(
  (line) =>
    line.seq > SELF_STARTED && (line.payload as { update?: { sessionUpdate?: string } }).update?.sessionUpdate === "agent_message_chunk",
)!.seq;
const SELF_ANSWER = "백그라운드 명령어가 완료되었습니다.";
/** 사람이 보낸 두 턴까지 읽은 Claude 대화. */
const selfClaude = (id: string) => conversationRow({ id, agent: "claude", name: "Claude", lastSeq: SECOND_END });

test("스스로 이어 간 턴: 보낸 말 없이 선 턴의 머리줄에 「스스로 이어 감」 표지가 서고, 사용자 메시지는 서지 않는다", async ({
  page,
}) => {
  const claude = selfClaude("c-self-claude");
  await openChat(page, linesThrough(selfTurn, SECOND_END), claude);
  // 사람이 보낸 턴들이 끝난 뒤 — 에이전트가 백그라운드 작업 알림으로 스스로 턴을 연다(턴 밖 update).
  await expect(머리줄(page, "8초 동안 작업함")).toBeVisible();
  await expect(작업패널(page).getByText("스스로 이어 감", { exact: true })).toHaveCount(0);

  // 도는 동안 — 걸린 시간 머리줄 옆에 표지가 서고, 턴이 돌므로 보내기 자리는 멈추기다.
  await streamLines(page, plainWork.slug, claude.id, linesThrough(linesAfter(selfTurn, SECOND_END), SELF_ANSWERED));
  await expect(작업패널(page).getByText(SELF_ANSWER, { exact: false })).toBeVisible();
  await expect(작업패널(page).getByText("스스로 이어 감", { exact: true })).toBeVisible();
  await expect(단추(page, "멈추기")).toBeVisible();

  // 턴 밖 끝 — 머리줄이 접히고 표지가 남는다. 사용자 메시지는 사람이 보낸 두 말뿐이다.
  await streamLines(page, plainWork.slug, claude.id, linesAfter(selfTurn, SELF_ANSWERED));
  await expect(머리줄(page, "14초 동안 작업함")).toBeVisible();
  await expect(작업패널(page).getByText("스스로 이어 감", { exact: true })).toHaveCount(1);
  await expect(작업패널(page).getByText(SELF_ANSWER, { exact: false })).toBeVisible();
  for (const sent of selfTurn.filter((line) => line.kind === "sent")) {
    await expect(작업패널(page).getByText((sent.payload as { text: string }).text, { exact: true })).toHaveCount(1);
  }
  await expect(단추(page, "멈추기")).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("스스로 이어 간 턴의 시작: 시작 표지가 오면 첫 조각 전에도 「일하는 중」이고 멈추기가 서며, ×는 닫기 전에 묻는다", async ({
  page,
}) => {
  const claude = selfClaude("c-self-start-claude");
  await openChat(page, linesThrough(selfTurn, SECOND_END), claude);
  await expect(머리줄(page, "8초 동안 작업함")).toBeVisible();
  await expect(대화탭(page, "Claude")).toBeVisible();

  // 백그라운드 작업이 끝나 에이전트가 스스로 턴을 열었다 — 조각은 아직 없다(three-axes 티켓 16 · S4).
  await streamLines(page, plainWork.slug, claude.id, linesThrough(linesAfter(selfTurn, SECOND_END), SELF_STARTED));
  await expect(대화탭(page, "Claude — 일하는 중")).toBeVisible();
  await expect(단추(page, "멈추기")).toBeVisible();
  await 대화탭줄(page).getByRole("button", { name: "Claude 닫기", exact: true }).click();
  const 닫기창 = page.getByRole("alertdialog", { name: "대화 닫기", exact: true });
  await expect(닫기창).toHaveAccessibleDescription("에이전트가 일하는 중이에요 — 닫으면 그 턴이 끊겨요. 닫을까요?");
  await 닫기창.getByRole("button", { name: "취소", exact: true }).click();
  expect(await ipcCallArgs(page, "chat_close", "work")).toEqual([]);

  // 첫 조각과 턴 밖 끝 — 같은 턴에 붙고, 끝나면 「스스로 이어 감」 머리줄이다.
  await streamLines(page, plainWork.slug, claude.id, linesAfter(selfTurn, SELF_STARTED));
  await expect(머리줄(page, "14초 동안 작업함")).toBeVisible();
  await expect(작업패널(page).getByText("스스로 이어 감", { exact: true })).toHaveCount(1);
  await expect(대화탭(page, "Claude")).toBeVisible();
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

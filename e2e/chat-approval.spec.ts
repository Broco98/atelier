import { expect, test, type Page } from "./evidence";

import type { Conversation, RecordLine } from "@/features/chat/types";
import { WORKS } from "./fixtures";
import { ipcCallArgs, unknownIpcCalls } from "./harness";
import { conversationRow, handToolTurn, linesAfter, linesThrough, record, streamLines } from "./chat-records";
import { countAnnouncements, openWorkChat, 대화탭줄, 레일칸, 입력칸, 작업패널 } from "./chat-screen";

// three-axes 티켓 21 — **승인 카드와 계획 카드가 입력창 자리에 선다**(스토리 57 · 58 · 59 · 61 · 62 · 65 · 66 · 67 · 120).
//
// 자료는 L1이 남긴 기록이다(S26): 「권한」(티켓 08 — 워크트리 밖에 쓰는 명령에 권한을 묻고 「Yes, proceed」로 답한 Codex 턴),
// 「권한 거부」(같은 물음을 거부해 codex-acp가 턴을 `cancelled`로 끝낸 것), 「에이전트가 거둔 권한」 · 「권한이 걸린 채 멈춤」(같은
// 물음이 답 없이 거둬진 것 — `tests/permission.rs`), 「Codex 계획」(티켓 09 — `plan_update` 넷과 `switch_mode` 요청을 「다시
// 짜기」로 답한 것). ACP `plan`(체크리스트)은 가짜가 내지 않아 ACP 스키마 그대로 손으로 짓는다. Claude 계획 승인은 변환기가 같은
// `switch_mode` 모양으로 옮기므로 따로 쏘지 않는다.
// 재는 것은 역할 · 접근성 이름 · 보이는 글 · 나간 명령의 인자다.

const plainWork = WORKS[1];

/** 대화 탭 — 그 이름의 대화. 도는 · 기다리는 대화의 탭 이름에는 상태가 붙는다(「Codex — 나를 기다림」, three-axes 티켓 23). */
const 대화탭 = (page: Page, name: string) => 대화탭줄(page).getByRole("button", { name: new RegExp(`^${name}( — |$)`) });
/** 승인 카드 — 무엇을 묻는지(제목)를 이름으로 단 묶음이다. */
const 카드 = (page: Page, title: string) => 작업패널(page).getByRole("group", { name: title, exact: true });
const 머리줄 = (page: Page, name: string) => 작업패널(page).getByRole("button", { name, exact: true });

type Asked = { state: "asked"; requestId: string; request: { options: { optionId: string; name: string; kind: string }[] } };
const askedOf = (lines: readonly RecordLine[]) => {
  const line = lines.find((one) => one.kind === "permission" && (one.payload as Asked).state === "asked")!;
  return { seq: line.seq, line, payload: line.payload as Asked };
};

/** 그 work의 대화창을 연다 — 대화 목록은 `row` 하나, 기록 읽기는 `read`다. 입력칸 대신 카드가 서 있을 수 있어 대화 탭을 기다린다. */
const openChat = (page: Page, row: Conversation, read: readonly RecordLine[]): Promise<void> =>
  openWorkChat(page, [row], { [row.id]: read }, { ready: (page) => 대화탭(page, row.name) });

const permission = record("permission");
const asked = askedOf(permission);
const COMMAND = "printf 'g2' > /tmp/fake-outside/g2.txt";
const permissionCodex = conversationRow({ id: "c-perm-codex", agent: "codex", name: "Codex", lastSeq: asked.seq - 1 });

test("승인 카드: 권한 줄이 오면 입력창 자리에 승인 카드가 서서 무엇을 하려는지와 기록의 선택지를 그대로 보이고, 고르면 그 요청 id · 선택지 id로 권한 답이 가고, 답 줄이 오면 걷힌다", async ({
  page,
}) => {
  await openChat(page, permissionCodex, linesThrough(permission, asked.seq - 1));
  await expect(입력칸(page)).toBeVisible();

  // 권한 줄 — 입력칸 대신 승인 카드가 선다. 무엇을 하려는지: 도구(터미널) · 에이전트 · 명령.
  await streamLines(page, plainWork.slug, permissionCodex.id, [asked.line]);
  const card = 카드(page, "이 명령을 실행하도록 허용할까요?");
  await expect(card).toBeVisible();
  await expect(입력칸(page)).toHaveCount(0);
  await expect(card).toContainText("터미널 · Codex");
  await expect(card).toContainText(COMMAND);
  // 선택지는 엔진이 준 그대로 — 이름 글자 그대로 하나씩 선다.
  for (const option of asked.payload.request.options) {
    await expect(card.getByRole("button", { name: option.name, exact: true })).toBeVisible();
  }

  // 고르면 권한 답 — 기록의 요청 id와 고른 선택지 id가 간다.
  await card.getByRole("button", { name: "Yes, proceed", exact: true }).click();
  expect((await ipcCallArgs(page, "chat_answer_permission", "work")).map(({ args }) => args)).toEqual([
    { work: plainWork.slug, conversation: permissionCodex.id, request: "0", option: "allow_once" },
  ]);

  // 답 줄이 오면 카드가 걷히고 입력칸이 돌아온다. 턴은 이어 간다.
  await streamLines(page, plainWork.slug, permissionCodex.id, linesAfter(permission, asked.seq));
  await expect(card).toHaveCount(0);
  await expect(입력칸(page)).toBeVisible();
  await expect(머리줄(page, "10초 동안 작업함")).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** 그 기록의 권한 거둬짐 줄 — 걸린 요청이 답 없이 닫힌 자리다. */
const withdrawnOf = (lines: readonly RecordLine[]) =>
  lines.find((line) => line.kind === "permission" && (line.payload as { state: string }).state === "withdrawn")!.seq;

// L1이 남긴 「에이전트가 거둔 권한」(S26) — 물음 · 답을 기다리는 동안의 생각 둘 뒤에 에이전트가 답을 기다리지 않고 요청을 거두고
// (`withdrawn` · `agent`) 턴을 끝냈다.
const agentWithdrew = record("permission-withdrawn");
const AGENT_WITHDREW = withdrawnOf(agentWithdrew);

test("승인 카드: 에이전트가 답을 기다리지 않고 턴을 끝내 거둬짐 줄이 오면 걷히고 입력칸이 돌아온다", async ({ page }) => {
  const row = conversationRow({ id: "c-withdrawn-codex", agent: "codex", name: "Codex", lastSeq: AGENT_WITHDREW - 1 });
  await openChat(page, row, linesThrough(agentWithdrew, AGENT_WITHDREW - 1));
  const card = 카드(page, "이 명령을 실행하도록 허용할까요?");
  await expect(card).toBeVisible();
  await expect(입력칸(page)).toHaveCount(0);
  // 에이전트가 거둔 요청(`withdrawn` · `agent`) — 카드가 걷히고 입력칸이 돌아온다.
  await streamLines(page, plainWork.slug, row.id, linesThrough(linesAfter(agentWithdrew, AGENT_WITHDREW - 1), AGENT_WITHDREW));
  await expect(card).toHaveCount(0);
  await expect(입력칸(page)).toBeVisible();
  expect(await ipcCallArgs(page, "chat_answer_permission", "work")).toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// L1이 남긴 「권한이 걸린 채 멈춤」(S26) — 같은 물음이 걸린 동안 멈추기가 갔다: 호스트가 그 요청을 거두고(`withdrawn` · `stopped`)
// 턴이 우리의 멈춤으로 끝났다.
const stopWithdrew = record("permission-stopped");
const STOP_WITHDREW = withdrawnOf(stopWithdrew);

test("승인 카드: 입력칸이 카드에 자리를 내주므로 카드가 멈추기를 들고, 누르면 멈추기 명령이 가고, 멈춤으로 거둬짐 줄과 멈춘 턴 끝이 오면 걷힌다", async ({
  page,
}) => {
  const row = conversationRow({ id: "c-stopped-codex", agent: "codex", name: "Codex", lastSeq: STOP_WITHDREW - 1 });
  await openChat(page, row, linesThrough(stopWithdrew, STOP_WITHDREW - 1));
  const card = 카드(page, "이 명령을 실행하도록 허용할까요?");
  await expect(card).toBeVisible();
  await card.getByRole("button", { name: "멈추기", exact: true }).click();
  expect((await ipcCallArgs(page, "chat_stop", "work")).map(({ args }) => args)).toEqual([
    { work: plainWork.slug, conversation: row.id },
  ]);
  // 호스트가 그 요청을 거두고(`stopped`) 턴이 우리의 멈춤으로 끝난다 — 카드가 걷히고 「N초 후에 중단했습니다」다.
  await streamLines(page, plainWork.slug, row.id, linesAfter(stopWithdrew, STOP_WITHDREW - 1));
  await expect(card).toHaveCount(0);
  await expect(입력칸(page)).toBeVisible();
  await expect(머리줄(page, "8초 후에 중단했습니다")).toBeVisible();
  expect(await ipcCallArgs(page, "chat_answer_permission", "work")).toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

const deny = record("permission-deny");
const denyAsked = askedOf(deny);
const denyCodex = conversationRow({ id: "c-deny-codex", agent: "codex", name: "Codex", lastSeq: denyAsked.seq });

test("Codex 거부의 머리줄(S24): 승인 카드에서 거부하면 그 선택지 id가 가고, 우리가 멈추지 않은 `cancelled`로 끝난 턴은 「거부해서 멈췄어요」다", async ({
  page,
}) => {
  await openChat(page, denyCodex, linesThrough(deny, denyAsked.seq));
  const card = 카드(page, "이 명령을 실행하도록 허용할까요?");
  const reject = denyAsked.payload.request.options.find((option) => option.kind === "reject_once")!;
  await card.getByRole("button", { name: reject.name, exact: true }).click();
  expect((await ipcCallArgs(page, "chat_answer_permission", "work")).map(({ args }) => args)).toEqual([
    { work: plainWork.slug, conversation: denyCodex.id, request: "0", option: "cancel" },
  ]);

  // 거부 → codex-acp가 도구를 `failed`로 닫고 턴을 `cancelled`로 끝낸다(실측 G2). 우리는 멈추지 않았다.
  await streamLines(page, plainWork.slug, denyCodex.id, linesAfter(deny, denyAsked.seq));
  await expect(card).toHaveCount(0);
  await expect(머리줄(page, "거부해서 멈췄어요")).toHaveAttribute("aria-expanded", "false");
  await expect(작업패널(page).getByRole("button", { name: /후에 중단했습니다/ })).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 「Codex 계획」 — 열림 · 명령 목록 · 계획 켬(config) · 보낸 말(6) · 답 조각 · `plan_update` 넷(매번 전문) · `switch_mode` 물음 ·
// 「다시 짜기」 답 · 그 도구의 `completed` · 턴 끝 · 명령 목록.
const plan = record("codex-plan");
const updateKind = (line: RecordLine) =>
  line.kind === "update" ? (line.payload as { update?: { sessionUpdate?: string } }).update?.sessionUpdate : undefined;
const PLAN_SEQS = plan.filter((line) => updateKind(line) === "plan_update").map((line) => line.seq);
const planAsked = askedOf(plan);
const planCodex = conversationRow({ id: "c-plan-codex", agent: "codex", name: "Codex", lastSeq: PLAN_SEQS[0] - 1, plan: true });
/** 계획 카드 — 머리에 「계획」을 단 묶음이다. */
const 계획카드 = (page: Page) => 작업패널(page).getByRole("group", { name: "계획", exact: true });

test("계획 카드: `plan_update`의 마크다운이 계획 카드로 서고, 다음 `plan_update`는 새 카드 없이 같은 카드를 새 계획으로 바꾼다", async ({
  page,
}) => {
  await openChat(page, planCodex, linesThrough(plan, PLAN_SEQS[0] - 1));
  await expect(계획카드(page)).toHaveCount(0);

  // 첫 `plan_update` — 마크다운 그대로 카드가 선다: 제목과 번호 목록.
  await streamLines(page, plainWork.slug, planCodex.id, linesThrough(linesAfter(plan, PLAN_SEQS[0] - 1), PLAN_SEQS[0]));
  const card = 계획카드(page);
  await expect(card).toBeVisible();
  await expect(card.getByRole("heading", { name: "Add hello.txt", exact: true })).toBeVisible();
  await expect(card.getByRole("listitem")).toHaveText(["Create"]);

  // 뒤의 `plan_update` 셋 — 카드는 하나 그대로이고 글이 새 계획으로 바뀐다.
  await streamLines(page, plainWork.slug, planCodex.id, linesThrough(linesAfter(plan, PLAN_SEQS[0]), PLAN_SEQS[3]));
  await expect(card.getByRole("listitem")).toHaveText([
    "Create a repo-root file named hello.txt containing hi.",
    "Verify the file contains exactly hi.",
  ]);
  await expect(계획카드(page)).toHaveCount(1);
  // 계획은 흐름의 답 글로 섞이지 않는다 — 계획의 글은 카드 안에만 있다.
  await expect(작업패널(page).getByText("Verify the file contains exactly", { exact: false })).toHaveCount(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("「이 계획대로 할까요?」: `switch_mode` 권한 요청은 승인 카드 대신 이 카드로 서서 엔진의 두 선택지를 구현 · 다시 짜기로 보이고, 고른 선택지 id가 가고, 답한 뒤에도 계획 카드는 접힌 턴에 남는다", async ({
  page,
}) => {
  await openChat(page, { ...planCodex, lastSeq: planAsked.seq - 1 }, linesThrough(plan, planAsked.seq - 1));
  await expect(입력칸(page)).toBeVisible();

  await streamLines(page, plainWork.slug, planCodex.id, [planAsked.line]);
  const card = 카드(page, "이 계획대로 할까요?");
  await expect(card).toBeVisible();
  await expect(입력칸(page)).toHaveCount(0);
  await expect(card).toContainText("Codex · 계획 모드");
  // 보통 승인 카드가 아니다 — 명령을 묻는 제목도, 엔진의 영어 이름도 서지 않는다. 선택지는 엔진의 둘 그대로다(차례도).
  await expect(카드(page, "이 명령을 실행하도록 허용할까요?")).toHaveCount(0);
  const options = planAsked.payload.request.options;
  expect(options.map((option) => option.optionId)).toEqual(["implement_plan", "revise_plan"]);
  await expect(card.getByRole("button", { name: /구현|다시 짜기/ })).toHaveText(["다시 짜기", "구현"]);
  // 계획 본문은 흐름의 계획 카드에 있다 — 카드는 하나 그대로다.
  await expect(계획카드(page)).toHaveCount(1);

  await card.getByRole("button", { name: "다시 짜기", exact: true }).click();
  expect((await ipcCallArgs(page, "chat_answer_permission", "work")).map(({ args }) => args)).toEqual([
    { work: plainWork.slug, conversation: planCodex.id, request: "0", option: "revise_plan" },
  ]);

  // 답 → 그 「도구」의 `completed` → 턴 끝. 카드가 걷히고, 계획을 받아들인 「도구」는 도구 줄로 서지 않는다. 계획 카드는 접힌
  // 턴에 남아 무엇을 고칠지 말할 때 다시 읽힌다.
  await streamLines(page, plainWork.slug, planCodex.id, linesAfter(plan, planAsked.seq));
  await expect(card).toHaveCount(0);
  await expect(입력칸(page)).toBeVisible();
  await expect(머리줄(page, "9초 동안 작업함")).toHaveAttribute("aria-expanded", "false");
  await expect(계획카드(page)).toBeVisible();
  await 머리줄(page, "9초 동안 작업함").click();
  await expect(작업패널(page).getByRole("group", { name: /사용함|모드 바꿈|도구/ })).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

const 체크리스트 = (page: Page) => 작업패널(page).getByRole("list", { name: "계획 체크리스트", exact: true });

test("계획 체크리스트: 엔진이 ACP `plan`을 보내지 않으면 체크리스트 칸이 없고, 보내면 그 항목과 상태로 서며 다음 `plan`이 같은 칸을 바꾼다", async ({
  page,
}) => {
  // 「Codex 계획」 한 판 전체 — 계획 카드와 계획 승인은 있지만 ACP `plan`은 없다(실측 A2: 모델이 `update_plan`을 부르지 않았다).
  await openChat(page, { ...planCodex, lastSeq: plan[plan.length - 1].seq }, plan);
  await expect(계획카드(page)).toBeVisible();
  await expect(체크리스트(page)).toHaveCount(0);

  // 엔진이 `plan`을 보낸 턴(ACP 스키마의 꼴 — 올 때마다 목록 전체) — 손으로 짓는다. 두 번 오고 둘째가 첫째를 바꾼다.
  const step = (content: string, status: string) => ({ content, status, priority: "medium" });
  const turn = handToolTurn(
    plan[plan.length - 1].seq + 1,
    "이제 구현해 줘",
    [
      { sessionUpdate: "plan", entries: [step("hello.txt 만들기", "in_progress"), step("내용 확인", "pending")] },
      { sessionUpdate: "plan", entries: [step("hello.txt 만들기", "completed"), step("내용 확인", "in_progress")] },
    ],
    "만들었어요.",
    4000,
  );
  const [sent, first, second, ...rest] = turn;
  await streamLines(page, plainWork.slug, planCodex.id, [sent, first]);
  await expect(체크리스트(page).getByRole("listitem")).toHaveText(["hello.txt 만들기 · 하는 중", "내용 확인 · 남음"]);
  await streamLines(page, plainWork.slug, planCodex.id, [second]);
  await expect(체크리스트(page)).toHaveCount(1);
  await expect(체크리스트(page).getByRole("listitem")).toHaveText(["hello.txt 만들기 · 끝남", "내용 확인 · 하는 중"]);
  await streamLines(page, plainWork.slug, planCodex.id, rest);
  await expect(머리줄(page, "4초 동안 작업함")).toBeVisible();
  await expect(체크리스트(page)).toHaveCount(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("접근성(스토리 120): 승인 카드가 서면 알림 영역에 알림이 한 번 선다 — 카드가 묻는 말과 무엇을 하려는지를 말한다", async ({ page }) => {
  await openChat(page, permissionCodex, linesThrough(permission, asked.seq - 1));
  const announced = await countAnnouncements(page);
  await streamLines(page, plainWork.slug, permissionCodex.id, [asked.line]);
  const card = 카드(page, "이 명령을 실행하도록 허용할까요?");
  await expect(card).toBeVisible();
  // 카드 자신은 알림 영역이 아니다 — 대화창 밖 알림 자리 한 곳이 읽는다(작업 패널 · `chat` 탭에 같은 카드가 서도 한 번이다).
  expect(await card.evaluate((el) => el.closest('[aria-live], [role="status"], [role="alert"], [role="log"]'))).toBeNull();
  await expect.poll(announced).toHaveLength(1);
  expect((await announced())[0]).toBe(`Codex · 이 명령을 실행하도록 허용할까요? — ${COMMAND}`);

  // 다시 그려도(패널 칸을 오가도) 다시 알리지 않는다.
  await 레일칸(page, "spec").click();
  await 레일칸(page, "chat").click();
  await expect(card).toBeVisible();
  expect(await announced()).toHaveLength(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

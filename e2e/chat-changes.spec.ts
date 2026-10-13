import { expect, test, type Page } from "./evidence";

import type { RecordLine } from "@/features/chat/types";
import type { WorkView } from "@/features/works/types";
import { answerByArg } from "./fixtures";
import { installFixtureBackend, unknownIpcCalls } from "./harness";
import { cartWork, conversationRow, linesAfter, linesThrough, record, specCopy, streamLines, treeOf } from "./chat-records";
import { 대화탭, 레일칸, 입력칸, 작업패널 } from "./chat-screen";

// three-axes 티켓 26 — **고친 곳이 스펙 창 · 트리 · 레일 · 알약에 선다.**
//
// 자료는 L1이 남긴 「고친 곳」 기록(S26, 티켓 06)이다 — 가짜 에이전트가 턴 도중 spec에 새 문서를 쓰고(`drafts/idea.md`) ·
// 고치고(`plan.md` · `notes.txt`) · 지운(`old.md`) 뒤, 호스트가 턴 앞뒤를 견줘 `changes` 줄을 `turn-end` 바로 앞에 적었다. 바뀐 줄
// 범위는 새 글 기준이라 화면이 읽는 본문은 L1이 함께 남긴 그 턴 뒤의 spec 폴더(`changes.spec/`) 그대로다. 표시는 접근성 이름과
// data 속성으로 잰다 — 클래스 문자열(색)은 재지 않는다.

const changes = record("changes");
const spec = specCopy("changes");
const CHANGES_SEQ = changes.find((line) => line.kind === "changes")!.seq;
const SENT_SEQ = changes.find((line) => line.kind === "sent")!.seq;


/** 기록의 머리말이 말하는 work — slug `cart`. 기본 문서는 고치지 않은 `keep.md`다. */
const cart = cartWork(spec, "keep.md");

/** 그 work에 이미 선 Codex 대화 — 기록 읽기는 보낸 말 앞(열림 줄)까지를 답한다. */
const codex = conversationRow({ id: "c-cart-codex", agent: "codex", name: "Codex", lastSeq: SENT_SEQ - 1 });

const 문서 = (page: Page) => page.getByRole("main", { name: "문서", exact: true });
/** 스펙 창의 고친 곳 — 표시가 선 블록. 블록마다 원문의 시작 줄(`data-src-start`)을 든다. */
const 고친곳 = (page: Page) => 문서(page).locator("[data-changed]");

/** cart를 `file`로 열고 작업 패널을 `chat`으로 연다 — 대화 목록은 `codex` 하나다. */
async function openCart(page: Page, file: string): Promise<void> {
  await installFixtureBackend(page, {
    list_works: [cart],
    read_spec_file: answerByArg("path", spec.bodies),
    chat_list: answerByArg("work", { [cart.slug]: [codex] }, { otherwise: [] }),
    chat_read_record: answerByArg("conversation", { [codex.id]: linesThrough(changes, SENT_SEQ - 1) }),
  });
  await page.goto(`/works/${cart.slug}?file=${encodeURIComponent(file)}`);
  await expect(문서(page).getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
  await 레일칸(page, "chat").click();
  await expect(입력칸(page)).toBeVisible();
}

test("스펙 창: 턴이 도는 동안은 새 내용을 다시 읽기만 하고, `changes` 줄이 오면 고친 범위에 걸린 블록에만 표시가 선다", async ({
  page,
}) => {
  await openCart(page, "plan.md");
  // 턴이 돈다 — 도구 줄들이 plan.md를 고치는 동안 표시는 서지 않는다(스토리 76).
  const turn = linesAfter(changes, SENT_SEQ - 1);
  await streamLines(page, cart.slug, codex.id, linesThrough(turn, CHANGES_SEQ - 1));
  await expect(문서(page).getByText("첫 문단을 고쳤다.", { exact: false })).toBeVisible();
  await expect(고친곳(page)).toHaveCount(0);

  // `changes` 줄 → plan.md의 바뀐 범위(3–4 · 9)에 걸린 블록 둘: 고친 문단(3–4줄)과 목록(8–9줄). 제목(1) · 소제목(6)은 아니다.
  await streamLines(page, cart.slug, codex.id, linesAfter(turn, CHANGES_SEQ - 1));
  await expect(고친곳(page)).toHaveCount(2);
  expect(await 고친곳(page).evaluateAll((all) => all.map((el) => el.getAttribute("data-src-start")))).toEqual(["3", "8"]);
  await expect(고친곳(page).first()).toContainText("요약 한 줄.");
  await expect(고친곳(page).nth(1)).toContainText("둘을 고쳤다.");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** 그 work에 함께 선 Claude 대화 — 기록이 비었다(쉬는 대화). */
const claude = conversationRow({ id: "c-cart-claude", agent: "claude", name: "Claude" });

/**
 * 손으로 짓는 한 턴 — 보낸 말 · `changes` · 턴 끝. 꼴은 L1 기록과 같고 seq는 `from`부터 오른다. `changes`의 payload는 L1 기록의
 * 그것이 기본이다(같은 고친 곳을 한 턴 더).
 */
function turnWithSameChanges(
  from: number,
  payload: unknown = changes.find((line) => line.kind === "changes")!.payload,
): RecordLine[] {
  const at = (n: number) => `2026-10-10T11:00:${String(n).padStart(2, "0")}.000+09:00`;
  return [
    { seq: from, at: at(0), kind: "sent", payload: { text: "한 번 더", prompt: [{ type: "text", text: "한 번 더" }], sendNow: false } },
    { seq: from + 1, at: at(1), kind: "changes", payload },
    {
      seq: from + 2,
      at: at(2),
      kind: "turn-end",
      payload: { stopReason: "end_turn", durationMs: 2000, cancelledByUs: false, outOfTurn: false },
    },
  ];
}

test("지우기: 사람이 다음 말을 보내면 표시가 지워진다 — 같은 대화에서도, 같은 work의 다른 대화에서 보내도", async ({ page }) => {
  await installFixtureBackend(page, {
    list_works: [cart],
    read_spec_file: answerByArg("path", spec.bodies),
    chat_list: answerByArg("work", { [cart.slug]: [codex, claude] }, { otherwise: [] }),
    chat_read_record: answerByArg("conversation", { [codex.id]: linesThrough(changes, SENT_SEQ - 1), [claude.id]: [] }),
  });
  await page.goto(`/works/${cart.slug}?file=plan.md`);
  await expect(문서(page).getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
  await 레일칸(page, "chat").click();
  await expect(대화탭(page, "Codex")).toHaveAttribute("aria-pressed", "true");

  // 같은 대화에서 다음 말을 보낸다 — 보내는 순간 지운다.
  await streamLines(page, cart.slug, codex.id, linesAfter(changes, SENT_SEQ - 1));
  await expect(고친곳(page)).toHaveCount(2);
  await 입력칸(page).fill("목록도 다듬어 줘");
  await 입력칸(page).press("Enter");
  await expect(고친곳(page)).toHaveCount(0);

  // 그 턴이 또 고쳤다 — 표시가 다시 선다. 이번에는 같은 work의 **다른 대화**(Claude)에서 보낸다. 표시는 work의 것이다(S19).
  await streamLines(page, cart.slug, codex.id, turnWithSameChanges(changes.length + 1));
  await expect(고친곳(page)).toHaveCount(2);
  await 대화탭(page, "Claude").click();
  await expect(대화탭(page, "Claude")).toHaveAttribute("aria-pressed", "true");
  await 입력칸(page).fill("요약해 줘");
  await 입력칸(page).press("Enter");
  await expect(고친곳(page)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/** 트리의 파일 행 — 이름 버튼(확장자 꼬리표 + 이름). 점은 그 버튼의 설명(`aria-description`)이 말한다. */
const 트리행 = (page: Page, name: string) => 작업패널(page).getByRole("button", { name, exact: true });
const 안연점 = "고쳐졌는데 아직 열지 않았어요";
const 레일점 = "고쳐졌는데 아직 열지 않은 파일이 있어요";

test("트리 · 레일: 열지 않은 고친 파일에 트리 점과 레일 `spec` 점이 서고, 그 파일을 열면 지워진다", async ({ page }) => {
  // 기본 문서(고치지 않은 keep.md)를 보며 대화한다.
  await installFixtureBackend(page, {
    list_works: [cart],
    read_spec_file: answerByArg("path", spec.bodies),
    chat_list: answerByArg("work", { [cart.slug]: [codex] }, { otherwise: [] }),
    chat_read_record: answerByArg("conversation", { [codex.id]: linesThrough(changes, SENT_SEQ - 1) }),
  });
  await page.goto(`/works/${cart.slug}`);
  await expect(문서(page).getByRole("heading", { name: "그대로 둘 문서" })).toBeVisible({ timeout: 20_000 });
  await 레일칸(page, "chat").click();
  await expect(레일칸(page, "spec")).not.toHaveAttribute("aria-description");

  // 턴이 끝났다 — 고친 파일 셋(새 문서 idea.md · 고친 notes.txt · plan.md)이 아직 안 열렸다. 트리가 안 보이니 레일 `spec`에 점이 선다.
  await streamLines(page, cart.slug, codex.id, linesAfter(changes, SENT_SEQ - 1));
  await expect(레일칸(page, "spec")).toHaveAttribute("aria-description", 레일점);

  // 트리를 연다 — 고친 파일 행에 점이 선다. 고치지 않은 keep.md와 지운 old.md(트리에 없다)는 아니다. 트리가 보이는 동안 레일 점은 걷힌다.
  await 레일칸(page, "spec").click();
  await expect(트리행(page, "MD idea.md")).toHaveAttribute("aria-description", 안연점);
  await expect(트리행(page, "TXT notes.txt")).toHaveAttribute("aria-description", 안연점);
  await expect(트리행(page, "MD plan.md")).toHaveAttribute("aria-description", 안연점);
  await expect(트리행(page, "MD keep.md")).not.toHaveAttribute("aria-description");
  await expect(레일칸(page, "spec")).not.toHaveAttribute("aria-description");

  // plan.md를 연다 — 그 행의 점만 지워진다. 대화창으로 돌아가면 아직 안 연 파일이 남아 레일 점이 그대로다.
  await 트리행(page, "MD plan.md").click();
  await expect(문서(page).getByRole("heading", { name: "계획" })).toBeVisible();
  await expect(트리행(page, "MD plan.md")).not.toHaveAttribute("aria-description");
  await expect(트리행(page, "MD idea.md")).toHaveAttribute("aria-description", 안연점);
  await 레일칸(page, "chat").click();
  await expect(레일칸(page, "spec")).toHaveAttribute("aria-description", 레일점);

  // 나머지 둘을 열면 레일 점도 지워진다.
  await 레일칸(page, "spec").click();
  await 트리행(page, "MD idea.md").click();
  await expect(문서(page).getByRole("heading", { name: "아이디어" })).toBeVisible();
  await 트리행(page, "TXT notes.txt").click();
  await expect(문서(page).getByText("다듬은 글")).toBeVisible();
  for (const row of ["MD idea.md", "TXT notes.txt", "MD plan.md"]) {
    await expect(트리행(page, row)).not.toHaveAttribute("aria-description");
  }
  await 레일칸(page, "chat").click();
  await expect(레일칸(page, "spec")).not.toHaveAttribute("aria-description");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

const 알약 = (page: Page) => 작업패널(page).getByRole("button", { name: /개 파일 변경됨$/ });

test("알약: 마지막 턴의 고친 파일 수를 말하고, 목록에 「새 문서」가 구별되며, 파일을 누르면 스펙 창이 그 파일을 열고, 새 턴이 시작하면 걷힌다", async ({
  page,
}) => {
  await openCart(page, "keep.md");
  const turn = linesAfter(changes, SENT_SEQ - 1);
  await streamLines(page, cart.slug, codex.id, linesThrough(turn, CHANGES_SEQ - 1));
  await expect(작업패널(page).getByText("spec을 고쳤다.", { exact: true })).toBeVisible();
  await expect(알약(page)).toHaveCount(0);

  // 턴 끝 — 이 턴의 고친 곳은 넷이다(새 문서 · 고침 둘 · 지움).
  await streamLines(page, cart.slug, codex.id, linesAfter(turn, CHANGES_SEQ - 1));
  await expect(알약(page)).toHaveText("4개 파일 변경됨");

  // 누르면 파일 목록 — 새로 생긴 문서는 「새 문서」다. 지운 문서는 열 것이 없어 고를 수 없다.
  await 알약(page).click();
  const 목록 = page.getByRole("menu");
  await expect(목록.getByRole("menuitem")).toHaveText([/^drafts\/idea\.md\s*새 문서$/, "notes.txt", /^old\.md\s*지운 문서$/, "plan.md"]);
  await expect(목록.getByRole("menuitem", { name: /old\.md/ })).toHaveAttribute("aria-disabled", "true");

  // 파일을 누르면 스펙 창이 그 파일을 첫 고친 자리(3줄)로 연다 — 문서 링크라 주소의 `file`이 바뀐다.
  await 목록.getByRole("menuitem", { name: "plan.md", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/works/${cart.slug}\\?.*file=plan\\.md`));
  await expect(문서(page).getByRole("heading", { name: "계획" })).toBeVisible();
  await expect(문서(page).locator('[data-src-start="3"]')).toBeInViewport();

  // 새 턴이 시작하면(보낸 말 줄) 마지막 턴이 바뀌어 알약이 걷힌다 — 새 턴에는 아직 고친 곳이 없다.
  await streamLines(page, cart.slug, codex.id, turnWithSameChanges(changes.length + 1).slice(0, 1));
  await expect(알약(page)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("알약: 첫 고친 자리가 문서 아래쪽이면 스펙 창이 거기까지 굴러간다", async ({ page }) => {
  // L1 자료의 문서는 짧아 다 보인다 — 같은 꼴로 손으로 지은 긴 문서와 그 고친 곳(123줄)을 쓴다.
  const paragraphs = Array.from({ length: 60 }, (_, at) => [`${at + 1}번째 문단이다.`, ""]).flat();
  const long = ["# 긴 문서", "", ...paragraphs, "끝에서 고친 문단이다.", ""].join("\n");
  const CHANGED_LINE = 3 + paragraphs.length;
  const withLong: WorkView = { ...cart, specFiles: [...spec.files, "긴.md"], specTree: { ...cart.specTree, items: treeOf([...spec.files, "긴.md"]) } };
  await installFixtureBackend(page, {
    list_works: [withLong],
    read_spec_file: answerByArg("path", { ...spec.bodies, "긴.md": long }),
    chat_list: answerByArg("work", { [cart.slug]: [codex] }, { otherwise: [] }),
    chat_read_record: answerByArg("conversation", { [codex.id]: linesThrough(changes, SENT_SEQ - 1) }),
  });
  await page.goto(`/works/${cart.slug}`);
  await expect(문서(page).getByRole("heading", { name: "그대로 둘 문서" })).toBeVisible({ timeout: 20_000 });
  await 레일칸(page, "chat").click();
  await streamLines(
    page,
    cart.slug,
    codex.id,
    turnWithSameChanges(SENT_SEQ, { files: [{ path: "긴.md", change: "modified", lines: [{ start: CHANGED_LINE, end: CHANGED_LINE }] }] }),
  );
  await 알약(page).click();
  await page.getByRole("menu").getByRole("menuitem", { name: "긴.md", exact: true }).click();
  await expect(문서(page).getByRole("heading", { name: "긴 문서" })).toBeAttached();
  const 고친문단 = 문서(page).locator(`[data-src-start="${CHANGED_LINE}"]`);
  await expect(고친문단).toHaveAttribute("data-changed", "");
  await expect(고친문단).toBeInViewport();
  await expect(문서(page).getByRole("heading", { name: "긴 문서" })).not.toBeInViewport();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("함께 돈 대화: `changes`가 두 대화에 모두 적혔으면 두 대화의 알약이 모두 센다", async ({ page }) => {
  await installFixtureBackend(page, {
    list_works: [cart],
    read_spec_file: answerByArg("path", spec.bodies),
    chat_list: answerByArg("work", { [cart.slug]: [codex, claude] }, { otherwise: [] }),
    chat_read_record: answerByArg("conversation", { [codex.id]: linesThrough(changes, SENT_SEQ - 1), [claude.id]: [] }),
  });
  await page.goto(`/works/${cart.slug}?file=plan.md`);
  await expect(문서(page).getByRole("heading", { level: 1 })).toBeVisible({ timeout: 20_000 });
  await 레일칸(page, "chat").click();
  await expect(대화탭(page, "Codex")).toHaveAttribute("aria-pressed", "true");

  // Claude가 먼저 말을 받아 돌고, 그동안 Codex가 spec을 고치고 끝낸다. Claude의 턴 끝 비교에도 그 고침이 든다(three-axes 결정 22).
  const claudeTurn = turnWithSameChanges(1);
  await streamLines(page, cart.slug, claude.id, claudeTurn.slice(0, 1));
  await streamLines(page, cart.slug, codex.id, linesAfter(changes, SENT_SEQ - 1));
  await streamLines(page, cart.slug, claude.id, claudeTurn.slice(1));

  await expect(알약(page)).toHaveText("4개 파일 변경됨");
  // Codex를 보는 동안 Claude의 턴이 끝났다 — 그 탭은 「끝남」이고(three-axes 티켓 23), 보면 걷힌다.
  await 대화탭(page, "Claude — 끝남").click();
  await expect(대화탭(page, "Claude")).toHaveAttribute("aria-pressed", "true");
  await expect(알약(page)).toHaveText("4개 파일 변경됨");
  // 표시는 work의 것 하나다 — 두 줄이 같은 범위를 적어도 블록은 둘 그대로다.
  await expect(고친곳(page)).toHaveCount(2);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

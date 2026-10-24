import { expect, test, type Page } from "./evidence";

import { answerByArg, FIXTURE_HOST, FIXTURE_THREAD } from "./fixtures";
import { installFixtureBackend, ipcCallArgs, replaceAnswer, unknownIpcCalls } from "./harness";
import { fireSummary, linesAfter, linesThrough, record, sentPayloads, seqOf, streamLines, summaryOf } from "./thread-records";
import type { AgentRoster, Participant, ThreadView } from "@/features/thread/types";

// v1 티켓 21(PR ② e2e) 흐름 하나 — **입력창의 @ 메뉴로 Agent를 부르면 그 Agent가 Thread에 들어와 답하고, 얼굴 · 이름 줄로 누가
// 말하는지 보인다**(v1 티켓 13 · 14 · 19 · 구현 스펙 §5 · §14 · 경계 ② 「@ 메뉴」 · 「Thread」).
//
// 줄은 L1이 축복한 「@멘션한 리뷰어가 들어와 답한다」(`thread-mention.jsonl`)를 그대로 쏜다 — Host가 한 턴 답한 뒤 사람이
// `@reviewer`에게 말하면, 리뷰어가 들어오고(`joined`, 얼굴 · 이름 실음) 새 Session으로 한 턴 답한다. 보낼 글도 그 기록의 `sent`
// 줄에서 읽는다(스토리 137). 엔진이 참여자를 늘리면 목록 요약 이벤트(`thread:list`, handle 둘)가 오고 화면이 `thread_get`을 다시
// 읽는다(`hooks.ts` `putSummary`) — 이 검사는 그 답을 갈아 끼운 뒤 요약을 쏜다.

const mention = record("thread-mention");
const [, toReviewer] = sentPayloads(mention);
const HOST_END = seqOf(mention, "turn-end", 1);
const REVIEWER_SENT = seqOf(mention, "sent", 2);

/** 리뷰어가 들어온 뒤의 참여자 줄 — `joined` 줄의 때와 리뷰어의 Session(`fake-session-2`). */
const REVIEWER: Participant = {
  ...FIXTURE_HOST,
  handle: "reviewer",
  joinedAt: mention.find((line) => line.kind === "joined" && line.who === "reviewer")!.at,
  sessionId: "fake-session-2",
};

/** Host가 첫 턴을 마친 Thread — 이 앱에 Session이 떠 있고 기록은 Host의 턴 끝까지다. */
const answered: ThreadView = { ...FIXTURE_THREAD, live: true, lastSeq: HOST_END };
/** 리뷰어가 들어온 Thread. */
const joined: ThreadView = { ...answered, participants: [FIXTURE_HOST, REVIEWER] };

/**
 * 부를 수 있는 Agent — Library의 Host · 리뷰어와 깨진 테스터(모르는 도구). 리뷰어의 얼굴은 기본 `reviewer.md`의 것이다(초록 동그라미).
 * `path`는 화면이 경로 복사에만 쓴다.
 */
const ROSTER: AgentRoster = {
  agents: [
    {
      call: "host",
      from: "library",
      path: "/Users/tester/.atelier/library/agents/host.md",
      definition: {
        handle: "host",
        name: "Host",
        description: "다른 Agent를 부르지 않았을 때 답한다.",
        avatar: null,
        model: { prefer: null, effort: null },
        policy: { askBefore: [], forbid: [] },
      },
    },
    {
      call: "reviewer",
      from: "library",
      path: "/Users/tester/.atelier/library/agents/reviewer.md",
      definition: {
        handle: "reviewer",
        name: "리뷰어",
        description: "바뀐 코드를 읽고 리뷰한다.",
        avatar: { shape: "circle", color: "green" },
        model: { prefer: null, effort: null },
        policy: { askBefore: [], forbid: [] },
      },
    },
  ],
  broken: [
    {
      call: "tester",
      handle: "tester",
      from: "library",
      path: "/Users/tester/.atelier/library/agents/tester.md",
      problem: { kind: "unknownTool", tool: "deploy" },
    },
  ],
};

const 입력칸 = (page: Page) => page.getByRole("textbox", { name: "보낼 말", exact: true });
const 흐름 = (page: Page) => page.getByRole("main");
const 메뉴 = (page: Page) => page.getByRole("listbox", { name: "Agent 부르기", exact: true });
const 묶음 = (page: Page, section: string) => 메뉴(page).getByRole("group", { name: section, exact: true });

test("@ 메뉴가 이 Thread의 Agent를 먼저 · 깨진 Agent는 흐리게 까닭과 보이고, 고른 리뷰어에게 보내면 들어와 얼굴 · 이름 줄로 답하며, 「새 Agent 만들기」가 새 Thread를 채운다", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    thread_list: [summaryOf(answered)],
    thread_get: answerByArg("thread", { [answered.id]: answered }),
    thread_read_record: answerByArg("thread", { [answered.id]: linesThrough(mention, HOST_END) }),
    thread_mark_read: answerByArg("thread", { [answered.id]: { ...summaryOf(answered), lastRead: HOST_END } }),
    list_agents: answerByArg("work", {}, { otherwise: ROSTER }),
  });
  await page.goto(`/threads/${answered.id}`);
  // **기본 5초가 아니다** — 워커의 첫 페이지면 dev 서버가 첫 화면을 처음 변환하는 것을 기다린다.
  await expect(흐름(page).getByText("hello from turn", { exact: true })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("img", { name: "참여자 Host", exact: true })).toBeVisible();

  // @ 메뉴 — 이 Thread에 있는 Agent(Host)가 먼저, 그 아래 Library다. 깨진 테스터는 고를 수 없고 그 까닭이 설명 자리에 선다.
  await 입력칸(page).pressSequentially("@");
  await expect(메뉴(page)).toBeVisible();
  await expect(메뉴(page).getByRole("group").first()).toHaveAttribute("aria-label", "이 Thread에 있음");
  await expect(묶음(page, "이 Thread에 있음").getByRole("option")).toHaveText([/^Host/]);
  const 테스터 = 묶음(page, "Library").getByRole("option", { name: "tester", exact: true });
  await expect(묶음(page, "Library").getByRole("option")).toHaveText([/^리뷰어@reviewer/, /^tester@tester모르는 도구가 있어요: deploy$/]);
  await expect(테스터).toHaveAttribute("aria-disabled", "true");
  await expect(테스터).toHaveAccessibleDescription("모르는 도구가 있어요: deploy");

  // 이름을 좁혀 Enter — 입력칸에 `@reviewer `가 들고, 나머지 말을 이어 쓴다. 받는 이는 첫 멘션이다(엔진 `first_mention`과 같다).
  await 입력칸(page).pressSequentially("rev");
  await expect(메뉴(page).getByRole("option", { name: "리뷰어", exact: true })).toHaveAttribute("aria-selected", "true");
  await 입력칸(page).press("Enter");
  await expect(메뉴(page)).toHaveCount(0);
  await expect(입력칸(page)).toHaveValue("@reviewer ");
  await 입력칸(page).pressSequentially(toReviewer.text.slice("@reviewer ".length));
  await 입력칸(page).press("Enter");
  expect((await ipcCallArgs(page, "thread_send", "text")).map(({ args }) => args)).toEqual([
    { thread: answered.id, text: toReviewer.text, attachments: [], quote: null },
  ]);

  // 엔진이 리뷰어를 앉혔다 — 참여자가 둘인 요약이 오면 머리 줄의 얼굴이 둘이 된다. 들어옴 줄과 보낸 말이 서고, 아직 답이 없으니
  // 「리뷰어가 답하는 중」이다.
  await replaceAnswer(page, "thread_get", answerByArg("thread", { [joined.id]: joined }));
  await replaceAnswer(page, "thread_mark_read", answerByArg("thread", { [joined.id]: summaryOf(joined) }));
  await streamLines(page, answered.id, linesThrough(linesAfter(mention, HOST_END), REVIEWER_SENT));
  await fireSummary(page, joined);
  await expect(page.getByRole("img", { name: "참여자 Host, 리뷰어", exact: true })).toBeVisible();
  await expect(흐름(page).locator('[data-system="joined"]')).toHaveText("리뷰어가 참여함");
  await expect(흐름(page).getByText(toReviewer.text, { exact: true })).toBeVisible();
  await expect(흐름(page).locator("[data-answering]")).toHaveText("리뷰어가 답하는 중");

  // 리뷰어의 답 — 이름 줄(얼굴 · 「리뷰어」 · `@reviewer` · 시각)이 서고 그 아래 답이다. 턴이 끝나면 「답하는 중」이 걷힌다. 말풍선의
  // 멘션도 `@reviewer` 글이라 이름 줄은 시각이 있는 턴으로 가른다.
  await streamLines(page, answered.id, linesAfter(mention, REVIEWER_SENT));
  await expect(흐름(page).locator("[data-answering]")).toHaveCount(0);
  const 답한턴 = 흐름(page).locator("[data-turn]").filter({ has: page.locator("time") });
  await expect(답한턴).toHaveCount(2);
  await expect(답한턴.nth(1).getByText("@reviewer", { exact: true })).toBeVisible();
  await expect(답한턴.nth(1).getByText("리뷰어", { exact: true })).toBeVisible();
  await expect(답한턴.nth(1).getByText("hello from turn", { exact: true })).toBeVisible();
  // Host의 이름 줄에는 `@handle`이 없다.
  await expect(답한턴.nth(0).getByText("Host", { exact: true })).toBeVisible();
  await expect(답한턴.nth(0).getByText("@host", { exact: true })).toHaveCount(0);

  // 다시 연 @ 메뉴 — 앉은 리뷰어가 「이 Thread에 있음」으로 올라오고 Library 묶음에는 남은 깨진 줄만 선다.
  await 입력칸(page).pressSequentially("@");
  await expect(묶음(page, "이 Thread에 있음").getByRole("option")).toHaveText([/^Host/, /^리뷰어@reviewer/]);
  await expect(묶음(page, "Library").getByRole("option")).toHaveText([/^tester/]);

  // 끝 줄 「새 Agent 만들기」 — 새 Thread로 가서 Agent 만들기를 맡기는 말이 입력칸에 찬다(보내지는 않는다).
  await 메뉴(page).getByRole("option", { name: "새 Agent 만들기", exact: true }).click();
  await expect(page).toHaveURL("/");
  await expect(입력칸(page)).toHaveValue("Agent를 하나 만들고 싶어");
  await expect(입력칸(page)).toBeFocused();
  expect(await ipcCallArgs(page, "thread_start", "text")).toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

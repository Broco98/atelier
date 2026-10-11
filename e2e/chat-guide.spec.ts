import { expect, test, type Page } from "./evidence";

import { CHAT_ENGINE_EVENT } from "@/features/chat/events";
import type { ChatEngineEvent, EngineCheck, RecordLine } from "@/features/chat/types";
import { answerByArg, WORKS } from "./fixtures";
import {
  clipboardWrites,
  fireEvent,
  installFixtureBackend,
  ipcCallArgs,
  recordClipboard,
  replaceAnswer,
  unknownIpcCalls,
} from "./harness";
import { conversationRow, handTurn, record, streamLines } from "./chat-records";
import { 대화탭, 레일칸, 입력칸, 작업패널 } from "./chat-screen";

// three-axes 티켓 22 — **안내 카드가 못 찾음 · 로그인 안 됨 · 로그인 중을 보이고, 끝나면 대화로 돌아간다**(three-axes 결정 24 · 30).
//
// 대화 호스트는 목업 백엔드의 답(엔진 확인)과 이 검사가 쏘는 엔진 상태 이벤트 · 기록 줄 이벤트로 선다. 엔진 상태는 L1(티켓 12)이
// 못박은 꼴 그대로 손으로 짓는다(`chat.rs`의 「엔진 상태 이벤트는 …」 · `login.rs`). 재는 것은 카드의 이름 · 보이는 글 · 나간
// 명령의 인자 · 클립보드에 쓴 값이다. 진짜 「로그인」 단추로 끝까지 가는 것(관문 G3)은 사람이 판 끝(28)에서 본다.

const [, plainWork] = WORKS;

/** 안내 카드 — 제목이 이름이다. 대화창 자리(기록 · 입력창 대신)에 선다. */
const 카드 = (page: Page, title: string) => 작업패널(page).getByRole("region", { name: title, exact: true });
const 단추 = (page: Page, title: string, name: string) => 카드(page, title).getByRole("button", { name, exact: true });

const engine = (event: ChatEngineEvent) => event;

const CODEX_MISSING: EngineCheck = {
  state: "missing",
  missing: [{ name: "codex-acp", install: "npm i -g @agentclientprotocol/codex-acp" }],
};
const CODEX_LOGGED_OUT: EngineCheck = {
  state: "found",
  programs: [
    { name: "codex-acp", path: "/opt/fixture/bin/codex-acp" },
    { name: "codex", path: "/opt/fixture/bin/codex" },
    { name: "node", path: "/opt/fixture/bin/node" },
  ],
  loggedIn: false,
};

// 「Codex 한 턴」(L1, S26) — 이미 한 턴을 끝낸 Codex 대화. 카드가 걷히면 그 기록이 그대로 다시 선다.
const codexOneTurn = record("codex-one-turn");
const codex = conversationRow({ id: "c-codex", agent: "codex", name: "Codex", lastSeq: codexOneTurn.length });

/** Codex 대화 하나가 선 work의 대화창을 연다 — 엔진 확인의 답은 `check`다. 클립보드 손잡이도 함께 깐다. */
async function openCodex(page: Page, check: EngineCheck, read: readonly RecordLine[] = codexOneTurn): Promise<void> {
  await recordClipboard(page);
  await installFixtureBackend(page, {
    chat_list: answerByArg("work", { [plainWork.slug]: [codex] }, { otherwise: [] }),
    chat_read_record: answerByArg("conversation", { [codex.id]: read }),
    chat_check_engine: answerByArg("agent", { codex: check }),
  });
  await page.goto(`/works/${plainWork.slug}`);
  await 레일칸(page, "chat").click();
  await expect(대화탭(page, "Codex")).toHaveAttribute("aria-pressed", "true");
}

test("못 찾음: 빠진 것과 설치 명령이 대화창 자리에 서고, 「명령 복사」가 설치 명령을, 「다시 확인」이 다시 읽기 표지를 싣고, 찾으면 대화로 돌아간다", async ({
  page,
}) => {
  await openCodex(page, CODEX_MISSING);
  // 대화창이 그 엔진의 대화를 처음 보일 때 엔진을 확인한다 — 다시 읽기가 아니다.
  await expect.poll(async () => (await ipcCallArgs(page, "chat_check_engine", "agent")).map(({ args }) => args)).toEqual([
    { agent: "codex", reread: false },
  ]);
  const title = "codex-acp를 찾지 못했어요";
  await expect(카드(page, title)).toBeVisible();
  await expect(카드(page, title).getByText("npm i -g @agentclientprotocol/codex-acp", { exact: true })).toBeVisible();
  // 카드는 기록과 입력창 대신 선다.
  await expect(입력칸(page)).toHaveCount(0);
  await expect(작업패널(page).getByText("it printed", { exact: false })).toHaveCount(0);
  // 못 찾은 엔진에는 로그인이 없다.
  await expect(단추(page, title, "로그인")).toHaveCount(0);

  await 단추(page, title, "명령 복사").click();
  await expect.poll(() => clipboardWrites(page)).toEqual(["npm i -g @agentclientprotocol/codex-acp"]);

  // 설치한 뒤 「다시 확인」 — 앱을 다시 켜지 않고 로그인 환경을 새로 읽는다(스토리 102). 찾았으면 카드가 걷히고 기록이 다시 선다.
  await replaceAnswer(page, "chat_check_engine", { ...CODEX_LOGGED_OUT, loggedIn: true });
  await 단추(page, title, "다시 확인").click();
  await expect.poll(async () => (await ipcCallArgs(page, "chat_check_engine", "agent")).map(({ args }) => args)).toEqual([
    { agent: "codex", reread: false },
    { agent: "codex", reread: true },
  ]);
  await expect(카드(page, title)).toHaveCount(0);
  await expect(입력칸(page)).toBeVisible();
  await expect(작업패널(page).getByText("it printed", { exact: false })).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("못 찾음: 대화 없는 work에서 기본 에이전트를 못 찾으면 대화를 만들지 않고 카드가 서고, 「다시 확인」으로 찾으면 그때 첫 대화가 열린다", async ({
  page,
}) => {
  await recordClipboard(page);
  await installFixtureBackend(page, {
    chat_check_engine: answerByArg("agent", {
      claude: { state: "missing", missing: [{ name: "claude", install: "curl -fsSL https://claude.ai/install.sh | bash" }] },
    }),
  });
  await page.goto(`/works/${plainWork.slug}`);
  await 레일칸(page, "chat").click();
  const title = "claude를 찾지 못했어요";
  await expect(카드(page, title)).toBeVisible();
  expect(await ipcCallArgs(page, "chat_new", "work"), "못 찾은 엔진으로는 대화를 만들지 않는다").toEqual([]);
  await 단추(page, title, "명령 복사").click();
  await expect.poll(() => clipboardWrites(page)).toEqual(["curl -fsSL https://claude.ai/install.sh | bash"]);

  await replaceAnswer(page, "chat_check_engine", {
    state: "found",
    programs: [{ name: "claude", path: "/opt/fixture/bin/claude" }],
    loggedIn: true,
  } satisfies EngineCheck);
  await 단추(page, title, "다시 확인").click();
  await expect(대화탭(page, "Claude")).toHaveAttribute("aria-pressed", "true");
  expect((await ipcCallArgs(page, "chat_new", "work")).map(({ args }) => args)).toEqual([
    { work: plainWork.slug, agent: "claude" },
  ]);
  expect((await ipcCallArgs(page, "chat_check_engine", "agent")).map(({ args }) => args)).toContainEqual({
    agent: "claude",
    reread: true,
  });
  await expect(카드(page, title)).toHaveCount(0);
  await expect(입력칸(page)).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("+: 띄우기 전에 엔진을 확인하고, 못 찾으면 대화를 만들지 않고 켜진 대화 대신 그 엔진의 카드가 서며, 대화 탭을 고르면 거둔다", async ({
  page,
}) => {
  await recordClipboard(page);
  await installFixtureBackend(page, {
    chat_list: answerByArg("work", { [plainWork.slug]: [codex] }, { otherwise: [] }),
    chat_read_record: answerByArg("conversation", { [codex.id]: codexOneTurn }),
  });
  await page.goto(`/works/${plainWork.slug}`);
  await 레일칸(page, "chat").click();
  await expect(입력칸(page)).toBeVisible();

  await replaceAnswer(
    page,
    "chat_check_engine",
    answerByArg("agent", {
      claude: { state: "missing", missing: [{ name: "claude", install: "curl -fsSL https://claude.ai/install.sh | bash" }] },
    }),
  );
  await 작업패널(page).getByRole("button", { name: "새 대화", exact: true }).click();
  const title = "claude를 찾지 못했어요";
  await expect(카드(page, title)).toBeVisible();
  expect((await ipcCallArgs(page, "chat_check_engine", "agent")).map(({ args }) => args)).toEqual([
    { agent: "codex", reread: false },
    { agent: "claude", reread: false },
  ]);
  expect(await ipcCallArgs(page, "chat_new", "work")).toEqual([]);
  await expect(입력칸(page)).toHaveCount(0);

  // 다른 대화를 고르면 카드를 거두고 그 대화가 선다.
  await 대화탭(page, "Codex").click();
  await expect(카드(page, title)).toHaveCount(0);
  await expect(입력칸(page)).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// L1(티켓 12)이 못박은 「session/new가 -32000」 기록 — 띄우는 중 · 계정 없음 · 로그인 필요(실측 A3).
const loginRequiredOnOpen: RecordLine[] = [
  { seq: 1, at: "2026-10-10T10:00:01.000+09:00", kind: "session", payload: { state: "spawning" } },
  {
    seq: 2,
    at: "2026-10-10T10:00:02.000+09:00",
    kind: "session",
    payload: { state: "auth-status", params: { authStatus: { kind: "none", label: "Not logged in" } } },
  },
  { seq: 3, at: "2026-10-10T10:00:03.000+09:00", kind: "session", payload: { state: "login-required" } },
];

const LOGGED_OUT = "Codex에 로그인이 안 돼 있어요";
const LOGGING_IN = "Codex에 로그인하는 중이에요";
const LOGIN_URL = "https://auth.openai.com/oauth/authorize?client_id=fixture&state=abc";

test("로그인 안 됨: 「로그인」이 로그인 시작을 부르고, 링크 이벤트에 「링크 복사」 · 「취소」가 서고, 끝남 · 됨이 오면 카드가 걷혀 대화로 돌아간다", async ({
  page,
}) => {
  await openCodex(page, CODEX_LOGGED_OUT, loginRequiredOnOpen);
  await expect(카드(page, LOGGED_OUT)).toBeVisible();
  await expect(입력칸(page)).toHaveCount(0);
  // 「명령 복사」는 터미널에서 직접 로그인하는 길이다(스토리 98) — 그 엔진의 로그인 명령.
  await 단추(page, LOGGED_OUT, "명령 복사").click();
  await expect.poll(() => clipboardWrites(page)).toEqual(["codex login"]);
  // 링크는 로그인 명령이 URL을 찍은 뒤에만 선다.
  await expect(단추(page, LOGGED_OUT, "링크 복사")).toHaveCount(0);

  await 단추(page, LOGGED_OUT, "로그인").click();
  expect((await ipcCallArgs(page, "chat_start_login", "agent")).map(({ args }) => args)).toEqual([{ agent: "codex" }]);

  // 호스트가 띄운 로그인 명령이 돈다 — 아직 URL을 찍지 않았다.
  await fireEvent(page, CHAT_ENGINE_EVENT, engine({ agent: "codex", found: true, loggedIn: null, login: { state: "running", url: null } }));
  await expect(카드(page, LOGGING_IN)).toBeVisible();
  await expect(단추(page, LOGGING_IN, "취소")).toBeVisible();
  await expect(단추(page, LOGGING_IN, "링크 복사")).toHaveCount(0);
  await expect(단추(page, LOGGING_IN, "로그인")).toHaveCount(0);

  // 링크 이벤트 — 명령이 처음 찍은 https:// URL. 브라우저가 안 열렸으면 그것을 복사해 직접 연다(스토리 95).
  await fireEvent(page, CHAT_ENGINE_EVENT, engine({ agent: "codex", found: true, loggedIn: null, login: { state: "running", url: LOGIN_URL } }));
  await 단추(page, LOGGING_IN, "링크 복사").click();
  await expect.poll(() => clipboardWrites(page)).toEqual(["codex login", LOGIN_URL]);
  await expect(단추(page, LOGGING_IN, "취소")).toBeVisible();

  // 끝남 · 됨 — 호스트가 저절로 다시 확인한 답이 함께 온다. 카드가 걷히고 대화로 돌아간다(기록은 그대로다). 대화를 다시
  // 띄우는 것은 호스트다 — 화면은 아무 명령도 더 부르지 않는다.
  await fireEvent(
    page,
    CHAT_ENGINE_EVENT,
    engine({ agent: "codex", found: true, loggedIn: true, login: { state: "ended", cancelled: false, exitCode: 0 } }),
  );
  await expect(카드(page, LOGGING_IN)).toHaveCount(0);
  await expect(카드(page, LOGGED_OUT)).toHaveCount(0);
  await expect(입력칸(page)).toBeVisible();
  expect(await ipcCallArgs(page, "chat_start_login", "agent")).toHaveLength(1);
  expect(await ipcCallArgs(page, "chat_check_engine", "agent")).toHaveLength(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("로그인 중: 「취소」가 로그인 취소를 부르고, 취소로 끝나면 다시 로그인 안 됨 카드다", async ({ page }) => {
  await openCodex(page, CODEX_LOGGED_OUT, loginRequiredOnOpen);
  await 단추(page, LOGGED_OUT, "로그인").click();
  await fireEvent(page, CHAT_ENGINE_EVENT, engine({ agent: "codex", found: true, loggedIn: null, login: { state: "running", url: LOGIN_URL } }));
  await 단추(page, LOGGING_IN, "취소").click();
  expect((await ipcCallArgs(page, "chat_cancel_login", "agent")).map(({ args }) => args)).toEqual([{ agent: "codex" }]);

  await fireEvent(
    page,
    CHAT_ENGINE_EVENT,
    engine({ agent: "codex", found: true, loggedIn: false, login: { state: "ended", cancelled: true, exitCode: null } }),
  );
  await expect(카드(page, LOGGING_IN)).toHaveCount(0);
  await expect(단추(page, LOGGED_OUT, "로그인")).toBeVisible();
  await expect(입력칸(page)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("로그인 안 됨: 로그인 명령이 끝났는데도 안 됐으면 exit code를 말하고 다시 「로그인」이 선다", async ({ page }) => {
  await openCodex(page, CODEX_LOGGED_OUT, loginRequiredOnOpen);
  await 단추(page, LOGGED_OUT, "로그인").click();
  await fireEvent(page, CHAT_ENGINE_EVENT, engine({ agent: "codex", found: true, loggedIn: null, login: { state: "running", url: null } }));
  await fireEvent(
    page,
    CHAT_ENGINE_EVENT,
    engine({ agent: "codex", found: true, loggedIn: false, login: { state: "ended", cancelled: false, exitCode: 1 } }),
  );
  await expect(카드(page, LOGGED_OUT)).toContainText("exit code 1");
  await expect(단추(page, LOGGED_OUT, "로그인")).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("대화 도중: 턴 도중에 로그인이 풀린 줄이 오면 오류 글이 아니라 같은 안내 카드가 선다 — 엔진을 가리지 않는다", async ({ page }) => {
  const claude = conversationRow({ id: "c-claude", agent: "claude", name: "Claude" });
  await recordClipboard(page);
  await installFixtureBackend(page, {
    chat_list: answerByArg("work", { [plainWork.slug]: [claude] }, { otherwise: [] }),
    chat_read_record: answerByArg("conversation", { [claude.id]: [] }),
  });
  await page.goto(`/works/${plainWork.slug}`);
  await 레일칸(page, "chat").click();
  await expect(입력칸(page)).toBeVisible();

  // 말을 보냈고, 턴이 에이전트의 -32000으로 끝났다 — 호스트는 턴 끝 바로 뒤에 로그인 필요 줄을 적는다(티켓 12 · 16의 S3).
  const [sent] = handTurn(1, "overview를 고쳐 줘", "", 0);
  await streamLines(page, plainWork.slug, claude.id, [
    sent,
    {
      seq: 2,
      at: "2026-10-10T11:00:02.000+09:00",
      kind: "turn-end",
      payload: {
        stopReason: null,
        durationMs: 1000,
        cancelledByUs: false,
        outOfTurn: false,
        error: { code: -32000, message: "Authentication required" },
      },
    },
    { seq: 3, at: "2026-10-10T11:00:03.000+09:00", kind: "session", payload: { state: "login-required" } },
  ]);
  const title = "Claude Code에 로그인이 안 돼 있어요";
  await expect(카드(page, title)).toBeVisible();
  await expect(입력칸(page)).toHaveCount(0);
  await expect(단추(page, title, "로그인")).toBeVisible();
  await 단추(page, title, "명령 복사").click();
  await expect.poll(() => clipboardWrites(page)).toEqual(["claude auth login"]);

  // 로그인이 됐다(터미널에서 하고 「다시 확인」, 또는 로그인 명령의 끝) — 카드가 걷히고 보낸 말이 그대로 있다.
  await fireEvent(page, CHAT_ENGINE_EVENT, engine({ agent: "claude", found: true, loggedIn: true, login: null }));
  await expect(카드(page, title)).toHaveCount(0);
  await expect(입력칸(page)).toBeVisible();
  await expect(작업패널(page).getByText("overview를 고쳐 줘", { exact: true })).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

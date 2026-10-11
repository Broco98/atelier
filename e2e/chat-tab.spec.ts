import { expect, test, type Page } from "./evidence";

import type { EngineCheck } from "@/features/chat/types";
import { answerByArg, WORKS } from "./fixtures";
import { fireEvent, installFixtureBackend, ipcCallArgs, replaceAnswer, steadyCount, unknownIpcCalls } from "./harness";
import { conversationRow, handToolTurn, streamLines } from "./chat-records";
import { 레일칸, 작업패널 } from "./chat-screen";

// three-axes 티켓 24 — **`chat` 탭이 대화창을 가운데에 넓게 띄운다**(S21 · S22 · 스토리 17~22).
//
// 정적 마크업(WorksPage.test.tsx)이 「주소가 `tab=chat`이면 무엇이 서는가」를 들고, 이 층은 누르고 옮기는 손맛을 잰다: 탭을 누르면
// 주소와 본문이 바뀌고 새로고침해도 남는가, 레일 `chat`이 대화를 패널로 데려오는가, 문서 링크가 `spec` 탭으로 가는가, ⌘ 숫자 키와
// 분할이 그대로인가. 대화 호스트는 목업 백엔드의 답과 이 검사가 쏘는 기록 줄 이벤트로 선다(`chat-records.ts`).

const [specWork] = WORKS;

/** 탭 줄의 칸 — 레일의 `chat` 칸과 이름이 같아서 칸 id(`data-tab`)로 집는다. */
const 탭 = (page: Page, id: "spec" | "chat") => page.locator(`header [data-tab="${id}"]`);
/** 가운데 카드 — 본문은 `main` 하나다. 대화창이면 「대화」, 문서면 「문서」다. */
const 가운데대화 = (page: Page) => page.getByRole("main", { name: "대화", exact: true });
const 문서 = (page: Page) => page.getByRole("main", { name: "문서", exact: true });
const 대화탭줄 = (scope: ReturnType<Page["locator"]>) => scope.getByRole("group", { name: "대화 탭", exact: true });
const 입력칸 = (scope: ReturnType<Page["locator"]>) => scope.getByRole("textbox", { name: "보낼 말", exact: true });

const codex = conversationRow({ id: "c-tab-codex", agent: "codex", name: "Codex" });

/** 대화 하나가 선 work로 간다 — 대화 목록은 `codex` 하나다. */
async function openWork(page: Page, search = ""): Promise<void> {
  await installFixtureBackend(page, {
    chat_list: answerByArg("work", { [specWork.slug]: [codex] }, { otherwise: [] }),
  });
  await page.goto(`/works/${specWork.slug}${search}`);
  // **기본 5초가 아니다** — 워커의 첫 페이지는 dev 서버가 작업 화면을 처음 변환하는 것을 기다린다(chat.spec.ts와 같은 까닭).
  await expect(탭(page, "spec")).toBeVisible({ timeout: 20_000 });
}

test("자리: `chat` 탭이 `spec` 바로 뒤에 서고, 누르면 가운데에 대화창이 뜨며, 주소가 `tab=chat`이고 새로고침해도 `chat`이다", async ({
  page,
}) => {
  await openWork(page);
  // 탭 줄의 고정 칸 순서 — `spec` 다음이 `chat`이고 그 뒤에 셸 칸이 선다.
  const order = await page.locator("header [data-tab]").evaluateAll((all) => all.map((el) => el.getAttribute("data-tab")));
  expect(order.indexOf("spec")).toBeGreaterThan(-1);
  expect(order.indexOf("chat")).toBe(order.indexOf("spec") + 1);
  await expect(탭(page, "chat")).toHaveAttribute("aria-pressed", "false");

  await 탭(page, "chat").click();
  await expect(page).toHaveURL(/[?&]tab=chat\b/);
  await expect(탭(page, "chat")).toHaveAttribute("aria-pressed", "true");
  await expect(탭(page, "spec")).toHaveAttribute("aria-pressed", "false");
  // 가운데가 대화창이다 — 작업 패널과 같은 대화 탭 줄과 입력창(스토리 18). 문서는 서지 않는다.
  await expect(대화탭줄(가운데대화(page)).getByRole("button", { name: "Codex", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(입력칸(가운데대화(page))).toBeVisible();
  await expect(문서(page)).toHaveCount(0);
  // 넓게 — 가운데 대화창이 작업 패널 기본 폭(330)보다 넓다.
  const wide = await 입력칸(가운데대화(page)).evaluate((el) => el.closest("form")!.getBoundingClientRect().width);
  expect(wide).toBeGreaterThan(400);

  await page.reload();
  await expect(입력칸(가운데대화(page))).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/[?&]tab=chat\b/);
  await expect(탭(page, "chat")).toHaveAttribute("aria-pressed", "true");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("한 곳에: `chat` 탭이 떠 있는 동안 작업 패널에 같은 대화창이 없고, 레일 `chat`을 누르면 가운데는 `spec`, 작업 패널은 `chat`이 된다", async ({
  page,
}) => {
  await openWork(page);
  // 패널에서 대화를 열어 둔다 — 쓰던 글이 있다.
  await 레일칸(page, "chat").click();
  await 입력칸(작업패널(page)).fill("overview를 고쳐 줘");

  // `chat` 탭을 누르면 대화창이 가운데로 간다 — 패널에는 대화 탭 줄도 입력칸도 없다. 쓰던 글은 따라온다(같은 대화창).
  await 탭(page, "chat").click();
  await expect(입력칸(가운데대화(page))).toHaveValue("overview를 고쳐 줘");
  await expect(대화탭줄(작업패널(page))).toHaveCount(0);
  await expect(입력칸(작업패널(page))).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "보낼 말", exact: true })).toHaveCount(1);
  // 그동안 레일 `chat`은 켜진 것으로 읽힌다.
  await expect(레일칸(page, "chat")).toHaveAttribute("aria-pressed", "true");

  // 레일 `chat`을 누르면 대화가 패널로 돌아온다 — 가운데는 문서, 패널은 대화창이다(프로토타입 D). 패널을 닫지 않는다.
  await 레일칸(page, "chat").click();
  await expect(page).not.toHaveURL(/[?&]tab=/);
  await expect(문서(page)).toBeVisible();
  await expect(가운데대화(page)).toHaveCount(0);
  await expect(입력칸(작업패널(page))).toHaveValue("overview를 고쳐 줘");
  await expect(탭(page, "spec")).toHaveAttribute("aria-pressed", "true");
  await expect(레일칸(page, "chat")).toHaveAttribute("aria-pressed", "true");

  // 패널이 트리를 보이던 채로 `chat` 탭을 열어도 트리는 그대로다 — 레일 `spec`과 `chat`이 함께 켜진다.
  await 레일칸(page, "spec").click();
  await 탭(page, "chat").click();
  await expect(입력칸(가운데대화(page))).toBeVisible();
  await expect(작업패널(page).getByRole("button", { name: "증거", exact: true })).toBeVisible();
  await expect(레일칸(page, "spec")).toHaveAttribute("aria-pressed", "true");
  await expect(레일칸(page, "chat")).toHaveAttribute("aria-pressed", "true");
  // 대화는 끄지 않는다 — 자리를 옮겼을 뿐이다.
  expect(await ipcCallArgs(page, "chat_close", "work")).toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("문서 링크: `chat` 탭에서 도구 줄의 파일을 누르면 `spec` 탭에 그 파일이 열린다", async ({ page }) => {
  await openWork(page, "?tab=chat");
  await expect(입력칸(가운데대화(page))).toBeVisible();
  // spec 폴더 안의 파일을 읽는 도구 줄 — 코어가 주는 홈 축약 표기 그대로다. 턴이 도는 동안이라 줄이 펼쳐 서 있다.
  await streamLines(
    page,
    specWork.slug,
    codex.id,
    handToolTurn(
      1,
      "메타를 읽어 줘",
      [
        {
          sessionUpdate: "tool_call",
          toolCallId: "read-tab-meta",
          kind: "read",
          title: "Read file '~/.atelier/works/pinned-work/spec/메타.json'",
          status: "in_progress",
          locations: [{ path: "~/.atelier/works/pinned-work/spec/메타.json" }],
        },
        { sessionUpdate: "tool_call_update", toolCallId: "read-tab-meta", status: "completed" },
      ],
      "읽었어요.",
      1000,
    ).slice(0, 3),
  );
  await 가운데대화(page)
    .getByRole("group", { name: "메타.json 읽음", exact: true })
    .getByRole("button", { name: "메타.json", exact: true })
    .click();

  // 문서 링크와 같은 길이다 — 탭이 `spec`으로 돌아가고 그 파일이 열린다(스토리 19).
  await expect(page).toHaveURL(/[?&]file=%EB%A9%94%ED%83%80\.json/);
  await expect(page).not.toHaveURL(/[?&]tab=/);
  await expect(문서(page)).toBeVisible();
  await expect(문서(page).locator('[data-slot="card-head"]')).toContainText("메타.json");
  await expect(탭(page, "spec")).toHaveAttribute("aria-pressed", "true");
  await expect(가운데대화(page)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("⌘ 키: `chat` 탭에서도 ⌘2는 첫 셸, ⌘1은 `spec`이다 — 입력칸에 포커스가 있어도 메뉴로 온 키는 그대로 먹는다", async ({
  page,
}) => {
  // 셸 하나를 띄워 둔다 — 터미널로 들어가면 자동 셸이 선다.
  await openWork(page, "?tab=terminal");
  await expect(page.locator(".xterm")).toHaveCount(1);

  await 탭(page, "chat").click();
  await expect(입력칸(가운데대화(page))).toBeVisible();
  // 입력칸에 쓰는 중에 ⌘2 — 앱에서는 네이티브 메뉴가 이 키를 받아 창에 흘린다(`hotkey:menu`). 이 층에는 OS 메뉴가 없어 그 이벤트를 쏜다.
  await 입력칸(가운데대화(page)).click();
  await fireEvent(page, "hotkey:menu", "Digit2");
  await expect(page).toHaveURL(/[?&]tab=terminal\b/);
  await expect(page.locator(".xterm")).toHaveCount(1);
  await expect(page.locator('[data-tab="shell"] button[aria-pressed]').first()).toHaveAttribute("aria-pressed", "true");
  await expect(가운데대화(page)).toHaveCount(0);

  // 탭 칸에 포커스가 있을 때의 ⌘1 — 웹뷰가 받는 길이다. `chat`에는 숫자 키가 없어 ⌘1은 `spec`이다.
  await 탭(page, "chat").click();
  await expect(입력칸(가운데대화(page))).toBeVisible();
  await page.keyboard.press("Meta+1");
  await expect(page).not.toHaveURL(/[?&]tab=/);
  await expect(문서(page)).toBeVisible();
  await expect(탭(page, "spec")).toHaveAttribute("aria-pressed", "true");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("분할: `chat` 탭에서 분할을 켜도 `spec ▏터미널`이고, 분할 중에 `chat` 탭을 누르면 분할이 꺼지고 대화창이 선다", async ({ page }) => {
  await openWork(page, "?tab=chat");
  await expect(입력칸(가운데대화(page))).toBeVisible();

  await page.getByRole("button", { name: "분할", exact: true }).click();
  await expect(page).toHaveURL(/[?&]split=lr\b/);
  await expect(page).not.toHaveURL(/[?&]tab=chat\b/);
  // 열 머리 둘이 `spec` → `terminal` 순서로 선다. 대화창은 어느 열에도 없다.
  expect(await page.locator("[data-column]").evaluateAll((all) => all.map((el) => el.getAttribute("data-column")))).toEqual([
    "spec",
    "terminal",
  ]);
  await expect(가운데대화(page)).toHaveCount(0);
  await expect(탭(page, "chat")).toHaveAttribute("aria-pressed", "false");

  // 분할 중에 `chat` 탭 — 분할이 꺼지고 대화창이 가운데에 선다. 눌러도 아무 일이 없는 칸이 아니다.
  await 탭(page, "chat").click();
  await expect(page).toHaveURL(/[?&]tab=chat\b/);
  await expect(page).not.toHaveURL(/[?&]split=/);
  await expect(입력칸(가운데대화(page))).toBeVisible();
  await expect(page.locator("[data-column]")).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("못 찾음: `chat` 탭에서 「다시 확인」으로 빠진 엔진을 찾으면 첫 대화가 하나만 열린다 — 숨은 작업 패널의 대화창이 또 열지 않는다", async ({
  page,
}) => {
  await installFixtureBackend(page, {
    chat_check_engine: answerByArg("agent", {
      claude: { state: "missing", missing: [{ name: "claude", install: "curl -fsSL https://claude.ai/install.sh | bash" }] },
    }),
  });
  await page.goto(`/works/${specWork.slug}?tab=chat`);
  const 카드 = 가운데대화(page).getByRole("region", { name: "claude를 찾지 못했어요", exact: true });
  await expect(카드).toBeVisible({ timeout: 20_000 });
  expect(await ipcCallArgs(page, "chat_new", "work")).toEqual([]);

  await replaceAnswer(page, "chat_check_engine", {
    state: "found",
    programs: [{ name: "claude", path: "/opt/fixture/bin/claude" }],
    loggedIn: true,
  } satisfies EngineCheck);
  await 카드.getByRole("button", { name: "다시 확인", exact: true }).click();
  await expect(대화탭줄(가운데대화(page)).getByRole("button", { name: "Claude", exact: true })).toBeVisible();
  // 가운데와 작업 패널(숨은 채 마운트돼 있다)에 같은 work의 대화창이 둘 서 있어도, 엔진을 찾은 소식에 대화를 만드는 것은 한 번이다.
  expect(await steadyCount(page, "chat_new")).toBe(1);
  expect((await ipcCallArgs(page, "chat_new", "work")).map(({ args }) => args)).toEqual([{ work: specWork.slug, agent: "claude" }]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

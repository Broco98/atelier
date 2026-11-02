import { expect, test, type Page } from "./evidence";

import { answerByArg, FIXTURE_THREAD } from "./fixtures";
import { installFixtureBackend, ipcArgs, ipcCallArgs, unknownIpcCalls } from "./harness";
import { summaryOf } from "./thread-records";
import { PAYMENTS, REFUND, SCOPE_BY_SERVICE, SCOPES, WORLD } from "./thread-service-world";
import type { ThreadView } from "@/features/thread/types";

// 흐름 「트레이」의 Work 칩 조각(구현 스펙 「01a — 범위와 새 채팅」 · 티켓 01a-14) — **어디서 일할지는 주소 씨앗이 정한다. 고르는 스위치는 없다. 씨앗이
// 없으면 Work 칩 없이 작업공간 없는 채팅이고, `?new=work`는 ×로 빼는 「새 작업공간」 칩을, `?work=`는 누르면 그 작업공간으로 가는 잠긴 칩을 세운다. 시작할
// 곳이 입력창 안내 · 정도 칩을 바꾸고 첫 말의 `link`로 간다.** 트레이의 나머지(두 자리 · 첫 말 뒤의 잠긴 칩 · 범위 칩 · 범위 줄 · 범위와 입력 글의 씨앗 ·
// 입력창 안)는 같은 흐름의 `thread-tray`가 잰다 — 같은 것을 두 번 재지 않는다.
//
// 첫 말 뒤의 일(새 Work 제안 · 그 Work의 자리에서 뜨는 Session)은 엔진의 몫이다 — L1(`thread_work.rs` 머리말 · `thread_host.rs` ·
// `thread_policy.rs`)이 잰다. 여기서는 고른 것이 그 인자로 나가는 데까지다. Work · Service는 시안의 세계다(`thread-service-world`).

test.use({ viewport: { width: 1440, height: 900 } });

const picked = REFUND;
const linked: ThreadView = { ...FIXTURE_THREAD, work: picked.slug };
const typed = "환불 버튼 문구를 고쳐 줘";

const 사이드바 = (page: Page) => page.locator("aside[data-sidebar]");
const 입력칸 = (page: Page) => page.getByRole("textbox", { name: "보낼 말", exact: true });
const 첫화면 = (page: Page) => page.getByRole("heading", { name: "무엇을 만들까요?", exact: true });
const 트레이 = (page: Page) => page.locator('[data-slot="composer-tray"]');
const 새작업공간칩 = (page: Page) => 트레이(page).locator('[data-slot="new-work-chip"]');
const 칩빼기 = (page: Page) => 트레이(page).getByRole("button", { name: "새 작업공간 빼기", exact: true });
const 잠긴칩 = (page: Page) => 트레이(page).locator('[data-slot="work-chip"]');
const 정도칩 = (page: Page, name: string) => page.getByRole("button", { name: `물어보는 정도 ${name}`, exact: true });
const 갈래 = (page: Page, name: string) => page.getByRole("menuitemradio", { name, exact: true });
const 범위칩 = (page: Page, name: string) => 트레이(page).getByRole("button", { name: `범위: ${name}`, exact: true });

/** 그 주소를 연다. **기본 5초가 아니다** — 워커의 첫 페이지면 dev 서버가 첫 화면을 처음 변환하는 것을 기다린다. */
async function open(page: Page, url: string) {
  await page.goto(url);
  await expect(첫화면(page)).toBeVisible({ timeout: 20_000 });
}

/** 시작할 곳이 바꾸는 글 — 빈 입력창의 안내. */
async function shows(page: Page, placeholder: string) {
  await expect(입력칸(page)).toHaveAttribute("placeholder", placeholder);
}

/** 첫 말을 보낸다 — 새 Thread가 그 주소에 선다(본문이 그 Thread다). */
async function send(page: Page, text: string) {
  await 입력칸(page).fill(text);
  await 입력칸(page).press("Enter");
  await expect(page).toHaveURL(`/threads/${FIXTURE_THREAD.id}`);
  await expect(page.getByRole("main", { name: linked.title, exact: true })).toBeVisible();
}

const BACKEND = {
  ...WORLD,
  thread_list: [summaryOf(linked)],
  thread_get: answerByArg("thread", { [linked.id]: linked }),
};

// 씨앗이 없는 새 채팅과 「새 채팅」(`?new=thread`)은 같은 화면이다 — 어디에도 묶이지 않는다.
for (const url of ["/", "/?new=thread"]) {
  test(`${url}에는 Work 칩이 없고 안내가 「무엇이든 요청하세요」이며, 첫 말이 작업공간 없이 간다`, async ({ page }) => {
    await installFixtureBackend(page, BACKEND);
    await open(page, url);

    await expect(잠긴칩(page)).toHaveCount(0);
    await expect(새작업공간칩(page)).toHaveCount(0);
    await shows(page, "무엇이든 요청하세요");

    // 고르지 않아도 정도는 간다 — 작업공간 없는 새 채팅의 기본 「편집 자동」을 파일에 적는다(구현 스펙 「01a — 권한」).
    await expect(정도칩(page, "편집 자동")).toBeVisible();
    await send(page, typed);
    expect(await ipcArgs(page, "thread_start", "text")).toEqual([
      { text: typed, attachments: [], link: { kind: "no-work" }, mode: "edits", model: null, effort: null, service: null, project: null },
    ]);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

test("`?new=work`에 「새 작업공간」 칩과 빼기 단추가 서고 안내가 바뀌며, 첫 말이 새 작업공간으로 간다", async ({ page }) => {
  await installFixtureBackend(page, BACKEND);
  await open(page, "/?new=work");

  await expect(새작업공간칩(page)).toHaveText("새 작업공간");
  await expect(칩빼기(page)).toBeVisible();
  await expect(잠긴칩(page)).toHaveCount(0);
  await shows(page, "만들 기능이나 고칠 문제를 적어 주세요");

  await send(page, typed);
  expect(await ipcArgs(page, "thread_start", "text")).toEqual([
    { text: typed, attachments: [], link: { kind: "new-work" }, mode: "edits", model: null, effort: null, service: null, project: null },
  ]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("×가 칩을 빼고 주소를 `/?new=thread`로 바꾸며 고른 범위 · 모드 · 쓴 글이 남고, 사이드바 +가 칩을 다시 세우고, 뒤로 가도 뺀 칩이 돌아오지 않는다", async ({
  page,
}) => {
  await installFixtureBackend(page, { ...BACKEND, reading_scope: answerByArg("service", SCOPE_BY_SERVICE, { otherwise: SCOPES.all }) });
  await open(page, "/");
  const plus = 사이드바(page).getByRole("button", { name: "작업공간 만들기", exact: true });
  await plus.click();
  await expect(page).toHaveURL("/?new=work");
  await expect(새작업공간칩(page)).toBeVisible();

  // 칩을 빼기 전에 고른 것 — 범위 · 모드 · 쓴 글.
  await 트레이(page).getByRole("button", { name: "범위 없음", exact: true }).click();
  await 갈래(page, PAYMENTS.name).click();
  await 정도칩(page, "편집 자동").click();
  await 갈래(page, "계획").click();
  await 입력칸(page).fill(typed);
  const 고른것이남는다 = async () => {
    await expect(범위칩(page, PAYMENTS.name)).toBeVisible();
    await expect(정도칩(page, "계획")).toBeVisible();
    await expect(입력칸(page)).toHaveValue(typed);
  };
  await 고른것이남는다();

  await 칩빼기(page).click();
  await expect(새작업공간칩(page)).toHaveCount(0);
  await expect(page).toHaveURL("/?new=thread");
  await 고른것이남는다();

  // + 를 다시 누르면 칩이 돌아온다 — `?new=work`와 `?new=thread`는 같은 화면이라 고른 것이 그대로다(`newThreadKey`). ×가 주소를 그대로 두면 같은 주소라 여기서 아무 일도 없다.
  await plus.click();
  await expect(page).toHaveURL("/?new=work");
  await expect(새작업공간칩(page)).toBeVisible();
  await 고른것이남는다();

  // ×는 주소를 갈아 세운다 — 뒤로 가도 앞서 뺀 자리이지 칩이 선 `?new=work`가 아니다.
  await 칩빼기(page).click();
  await expect(page).toHaveURL("/?new=thread");
  await page.goBack();
  await expect(page).toHaveURL("/?new=thread");
  await expect(새작업공간칩(page)).toHaveCount(0);
  await 고른것이남는다();

  // 뺀 뒤의 첫 말은 작업공간 없이, 고른 것과 함께 간다.
  await send(page, typed);
  expect(await ipcArgs(page, "thread_start", "text")).toEqual([
    { text: typed, attachments: [], link: { kind: "no-work" }, mode: "plan", model: null, effort: null, service: { slug: PAYMENTS.slug }, project: null },
  ]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("`?work=`에 그 작업공간의 잠긴 칩이 서서 누르면 그리로 가고, 안내가 그 이름을 부르며 정도 칩이 그 작업공간의 값이고, 첫 말이 그 작업공간으로 간다", async ({
  page,
}) => {
  // 기본 정도(「편집 자동」)와 다른 값이라야 칩이 그 작업공간의 값을 읽었는지 갈린다.
  await installFixtureBackend(page, { ...BACKEND, thread_work_mode: answerByArg("work", { [picked.slug]: "plan" }) });
  await open(page, `/?work=${picked.slug}`);

  await expect(잠긴칩(page)).toHaveAccessibleName(`작업공간으로 가기: ${picked.title}`);
  await expect(잠긴칩(page)).toHaveText(picked.title);
  await expect(칩빼기(page)).toHaveCount(0);
  await shows(page, `${picked.title}에서 무엇을 할까요?`);
  await expect.poll(() => ipcArgs(page, "thread_work_mode", "work")).toEqual([{ work: picked.slug }]);
  await expect(정도칩(page, "계획")).toBeVisible();

  await 잠긴칩(page).click();
  await expect(page).toHaveURL(new RegExp(`/works/${picked.slug}`));
  await page.goBack();
  await expect(첫화면(page)).toBeVisible();
  await expect(잠긴칩(page)).toHaveAccessibleName(`작업공간으로 가기: ${picked.title}`);

  // 고르지 않은 정도는 `null`이다 — 엔진이 그 Work의 정도를 쓴다. 고르지 않은 범위도 `null`이다 — 이은 Work의 Service를 건드리지 않는다.
  await send(page, typed);
  expect(await ipcArgs(page, "thread_start", "text")).toEqual([
    { text: typed, attachments: [], link: { kind: "work", slug: picked.slug }, mode: null, model: null, effort: null, service: null, project: null },
  ]);
  expect(await ipcCallArgs(page, "thread_set_mode", "thread")).toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 스위치와 함께 `/work`도 사라졌다 — 첫 말 전의 화면 명령은 넷이고, 어느 씨앗으로 열어도 같다.
for (const url of ["/", "/?new=work", `/?work=${picked.slug}`]) {
  test(`${url}의 「/」 메뉴에 \`/work\`가 없다`, async ({ page }) => {
    await installFixtureBackend(page, BACKEND);
    await open(page, url);
    await 입력칸(page).fill("/");
    await expect(page.getByRole("listbox", { name: "명령", exact: true }).getByRole("option")).toHaveText([
      /^\/new/,
      /^\/plan/,
      /^\/model/,
      /^\/policy/,
    ]);
    expect(await unknownIpcCalls(page)).toEqual([]);
  });
}

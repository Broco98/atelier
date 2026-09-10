import { expect, test } from "./evidence";
import type { Locator, Page } from "./evidence";
import {
  MAISON_SEARCH_DESTINATION_QUERY,
  MAISON_SEARCH_HITS,
  ROOMS,
  ROOM_SPEC_FILE_BODIES,
  SEARCH_DESTINATION_QUERY,
  SEARCH_HITS,
  WORKS,
} from "./fixtures";
import { awaitSpawned, installFixtureBackend, readIpcRecord, unknownIpcCalls } from "./harness";

// 판 01 — ⌘K로 열고, 치면 좁혀지고, 방향키로 고르고, Enter로 간다.
//
// **마크업 seam이 보는 것은 여기서 다시 보지 않는다.** 줄에 무엇이 적히는지·골라진 줄이
// 하나인지·없다고 말하는 줄은 SearchPalette.test.tsx가 들고, 맞추는 규칙과 상한은 코어
// 단위가 들고, 늦은 답을 버리는 것은 옵션 seam이 든다(hooks.test.ts). 이 층이 드는 것은
// 이벤트가 있어야만 보이는 것들이다 — 셸을 지나오는 키, 마우스, 실제 이동, 「떠 있는 창이
// 막는다」, 그리고 **친 것이 명령까지 가는 배선**.
//
//
// **세계도 이 층이 든다**(#185, 아래 셋). 물음에 세계가 실리는 것은 옵션 seam이(hooks.test.ts),
// 고른 줄이 어느 주소로 풀리는지는 순수 함수가 든다(hit-target.test.ts) — 그런데 그 둘에
// 건네지는 값은 셸이 주소와 저장소로 합성하는 것이라(`shellMode`), 그 한 자리만 Atelier로
// 누워도 앞의 두 층은 그대로 초록이다. 그리고 세계를 **건너간 뒤 다시 여는 것**은 여기 말고
// 도는 자리가 없다.
// **가장 큰 것은 첫 검사다.** 「⌘K가 xterm을 지나 window까지 오는가」는 실물 xterm이 붙어야만
// 답이 나오고, 다른 층은 전부 xterm 없이 돈다. 셸이 그 키를 타이핑하지 않는다는 판정은
// 순수 모듈이 들지만(`shellHotkey`가 `"app"`), 그 판정이 xterm에 **실제로 물려 있는지**는
// 여기서만 난다.
//
// **빈 화면에 어느 층이 서는지는 여기서 안 잰다.** 픽스처의 검색은 질의를 못 보고 늘 같은
// 답을 주므로, 빈 질의 답을 심으면 자기가 심은 것을 다시 읽는 동어반복이 된다 —
// **결정 6·7의 그물은 코어 단위(`search.rs`)에만 있다.**

const [specWork] = WORKS;
/** 무선택 주소(`/maison/rooms`)가 정규화로 고르는 Room — 첫 줄은 초안이라 건너뛴다. */
const [, room] = ROOMS;
const [ROOM_DOC] = room.specFiles;
/**
 * 픽스처 마크다운의 **문단** 한 줄. 머리말은 안 쓴다 — Room의 머리말(`# 읽는 방`)이 제목과
 * 같은 글자라, 그것으로 찾으면 「본문이 섰다」와 「제목이 섰다」가 갈리지 않는다
 * (`maison-rooms.spec.ts`가 같은 자리를 같은 이유로 그렇게 집는다).
 */
const ROOM_BODY = ROOM_SPEC_FILE_BODIES[ROOM_DOC].split("\n\n")[1].trim();

const palette = (page: Page) => page.getByRole("listbox", { name: "검색 결과" });
const rows = (page: Page) => page.getByRole("option");
const box = (page: Page) => page.getByRole("textbox", { name: "검색어" });
/** 셸 컨트롤 행 맨 오른쪽 칸. `exact`가 없으면 팔레트의 「검색어」·「검색 결과」까지 문다. */
const searchButton = (page: Page) => page.getByRole("button", { name: "검색", exact: true });

/**
 * 검색 명령이 **어떤 질의로** 나갔는가. 같은 질의가 두 번 나가는 것은 세지 않는다 —
 * StrictMode가 붙였다 떼는 자리라 그 수는 이 검사가 말하려는 것이 아니다.
 */
async function askedFor(page: Page): Promise<string[]> {
  const calls = (await readIpcRecord(page))?.calls ?? [];
  const asked = calls
    .filter((call) => call.startsWith("search "))
    .map((call) => JSON.parse(call.slice("search ".length)).query as string);
  return [...new Set(asked)];
}

/**
 * 마지막 물음이 **들고 나간 목적지들**. 「가는 곳」 줄은 프런트가 「무엇이 있는가」를 보내야
 * 서는데(결정 21), 그 목록이 세계를 타는지는 픽스처의 답으로는 안 보인다 — 답은 심어 둔
 * 것이고 목록은 물음 쪽에 있다. 그래서 기록에서 직접 읽는다(`terminal-worlds.spec.ts`의
 * `spawnedModes`와 같은 수법).
 *
 * 못 찾았을 때 **빈 목록을 돌려주지 않는다** — 「목적지를 안 보냈다」와 「검색이 아예 안
 * 나갔다」가 같은 얼굴이 되면, 팔레트가 통째로 죽어도 「Maison에는 `Projects`가 없다」가 초록이다.
 */
async function destinationsAsked(page: Page): Promise<string[]> {
  const calls = (await readIpcRecord(page))?.calls ?? [];
  const asked = calls.filter((call) => call.startsWith("search "));
  if (asked.length === 0) return ["(검색이 나가지 않았다)"];
  const args = JSON.parse(asked[asked.length - 1].slice("search ".length)) as {
    destinations?: { key: string }[];
  };
  if (args.destinations === undefined) return ["(목적지가 안 실렸다)"];
  return args.destinations.map((place) => place.key);
}

/**
 * 세그먼트의 한 칸(`ModeSwitch`). `mode-switch.spec.ts`·`terminal-worlds.spec.ts`가 같은 규격으로
 * 집는다 — 그룹으로 좁히는 것은 `Atelier`·`Maison`이 다른 자리에도 적힐 수 있어서다.
 */
const modeButton = (page: Page, label: string) =>
  page.getByRole("group", { name: "모드 선택" }).getByRole("button", { name: label, exact: true });

/** 팔레트를 여는 키. 화음 하나라 준비도 상태도 없다(팔레트 결정 1). */
async function pressSearchKey(page: Page) {
  await page.keyboard.press("Meta+k");
}

/** 포커스가 xterm의 숨은 입력칸에 있는가 — 셸을 붙이면 그쪽이 스스로 가져간다. */
const focusedClass = (page: Page) =>
  page.evaluate(() => document.activeElement?.className ?? "");

test("⌘K가 셸에 포커스가 있는 동안에도 팔레트를 연다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await expect(page.locator(".xterm")).toHaveCount(1);
  // **이 줄이 이 검사의 전제다.** 포커스가 셸에 없으면 「셸을 지나온다」를 아무것도 안 잰다.
  await expect.poll(() => focusedClass(page)).toContain("xterm-helper-textarea");

  await pressSearchKey(page);

  await expect(palette(page)).toBeVisible();
  await expect(rows(page)).toHaveCount(SEARCH_HITS.length);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 29. **치는 동안 즉시 따라온다** — 디바운스가 없으니 글자 하나가 곧 물음 하나다.
// 이 층이 드는 것은 **배선**이다: 포커스가 칸으로 오는가, 친 것이 그대로 명령에 실려 나가는가.
// 좁혀지는 규칙은 코어 단위가 든다 — 이 층의 픽스처는 질의를 못 보고 늘 같은 답을 준다.
test("치면 그 글자가 그대로 명령으로 나간다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${specWork.slug}`);
  await expect(page.locator("main").getByRole("heading", { name: "개요" })).toBeVisible();

  await pressSearchKey(page);
  // **팔레트가 포커스를 가져와야 한다.** 안 가져오면 친 글자가 칸이 아니라 뒤 화면으로 간다.
  await expect(box(page)).toBeFocused();

  await box(page).pressSequentially("고정");

  await expect(box(page)).toHaveValue("고정");
  // 열 때 한 번(빈 질의), 글자마다 한 번씩. 마지막 물음이 **지금 칸에 있는 것**이다.
  await expect.poll(() => askedFor(page)).toEqual(["", "고", "고정"]);
  // 치는 사이에 목록이 비지 않는다 — 픽스처가 질의를 안 보므로 줄 수는 내내 같다.
  await expect(rows(page)).toHaveCount(SEARCH_HITS.length);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 21·51. **설정은 사이드바 nav 줄에 없지만 팔레트는 갈 수 있다** — 「nav 줄에 서는가」와
// 「팔레트가 갈 수 있는가」가 다른 물음이라, 설정만 `navItems` 밖에 산다(`destinations.ts`).
//
// 이 층이 드는 것은 그 갈림이 **화면에서 끝까지 도는가**다: 코어는 `key` 하나만 돌려주므로
// (결정 21) 프런트가 그것으로 라벨을 되찾아 그리고, 주소를 되찾아 실제로 그 화면을 세운다.
// **둘을 한 검사에서 본다** — 뜨기만 하고 안 가면 안 고친 것과 같고, `navItems`만 훑던
// 시절의 실패가 정확히 그 모양이었다(목록에는 뜨는데 Enter가 아무 일도 안 한다).
//
// 좁혀지는 것은 여기서 안 잰다 — 이 질의 하나에만 답이 심겨 있다(fixtures의 머리말).
test("설정 줄을 고르면 설정 화면이 선다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await expect(page.locator(".xterm")).toHaveCount(1);

  await pressSearchKey(page);
  await expect(box(page)).toBeFocused();
  await box(page).pressSequentially(SEARCH_DESTINATION_QUERY);

  // **`exact`가 있어야 한다.** 이름 맞추기는 대소문자를 접으므로, 라벨 되찾기가 통째로 죽어
  // key(`settings`)가 그대로 서도 `exact` 없이는 초록이 된다.
  const row = page.getByRole("option", { name: "Settings", exact: true });
  // 이 답에는 거터를 재려고 심어 둔 작업·본문 줄이 함께 있다(fixtures) — **목적지가 맨 위이고
  // 무선택 정규화가 고르는 것도 그것**이라는 게 여기서 함께 재진다.
  await expect(rows(page)).toHaveCount(3);
  await expect(row).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Enter");

  await expect(palette(page)).toHaveCount(0);
  await expect(page).toHaveURL("/settings");
  // **주소만 보면 화면이 안 서도 초록이다.** 설정 화면의 구획 머리가 그 자리에 선다.
  await expect(page.getByRole("heading", { name: "터미널" })).toBeVisible();
  // 훅 구획은 **백엔드가 답해 줘야 서는 자리**다(#207) — 상태·경로·미리보기가 전부
  // `agent_hooks`의 답에서 오므로, 여기까지 오면 그 왕복이 실제로 돈 것이다.
  await expect(page.getByRole("heading", { name: "에이전트 훅" })).toBeVisible();
  await expect(page.getByText("~/.codex/config.toml")).toBeVisible();
  await expect(page.getByText("[[hooks.Stop]]")).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 1. **⌘K에 수식키가 더 붙으면 아니다.** VS Code가 ⌘K를 화음 접두사로 쓰는 계열
// (⌘K ⌘S 등)과 ⌘⇧K(「줄 삭제」)를 결정문이 명시로 배제했다 — 순수 모듈이 그 판정을 들지만
// 여기서 한 번 더 재는 것은 **리스너가 그 술어를 실제로 통과시키는지**가 이 층의 물음이라서다.
/**
 * 네이티브 메뉴가 쏘는 것을 **손으로 쏜다.** 이 층의 브라우저에는 OS 메뉴가 없어서 항목을
 * 누를 수가 없는데, 메뉴가 하는 일은 `hotkey:menu`에 code를 실어 보내는 것 하나뿐이라
 * 그 이벤트를 직접 쏘면 **메뉴 → 합성 keydown → 팔레트**의 나머지 전부가 실제로 돈다.
 *
 * 구독 id는 하네스가 적어 둔 IPC 기록에서 읽는다 — 상수로 적을 수 없다(`transformCallback`이
 * 난수로 짓는다). 못 찾으면 던진다: 구독이 안 걸린 채 지나가면 아래 단언이 **아무것도 안
 * 쏜 채로** 초록이 될 수 있다.
 */
async function fireMenuHotkey(page: Page, code: string) {
  const calls = (await readIpcRecord(page))?.calls ?? [];
  // **`listen`만 고른다.** 같은 이름이 `unlisten` 줄에도 있는데 그쪽에는 handler가 없다 —
  // StrictMode가 붙였다 떼면서 마지막 줄이 그 해제가 된다. 살아 있는 것은 **마지막 구독**이다.
  const listen = calls
    .filter((call) => call.startsWith("plugin:event|listen") && call.includes('"hotkey:menu"'))
    .reverse()[0];
  const handler = listen && /"handler":(\d+)/.exec(listen)?.[1];
  if (!handler) throw new Error(`hotkey:menu 구독을 못 찾았다 — IPC 기록: ${JSON.stringify(calls)}`);
  await page.evaluate(
    ([id, sent]) => {
      const internals = (
        window as unknown as {
          __TAURI_INTERNALS__: { runCallback: (id: number, data: unknown) => void };
        }
      ).__TAURI_INTERNALS__;
      internals.runCallback(Number(id), { event: "hotkey:menu", id: 0, payload: sent });
    },
    [handler, code],
  );
}

// 결정 3. **`View ▸ Search`가 프레임 안에서도 팔레트를 연다.**
//
// ⇧⇧는 이 길에 실을 수가 없었다 — 「같은 수식키를 300ms 안에 두 번」은 accelerator 문법에
// 자리가 없고, 파싱 실패를 Tauri가 조용히 버려 **단축키 없는 항목이 선다.** 여는 키를 바꾼
// 값의 절반이 이 검사이고, **그 값이 실제로 도는지를 재는 유일한 층이 여기다.**
test("메뉴가 쏜 ⌘K가 팔레트를 연다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await expect(page.locator(".xterm")).toHaveCount(1);
  await expect(palette(page)).toHaveCount(0);

  await fireMenuHotkey(page, "KeyK");

  await expect(palette(page)).toBeVisible();
  await expect(rows(page)).toHaveCount(SEARCH_HITS.length);
  // 뜬 것이 키로 여는 것과 **같은 조각**이다 — 포커스를 가져오는 것이 그 조각의 일이다.
  await expect(box(page)).toBeFocused();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("⌘⇧K·⌘⌥K로는 안 열린다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${specWork.slug}`);
  await expect(page.locator("main").getByRole("heading", { name: "개요" })).toBeVisible();

  await page.keyboard.press("Meta+Shift+k");
  await expect(palette(page)).toHaveCount(0);
  await page.keyboard.press("Meta+Alt+k");
  await expect(palette(page)).toHaveCount(0);

  // **같은 자리에서 ⌘K는 열린다** — 안 재면 이 검사가 「키가 아예 안 온다」로도 초록이다.
  await pressSearchKey(page);
  await expect(palette(page)).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

/**
 * 줄 하나의 **거터 기하**. 슬롯의 x, 그 다음 형제(=이름)의 x, 그리고 글리프와 줄의 세로
 * 중심을 함께 잰다 — 세로는 `self-center`가 없으면 글자 베이스라인으로 내려앉는 값이고,
 * 그 어긋남은 CSS가 있어야만 난다.
 */
async function gutterOf(row: Locator) {
  return row.evaluate((el) => {
    const slot = el.querySelector("[data-gutter]");
    if (!slot) throw new Error("줄에 거터 슬롯이 없다");
    const name = slot.nextElementSibling;
    if (!name) throw new Error("슬롯 다음에 이름이 없다");
    const rowBox = el.getBoundingClientRect();
    const slotBox = slot.getBoundingClientRect();
    const glyph = slot.querySelector("svg")?.getBoundingClientRect() ?? null;
    return {
      slotX: slotBox.x,
      nameX: name.getBoundingClientRect().x,
      rowMidY: rowBox.y + rowBox.height / 2,
      slotMidY: slotBox.y + slotBox.height / 2,
      glyphMidY: glyph === null ? null : glyph.y + glyph.height / 2,
    };
  });
}

// 결정 17·18. **글자 시작점이 층을 가로질러 하나다.**
//
// 이 층에서만 답이 난다 — 정적 마크업 seam에는 CSS가 없어 x도 26px도 안 나오고, 크기 클래스
// 문자열을 단언하는 것은 그 파일이 스스로 금지한 「모양으로 가르기」다. 여기서 재는 것 셋:
// 층이 달라도 이름의 x가 같다 · 구획 머리가 글리프와 같은 컬럼이다 · 그 둘이 26px 갈린다.
test("모든 줄이 같은 거터를 예약한다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await expect(page.locator(".xterm")).toHaveCount(1);

  await pressSearchKey(page);
  await expect(rows(page)).toHaveCount(SEARCH_HITS.length);

  // 고정 답은 문서 줄이다 — 글리프가 없는 갈래이고, **빈 슬롯이 서야 하는** 쪽이다.
  const docRow = await gutterOf(rows(page).first());
  // **머리는 글자의 x를 잰다 — 상자가 아니다.** 상자는 줄과 같은 자리에서 시작하고 안쪽
  // padding으로 글자를 미는데, 눈이 보는 세로선은 그 글자 쪽이다.
  const headX = await page.locator("[data-head]").first().evaluate((el) => {
    const range = document.createRange();
    range.selectNodeContents(el);
    return range.getBoundingClientRect().x;
  });
  expect(docRow.glyphMidY, "문서 줄에 글리프가 섰다").toBeNull();

  // **구획 머리는 글리프와 같은 컬럼이고, 줄 글자와는 26px 갈린다.**
  expect(Math.round(headX)).toBe(Math.round(docRow.slotX));
  expect(Math.round(docRow.nameX - headX)).toBe(26);

  // 같은 팔레트에서 층이 셋인 답으로 갈아 끼운다 — 가는 곳·작업·본문이 함께 선다.
  // **작업 줄이 여기 있어야 하는 이유가 티켓의 문장이다**: 「이름의 x가 목적지 줄과 작업
  // 줄에서 같다」. 고정 답은 문서 줄만 내므로 그 층은 이 답으로만 잴 수 있다.
  await box(page).pressSequentially(SEARCH_DESTINATION_QUERY);
  await expect(rows(page)).toHaveCount(3);
  const [destRow, workRow, textRow] = [
    await gutterOf(rows(page).nth(0)),
    await gutterOf(rows(page).nth(1)),
    await gutterOf(rows(page).nth(2)),
  ];

  // **세 층의 글자 시작점이 하나다.** 문서 줄은 위에서 이미 쟀다.
  expect(Math.round(destRow.nameX)).toBe(Math.round(docRow.nameX));
  expect(Math.round(workRow.nameX), "작업 줄의 글자 시작점이 갈렸다").toBe(
    Math.round(docRow.nameX),
  );
  expect(Math.round(textRow.nameX), "본문 줄의 글자 시작점이 갈렸다").toBe(
    Math.round(docRow.nameX),
  );
  // 글리프를 드는 것은 **목적지 줄뿐이다**(결정 17). 나머지는 슬롯만 서고 비어 있다.
  expect(workRow.glyphMidY, "작업 줄에 글리프가 섰다").toBeNull();
  expect(textRow.glyphMidY, "본문 줄에 글리프가 섰다").toBeNull();

  // **글리프가 실제로 섰고, 세로로 줄 한가운데다.** `self-center`가 빠지면 글자 베이스라인에
  // 앉아 사이드바와 세로 위치가 갈리는데, 그 어긋남은 이 층에서만 보인다.
  expect(destRow.glyphMidY, "목적지 줄에 글리프가 없다").not.toBeNull();
  expect(Math.abs(destRow.glyphMidY! - destRow.rowMidY)).toBeLessThan(1.5);

  // **거터가 스니펫 바닥을 안 깎았다.** 결정 18이 거터를 줄 padding이 아니라 flex 자식으로
  // 문 이유가 이것이고, 지금까지 어느 층도 그것을 안 쟀다.
  //
  // `basis-1/3`은 **컨테이너 내용폭**의 1/3이라, padding으로 밀었다면 바닥이 그만큼 깎인다
  // (26px ÷ 3 ≈ 8.7px). 그래서 「스니펫이 내용폭의 1/3이다」로는 못 잡는다 — 그 등식은 두
  // 설계에서 다 참이다. 재는 것은 **줄 상자에서 기본 padding만 뺀 값**의 1/3이고, 그래서
  // 그 padding이 여전히 10px 두 쪽인 것을 바로 아래에서 따로 못박는다.
  const floor = await rows(page).nth(2).evaluate((el) => {
    const style = getComputedStyle(el);
    const snippet = el.querySelectorAll("span");
    return {
      padX: parseFloat(style.paddingLeft) + parseFloat(style.paddingRight),
      rowWidth: el.getBoundingClientRect().width,
      snippetWidth: snippet[snippet.length - 1].getBoundingClientRect().width,
    };
  });
  expect(floor.padX, "줄의 좌우 padding이 px-2.5가 아니다").toBe(20);
  expect(floor.snippetWidth).toBeCloseTo((floor.rowWidth - floor.padX) / 3, 1);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 16·77·97. 방향키로 고른 것이 열리고, **분할이 그대로 남는다.**
test("방향키로 고른 문서로 가고 분할이 안 무너진다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${specWork.slug}?tab=terminal&split=lr`);
  await expect(page.locator(".xterm")).toHaveCount(1);

  await pressSearchKey(page);
  await expect(rows(page).nth(0)).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("ArrowDown");
  await expect(rows(page).nth(1)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowUp");
  await expect(rows(page).nth(0)).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("ArrowDown");

  await page.keyboard.press("Enter");

  await expect(palette(page)).toHaveCount(0);
  // 주소가 **고른 줄의 문서**를 가리킨다. 첫 줄로 갔으면 여기가 빨개진다 — 방향키가
  // 표시만 옮기고 Enter가 늘 첫 줄을 여는 퇴화가 그 모양이다.
  await expect
    .poll(() => new URL(page.url()).searchParams.get("file"))
    .toBe(specWork.specFiles[1]);
  // **분할이 그대로다**(결정 16) — 문서를 갈아 끼우려고 화면을 다시 만들지 않는다.
  await expect(page).toHaveURL(/split=lr/);
  // 문서를 골랐으므로 본문은 spec으로 돌아온다(결정 50).
  await expect(page).not.toHaveURL(/tab=terminal/);
  // 화면에 선 것도 **그 문서**다 — 둘째 줄이 그림이라 본문이 그림으로 선다. 첫 줄을 열었으면
  // 마크다운이 서므로 주소와 화면이 함께 갈린다.
  await expect(page.locator("main img")).toHaveCount(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 「키보드가 주인 도구」여도 손이 마우스에 있을 때가 있다. 클릭은 정적 마크업 seam에
// 이벤트가 없어 안 보인다 — 줄이 `<button>`이라는 것까지가 그쪽이 드는 전부다.
test("마우스로도 고를 수 있다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${specWork.slug}`);
  await expect(page.locator("main").getByRole("heading", { name: "개요" })).toBeVisible();

  await pressSearchKey(page);
  await rows(page).nth(1).click();

  await expect(palette(page)).toHaveCount(0);
  await expect
    .poll(() => new URL(page.url()).searchParams.get("file"))
    .toBe(specWork.specFiles[1]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("Esc로 닫히고 주소도 포커스도 제자리다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${specWork.slug}?tab=terminal`);
  // 화면이 서기를 기다린다 — 앱이 뜨기 전에 누르면 키를 듣는 자리가 아직 없다.
  await expect(page.locator(".xterm")).toHaveCount(1);
  // **이 줄이 아래 포커스 검사의 전제다.** 포커스가 애초에 셸에 없으면 돌려주는 것을
  // 아무것도 안 잰다.
  await expect.poll(() => focusedClass(page)).toContain("xterm-helper-textarea");
  const before = page.url();

  await pressSearchKey(page);
  await expect(palette(page)).toBeVisible();
  // 입력칸이 생기면서 포커스가 셸을 떠난다 — 빌린 것이 있어야 돌려줄 것도 있다.
  await expect(box(page)).toBeFocused();

  await page.keyboard.press("Escape");

  await expect(palette(page)).toHaveCount(0);
  expect(page.url()).toBe(before);
  // **빌린 포커스를 돌려준다.** 안 돌려주면 Esc 뒤에 친 글자가 아무 데도 안 들어간다.
  await expect.poll(() => focusedClass(page)).toContain("xterm-helper-textarea");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 4. 「어디서 눌렸나」와 「화면에 무엇이 떠 있나」는 다른 물음이고, 뒤엣것은 부르는
// 쪽(앱 셸)이 든다 — 물음에 답하는 중에 화면이 가려지면 안 된다.
// 판 01의 ⌘K에 **누를 수 있는 자리**가 하나 붙었다 — 셸 컨트롤 행의 마지막 칸이다.
// 이 층이 드는 것은 「버튼이 있다」가 아니라 **「눌러서 실제로 팔레트가 뜬다」**다: 정적 마크업
// seam에는 이벤트가 없어 아무 데도 배선되지 않은 버튼을 초록으로 통과시킨다.
//
// **함께 드는 것이 「여는 자리가 하나인가」다.** 뜨는 것이 ⌘K가 여는 것과 같은 조각이어야
// 하므로 위 검사들과 같은 기준으로 잰다 — 줄 수, 그리고 그 조각만 하는 일인 포커스 빌리기.
//
// 마지막 줄은 **떠 있을 때 그 자리가 무엇인가**다. 팔레트 배경이 셸 컨트롤 행을 덮으므로
// 다시 누르면 닫힌다 — 버튼이 토글을 따로 안 드는 근거가 그것이라, 안 재면 「눌러도 아무 일도
// 안 난다」로 퇴화해도 티가 안 난다.
test("검색 버튼이 ⌘K와 같은 팔레트를 연다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await expect(page.locator(".xterm")).toHaveCount(1);

  // **누를 자리를 미리 잰다** — 열리고 나면 팔레트 배경이 덮어 버튼을 locator로 못 누른다.
  const at = await searchButton(page).boundingBox();
  expect(at, "셸 컨트롤 행에 검색 버튼이 없다").not.toBeNull();
  const point = { x: at!.x + at!.width / 2, y: at!.y + at!.height / 2 };

  await searchButton(page).click();

  // **뜨는 것이 하나여야 한다** — locator가 strict라 팔레트가 둘이면 이 줄에서 터진다.
  // 버튼이 제 상태를 따로 들면 정확히 그 모양이 된다.
  await expect(palette(page)).toBeVisible();
  await expect(rows(page)).toHaveCount(SEARCH_HITS.length);
  // 포커스를 가져오는 것은 팔레트 조각의 일이다 — ⌘K로 연 것과 같은 것이 떴다는 뜻이다.
  await expect(box(page)).toBeFocused();

  // 같은 자리를 다시 누른다. 그 위에 있는 것은 버튼이 아니라 팔레트의 배경이라 닫힌다.
  await page.mouse.click(point.x, point.y);

  await expect(palette(page)).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("확인 창이 떠 있는 동안에는 안 열린다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  // **pty가 앉은 뒤에 닫아야 확인 창이 뜬다**(`awaitSpawned`의 머리말).
  await awaitSpawned(page, 1);
  await page.locator('[data-tab="shell"] button[aria-label$="닫기"]').click();
  const ask = page.getByRole("alertdialog");
  await expect(ask).toBeVisible();

  await pressSearchKey(page);

  await expect(palette(page)).toHaveCount(0);
  // 창은 그대로 서 있다 — 팔레트가 그 위를 덮지도, 창을 대신 닫지도 않는다.
  await expect(ask).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 17·21 — **⇧⇧는 지금 서 있는 세계만 본다.**
//
// 한 검사가 **세 번 연다**: 이쪽 → 저쪽 → 다시 이쪽. 저쪽에서 한 번만 열어 보면 「세계를
// 탄다」와 「어디서 열든 Maison 것이 온다」가 갈리지 않고, 돌아오는 길이 있어야 세계가
// 화면에 **머무는 값**이 아니라 지금 서 있는 자리에서 나온다는 것이 보인다.
//
// 「무엇이 있는가」를 기록에서 함께 읽는다 — 픽스처의 답은 심어 둔 것이라, 목록이 저쪽 것인
// 채로 나가도 화면에는 그 답이 그대로 선다.
test("세계를 건너면 ⌘K가 저쪽 세계를 안 본다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await expect(page.locator(".xterm")).toHaveCount(1);

  await pressSearchKey(page);
  await expect(rows(page)).toHaveCount(SEARCH_HITS.length);
  // **순서까지 본다.** 코어가 건넨 순서로 「가는 곳」 줄이 서므로(`search.rs`의
  // `destination_hits`) 이 배열이 곧 팔레트에 서는 순서이고, `Settings`가 맨 뒤인 것도
  // 그 계약이다(결정 51).
  await expect.poll(() => destinationsAsked(page)).toEqual([
    "projects",
    "terminal",
    "archive",
    "settings",
  ]);
  await page.keyboard.press("Escape");

  await modeButton(page, "Maison").click();
  await expect(page).toHaveURL(`/maison/rooms/${room.slug}`);

  await pressSearchKey(page);
  // **줄 수부터 갈린다** — 저쪽 답이 왔으면 넷이 선다(픽스처의 `MAISON_SEARCH_HITS`).
  await expect(rows(page)).toHaveCount(MAISON_SEARCH_HITS.length);
  await expect(page.getByRole("option", { name: room.title }).first()).toBeVisible();
  // 반대쪽 증거. 프런트가 한 자리에서 **저쪽 세계의 값**을 실으면 그것은 어디서도 오류가
  // 아니라(#187이 닫은 것은 빠뜨린 호출이지 틀린 값이 아니다), 그때 이 제목이 네 줄에 다 선다.
  await expect(page.getByRole("option", { name: specWork.title })).toHaveCount(0);
  // `Projects`가 빠진 것은 줄인 게 아니라 이 세계에 프로젝트가 없어서다(결정 17).
  await expect.poll(() => destinationsAsked(page)).toEqual(["terminal", "archive", "settings"]);
  await page.keyboard.press("Escape");

  await modeButton(page, "Atelier").click();
  await expect(page).toHaveURL("/terminal");

  await pressSearchKey(page);
  await expect(rows(page)).toHaveCount(SEARCH_HITS.length);
  await expect(page.getByRole("option", { name: room.title })).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 10·16 — **고른 줄이 그 세계 안에 머문다.**
//
// 주소와 **기억이 함께** 갈려야 한다(`hit-target.ts`): 기억은 (mode, slug)로 찾는데
// (`-work-search.ts`의 `lastView`) 결정 10이 두 세계에 같은 slug를 허용하므로, 주소만 옮기고
// 기억을 Atelier로 두면 Maison에서 연 Room이 저쪽 세계의 같은 이름 기억으로 열린다.
//
// 터미널에서 연다 — 이미 그 Room에 서 있으면 「갔다」와 「원래 거기였다」가 안 갈린다.
test("Maison에서 고른 문서 줄은 Maison 주소로 간다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/maison/terminal");
  await expect(page.locator(".xterm")).toHaveCount(1);

  await pressSearchKey(page);
  // **목록이 선 뒤에 방향키다**(형제 검사들과 같은 규율). 빈 목록에 ArrowDown이 닿으면
  // `Math.min(at + 1, hits.length - 1)`가 `Math.min(0, -1)` = -1을 앉히고, 뒤늦게 줄이 와도
  // `at = Math.min(selected, …)`가 그대로 -1이라 **자리가 되살아나지 않는다** — 이어지는
  // Enter가 `at >= 0`에 걸려 팔레트가 영영 안 닫힌다. 재시도로도 안 풀리는 하드 실패다.
  //
  // 줄 수까지 함께 못 박는 것은 아래 「둘째 줄이 문서 줄이다」의 전제가 여기서 서기 때문이다.
  await expect(rows(page)).toHaveCount(MAISON_SEARCH_HITS.length);
  await expect(rows(page).nth(0)).toHaveAttribute("aria-selected", "true");
  // 둘째 줄이 문서 줄이다(첫 줄은 Room 자신). 문서 줄을 고르는 것은 **`file`이 함께 실리는지**
  // 까지 한 번에 보기 위해서다 — work 줄만 고르면 주소의 앞부분만 재고 끝난다.
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");

  await expect(palette(page)).toHaveCount(0);
  // `/works/…`가 **아니다.** 그 되돌림은 「없는 work」 화면 하나로만 보인다.
  await expect.poll(() => new URL(page.url()).pathname).toBe(`/maison/rooms/${room.slug}`);
  expect(new URL(page.url()).searchParams.get("file")).toBe(ROOM_DOC);
  // 화면에 선 것도 **그 Room 자신의 문서**다. 주소만 보면 읽기가 Atelier로 나가도 초록이다 —
  // 목록과 읽기가 다른 명령이라 한쪽만 세계를 빠뜨릴 수 있다(`maison-rooms.spec.ts`).
  await expect(page.getByText(ROOM_BODY)).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 21·51의 Maison 쪽. 위 「설정 줄을 고르면 설정 화면이 선다」와 같은 물음을 재는데,
// 그 검사가 이쪽까지 못 드는 것은 `/settings`에 **모드 접두사가 없어서**다 — 두 세계가 같은
// 화면으로 가므로, 고르고 나서도 어느 세계의 표에서 주소를 풀었는지가 화면에 안 남는다.
// `Terminal`은 남는다: 표를 안 보고 리터럴로 적으면 그 자리에서 세계를 건넌다.
test("Maison에서 고른 목적지 줄은 그 세계의 화면을 세운다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/maison/rooms/${room.slug}`);
  await expect(page.getByText(ROOM_BODY)).toBeVisible();

  await pressSearchKey(page);
  await expect(box(page)).toBeFocused();
  await box(page).pressSequentially(MAISON_SEARCH_DESTINATION_QUERY);

  // **`exact`가 있어야 한다** — 위 설정 줄 검사와 같은 이유다(이름 맞추기가 대소문자를 접어
  // 라벨 되찾기가 통째로 죽어도 key `terminal`이 그대로 서면 초록이 된다).
  const row = page.getByRole("option", { name: "Terminal", exact: true });
  await expect(rows(page)).toHaveCount(1);
  await expect(row).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Enter");

  await expect(palette(page)).toHaveCount(0);
  await expect(page).toHaveURL("/maison/terminal");
  // **주소만 보면 화면이 안 서도 초록이다.** 그 세계의 셸이 실제로 뜬다.
  await expect(page.locator(".xterm")).toHaveCount(1);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **확인 창이 막는 것은 팔레트뿐이다** — 사이드바 토글은 그 뒤에서도 먹는다.
//
// 이 한 줄이 없으면 조용히 죽는다. 두 키가 같은 파일에서 window를 듣고 있어, 위 검사를
// 초록으로 만드는 게이트를 핸들러 맨 위로 한 칸만 올리면 ⌘B가 함께 막히는데 **타입도
// 다른 검사도 아무것도 안 잡는다**(⇧⇧ 리스너가 실제로 그 모양이었다). 그 키가 답을
// 요구하지 않는다는 것이 갈리는 근거다 — 창은 그대로 서 있고 뒤 화면만 접힌다.
test("확인 창이 떠 있어도 ⌘B는 먹는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  const sidebar = page.locator("aside").first();
  const opened = (await sidebar.boundingBox())?.width ?? 0;
  expect(opened, "사이드바가 처음부터 접혀 있으면 이 검사가 아무것도 못 잰다").toBeGreaterThan(0);

  await page.locator('[data-tab="shell"] button[aria-label$="닫기"]').click();
  const ask = page.getByRole("alertdialog");
  await expect(ask).toBeVisible();

  await page.keyboard.press("Meta+b");

  await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBe(0);
  // 창은 그대로다 — 접힌 것은 뒤 화면이고, 답해야 하는 물음은 그대로 서 있다.
  await expect(ask).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **떠 있는 동안 뒤가 어두워지고, 스크롤 막대가 사라진다.**
//
// 이 층에서만 보인다: `backdrop-filter`도 막대의 `display`도 진짜 CSS가 있어야 나고, 막대는
// **구르기 전엔 DOM에 노드조차 없다**(`lib/scroll-quiet.ts` — 문서에 한 쌍을 게을리 만든다).
// 그래서 먼저 굴려 막대를 세운 다음 팔레트를 연다.
//
// 막대를 걷는 이유가 층 순서에 있다 — 막대는 `z-index: 45`이고 막이 `z-50`이라 막대가
// **아래**에 깔리는데, 막이 반투명이라 그대로 비친다. 올려서 풀지 않는 것은 뒤 화면이 팔레트가
// 떠 있는 동안 구를 수 없기 때문이다(막이 포인터를 다 받는다) — 구를 수 없는 것의 막대는
// 거짓말이다. 사람이 실물에서 그것을 보고 말했다: 「스크롤바가 뒤에서 튀는게 보임」.
test("팔레트가 뜨면 뒤가 흐려지지 않고 어두워지며, 막대가 걷힌다", async ({ page }) => {
  await installFixtureBackend(page);
  // 사이드바 목록이 넘치도록 창을 낮춘다 — 고정 데이터의 work은 넷이라 기본 높이로는 안
  // 넘치고, 안 넘치면 굴러도 막대가 안 선다(scrollbar.spec.ts와 같은 준비).
  await page.setViewportSize({ width: 1280, height: 240 });
  await page.goto("/projects");

  // 굴려서 막대를 세운다 — 이게 없으면 아래 단언이 「없는 노드」를 보고 초록이 된다.
  const list = page.locator("aside .scroll-quiet");
  await list.evaluate((el) => el.scrollBy(0, 40));
  const bar = page.locator('[data-scrollbar="vertical"]');
  await expect(bar).toHaveAttribute("data-on", "");

  await pressSearchKey(page);
  await expect(palette(page)).toBeVisible();

  // **막대가 걷힌다.** `opacity: 0`이 아니라 `display: none`인 것은, 스크립트가 `data-on`을
  // 다시 걸면 opacity 싸움에서 이기기 때문이다.
  await expect(bar).toHaveCSS("display", "none");

  // **흐리지 않는다.** `backdrop-blur`는 뒤 화면의 글자를 뭉개 무엇 위에 떠 있는지를 지웠다.
  // **막을 클래스로 집는다.** 이 저장소는 보통 모양이 아니라 표식으로 가르지만, 여기서는
  // 「세 모달이 같은 유틸리티를 쓴다」 자체가 계약이라 그 이름이 곧 정체성이다.
  const scrim = page.locator("div.modal-scrim");
  await expect(scrim).toHaveCount(1);
  await expect(scrim).toHaveCSS("backdrop-filter", "none");
  // **어둡게만 한다** — 배경색을 덮으면 라이트 테마에서 뒤가 오히려 밝아진다.
  await expect(scrim).toHaveCSS("background-color", "rgba(0, 0, 0, 0.25)");

  // 닫으면 표식이 걷혀 막대가 되돌아온다 — 남으면 앱이 도는 내내 막대가 없다.
  await page.keyboard.press("Escape");
  await expect(palette(page)).toHaveCount(0);
  await expect(bar).not.toHaveCSS("display", "none");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 24 — **바닥이 녹으면 더 있다는 뜻이다.** 한때 「일부만 보입니다 — 더 치면 좁혀집니다」가
// 목록 아래 서 있었고 사람이 걷으라고 했다: 「맨 아래는, 만약 더 있다면, 더 있다고 인식될
// 만한 디자인이 필요할 것 같음」.
//
// **묘수는 페이드와 같은 길이의 바닥 여백이다.** 마스크는 상자에 상시 걸려 스크롤을 따라
// 움직이지 않으므로 아래 24px이 늘 녹는데, 콘텐츠 끝에 같은 길이의 빈 여백을 두면 바닥까지
// 구른 순간 그 여백이 페이드 자리로 올라온다 — **지울 글자가 없다.** 중간에서만 다음 줄이
// 녹는다. 이 층에서만 보인다: 마스크도 여백도 진짜 CSS와 레이아웃이 있어야 나고, 「바닥에서
// 마지막 줄이 온전한가」는 실제로 굴려 봐야 답이 난다.
test("목록 바닥이 녹아 「더 있다」를 말하고, 바닥에 닿으면 지울 것이 없다", async ({ page }) => {
  await installFixtureBackend(page);
  // 목록이 넘치도록 낮춘다 — 안 넘치면 「바닥까지 굴린다」가 아무것도 안 잰다.
  // 고정 데이터의 줄은 넷뿐이라 카드(`max-h-[60vh]`)를 이만큼 눌러야 넘친다.
  await page.setViewportSize({ width: 1280, height: 240 });
  await page.goto("/projects");
  // 버튼으로 연다 — 여기서 재는 것은 목록 바닥이라 여는 길이 무엇이든 같다.
  await searchButton(page).click();
  await expect(palette(page)).toBeVisible();

  const list = palette(page);
  const 규격 = await list.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      mask: cs.maskImage,
      pb: cs.paddingBottom,
      over: el.scrollHeight > el.clientHeight + 1,
    };
  });
  expect(규격.over, "목록이 안 넘쳐서 아래를 아무것도 못 잰다").toBe(true);
  expect(규격.mask).toContain("linear-gradient");
  // **페이드 길이와 바닥 여백이 같은 수여야 한다** — 다르면 바닥에서 마지막 줄이 녹거나
  // (여백이 짧다) 빈 자리가 남는다(여백이 길다). 그 「같음」이 이 판의 전부다.
  expect(규격.mask).toContain(규격.pb.replace(/px$/, "px"));
  expect(규격.pb).toBe("24px");

  // 바닥까지 구른다.
  await list.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await expect
    .poll(() => list.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight))
    .toBeLessThanOrEqual(1);

  // **마지막 줄이 페이드 밖에 선다.** 여백이 없으면 여기가 페이드 안으로 들어와 흐려진다.
  const 여유 = await list.evaluate((el) => {
    const rows = el.querySelectorAll("[data-row]");
    const last = rows[rows.length - 1].getBoundingClientRect();
    const fade = parseFloat(getComputedStyle(el).paddingBottom);
    return el.getBoundingClientRect().bottom - fade - last.bottom;
  });
  expect(여유, "바닥까지 굴렸는데 마지막 줄이 페이드에 걸린다").toBeGreaterThanOrEqual(0);

  // 그리고 걷힌 줄은 돌아오지 않는다.
  await expect(page.getByText("일부만 보입니다")).toHaveCount(0);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

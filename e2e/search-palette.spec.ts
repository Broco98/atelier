import { SEARCH_GAP_MS } from "@/features/terminal/shell-registry";
import { expect, test } from "./evidence";
import type { Page } from "./evidence";
import {
  MAISON_SEARCH_DESTINATION_QUERY,
  MAISON_SEARCH_HITS,
  ROOMS,
  ROOM_SPEC_FILE_BODIES,
  SEARCH_DESTINATION_QUERY,
  SEARCH_HITS,
  WORKS,
} from "./fixtures";
import { installFixtureBackend, readIpcRecord, unknownIpcCalls } from "./harness";

// 판 01 — ⇧⇧로 열고, 치면 좁혀지고, 방향키로 고르고, Enter로 간다.
//
// **마크업 seam이 보는 것은 여기서 다시 보지 않는다.** 줄에 무엇이 적히는지·골라진 줄이
// 하나인지·없다고 말하는 줄은 SearchPalette.test.tsx가 들고, 맞추는 규칙과 상한은 코어
// 단위가 들고, 늦은 답을 버리는 것은 옵션 seam이 든다(hooks.test.ts). 이 층이 드는 것은
// 이벤트가 있어야만 보이는 것들이다 — 셸을 지나오는 키, 마우스, 실제 이동, 「떠 있는 창이
// 막는다」, 그리고 **친 것이 명령까지 가는 배선**.
//
// **가장 큰 것은 첫 검사다.** 「⇧ 단독 keydown이 xterm을 지나 window까지 오는가」는 실물
// xterm이 붙어야만 답이 나오고, 다른 층은 전부 xterm 없이 돈다.
//
// **세계도 이 층이 든다**(#185, 아래 셋). 물음에 세계가 실리는 것은 옵션 seam이(hooks.test.ts),
// 고른 줄이 어느 주소로 풀리는지는 순수 함수가 든다(hit-target.test.ts) — 그런데 그 둘에
// 건네지는 값은 셸이 주소와 저장소로 합성하는 것이라(`shellMode`), 그 한 자리만 Atelier로
// 누워도 앞의 두 층은 그대로 초록이다. 그리고 세계를 **건너간 뒤 다시 여는 것**은 여기 말고
// 도는 자리가 없다.

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

/** ⇧를 두 번 누른다. **사이에 아무 키도 안 낀다** — 끼면 무장이 풀린다. */
async function doubleShift(page: Page) {
  await page.keyboard.press("Shift");
  await page.keyboard.press("Shift");
}

/** 포커스가 xterm의 숨은 입력칸에 있는가 — 셸을 붙이면 그쪽이 스스로 가져간다. */
const focusedClass = (page: Page) =>
  page.evaluate(() => document.activeElement?.className ?? "");

test("⇧⇧가 셸에 포커스가 있는 동안에도 팔레트를 연다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await expect(page.locator(".xterm")).toHaveCount(1);
  // **이 줄이 이 검사의 전제다.** 포커스가 셸에 없으면 「셸을 지나온다」를 아무것도 안 잰다.
  await expect.poll(() => focusedClass(page)).toContain("xterm-helper-textarea");

  await doubleShift(page);

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

  await doubleShift(page);
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

  await doubleShift(page);
  await expect(box(page)).toBeFocused();
  await box(page).pressSequentially(SEARCH_DESTINATION_QUERY);

  // **`exact`가 있어야 한다.** 이름 맞추기는 대소문자를 접으므로, 라벨 되찾기가 통째로 죽어
  // key(`settings`)가 그대로 서도 `exact` 없이는 초록이 된다.
  const row = page.getByRole("option", { name: "Settings", exact: true });
  await expect(rows(page)).toHaveCount(1);
  await expect(row).toHaveAttribute("aria-selected", "true");

  await page.keyboard.press("Enter");

  await expect(palette(page)).toHaveCount(0);
  await expect(page).toHaveURL("/settings");
  // **주소만 보면 화면이 안 서도 초록이다.** 설정 화면의 구획 머리가 그 자리에 선다.
  await expect(page.getByRole("heading", { name: "터미널" })).toBeVisible();
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 30. 키만 보면 **⇧+클릭 두 번이 팔레트를 연다** — 그 사이에 keydown이 하나도 안 끼기
// 때문이다. 본문에서 선택을 늘리는 흔한 동작이 그 모양이고, 무장을 비우는 것이 순수 함수
// 밖에 사는 유일한 규칙이라 **잴 수 있는 자리가 여기뿐이다.**
test("⇧+클릭 두 번으로는 안 열린다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${specWork.slug}`);
  const body = page.locator("main").getByRole("heading", { name: "개요" });
  await expect(body).toBeVisible();

  const startedAt = Date.now();
  await body.click({ modifiers: ["Shift"] });
  await body.click({ modifiers: ["Shift"] });
  const elapsed = Date.now() - startedAt;

  await expect(palette(page)).toHaveCount(0);
  // **이 검사가 마우스 때문에 초록인지 시간 때문에 초록인지를 가른다.** 두 ⇧ 사이가 간격을
  // 넘겼으면 mousedown 규칙을 통째로 지워도 초록이라, 아무것도 안 재고 지나간다.
  expect(elapsed, "두 ⇧ 사이가 간격을 넘겼다 — 이 검사가 마우스를 재지 못한다").toBeLessThan(
    SEARCH_GAP_MS,
  );
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 결정 16·77·97. 방향키로 고른 것이 열리고, **분할이 그대로 남는다.**
test("방향키로 고른 문서로 가고 분할이 안 무너진다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${specWork.slug}?tab=terminal&split=lr`);
  await expect(page.locator(".xterm")).toHaveCount(1);

  await doubleShift(page);
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

  await doubleShift(page);
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

  await doubleShift(page);
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
test("확인 창이 떠 있는 동안에는 안 열린다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await page.locator('[data-tab="shell"] button[aria-label$="닫기"]').click();
  const ask = page.getByRole("alertdialog");
  await expect(ask).toBeVisible();

  await doubleShift(page);

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
test("세계를 건너면 ⇧⇧가 저쪽 세계를 안 본다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/terminal");
  await expect(page.locator(".xterm")).toHaveCount(1);

  await doubleShift(page);
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

  await doubleShift(page);
  // **줄 수부터 갈린다** — 저쪽 답이 왔으면 넷이 선다(픽스처의 `MAISON_SEARCH_HITS`).
  await expect(rows(page)).toHaveCount(MAISON_SEARCH_HITS.length);
  await expect(page.getByRole("option", { name: room.title }).first()).toBeVisible();
  // 반대쪽 증거. 백엔드에서 `mode`가 아직 선택 인자라(#187) 프런트가 한 자리에서 빠뜨려도
  // 오류가 아니라 조용히 Atelier 것이 오는데, 그때 이 제목이 네 줄에 다 선다.
  await expect(page.getByRole("option", { name: specWork.title })).toHaveCount(0);
  // `Projects`가 빠진 것은 줄인 게 아니라 이 세계에 프로젝트가 없어서다(결정 17).
  await expect.poll(() => destinationsAsked(page)).toEqual(["terminal", "archive", "settings"]);
  await page.keyboard.press("Escape");

  await modeButton(page, "Atelier").click();
  await expect(page).toHaveURL("/terminal");

  await doubleShift(page);
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

  await doubleShift(page);
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

  await doubleShift(page);
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

import { expect, test, type Locator, type Page } from "./evidence";
import { ARCHIVE, PROJECTS, WORKS } from "./fixtures";
import {
  awaitSpawned,
  fireAttention,
  installFixtureBackend,
  openShell,
  processesTitle,
  unknownIpcCalls,
  탭으로,
  띠,
  그림자,
  머리카드,
  색대비,
  이름표,
  칠한값,
  토큰값,
  토큰색,
  팔레트,
  행버튼,
} from "./harness";
import { settle } from "./tab-row";

// codex-ds 티켓 09 — **프리미티브가 Codex 모양을 입고, 키보드 포커스는 어디서나 같은 링이다**(codex-ds 스펙 §3 「프리미티브」 ·
// 결정 11 · DS `Keyboard`).
//
// 모양은 칠해진 값(computed style)을 토큰을 칠한 값과 맞대고, DS가 못박은 수(아이콘 버튼 28 · 반경 `lg` 10 · `md` 8 · `4xl` 24)는
// 따로 센다 — 토큰 값이 바뀌는 날 견줌이 함께 흘러가 초록으로 남지 않게(`frame.spec.ts`의 티켓 08 검사와 같은 길). 토큰이 없는
// 수(글자 버튼 32 · 입력 32 · 확인 창 400 · 작은 아이콘 버튼 24)는 DS 부품 값(`.at-btn.sm` · `.at-input` · `.at-dialog` ·
// `.at-ib.xs`)을 그대로 적는다.
//
// 링은 **Tab으로 들어가서** 잰다 — 마우스로 누르면 서지 않는 링(`:focus-visible`)이라, 키보드가 온 길로 닿아야 「사람이 Tab으로
// 다닐 때 보는 것」이다. 링은 accent 1px(`outline`) + 바깥 4px `focus-halo`(`box-shadow`)다.
//
// **WebKit의 Tab은 맨 `<button>`에 서지 않는다**(실측 10-11) — macOS의 「키보드 탐색」이 꺼진 기본값에서 Tab은 입력칸과
// `tabindex`를 단 것(Base UI 부품은 스스로 단다)만 다닌다. 사이드바 행과 셸 탭의 이름 버튼은 화면이 지은 버튼이라 `tabindex`를
// 명시해 Tab 정류장이 됐다(codex-ds 티켓 32 — 목록은 정류장 하나, 탭 줄은 칸마다). 그래서 여기서도 Tab이 온 길로 닿는다(`탭으로`).
// 사이드바 구획 머리는 목록 안의 행이라 Tab이 아니라 ↑로 간다 — 목록 안을 화살표로 옮긴 포커스도 키보드가 온 길이라 `:focus-visible`이다.

const project = PROJECTS[0];
const [, plainWork] = WORKS;

/** 그 요소에 칠해진 포커스 링 — `outline`(굵기 · 모양 · 색)과 자리, `box-shadow`. */
async function 링(target: Locator) {
  const [굵기, 모양, 색, 자리, 그림자층] = await 칠한값(
    target,
    "outline-width",
    "outline-style",
    "outline-color",
    "outline-offset",
    "box-shadow",
  );
  return { 선: `${굵기} ${모양} ${색}`, 자리, 그림자층 };
}

/** 링이 DS 값인가 — accent 1px 실선이 테두리 바로 바깥(offset 0)에, 그 바깥으로 `focus-halo` 4px. */
async function 링이선다(page: Page, target: Locator, 이름: string): Promise<void> {
  const accent = await 토큰색(page, "--accent");
  const halo = await 토큰색(page, "--focus-halo");
  // 색 전환(`transition-colors`)을 단 것은 outline 색도 함께 건너간다 — 다 건너간 값을 잰다.
  await target.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished.catch(() => undefined))));
  const { 선, 자리, 그림자층 } = await 링(target);
  expect(선, `${이름} — 링의 선`).toBe(`1px solid ${accent}`);
  expect(자리, `${이름} — 링의 자리`).toBe("0px");
  expect(그림자층, `${이름} — 링의 무리`).toContain(`${halo} 0px 0px 0px 4px`);
  await 링이다보인다(target, 이름);
}

/** 링이 테두리 바깥으로 차지하는 폭 — `focus-halo` 4px이다(DS `Keyboard` 「바깥 4px」). accent 1px 선은 그 안쪽에 겹친다. */
const 링폭 = 4;

/**
 * 링이 **다 칠해지는가** — 넘침을 자르는 조상(`overflow`가 `visible`이 아닌 상자 — 가로로 구르는 탭 줄 · 접히는 구획 · 목록)이
 * 링을 자르지 않는다. computed 값만 보면 잘린 링도 「같은 링」으로 읽힌다: 링은 칠해지지만 그 상자의 안쪽 테두리(padding
 * 상자) 밖은 화면에 안 나온다. 그래서 요소 상자를 링 폭만큼 부풀린 사각형이 자르는 상자마다 그 안쪽 테두리 안에 드는지 잰다.
 * 자르는 축만 본다 — `overflow-x`만 `clip`인 상자는 세로로 안 자른다.
 *
 * 페이지 안에서 도는 함수다(`evaluateAll`) — 자르는 변을 `<상자> 변`으로 돌려준다. `굴러나간것은뺀다`면 자르는 상자 안에
 * 다 들어와 있지 않은 요소(굴러서 반쯤 · 통째로 나간 것, 접힌 구획 안의 것)는 세지 않는다 — 그 링이 안 보이는 것은 그 요소가
 * 안 보이기 때문이다. 크기가 없는 요소도 같다. **링을 안쪽에 입는 것**(`data-ring-inset` — 카드 끝까지 차는 문서 글)은 테두리
 * 바깥으로 차지하는 것이 없어 요소 상자 그대로 잰다.
 */
function 잘린링(els: Element[], { 폭: 바깥폭, 굴러나간것은뺀다 }: { 폭: number; 굴러나간것은뺀다: boolean }): string[] {
  const cut: string[] = [];
  for (const el of els) {
    const box = el.getBoundingClientRect();
    const 폭 = el.hasAttribute("data-ring-inset") ? 0 : 바깥폭;
    if (굴러나간것은뺀다 && (box.width === 0 || box.height === 0)) continue;
    const 이름 = `<${el.tagName.toLowerCase()}> 「${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 24)}」`;
    const 변: string[] = [];
    for (let at = el.parentElement; at; at = at.parentElement) {
      const style = getComputedStyle(at);
      const [가로, 세로] = [style.overflowX !== "visible", style.overflowY !== "visible"];
      if (!가로 && !세로) continue;
      const r = at.getBoundingClientRect();
      const 안 = {
        left: r.left + parseFloat(style.borderLeftWidth),
        right: r.right - parseFloat(style.borderRightWidth),
        top: r.top + parseFloat(style.borderTopWidth),
        bottom: r.bottom - parseFloat(style.borderBottomWidth),
      };
      const 들어와있다 =
        box.left >= 안.left - 0.5 && box.right <= 안.right + 0.5 && box.top >= 안.top - 0.5 && box.bottom <= 안.bottom + 0.5;
      if (굴러나간것은뺀다 && !들어와있다) {
        변.length = 0;
        break;
      }
      const 상자 = `<${at.tagName.toLowerCase()} class="${at.getAttribute("class") ?? ""}">`;
      if (가로 && box.left - 폭 < 안.left - 0.5) 변.push(`${상자} 왼쪽 ${(box.left - 안.left).toFixed(1)}px`);
      if (가로 && box.right + 폭 > 안.right + 0.5) 변.push(`${상자} 오른쪽 ${(안.right - box.right).toFixed(1)}px`);
      if (세로 && box.top - 폭 < 안.top - 0.5) 변.push(`${상자} 위 ${(box.top - 안.top).toFixed(1)}px`);
      if (세로 && box.bottom + 폭 > 안.bottom + 0.5) 변.push(`${상자} 아래 ${(안.bottom - box.bottom).toFixed(1)}px`);
    }
    cut.push(...변.map((one) => `${이름} — ${one}`));
  }
  return cut;
}

async function 링이다보인다(target: Locator, 이름: string): Promise<void> {
  const 잘림 = await target.evaluateAll(잘린링, { 폭: 링폭, 굴러나간것은뺀다: false });
  expect(잘림, `${이름} — 링을 자르는 상자(그 변과, 상자 끝까지 남은 거리)`).toEqual([]);
}

test("키보드 포커스는 버튼 · 아이콘 버튼 · 입력 · 토글 · 사이드바 행 · 탭에서 같은 링이다", async ({ page }) => {
  await installFixtureBackend(page);

  // Projects — 글자 버튼 · 아이콘 버튼과, 상자가 링을 입는 검색칸(포커스는 안의 입력칸에 있다).
  await page.goto(`/projects/${project.slug}`);
  const 검색 = page.getByRole("textbox", { name: "프로젝트 검색", exact: true });
  await 탭으로(page, 검색);
  await 링이선다(page, page.locator("[data-slot=input-group]"), "검색칸");
  const 아이콘버튼 = page.getByRole("button", { name: "프로젝트 등록", exact: true });
  await 탭으로(page, 아이콘버튼);
  await 링이선다(page, 아이콘버튼, "아이콘 버튼");
  const 글자버튼 = page.getByRole("button", { name: "폴더 열기", exact: true });
  await 탭으로(page, 글자버튼);
  await 링이선다(page, 글자버튼, "글자 버튼");
  // 링은 포커스가 있는 동안만이다 — 떠난 자리에는 선도 무리도 없다.
  const 떠난자리 = await 링(아이콘버튼);
  expect(떠난자리.선, "떠난 자리에 링의 선이 남았다").not.toContain("solid");
  expect(떠난자리.그림자층, "떠난 자리에 링의 무리가 남았다").not.toContain(await 토큰색(page, "--focus-halo"));

  // Settings — 입력칸과 칩 토글.
  await page.goto("/settings/terminal");
  const 입력 = page.getByRole("textbox", { name: "터미널 글꼴", exact: true });
  await 탭으로(page, 입력);
  await 링이선다(page, 입력, "입력칸");
  const 칩 = page.getByRole("group", { name: "글꼴 프리셋", exact: true }).getByRole("button").first();
  await 탭으로(page, 칩);
  await 링이선다(page, 칩, "칩 토글");

  // 작업 화면 — 사이드바 행의 이름 버튼 · 구획 머리와 셸 탭의 이름 버튼. 부품이 아니라 화면이 지은 버튼이고, 전에는 링이 없던
  // 자리다. 셸 입력칸은 Tab을 셸에 보내므로 포커스를 내려놓고 창의 Tab 차례에서 간다.
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const 행 = 행버튼(page, plainWork.title);
  await 탭으로(page, 행);
  await 링이선다(page, 행, "사이드바 행");
  const 구획머리 = page.locator("[data-worklist] [data-section]").first();
  for (let n = 0; n < 6 && !(await 구획머리.evaluate((el) => el === document.activeElement)); n += 1) {
    await page.keyboard.press("ArrowUp");
  }
  await expect(구획머리).toBeFocused();
  await 링이선다(page, 구획머리, "사이드바 구획 머리");
  const 셸탭 = 이름표(page, 0);
  await 탭으로(page, 셸탭);
  await 링이선다(page, 셸탭, "셸 탭");

  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **링은 어느 화면에서도 안 잘린다** — 위 검사가 몇 자리에 포커스를 주고 재는 「다 칠해지는가」를, 화면마다 링을 다는
// 것(`focus-ring`) 전부로 넓힌다. 링은 포커스가 있어야 칠해지지만 자르는 상자의 기하는 포커스와 상관없다 — 그래서 포커스 없이
// 상자만 잰다. 넘침을 자르는 상자(구르는 목록 · 접히는 구획 · 가로로 구르는 탭 줄)의 끝에 붙어 선 것은 그 변의 링이 통째로
// 사라진다 — 한 자리를 고쳐도 옆 화면의 같은 모양이 남았다(셸 탭 줄 · 사이드바 구획 · 프로젝트 · 아카이브 목록의 첫 행 ·
// 아카이브 문서 트리 · 편집기 트리). 굴러서 상자 밖으로 나간 것과 접힌 구획 안의 것은 세지 않는다(`잘린링`).
test("링을 다는 것은 어느 화면에서도 넘침을 자르는 상자에 링이 잘리지 않는다", async ({ page }) => {
  await installFixtureBackend(page);
  const 화면들: [string, Locator][] = [
    [`/projects/${project.slug}`, page.getByRole("textbox", { name: "프로젝트 검색", exact: true })],
    [`/archive/${ARCHIVE[0].slug}`, page.getByRole("heading", { name: "기록 — 치운 일" })],
    ["/processes", processesTitle(page)],
    ["/settings/terminal", page.getByRole("textbox", { name: "터미널 글꼴", exact: true })],
    ["/settings/spec-layout/edit", page.getByRole("tree", { name: "레이아웃 항목" })],
    [`/works/${WORKS[0].slug}`, 행버튼(page, WORKS[0].title)],
    [`/works/${plainWork.slug}?tab=terminal`, 이름표(page, 0)],
  ];
  for (const [주소, 앵커] of 화면들) {
    await page.goto(주소);
    await expect(앵커).toBeVisible();
    // 그리기가 멈춘 뒤에 잰다 — 링을 단 것의 수와 잘린 자리가 두 번 연달아 같고 도는 전환이 없을 때다.
    const { 잘림 } = await settle(page, async () => {
      const 링 = page.locator(".focus-ring");
      return { 수: await 링.count(), 잘림: await 링.evaluateAll(잘린링, { 폭: 링폭, 굴러나간것은뺀다: true }) };
    });
    expect(잘림, 주소).toEqual([]);
  }
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **알림 띠도 링이 안 잘린다** — 띠는 부르는 셸이 있어야 서는 상자라 위 화면 목록이 그리지 못한다. 띠 상자는 세로로 구르느라
// 넘침을 잘라(가로도 함께 잘린다) 상자 양끝에 붙어 선 줄의 링이 양옆에서 사라졌었다. 한 work의 셸 넷이 기다리면 줄 셋과 ⌄가
// 선다(띠의 상한 3) — 줄과 ⌄가 같은 상자 안이라 함께 잰다.
test("알림 띠의 줄과 ⌄도 링이 잘리지 않는다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}?tab=terminal`);
  await awaitSpawned(page, 1);
  for (let 칸 = 2; 칸 <= 4; 칸 += 1) await openShell(page);
  // 넷이 다 앉은 뒤에 쏜다(`openShell`이 칸마다 기다렸다 — `markAttention`의 착석 기다림은 칸 수가 그 번호와 같기를 본다).
  for (let pty = 1; pty <= 4; pty += 1) {
    await fireAttention(page, { agent: "claude", event: "Elicitation", payload: { message: "답을 기다린다" } }, pty);
  }
  const 링 = 띠(page).locator(".focus-ring");
  // 앵커: 줄 셋과 ⌄ 하나 — 띠가 안 서거나 접힌 채가 아니면 이 넷이다.
  await expect(링).toHaveCount(4);
  const { 잘림 } = await settle(page, async () => ({
    수: await 링.count(),
    잘림: await 링.evaluateAll(잘린링, { 폭: 링폭, 굴러나간것은뺀다: true }),
  }));
  expect(잘림).toEqual([]);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("버튼 · 아이콘 버튼 · 검색칸 · 입력의 높이와 반경이 DS 값이다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/projects/${project.slug}`);

  // 머리 카드의 글자 버튼 — DS `.at-btn.top`(24 · `radius-md`). 머리 줄에 서는 것은 모두 24다(창 컨트롤 · 작업 ⋯와 같다).
  const 버튼반경 = await 토큰값(page, "border-top-left-radius", "--radius-lg");
  expect(버튼반경, "radius-lg").toBe("10px");
  const 작은반경 = await 토큰값(page, "border-top-left-radius", "--radius-md");
  expect(작은반경, "radius-md").toBe("8px");
  expect(
    await 칠한값(머리카드(page).getByRole("button", { name: "폴더 열기", exact: true }), "height", "border-top-left-radius"),
    "머리 카드의 글자 버튼",
  ).toEqual(["24px", 작은반경]);
  // 아이콘 버튼 — Codex `IconButton`(`size-control` 정사각 · `radius-lg`). 동그란 아이콘 버튼은 걷혔다.
  const 컨트롤 = await 토큰값(page, "width", "--size-control");
  expect(컨트롤, "size-control").toBe("28px");
  expect(
    await 칠한값(
      page.getByRole("button", { name: "프로젝트 등록", exact: true }),
      "width",
      "height",
      "border-top-left-radius",
    ),
    "아이콘 버튼",
  ).toEqual([컨트롤, 컨트롤, 버튼반경]);
  // 검색칸 — DS `.at-search`(32 · `radius-lg` · `fill-soft` 면). 알약이 아니다.
  expect(
    await 칠한값(page.locator("[data-slot=input-group]"), "height", "border-top-left-radius", "background-color"),
    "검색칸",
  ).toEqual(["32px", 버튼반경, await 토큰색(page, "--fill-soft")]);

  // 입력칸 — DS `.at-input`(32 · `radius-md`).
  await page.goto("/settings/terminal");
  expect(
    await 칠한값(page.getByRole("textbox", { name: "터미널 글꼴", exact: true }), "height", "border-top-left-radius"),
    "입력칸",
  ).toEqual(["32px", 작은반경]);

  // 카드 안의 글자 버튼 — DS `.at-btn.sm`(32 · `radius-lg`, 에이전트 훅의 「설치」). 알약은 걷혔다(codex-ds 결정 3).
  await page.goto("/settings/hooks");
  expect(
    await 칠한값(page.locator("main").getByRole("button", { name: "설치", exact: true }), "height", "border-top-left-radius"),
    "카드 안의 글자 버튼",
  ).toEqual(["32px", 버튼반경]);

  // 작은 아이콘 버튼 — 머리 카드의 작업 ⋯와 분할(DS `.at-ib.xs` 24 · `radius-md`). 둘은 세로선을 사이에 두고 한 줄에 서고,
  // 머리 줄에 서는 것은 모두 24다 — 한 줄의 아이콘 버튼 상자가 다르면 하나만 튀어 보인다.
  await page.goto(`/works/${plainWork.slug}`);
  for (const name of ["작업 메뉴", "분할"]) {
    expect(
      await 칠한값(page.getByRole("button", { name, exact: true }), "width", "height", "border-top-left-radius"),
      name,
    ).toEqual(["24px", "24px", 작은반경]);
  }

  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("확인 창은 반경 24 · 짙은 그림자 · 옅은 막이고, 제목은 heading-xs다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/projects/${project.slug}`);

  await page.getByRole("button", { name: "제거", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: `'${project.name}' 제거` });
  await expect(dialog).toBeVisible();
  // 열림 애니메이션(크기 95% → 100%)이 끝난 뒤에 잰다 — 도는 동안의 폭은 400이 아니다.
  await expect.poll(() => dialog.evaluate((el) => el.getAnimations().length)).toBe(0);

  // DS `.at-dialog` — 폭 400 · `radius-4xl` · `shadow-prominent` + `shadow-2xl`(두 겹이 한 토큰 `shadow-modal`이다).
  const 겹 = `${await 토큰값(page, "box-shadow", "--shadow-prominent")}, ${await 토큰값(page, "box-shadow", "--shadow-2xl")}`;
  const [폭, 반경, 그림자층] = await 칠한값(dialog, "width", "border-top-left-radius", "box-shadow");
  const 창반경 = await 토큰값(page, "border-top-left-radius", "--radius-4xl");
  expect(창반경, "radius-4xl").toBe("24px");
  expect([폭, 반경, 그림자(그림자층)], "확인 창").toEqual(["400px", 창반경, 겹]);
  // 제목 16/24 · 600(`heading-xs`), 바닥 버튼은 카드 안 버튼(32).
  expect(await 칠한값(dialog.getByRole("heading"), "font-size", "line-height", "font-weight"), "제목").toEqual([
    "16px",
    "24px",
    "600",
  ]);
  for (const name of ["취소", "제거"]) {
    expect(await 칠한값(dialog.getByRole("button", { name, exact: true }), "height"), `${name} 버튼`).toEqual(["32px"]);
  }
  // 막은 Codex `scrim`이다.
  expect(
    await 칠한값(page.locator("[data-slot=alert-dialog-overlay]"), "background-color"),
    "막",
  ).toEqual([await 토큰색(page, "--scrim")]);

  // 묻기만 하고 닫는다 — 지우는 부름이 나가지 않는다.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **채운 면 위의 흰 것은 테마와 상관없이 희다**(DS `.at-btn.danger` · `.at-switch::after` — 둘 다 `#ffffff`). `fg-inverse`는 `fg` 면
// 위의 뒤집힌 글자라 다크에서 검어진다(`#0d0d0d`) — 그 이름을 빨간 면에 얹으면 다크에서 검은 글자가 빨강 위에 선다(4.3:1, 13px
// 글자의 바닥 4.5 아래). 앱은 `.dark`를 켜지 않지만(codex-ds 결정 17) 다크 값은 지금 맞아야 한다 — 그래서 `.dark`를 켜고 잰다.
test("위험 버튼의 글자와 스위치 손잡이는 다크에서도 희다", async ({ page }) => {
  await installFixtureBackend(page);
  // 테마는 하네스 `팔레트`로 갈아 끼운다 — 전환이 끝날 때까지 기다리고, 켤 때마다 팔레트가 정말 바뀌었는지(`surface`)를 먼저 센다.
  // 두 자리의 기대값(흰 글자 · `danger-solid`)은 두 테마에서 같은 값이라, 팔레트가 안 바뀌어도 이 검사만으로는 초록이 된다.

  await page.goto(`/projects/${project.slug}`);
  await page.getByRole("button", { name: "제거", exact: true }).click();
  const dialog = page.getByRole("alertdialog", { name: `'${project.name}' 제거` });
  await expect(dialog).toBeVisible();
  const 위험 = dialog.getByRole("button", { name: "제거", exact: true });
  for (const 다크 of [false, true]) {
    await 팔레트(page, 다크);
    const 자리 = 다크 ? "다크" : "라이트";
    const [글자, 면] = await 칠한값(위험, "color", "background-color");
    expect([글자, 면], `위험 버튼 — ${자리}`).toEqual(["rgb(255, 255, 255)", await 토큰색(page, "--danger-solid")]);
    expect(await 색대비(page, 글자, 면), `위험 버튼 글자의 대비 — ${자리}`).toBeGreaterThanOrEqual(4.5);
  }
  await 팔레트(page, false);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await page.goto("/settings/notifications");
  const 손잡이 = page.locator("[data-slot=switch-thumb]").first();
  await expect(손잡이).toBeVisible();
  for (const 다크 of [false, true]) {
    await 팔레트(page, 다크);
    expect(await 칠한값(손잡이, "background-color"), `스위치 손잡이 — ${다크 ? "다크" : "라이트"}`).toEqual([
      "rgb(255, 255, 255)",
    ]);
  }
  expect(await unknownIpcCalls(page)).toEqual([]);
});

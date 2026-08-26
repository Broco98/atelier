import { expect, test } from "./evidence";
import { WORKS } from "./fixtures";
import { installFixtureBackend, readIpcRecord, unknownIpcCalls } from "./harness";

// 사이드바 작업 목록은 어느 화면에나 있으므로 목록 화면에서 본다 — Works 화면으로 들어가면
// 그 화면이 부르는 것까지 하네스가 답해야 하는데, 여기서 볼 것은 사이드바뿐이다.
//
// 정적 마크업 seam(SidebarWorkList.test.tsx)이 못 보는 것만 여기서 본다: hover에만 뜨는
// 것(결정 85)은 진짜 CSS가 있어야 하고, 핀을 눌러 나가는 쓰기와 접힘이 다음 실행까지
// 남는 것(결정 108)은 이벤트와 localStorage가 있어야 한다.

const [, plainWork] = WORKS;

// 헤더의 접근성 이름에는 개수가 함께 들어간다 — 라벨과 옅은 숫자가 같은 버튼 안이다.
const PINNED_HEADER = "고정 1";

test("핀은 hover에만 뜨고, 누르면 그 사실이 백엔드로 나간다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/projects");

  const pin = page.getByRole("button", { name: `${plainWork.title} 고정` });
  // 상시 노출하지 않는 것이 결정 85다. opacity로 본다 — 이 버튼은 늘 DOM에 있다.
  await expect(pin).toHaveCSS("opacity", "0");
  await page.getByRole("button", { name: plainWork.title, exact: true }).hover();
  await expect(pin).toHaveCSS("opacity", "1");

  await pin.click();
  // 고정은 화면 설정이 아니라 그 작업에 대한 사실이라 백엔드로 나간다(결정 81).
  // 누른 것이 안 고정된 행이므로 나가는 값은 true다.
  expect((await readIpcRecord(page))?.calls).toContain(
    `set_work_pinned {"slug":"${plainWork.slug}","pinned":true}`,
  );
  expect(await unknownIpcCalls(page)).toEqual([]);
});

test("`고정` 구획을 접으면 다음 실행에도 접혀 있다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto("/projects");

  // 행이 화면에서 빠지는 모양(0fr·inert)은 마크업 seam이 본다. 여기서 볼 것은 **다시
  // 띄웠을 때도 접혀 있는가**뿐이다 — 접기는 "설정"이라 영속한다(결정 108).
  const header = page.getByRole("button", { name: PINNED_HEADER, exact: true });
  await expect(header).toHaveAttribute("aria-expanded", "true");

  await header.click();
  await expect(header).toHaveAttribute("aria-expanded", "false");

  await page.reload();
  await expect(header).toHaveAttribute("aria-expanded", "false");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// 사이드바 트리(판 04). **이 층에서만 마운트된다** — 정적 마크업 seam은 가지의 속을 슬롯
// 표식으로 대신하므로, 스토어를 구독하는 진짜 컴포넌트(`ShellBranch`)가 실제로 서는지는
// 여기서만 드러난다. 실제로 그 자리에서 훅 순서를 뒤집는 사고를 한 번 냈고, 그때 L2도 L3도
// 전부 초록이었다 — 이 화면을 여는 검사가 저장소에 하나도 없었기 때문이다.
//
// Works 화면으로 들어가므로 그 화면이 부르는 것까지 하네스가 답해야 한다. `plain-work`은
// spec 파일이 없어(fixtures) 본문이 빈 상태로 서고 문서를 읽지 않는다.
test("고른 work 아래에 트리가 서고, 가지 접힘은 세션까지만 산다", async ({ page }) => {
  await installFixtureBackend(page);
  await page.goto(`/works/${plainWork.slug}`);

  // 표식으로 집는다 — 패널에도 `spec`이라 적힌 탭이 있어 글자로 집으면 갈린다.
  await expect(page.locator('[data-leaf="spec"]')).toBeVisible();

  const branch = page.locator('[data-branch=""]');
  // 가지의 속. 접혀도 DOM에는 남으므로(펴는 쪽도 애니메이션되어야 한다) **보이는가**로는
  // 가릴 수 없다 — 넘침에 잘릴 뿐이라 상자 크기는 그대로다. 닿을 수 없게 만드는 것이
  // `inert`이고, 그것이 이 계약의 관찰 가능한 형태다.
  const body = page.locator('[data-branch=""] + div');

  // 처음 고른 work의 가지는 펼쳐진다(결정 107). 그 속이 실제로 서는 것까지 본다.
  await expect(branch).toHaveAttribute("aria-expanded", "true");
  await expect(body).not.toHaveAttribute("inert", "");
  await expect(page.getByRole("button", { name: "셸 열기" })).toBeVisible();

  await branch.click();
  await expect(branch).toHaveAttribute("aria-expanded", "false");
  await expect(body).toHaveAttribute("inert", "");

  // **세션 메모리다**(결정 107) — 구획 접힘(위 검사)이 localStorage에 남는 것과 갈리는
  // 자리다. 다시 띄우면 기본값으로 돌아온다.
  await page.reload();
  await expect(branch).toHaveAttribute("aria-expanded", "true");
  expect(await unknownIpcCalls(page)).toEqual([]);
});

import { expect, test } from "./evidence";
import { PROJECTS, WORKS } from "./fixtures";
import { installFixtureBackend, unknownIpcCalls } from "./harness";

// 이 프로젝트에서 시작된 work이 하나 있는 짝 — 픽스처가 그렇게 묶어 뒀다(`projects: ["billing"]`).
const project = PROJECTS[0];
const work = WORKS.find((w) => w.projects.includes(project.slug))!;

// 컴포넌트를 격리 마운트하지 않고 실제 엔트리부터 태운다. 라우터가 브라우저 히스토리
// 위에서 돌고 엔트리가 렌더 전에 전역 초기화를 하므로, 부트를 건너뛰면 "브라우저에서
// 실제로 동작한다"가 증명되지 않는다.
test("고정 데이터가 주어지면 목록 화면이 그 데이터를 그린다", async ({ page }) => {
  await installFixtureBackend(page);

  await page.goto("/projects");

  // 행의 접근성 이름은 이름과 경로를 함께 담는다. 이름만으로 찾으면 상세 화면의
  // 제목 버튼과 둘 다 걸린다 — 경로까지 넣어 목록의 행 하나를 정확히 가리킨다.
  for (const project of PROJECTS) {
    await expect(
      page.getByRole("button", { name: `${project.name} ${project.path}` }),
    ).toBeVisible();
  }

  // 무선택 주소가 첫 항목 주소로 정규화된다 — 라우팅이 브라우저에서 실제로 돌았다는 증거다.
  await expect(page).toHaveURL(`/projects/${PROJECTS[0].slug}`);

  // 화이트리스트 밖 호출이 하나라도 있으면 하네스가 낡은 것이다.
  expect(await unknownIpcCalls(page)).toEqual([]);
});

// **여기서 work을 열어도 그 work의 마지막 자리가 선다**(결정 77·97 — `recallSearch`).
// 이 문만 오래 그 계약 밖에 있었다: `search` 없이 이동해 spec 기본 문서로 떨어졌고, 도착한
// 주소를 적어 두는 effect(`-works-view.tsx`)가 그 기본값으로 **그 work의 기억을 덮어써**
// 다음에 사이드바나 팔레트로 돌아와도 마지막 화면이 안 섰다. 잃는 것이 이 문 하나가 아니라
// **모든 문**이라는 것이 이 검사가 세우는 것이다.
//
// 기억은 모듈 스코프 지도라 **새로고침 한 번이면 통째로 날아간다** — 그래서 여기서 화면을
// 옮기는 길은 전부 앱 안의 클릭이고, `goto`는 맨 처음 한 번뿐이다. 그 왕복이 진짜인 층은
// 여기뿐이라 L2에는 이 검사가 설 자리가 없다.
test("이 프로젝트의 work을 열면 그 work의 마지막 자리가 열린다", async ({ page }) => {
  await installFixtureBackend(page);

  // 터미널을 보다 떠난다 — 결정 77이 없애려는 것이 바로 이 사람이 문서로 떨어지는 것이다.
  await page.goto(`/works/${work.slug}?tab=terminal`);
  await expect(page.locator('[data-tab="shell"]')).toBeVisible();

  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(page).toHaveURL(`/projects/${project.slug}`);

  // 「이 프로젝트에서 시작된 작업」 행. 사이드바 행도 같은 제목을 들고 있어 `main`으로 좁힌다 —
  // 사이드바 쪽은 이미 다른 검사가 든다(works-sidebar.spec.ts).
  await page.locator("main").getByRole("button", { name: work.title }).click();

  await expect(page).toHaveURL(new RegExp(`/works/${work.slug}`));
  await expect(page).toHaveURL(/tab=terminal/);

  expect(await unknownIpcCalls(page)).toEqual([]);
});

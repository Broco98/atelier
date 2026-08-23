import { expect, test } from "./evidence";
import { PROJECTS } from "./fixtures";
import { installFixtureBackend, unknownIpcCalls } from "./harness";

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

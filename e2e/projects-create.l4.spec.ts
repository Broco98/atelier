import { readdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { installRealBackend, unknownIpcCalls } from "./harness";
import { expect, test } from "./l4";

// 판 1이 관통이라고 부르는 것. 화면에서 폴더를 고르면 **진짜 파일이 생기고** 그 파일을
// 다시 읽어 목록이 그린다 — 쓰기와 읽기가 한 번에 걸린다.
//
// 순서에 뜻이 있다: 파일을 먼저 보고 그 다음 화면을 본다. 파일이 없으면 쓰는 다리가
// 끊긴 것이고, 파일은 있는데 행이 없으면 읽는 다리가 끊긴 것이다 — 고칠 곳이 다르다.
test("폴더를 고르면 진짜 파일이 생기고 목록에 그 프로젝트가 나타난다", async ({
  page,
  sandbox,
}) => {
  const { home, pickedFolder } = sandbox;
  await installRealBackend(page, sandbox);

  await page.goto("/projects");
  await expect(page.getByText("등록된 프로젝트가 없어요")).toBeVisible();

  // 세 자리의 버튼이 모두 같은 등록 흐름을 부른다(사이드바 아이콘, 빈 목록, 빈 본문).
  // 어느 것을 눌러도 같으므로 첫 번째를 쓴다.
  await page.getByRole("button", { name: "프로젝트 등록" }).first().click();

  // 다리를 타고 파일시스템까지 다녀오므로 즉시가 아니다.
  await expect.poll(() => projectFiles(home)).toHaveLength(1);

  const slug = projectFiles(home)[0].replace(/\.md$/, "");
  const written = readFileSync(join(home, "projects", `${slug}.md`), "utf8");
  // 코어가 경로를 canonicalize한다 — macOS에서 /var는 /private/var로 풀린다.
  expect(written).toContain(realpathSync(pickedFolder));

  const name = basename(pickedFolder);
  await expect(page.getByRole("button", { name: new RegExp(`^${name} `) })).toBeVisible();
  await expect(page).toHaveURL(`/projects/${slug}`);

  // 화이트리스트 밖 호출이 하나라도 있으면 하네스가 낡은 것이다.
  expect(await unknownIpcCalls(page)).toEqual([]);
});

function projectFiles(home: string): string[] {
  try {
    return readdirSync(join(home, "projects")).filter((name) => name.endsWith(".md"));
  } catch {
    // 아직 코어가 폴더를 안 만들었을 뿐이다 — poll이 다시 부른다.
    return [];
  }
}

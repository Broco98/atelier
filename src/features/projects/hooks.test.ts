/// <reference types="node" />
// 소스 스캔 한 건 때문에 Node 타입을 끌어온다 — 근거는 src/tauri-commands.test.ts 머리말과 같다.
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { projectsQuery } from "./hooks";

// **「Maison에서 `list_projects`가 한 번도 안 나간다」를 값으로 재는 자리다**(US 29).
// 이 저장소의 L2에는 DOM이 없어 훅을 돌려 볼 수 없다 — 그래서 조회를 켤지 말지가
// 훅 **밖**에 있어야 재진다(아카이브 쪽 `archivedDocsQuery`가 같은 이유로 같은 모양이다).
// 조건이 훅 안으로 들어가면 이 파일의 첫 검사가 통째로 사라지고, 저 세계에서 명령이
// 나가는 것을 실물로만 알게 된다.
describe("projectsQuery", () => {
  it("Atelier에서만 켜진다", () => {
    // 두 세계를 함께 잰다 — 한쪽만 재면 조건이 그쪽으로 누워도 초록이다
    expect(projectsQuery("atelier").enabled).toBe(true);
    expect(projectsQuery("maison").enabled).toBe(false);
  });

  it("키는 두 세계가 같다 — 캐시를 쪼개지 않는다", () => {
    // `works`·`archive`와 갈리는 자리다. Maison에 *다른* 프로젝트가 있는 것이 아니라
    // 프로젝트라는 것이 **없다** — 키를 갈라 두면 저 세계에도 채워질 수 있는 칸이 생긴다.
    expect(projectsQuery("maison").queryKey).toEqual(projectsQuery("atelier").queryKey);
  });
});

const src = fileURLToPath(new URL("../..", import.meta.url));

/**
 * `useProjects(<여기>)` — 호출부마다 「어느 세계를 읽는가」가 그 한 칸에 적힌다. 파일별로
 * 그 칸만 모은다.
 *
 * 빼는 것 둘: **선언이 사는 파일**(호출과 모양이 같아 함께 잡힌다)과 **테스트 파일**
 * (이 파일이 그 호출들을 글로 적고 있어 자기 자신을 문다). 남는 것이 화면 소스 전부다.
 */
function callArgs(): Record<string, string[]> {
  const names = readdirSync(src, { recursive: true, encoding: "utf8" }).filter(
    (name) =>
      /\.tsx?$/.test(name) &&
      !/\.test\.tsx?$/.test(name) &&
      !name.endsWith("features/projects/hooks.ts"),
  );
  // 글롭이 무너지면 아래 검사가 빈 표를 통과시킬 뻔한다 — 여기서 먼저 선다.
  expect(names.length, "src에서 소스 파일을 하나도 찾지 못했다").toBeGreaterThan(0);
  const found: Record<string, string[]> = {};
  for (const name of names) {
    const args = [
      ...readFileSync(join(src, name), "utf8").matchAll(/useProjects\(([^)]*)\)/g),
    ].map((match) => match[1]);
    if (args.length > 0) found[name] = args;
  }
  return found;
}

// **`enabled`만으로는 절반이다.** 조건은 호출부가 넘긴 모드로 갈리는데, 정적 렌더는 훅을
// 돌리지 않아 「이 화면이 어느 세계로 물었나」가 L2에서 안 보인다 — 세 화면 중 하나가
// `"atelier"`로 눕혀 물어도 위 두 검사가 그대로 초록이다(실제로 변형해 확인했다).
//
// 그래서 호출부 표를 통째로 고정한다. 리터럴이 서도 되는 자리는 **주소가 Atelier로 고정된
// 화면 둘**뿐이다 — `/projects`·`/projects/$slug`에는 Maison 접두사가 붙을 수 없다.
// 셋째가 생기면 그것은 조회가 누운 것이므로 여기서 먼저 빨개진다.
describe("useProjects 호출부", () => {
  it("작업 화면 셋은 모드를 넘기고, 리터럴은 Atelier 전용 화면 둘뿐이다", () => {
    expect(callArgs()).toEqual({
      "features/projects/ProjectsPage.tsx": ['"atelier"'],
      "features/works/WorkMetaMenu.tsx": ["mode"],
      "features/works/WorkPanel.tsx": ["mode"],
      "features/works/WorksPage.tsx": ["mode"],
      "routes/-projects-view.tsx": ['"atelier"'],
    });
  });
});

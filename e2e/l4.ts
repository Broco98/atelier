import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { test as base } from "./evidence";

// L4가 쓰는 임시 세상. 테스트마다 새로 만들고 끝나면 지운다.

/** 등록 대상이 될 폴더의 이름. 프로젝트 이름과 slug가 여기서 나온다. */
const PICKED_FOLDER_NAME = "tracer-project";

export const test = base.extend<{ home: string; pickedFolder: string }>({
  // 데이터 루트와 등록 대상 폴더는 **형제로** 둔다. 대상 폴더가 데이터 루트 안에 있으면
  // "코드 폴더"와 "atelier가 관리하는 자리"의 구분이 테스트 안에서만 흐려진다.
  home: async ({}, use, testInfo) => {
    const root = mkdtempSync(join(tmpdir(), "atelier-l4-"));
    const home = join(root, "home");
    mkdirSync(home);

    await use(home);

    // 실패했으면 무엇이 생겼는지를 증거로 남기고 지운다. 임시 폴더는 정리되어야 하지만,
    // "파일이 아예 안 생겼다"와 "생겼는데 화면이 안 읽었다"는 고칠 곳이 전혀 다르다.
    if (testInfo.status !== testInfo.expectedStatus) {
      writeFileSync(testInfo.outputPath("atelier-home.txt"), treeReport(home));
    }
    rmSync(root, { recursive: true, force: true });
  },

  // 폴더 선택창 스텁이 돌려줄 절대경로. 코어가 canonicalize하므로 **실재해야** 한다.
  // git 저장소일 필요는 없다 — 없으면 기준 브랜치가 main으로 정해질 뿐이다.
  pickedFolder: async ({ home }, use) => {
    const folder = join(home, "..", PICKED_FOLDER_NAME);
    mkdirSync(folder);
    await use(folder);
  },
});

function treeReport(home: string): string {
  const files = readdirSync(home, { recursive: true, encoding: "utf8" });
  const lines = files.map((name) => `  ${name}`);
  return `ATELIER_HOME: ${home}\n${lines.length > 0 ? lines.join("\n") : "  (빈 폴더)"}\n`;
}

export { expect } from "./evidence";

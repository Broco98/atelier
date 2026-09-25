import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import type { Mode } from "@/mode";
import { test as base } from "./evidence";

// L4가 쓰는 임시 세상. 테스트마다 새로 만들고 끝나면 지운다.

/** 등록 대상이 될 폴더의 이름. 프로젝트 이름과 slug가 여기서 나온다. */
const PICKED_FOLDER_NAME = "tracer-project";

export interface Sandbox {
  /** 임시 데이터 루트. 다리가 `ATELIER_HOME`으로 여기를 가리킨다. */
  home: string;
  /**
   * 폴더 선택창 스텁이 돌려줄 절대경로. 코어가 canonicalize하므로 **실재해야** 한다.
   * git 저장소일 필요는 없다 — 없으면 기준 브랜치가 폴백될 뿐이다.
   */
  pickedFolder: string;
}

export const test = base.extend<{ sandbox: Sandbox }>({
  // 데이터 루트와 등록 대상 폴더를 **한 픽스처가 형제로** 만든다. 둘로 쪼개면 뒤쪽이
  // 앞쪽의 내부 배치를 되짚어야 하고, 그러면 배치를 바꿀 때 조용히 어긋난다.
  sandbox: async ({}, use, testInfo) => {
    const root = mkdtempSync(join(tmpdir(), "atelier-l4-"));
    const sandbox = { home: join(root, "home"), pickedFolder: join(root, PICKED_FOLDER_NAME) };
    mkdirSync(sandbox.home);
    mkdirSync(sandbox.pickedFolder);

    await use(sandbox);

    // 실패했으면 무엇이 생겼는지를 증거로 남기고 지운다. 임시 폴더는 정리되어야 하지만,
    // "파일이 아예 안 생겼다"와 "생겼는데 화면이 안 읽었다"는 고칠 곳이 전혀 다르다.
    if (testInfo.status !== testInfo.expectedStatus) {
      writeFileSync(testInfo.outputPath("atelier-home.txt"), treeReport(sandbox.home));
    }
    rmSync(root, { recursive: true, force: true });
  },
});

/**
 * work 폴더 하나의 `work.json`을 쓴다 — 코어가 읽는 모양이 **여기 한 곳에만** 선다. 살아 있는
 * work(`works/`)과 치운 work(`archive/`)이 같은 모양을 쓰고, 치운 쪽은 치운 때가 하나 더 실린다.
 */
function writeWorkJson(
  dir: string,
  fields: { title: string; status: string; createdAt: string; archivedAt?: string },
) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "work.json"), JSON.stringify({ ...fields, projects: [], pinned: false }));
}

/**
 * work 하나를 **손으로 심는다** — 만든 날까지 못 박아서(기본 순서가 만든 날에서 나온다).
 *
 * sandbox에는 work이 하나도 없고 **앱에도 다리에도 work을 만드는 커맨드가 없다**(work 생성은 MCP
 * 전용이다). 씨를 안 뿌리면 목록이 비어 주소가 정규화되고 화면이 아무것도 안 하는데, 실패는 엉뚱한
 * 곳을 가리킨다. 모양은 코어가 읽는 `work.json` 그대로다 — 여러 spec이 베껴 쓰면 그 모양이 바뀌는 날
 * 고칠 자리가 여럿이 된다. 그래서 치운 work(`archive/`)을 심는 `seedArchivedWork`도 같은 손을 탄다.
 */
export function seedWork(home: string, slug: string, title: string, createdAt: string) {
  const dir = join(home, "works", slug);
  writeWorkJson(dir, { title, status: "active", createdAt });
  mkdirSync(join(dir, "spec"), { recursive: true });
  writeFileSync(join(dir, "spec", "overview.md"), "# 개요\n\n한 줄.\n");
}

/**
 * 치운 work 하나를 **손으로 심는다** — `archive/<slug>/`에 치운 때가 실린 `work.json`과, 받은 파일을
 * work 폴더 기준 경로 그대로(`record.md`, `spec/…`).
 *
 * 앱에도 다리에도 아카이브를 만드는 길은 work을 치우는 것뿐인데, 치울 work을 만드는 커맨드가 없다
 * (`seedWork`와 같은 사정이다). 모양은 코어가 읽는 그대로다: 기록은 spec 밖(work 폴더)에 서고, spec
 * 문서는 `spec/` 아래에 선다. 만든 날과 치운 때는 못 박는다 — 아카이브 하나만 심는 동안은 순서가
 * 아무것도 가르지 않는다.
 */
export function seedArchivedWork(home: string, slug: string, title: string, files: Record<string, string>) {
  const dir = join(home, "archive", slug);
  writeWorkJson(dir, { title, status: "done", createdAt: "2026-08-01", archivedAt: "2026-08-10T03:04:05Z" });
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  }
}

/**
 * 모드의 레이아웃 폴더를 **손으로 심는다** — 사람이 `~/.atelier/layouts/<mode>/`를 두는 것과 같다.
 * 경로는 데이터 루트의 저장 모양 그대로다(spec 레이아웃 결정 6) — `work.json`처럼 여러 spec이 베껴
 * 쓰면 그 모양이 바뀌는 날 고칠 자리가 여럿이 된다. 폴더를 돌려주므로 템플릿 파일을 곁에 둘 수 있다.
 *
 * 다리에는 감시자가 없다 — 앱이 이미 읽은 뒤에 심었다면 다시 읽어야 따라온다.
 */
export function seedLayout(home: string, mode: Mode, layout: unknown): string {
  const folder = join(home, "layouts", mode);
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "layout.json"), JSON.stringify(layout));
  return folder;
}

function treeReport(home: string): string {
  const entries = readdirSync(home, { recursive: true, encoding: "utf8" });
  const lines = entries.map((name) => `  ${name}`);
  return `ATELIER_HOME: ${home}\n${lines.length > 0 ? lines.join("\n") : "  (빈 폴더)"}\n`;
}

export { expect } from "./evidence";

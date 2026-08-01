/// <reference types="node" />
// 이 파일만 Node 타입을 끌어온다 — tsconfig의 전역 types를 건드리면 프로젝트 전체의
// 자동 @types 포함이 좁아진다. node: 접두사도 쓰지 않는다: moduleResolution "bundler"가
// 그것을 절대 URI로 보고 건너뛰어 tsc가 빌드에서 실패한다.
import { readdirSync, readFileSync, type Dirent } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";

// 프런트엔드가 부르는 invoke 이름과 Rust가 등록한 명령 이름은 **문자열로만** 이어져 있다.
// 어느 쪽을 빠뜨려도 컴파일도 타입 검사도 통과하고, 버튼을 누르는 순간에야 실패한다.
// 그 연결을 여기서 고정한다.

// pathname은 한글 경로를 퍼센트 인코딩해서 넘긴다 — 이 저장소의 워크트리 경로가 그렇다
const root = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry: Dirent) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

function invokedNames(): string[] {
  const names = sourceFiles(join(root, "src")).flatMap((file) => {
    const source = readFileSync(file, "utf8");
    // 타입 인자는 **선택이다.** 이걸 요구하면 `invoke("x", …)`로 쓴 호출이 통째로 안 보여서,
    // 등록을 빠뜨려도 초록이 된다 — 이 테스트가 막으려던 바로 그 실패가 빠져나간다.
    return [...source.matchAll(/\binvoke(?:<[^>]*>)?\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
  });
  return [...new Set(names)].sort();
}

function registeredNames(): string[] {
  const source = readFileSync(join(root, "src-tauri/src/lib.rs"), "utf8");
  const block = source.match(/generate_handler!\[([\s\S]*?)\]/);
  if (!block) throw new Error("generate_handler! 블록을 찾지 못했다");
  return [...block[1].matchAll(/commands::([a-z_]+)/g)].map((m) => m[1]).sort();
}

describe("Tauri 명령 배선", () => {
  it("프런트엔드가 부르는 이름은 전부 등록돼 있다", () => {
    const missing = invokedNames().filter((name) => !registeredNames().includes(name));
    expect(missing).toEqual([]);
  });

  it("등록된 이름은 전부 commands.rs에 정의돼 있다", () => {
    const defined = readFileSync(join(root, "src-tauri/src/commands.rs"), "utf8");
    const undefinedNames = registeredNames().filter(
      (name) => !new RegExp(`pub async fn ${name}\\b`).test(defined),
    );
    expect(undefinedNames).toEqual([]);
  });

  // 데스크톱 명령은 **어떤 테스트도 본문을 실행하지 않는다** — src-tauri의 테스트 수는 0이고,
  // 위 두 검사는 이름만 본다. 두 줄짜리 위임 함수를 위해 크레이트에 테스트 하네스를 세우는
  // 것은 비례하지 않으므로, 배선 사실로서 여기에 건다(이 파일이 이미 하는 일과 같은 종류다).
  //
  // 걸어야 하는 이유: `false` → `true` 한 글자가 뒤집히면 ⋯ 메뉴의 "삭제"가 dirty 검사를
  // 통째로 건너뛰고 커밋 안 된 변경을 워크트리째 지운다. 확인 다이얼로그는 그렇게 된다고
  // 말하지 않고, MCP 쪽 atelier_remove_work와도 계약이 어긋난다.
  it("데스크톱 삭제 명령은 강제 플래그를 켜지 않는다", () => {
    const source = readFileSync(join(root, "src-tauri/src/commands.rs"), "utf8");
    // 인자 안에 `&works_dir()` 처럼 괄호가 한 겹 들어가므로 그만큼은 허용해야 한다
    const call = source.match(/atelier_core::remove_work\(((?:[^()]|\([^()]*\))*)\)/);
    expect(call, "commands.rs에서 remove_work 호출을 찾지 못했다").not.toBeNull();
    const force = call![1].split(",").pop()!.trim();
    expect(force).toBe("false");
  });
});

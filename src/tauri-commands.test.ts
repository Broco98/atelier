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
    return [...source.matchAll(/\binvoke<[^>]*>\(\s*"([a-z_]+)"/g)].map((m) => m[1]);
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
});

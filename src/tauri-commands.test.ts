/// <reference types="node" />
// 이 파일만 Node 타입을 끌어온다 — tsconfig의 전역 types를 건드리면 프로젝트 전체의
// 자동 @types 포함이 좁아진다. node: 접두사도 쓰지 않는다: moduleResolution "bundler"가
// 그것을 절대 URI로 보고 건너뛰어 tsc가 빌드에서 실패한다.
import { readdirSync, readFileSync, type Dirent } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { FIXTURE_COMMANDS } from "../e2e/fixtures";

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
  return block[1]
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => {
      // 모르는 모양을 **건너뛰지 않는다.** 건너뛰면 그 커맨드가 이 검사의 눈에서 통째로
      // 사라져 등록을 빠뜨려도 초록이 된다 — `use commands::*;`로 접두사 없이 등록하면
      // 실제로 그렇게 샌다. 같은 이유로 다리 크레이트의 대조도 fail-closed다.
      const name = /^commands::([a-z_]+)$/.exec(item);
      if (!name) throw new Error(`등록부에서 예상 못 한 항목을 봤다: ${item}`);
      return name[1];
    })
    .sort();
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

  // 이름이 맞아도 **인자 이름이 어긋나면** 똑같이 버튼을 누를 때 터진다. 이쪽도 문자열로만
  // 이어져 있고, 프런트엔드는 camelCase로 보내면 Tauri가 snake_case 파라미터에 맞춰 준다.
  it("invoke가 보내는 인자 이름은 commands.rs의 파라미터와 맞는다", () => {
    const commands = readFileSync(join(root, "src-tauri/src/commands.rs"), "utf8");
    const mismatched: string[] = [];
    for (const file of sourceFiles(join(root, "src"))) {
      const source = readFileSync(file, "utf8");
      const calls = source.matchAll(
        /\binvoke(?:<[^>]*>)?\(\s*"([a-z_]+)"\s*,\s*\{([^}]*)\}/g,
      );
      for (const [, name, args] of calls) {
        const params = commands.match(new RegExp(`pub async fn ${name}\\(([^)]*)\\)`));
        if (!params) continue;
        const declared = [...params[1].matchAll(/(\w+)\s*:/g)].map((m) => m[1]);
        const passed = args
          .split(",")
          .map((a) => a.split(":")[0].trim())
          // 스프레드(`...patch`)가 무엇을 펼치는지는 여기서 알 수 없다 — 정적으로 못 보는
          // 것을 틀렸다고 하면 그물이 아니라 소음이 된다. update_project가 그 형태다.
          .filter((a) => a && !a.startsWith("..."));
        for (const arg of passed) {
          const snake = arg.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
          if (!declared.includes(snake)) mismatched.push(`${name}: ${arg}`);
        }
      }
    }
    expect(mismatched).toEqual([]);
  });

  // L3 하네스는 부팅 경로가 부르는 커맨드에만 고정 데이터로 답한다. 그 이름이 낡으면
  // 하네스는 아무도 안 부르는 커맨드에 답하고, 진짜 커맨드는 화이트리스트 밖으로 나간다.
  // 실행 중에 터지긴 하지만 **그 커맨드를 태우는 테스트가 있을 때만**이라 여기서 못 박는다.
  // (L4는 이 목록이 없다 — `plugin:` 접두사가 아닌 것은 전부 다리로 가므로 낡을 자리가 없다.)
  it("L3 하네스가 답하는 커맨드는 전부 등록돼 있다", () => {
    const stale = Object.keys(FIXTURE_COMMANDS).filter(
      (name) => !registeredNames().includes(name),
    );
    expect(stale, "하네스의 고정 데이터가 등록부에 없는 이름을 답하고 있다").toEqual([]);
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

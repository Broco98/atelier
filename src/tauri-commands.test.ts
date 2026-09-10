/// <reference types="node" />
// 이 파일만 Node 타입을 끌어온다 — tsconfig의 전역 types를 건드리면 프로젝트 전체의
// 자동 @types 포함이 좁아진다. node: 접두사도 쓰지 않는다: moduleResolution "bundler"가
// 그것을 절대 URI로 보고 건너뛰어 tsc가 빌드에서 실패한다.
import { readdirSync, readFileSync, type Dirent } from "fs";
import { join } from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { FIXTURE_BY_MODE, FIXTURE_COMMANDS } from "../e2e/fixtures";

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

/**
 * **모드를 받는 명령**을 `commands.rs`에서 뽑는다. 손으로 적은 목록을 쓰지 않는 이유는 이
 * 파일이 이미 여러 번 적어 둔 것과 같다 — 명령이 하나 늘면 손목록은 그것을 조용히 빼놓고,
 * 그 실패가 아래 검사가 막으려는 것과 같은 종류다.
 *
 * 파싱은 **fail-closed다.** 서명을 못 찾으면 던지고(그 명령이 눈 밖으로 나가면 검사가
 * 무력해진다), `mode`가 있는데 타입이 `Mode`가 아니어도 던진다 — `Option<Mode>`로 되돌리는
 * 변경이 여기서는 「모드를 안 받는 명령」으로 보여 조용히 통과할 자리다. 그 되돌림 자체는
 * 다리 크레이트가 L1에서도 문다(`어느_명령도_모드를_기본값으로_안_정한다`).
 */
function modeTakingNames(): string[] {
  const commands = readFileSync(join(root, "src-tauri/src/commands.rs"), "utf8");
  const names = registeredNames().filter((name) => {
    const params = commands.match(new RegExp(`pub async fn ${name}\\(([^)]*)\\)`));
    if (!params) throw new Error(`commands.rs에서 ${name}의 서명을 찾지 못했다`);
    const declared = /\bmode\s*:\s*([^,)]+)/.exec(params[1]);
    if (!declared) return false;
    const type = declared[1].trim();
    if (type !== "Mode") {
      throw new Error(`${name}의 mode 인자가 \`Mode\`가 아니다: ${type} — 필수 계약(#187)이 풀렸다`);
    }
    return true;
  });
  if (names.length === 0) throw new Error("모드를 받는 명령을 하나도 못 찾았다 — 서명 모양이 바뀌었나");
  return names;
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
  //
  // **두 표를 다 본다.** 모드를 받는 커맨드는 `FIXTURE_BY_MODE`에만 있어(아래 검사가 그
  // 경계를 지킨다), 한 표만 보면 그쪽이 이 검사의 눈 밖으로 통째로 빠진다.
  it("L3 하네스가 답하는 커맨드는 전부 등록돼 있다", () => {
    const tables = { FIXTURE_COMMANDS, FIXTURE_BY_MODE };
    // **표가 비어 있지 않은지를 먼저 본다.** 표가 하나 더 생겼는데 여기서 안 읽으면 그 표는
    // 빈 목록을 훑고 조용히 초록이 되어, 이름이 낡아도 신호가 안 난다 — 이 검사가 막으려던
    // 실패가 검사 자신에게 나는 모양이다. 그래서 fail-closed로 닫는다.
    for (const [table, names] of Object.entries(tables)) {
      expect(Object.keys(names), `${table}이 비었다 — 이 검사가 읽는 표가 맞나`).not.toEqual([]);
    }
    const stale = Object.values(tables)
      .flatMap((table) => Object.keys(table))
      .filter((name) => !registeredNames().includes(name));
    expect(stale, "하네스의 고정 데이터가 등록부에 없는 이름을 답하고 있다").toEqual([]);
  });

  // **모드를 받는 명령은 이름만 보고 답을 받으면 안 된다**(#187). L3의 백엔드는 픽스처 표라
  // 실물의 거절이 거기까지 안 온다 — 이름 표에 줄이 하나 있으면 `mode`가 없거나 모르는 값인
  // 호출도 조용히 Atelier 데이터를 받아, 「Maison 화면인데 저쪽 것이 떴다」가 그 층에서
  // 통째로 안 걸린다(`e2e/fixtures.ts`의 두 머리말).
  //
  // **경계를 등록부에서 파생한다.** 새 명령이 모드를 받기 시작했는데 답을 이름 표에 적는
  // 것이 이 검사가 막는 실패이고, 그 물림이 실제로 일어나는지는 `e2e/mode-fail-closed.spec.ts`가
  // 브라우저에서 잰다 — 여기는 표의 배치를, 저기는 하네스의 행동을 본다.
  //
  // **양쪽을 다 잠근다.** 「이름 표에 없다」만 재면 어느 표에도 안 적힌 명령이 초록으로
  // 남는다 — 당장은 하네스의 화이트리스트 갈래가 물어 조용히 틀린 데이터가 가진 않지만,
  // `mode-fail-closed.spec.ts`가 음성 케이스의 목록을 `FIXTURE_BY_MODE`에서 뽑으므로 그
  // 명령은 「mode를 빼면 답이 없다」를 **한 번도 안 재고** 지나간다. 표의 머리말이 「전부
  // 여기 있다」고 적은 것도 그 순간 거짓이 된다.
  it("모드를 받는 명령은 L3에서 이름만 보고 답하지 않는다", () => {
    const byName = modeTakingNames().filter((name) =>
      Object.prototype.hasOwnProperty.call(FIXTURE_COMMANDS, name),
    );
    expect(byName, "이름 표가 모드를 받는 명령에 답하고 있다 — `FIXTURE_BY_MODE`로 옮겨라").toEqual(
      [],
    );

    const missing = modeTakingNames().filter(
      (name) => !Object.prototype.hasOwnProperty.call(FIXTURE_BY_MODE, name),
    );
    expect(
      missing,
      "모드를 받는 명령이 `FIXTURE_BY_MODE`에 없다 — 아직 아무도 안 태우면 두 칸을 `{}`로 적어라",
    ).toEqual([]);
  });

  // 데스크톱 명령의 **본문을 실행하는 테스트는 없다** — 위 두 검사는 이름만 보고, src-tauri의
  // 통합 테스트(`tests/top_terminal.rs`)는 커널(`pty::spawn`)을 직접 불러 이 위임 층을 지나지
  // 않는다. 두 줄짜리 위임 함수를 위해 크레이트에 `tauri::State` 하네스를 세우는 것은
  // 비례하지 않으므로, 배선 사실로서 여기에 건다(이 파일이 이미 하는 일과 같은 종류다).
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

  // 결정 10 — **셸이 뜨는 순간의 세계가 커널까지 그대로 간다.** 이 두 줄이 이 사슬에서
  // 아무도 안 보는 유일한 칸이다: 프런트가 인자에 싣는 것은 `features/terminal/api.test.ts`가,
  // 그 값이 셸 env(`ATELIER_MODE`)와 cwd를 정하는 것은 `src-tauri/tests/top_terminal.rs`가
  // 살아 있는 셸로 잰다 — 그런데 뒤엣것은 `pty::spawn`을 직접 부르므로 이 위임을 건너뛴다.
  //
  // 걸어야 하는 이유: 여기서 그 인자가 `Mode::Atelier`로 굳어도 **양쪽이 그대로 초록이고**
  // 화면에도 오류가 안 난다. Maison 터미널이 Atelier 홈에서 뜨고 그 셸에서 띄운 claude가
  // 저쪽 세계의 목록을 보는데, 그 사실이 어디에도 안 남는다.
  //
  // **다리도 이 자리를 못 잰다.** `pty_spawn`은 PTY 풀이 앱 프로세스의 상태라 다리가
  // `in_app_only`로 거절하므로, 모드를 받는 명령 열셋 중 이 하나만 계약 테스트
  // (`crates/atelier-test-bridge/tests/mode_contract.rs`)의 열거에서 빠진다 — 그 파일의
  // `SKIPPED`가 그 사실을 증인으로 들고 있고, 여기가 그 자리를 메우는 절반이다.
  //
  // 두 번째 인자를 **글자 그대로** 견준다. 「`mode`가 들어 있나」로 느슨하게 두면 상수를
  // 박은 갈래가 통과할 수 있고(`Mode::Maison`도 그 물음에는 답한다), 이 검사가 지키는 것은
  // 「인자에서 온다」 하나다. 호출을 못 찾으면 던진다 — 조용히 통과하는 소스 스캔은 그물이
  // 아니다.
  it("셸을 띄우는 명령은 받은 모드를 커널에 그대로 넘긴다", () => {
    const source = readFileSync(join(root, "src-tauri/src/commands.rs"), "utf8");
    // **지금 인자에는 괄호가 하나도 없다** — `pty::spawn(&pool, mode, cwd, cols, rows,
    // on_frame)`이라 `[^()]*`로도 잡힌다. 그래도 한 겹을 허용해 두는 것은, 인자 하나가
    // `&works_dir(mode)` 같은 호출로 바뀌는 날 정규식이 호출을 **통째로 못 찾아**
    // 「배선이 틀렸다」가 아니라 「호출이 없다」로 터지는 것을 막기 위해서다(위 remove_work
    // 검사는 실제로 그 모양이라 같은 허용을 쓴다).
    const call = source.match(/pty::spawn\(((?:[^()]|\([^()]*\))*)\)/);
    expect(call, "commands.rs에서 pty::spawn 호출을 찾지 못했다").not.toBeNull();
    const mode = call![1].split(",")[1]?.trim();
    expect(mode).toBe("mode");
  });
});

import { describe, expect, it } from "vitest";
import { exceptionsFromText, exceptionsText, exceptionsWith } from "./process-exceptions";

// 「셸을 닫아도 남길 프로세스」 칸의 글자 ↔ 저장할 값(프로세스 결정 5 · 프로세스 스펙 S7). 칸은 한 줄에 하나씩
// 쓰는 목록이고, 파일의 `null`은 「기본 목록을 쓴다」다 — 기본 목록은 백엔드(판정이 쓰는 Rust 상수)가 준다.

const DEFAULTS = ["tmux", "docker*"];

describe("칸에 보일 글자", () => {
  it("적힌 목록은 한 줄에 하나다", () => {
    expect(exceptionsText(["tmux", "colima"], DEFAULTS)).toBe("tmux\ncolima");
  });

  it("`null`이면 기본 목록을 보인다", () => {
    expect(exceptionsText(null, DEFAULTS)).toBe("tmux\ndocker*");
  });

  // 기본 목록을 모르는 채 빈 칸을 보이면, 거기 한 줄을 더해 저장하는 순간 기본 목록이 통째로 사라진다.
  it("`null`인데 기본 목록을 아직 모르면 보일 글자가 없다", () => {
    expect(exceptionsText(null, null)).toBeNull();
  });

  it("빈 목록은 빈 칸이다 — `null`과 다르다", () => {
    expect(exceptionsText([], DEFAULTS)).toBe("");
  });
});

describe("칸의 글자를 저장할 값으로", () => {
  it("한 줄에 하나씩 — 앞뒤 공백과 빈 줄은 걷는다", () => {
    expect(exceptionsFromText("tmux\n\n  colima  \n", DEFAULTS)).toEqual(["tmux", "colima"]);
  });

  // 판 04의 「예외로 두기」도 같은 규칙을 탄다(스펙 「판 01 › 예외 목록」).
  it("`null`에서 한 줄을 더하면 기본 목록 + 그 이름이다", () => {
    const shown = exceptionsText(null, DEFAULTS);
    expect(exceptionsFromText(`${shown}\nmydaemon`, DEFAULTS)).toEqual(["tmux", "docker*", "mydaemon"]);
  });

  // **파일에는 고친 것만 적는다.** 기본 목록 그대로를 글자로 적으면 다음 판의 기본 목록이 이 사람에게 안 닿는다 —
  // 고친 적도 없는데. 칸을 건드렸다 되돌린 것도 「안 고쳤다」다.
  it("기본 목록과 같으면 `null`이다", () => {
    expect(exceptionsFromText("tmux\ndocker*", DEFAULTS)).toBeNull();
    expect(exceptionsFromText(" tmux \n\ndocker*\n", DEFAULTS)).toBeNull();
  });

  it("순서만 달라도 고친 것이다", () => {
    expect(exceptionsFromText("docker*\ntmux", DEFAULTS)).toEqual(["docker*", "tmux"]);
  });

  // 모두 지운 칸은 「아무것도 남기지 않는다」이다. 기본값으로 돌리는 길은 「기본값으로」 하나다.
  it("빈 칸은 빈 목록이다 — `null`이 아니다", () => {
    expect(exceptionsFromText("", DEFAULTS)).toEqual([]);
    expect(exceptionsFromText(" \n \n", DEFAULTS)).toEqual([]);
  });

  it("기본 목록을 모르면 견주지 않고 목록 그대로다", () => {
    expect(exceptionsFromText("tmux\ndocker*", null)).toEqual(["tmux", "docker*"]);
  });
});

// 판 04의 「예외로 두기」(프로세스 티켓 31 · 프로세스 스펙 S7) — `Processes` 행의 이름 하나를 목록에 더한다. 설정 칸에서 한 줄을
// 더하는 것과 **같은 규칙**이다: `null`이면 기본 목록 + 그 이름을 적는다.
describe("이름 하나를 목록에 더하기", () => {
  it("`null`이면 기본 목록 + 그 이름이다", () => {
    expect(exceptionsWith(null, DEFAULTS, "esbuild")).toEqual(["tmux", "docker*", "esbuild"]);
  });

  it("고친 목록이 있으면 그 끝에 더한다 — 기본 목록을 되살리지 않는다", () => {
    expect(exceptionsWith(["colima"], DEFAULTS, "esbuild")).toEqual(["colima", "esbuild"]);
    expect(exceptionsWith([], DEFAULTS, "esbuild")).toEqual(["esbuild"]);
  });

  // 이미 든 이름을 한 번 더 적으면 칸에 같은 줄이 둘 선다. `null`에 든 이름(기본 목록의 것)이면 `null` 그대로다 — 파일에는 사람이
  // 고친 것만 적는다.
  it("이미 든 이름이면 그대로다", () => {
    expect(exceptionsWith(["colima", "esbuild"], DEFAULTS, "esbuild")).toEqual(["colima", "esbuild"]);
    expect(exceptionsWith(null, DEFAULTS, "tmux")).toBeNull();
  });

  // 칸의 규칙(`exceptionsFromText`)과 같다 — 더한 결과가 기본 목록과 같으면 `null`이다. 그래야 다음 판의 기본 목록이 이 사람에게 닿는다.
  it("더한 결과가 기본 목록과 같으면 `null`이다", () => {
    expect(exceptionsWith(["tmux"], DEFAULTS, "docker*")).toBeNull();
  });
});

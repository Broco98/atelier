import { describe, expect, it } from "vitest";
import { ownerlessNotice, ownerlessToastId, ownerlessWorldOf, vanishedOwners, worldsToReread } from "./shell-owners";
import type { ListResult } from "./shell-owners";
import { markExited, markOwnerless, NO_SHELLS, openShell, ownerOf, topTerminal } from "./shell-registry";
import type { ShellOrigin, ShellOwner, ShellsState } from "./shell-registry";
import type { Mode } from "@/mode";

// 티켓 12 — **주인 확인**(프로세스 결정 4 · 프로세스 스펙 S13). MCP로 아카이브 · 삭제된 work은 다른 프로세스가 한 일이라
// 앱은 `works:changed` 뒤의 목록 재조회로만 안다. 새 목록이 앉으면 그 세계의 셸 owner 중 slug가 목록에서 사라진 것을
// 찾는다 — 그 판정이 이 순수 모듈이다. 시간을 모른다(터미널의 시계 스캔이 이 파일도 본다).
//
// **모르면 판단하지 않는다**(fail-closed). 조회가 실패했거나 결과가 아직 없는데 「목록이 비었다」로 읽으면 그 세계의 셸이
// 전부 주인을 잃는다 — 사람이 누르지 않은 닫기가 모르는 것을 근거로 난다.

const originIn = (mode: Mode, slug: string): ShellOrigin => ({
  mode,
  cwd: `~/w/${slug}`,
  owner: ownerOf(mode, slug),
  project: null,
});

/** 그 자리들에 셸을 하나씩 연다. 번호는 여는 순서대로 1부터다. */
function shellsAt(...origins: ShellOrigin[]): ShellsState {
  return origins.reduce<ShellsState>((state, origin) => {
    const opened = openShell(state, origin);
    if (!opened) throw new Error("상한에 닿았다");
    return opened.state;
  }, NO_SHELLS);
}

const listed = (...slugs: string[]): ListResult => ({ status: "success", data: slugs.map((slug) => ({ slug })) });
const NOTHING_HELD = { has: () => false };
const holding = (...owners: ShellOwner[]) => new Set(owners);

describe("사라진 owner", () => {
  // work 가 · 나와 최상위 터미널.
  const state = shellsAt(
    originIn("atelier", "ga"),
    originIn("atelier", "ga"),
    originIn("atelier", "na"),
    topTerminal("atelier"),
  );

  it("목록에서 빠진 slug의 owner가 한 번씩 나온다", () => {
    expect(vanishedOwners(state, "atelier", listed("na"), NOTHING_HELD)).toEqual([ownerOf("atelier", "ga")]);
    expect(vanishedOwners(state, "atelier", listed(), NOTHING_HELD)).toEqual([
      ownerOf("atelier", "ga"),
      ownerOf("atelier", "na"),
    ]);
  });

  it("목록에 그대로 있으면 아무것도 안 나온다", () => {
    expect(vanishedOwners(state, "atelier", listed("ga", "na"), NOTHING_HELD)).toEqual([]);
  });

  // 최상위 터미널은 어느 work의 것도 아니다 — 목록이 비어도 주인을 안 잃는다.
  it("최상위 터미널의 셸은 안 나온다", () => {
    const tops = shellsAt(topTerminal("atelier"));
    expect(vanishedOwners(tops, "atelier", listed(), NOTHING_HELD)).toEqual([]);
  });

  it.each<[string, ListResult | undefined]>([
    ["실패", { status: "error", data: [{ slug: "na" }] }],
    ["로딩", { status: "pending" }],
    ["결과가 아직 없다", undefined],
    // 성공인데 값이 비어 온 모양 — 「빈 목록」과 가른다.
    ["성공인데 값이 없다", { status: "success" }],
  ])("%s이면 판단하지 않는다", (_, result) => {
    expect(vanishedOwners(state, "atelier", result, NOTHING_HELD)).toEqual([]);
  });

  // **UI 아카이브 · 삭제의 제외 창**. UI 길은 성공한 뒤 제 손으로 닫으므로(`closeShellsOf`) 그동안 그 slug는 감지에서
  // 빠진다 — 안 빼면 아카이브 도중 앉은 재조회가 사람이 이미 확인한 셸을 「주인 잃은 셸」로 세운다.
  it("제외 창에 든 owner는 뺀다", () => {
    expect(vanishedOwners(state, "atelier", listed(), holding(ownerOf("atelier", "ga")))).toEqual([
      ownerOf("atelier", "na"),
    ]);
  });

  // 이미 주인 잃은 셸은 다시 판정하지 않는다 — 다시 보면 claude가 대답을 마치고 조용해진 순간 저절로 닫힌다.
  // 그것이 프로세스 결정 4가 기각한 「끝날 때까지 기다렸다 자동으로 닫기」다.
  it("이미 주인 잃은 셸은 다시 안 나온다", () => {
    const ownerless = markOwnerless(state, [1, 2]);
    expect(vanishedOwners(ownerless, "atelier", listed(), NOTHING_HELD)).toEqual([ownerOf("atelier", "na")]);
  });
});

// 다시 읽을 다른 세계가 없다 — 모드가 하나다(ui-refresh 결정 3). 이 함수를 걷는 것은 판 02의 02다.
describe("저쪽 세계를 다시 읽는가", () => {
  it("다시 읽을 세계가 없다", () => {
    expect(worldsToReread(NO_SHELLS, "atelier")).toEqual([]);
    expect(worldsToReread(shellsAt(originIn("atelier", "ga"), topTerminal("atelier")), "atelier")).toEqual([]);
  });
});

describe("주인 잃은 셸의 세계", () => {
  const state = shellsAt(originIn("atelier", "ga"), originIn("atelier", "na"));

  it("주인 잃은 셸이면 그 세계다", () => {
    const ownerless = markOwnerless(state, [1, 2]);
    expect(ownerlessWorldOf(ownerless, 1)).toBe("atelier");
    expect(ownerlessWorldOf(ownerless, 2)).toBe("atelier");
  });

  // 띠가 이것으로 갈린다(S14) — 주인이 있는 셸은 지금처럼 그 work으로 간다.
  it("주인이 있는 셸 · 없는 번호는 `null`이다", () => {
    expect(ownerlessWorldOf(state, 1)).toBeNull();
    expect(ownerlessWorldOf(state, 99)).toBeNull();
  });

  // 끝난 칸도 주인 잃은 셸이다 — 표시는 셸이 끝나도 안 지워진다.
  it("끝난 칸도 표시가 남는다", () => {
    const ended = markExited(markOwnerless(state, [1]), 1, { exitCode: 1, signal: null });
    expect(ownerlessWorldOf(ended, 1)).toBe("atelier");
  });
});

describe("토스트", () => {
  // 세는 말은 화면의 말 「작업」이다(프로세스 스펙 S45 · `itemNameOf`).
  it("화면의 말로 N을 센다", () => {
    expect(ownerlessNotice("atelier", 2)).toBe("아카이브된 작업의 셸 2개에 아직 도는 것이 있어요");
  });

  // 동작 토스트는 자기 id를 쓴다 — 같은 알림이 다시 오면(주인 잃은 셸이 늘었다 · 띠에서 다시 불렀다) 새로 쌓이지 않고
  // 그 자리를 고친다.
  it("id가 하나다", () => {
    expect(ownerlessToastId("atelier")).toBe(ownerlessToastId("atelier"));
  });
});

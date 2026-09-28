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
  // Atelier의 work 가 · 나, Maison의 Room 가, 두 세계의 최상위 터미널.
  const state = shellsAt(
    originIn("atelier", "ga"),
    originIn("atelier", "ga"),
    originIn("atelier", "na"),
    originIn("maison", "ga"),
    topTerminal("atelier"),
    topTerminal("maison"),
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

  // **세계마다 따로 본다**(life-mode 결정 10) — 두 세계에 같은 slug가 설 수 있다. Atelier 목록에서 `ga`가 빠진 것으로 Maison의
  // Room `ga`가 주인을 잃으면 안 된다.
  it("그 세계의 목록은 그 세계의 셸만 본다", () => {
    expect(vanishedOwners(state, "maison", listed("ga"), NOTHING_HELD)).toEqual([]);
    expect(vanishedOwners(state, "maison", listed(), NOTHING_HELD)).toEqual([ownerOf("maison", "ga")]);
  });

  // 최상위 터미널은 어느 work의 것도 아니다 — 목록이 비어도 주인을 안 잃는다.
  it("최상위 터미널의 셸은 안 나온다", () => {
    const tops = shellsAt(topTerminal("atelier"), topTerminal("maison"));
    expect(vanishedOwners(tops, "atelier", listed(), NOTHING_HELD)).toEqual([]);
    expect(vanishedOwners(tops, "maison", listed(), NOTHING_HELD)).toEqual([]);
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

// 목록 쿼리는 관찰자가 있는 것만 다시 부른다 — 앱 루트는 지금 세계만 관찰하므로, 저쪽 세계는 따로 불러야 새로 앉는다.
// 부르는 것은 **그 세계를 owner로 가진 셸이 스토어에 하나라도 있을 때만**이다(S13). 그래서 이벤트 한 번에 목록 조회는
// 저쪽 세계에 셸이 없으면 1번, 있으면 2번이다 — 판 02(14)가 이 수를 기대값으로 쓴다.
describe("저쪽 세계를 다시 읽는가", () => {
  it("저쪽 세계에 셸이 없으면 안 읽는다 — 지금 세계의 셸은 세지 않는다", () => {
    expect(worldsToReread(NO_SHELLS, "atelier")).toEqual([]);
    expect(worldsToReread(shellsAt(originIn("atelier", "ga")), "atelier")).toEqual([]);
  });

  it("저쪽 세계에 셸이 있으면 그 세계를 읽는다", () => {
    expect(worldsToReread(shellsAt(originIn("maison", "ga")), "atelier")).toEqual(["maison"]);
    expect(worldsToReread(shellsAt(originIn("atelier", "ga")), "maison")).toEqual(["atelier"]);
  });

  // 스펙의 문장 그대로 「그 세계를 owner로 가진 셸」이다 — 최상위 터미널의 셸도 그 세계의 셸이다. 주인을 잃을 수는 없지만
  // 조회 수를 셸의 종류로 가르면 판 02가 기대값으로 쓰는 수가 셸 종류마다 갈린다.
  it("저쪽 세계의 최상위 터미널 셸도 센다", () => {
    expect(worldsToReread(shellsAt(topTerminal("maison")), "atelier")).toEqual(["maison"]);
  });
});

describe("주인 잃은 셸의 세계", () => {
  const state = shellsAt(originIn("atelier", "ga"), originIn("maison", "na"));

  it("주인 잃은 셸이면 그 세계다", () => {
    const ownerless = markOwnerless(state, [1, 2]);
    expect(ownerlessWorldOf(ownerless, 1)).toBe("atelier");
    expect(ownerlessWorldOf(ownerless, 2)).toBe("maison");
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
  // 세는 말은 세계의 것이다(프로세스 스펙 S45) — Atelier는 화면의 말 「작업」(`itemNameOf`), Maison은 「Room」이다.
  it("그 세계의 말로 N을 센다", () => {
    expect(ownerlessNotice("atelier", 2)).toBe("아카이브된 작업의 셸 2개에 아직 도는 것이 있어요");
    expect(ownerlessNotice("maison", 1)).toBe("아카이브된 Room의 셸 1개에 아직 도는 것이 있어요");
  });

  // 동작 토스트는 자기 id를 쓴다 — 같은 알림이 다시 오면(주인 잃은 셸이 늘었다 · 띠에서 다시 불렀다) 새로 쌓이지 않고
  // 그 자리를 고친다. 세계마다 따로인 것은 [모두 닫기]가 그 세계의 셸만 닫기 때문이다.
  it("세계마다 id가 하나다", () => {
    expect(ownerlessToastId("atelier")).toBe(ownerlessToastId("atelier"));
    expect(ownerlessToastId("atelier")).not.toBe(ownerlessToastId("maison"));
  });
});

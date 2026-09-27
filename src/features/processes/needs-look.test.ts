import { describe, expect, it } from "vitest";
import { SEEN_CAP, lookablesOf, needsLook, ownerlessShellKeys, seenWith } from "./needs-look";
import type { ProcessIdentity, ProcessSummary } from "./types";

// 프로세스 티켓 29 — **nav 메타의 `●` 판정**(프로세스 결정 11 · 프로세스 스펙 S41 · S42). 점은 손볼 것이 **본 뒤 새로 생겼을 때만**
// 선다: 본 것의 집합(주인 잃은 셸의 셸 키 · 출처 불명의 신원 · 기록 머리 id)과 지금 집합을 견준다. 이 파일은 그 판정의 순수 함수를
// 잰다. 진짜 사이드바에서 점이 서고 화면을 열면 꺼지는지는 L3가 잰다(`processes-nav-meta.spec.ts`).
//
// **기록의 까닭은 Rust가 가른다.** 요약의 머리 id는 `●`를 켜는 까닭(시작 정리 · MCP 아카이브 · 셸 스스로 끝남)과 「못 끝냄」이 든
// 기록에서만 나온다(`cleanup_log::look_head`의 L1) — 사람 손 기록은 머리를 안 옮긴다. 화면이 닫혀 있을 때 프런트가 받는 것은 요약뿐이라
// 까닭을 다 보는 자리가 거기뿐이다. 여기서 재는 것은 그 머리를 본 것과 견주는 절반이다.

const 요약 = (unknown: ProcessIdentity[] = [], recordHead: number | null = null, total: number | null = 900): ProcessSummary => ({
  total,
  cpu: null,
  app: null,
  webviewExcluded: true,
  unknown,
  recordHead,
});
const 신원 = (pid: number): ProcessIdentity => ({ pid, startedUs: 1_790_000_000_000_000 + pid });
const 셸 = (shellKey: string | null, ownerless: boolean) => ({ shellKey, ownerless });

/** 본 때의 집합을 지어 둔다 — 그때 화면을 열고 봤다. */
const 봤다 = (ownerless: string[], summary?: ProcessSummary) => seenWith([], lookablesOf(ownerless, summary));

describe("손볼 것이 새로 생기면 점이 선다", () => {
  it("아무것도 안 봤고 손볼 것도 없으면 점이 없다 — 합계만 선다", () => {
    expect(needsLook([], lookablesOf([], 요약()))).toBe(false);
  });

  it("새 주인 잃은 셸 — 셸 키로 센다", () => {
    const seen = 봤다(["G-1"], 요약());
    expect(needsLook(seen, lookablesOf(["G-1"], 요약()))).toBe(false);
    expect(needsLook(seen, lookablesOf(["G-1", "G-2"], 요약()))).toBe(true);
  });

  it("새 출처 불명 — 요약에 실린 신원으로 센다", () => {
    const seen = 봤다([], 요약([신원(500)]));
    expect(needsLook(seen, lookablesOf([], 요약([신원(500)])))).toBe(false);
    expect(needsLook(seen, lookablesOf([], 요약([신원(500), 신원(501)])))).toBe(true);
  });

  it("새 자동 기록 — 요약의 머리 id가 바뀌었다", () => {
    const seen = 봤다([], 요약([], 7));
    expect(needsLook(seen, lookablesOf([], 요약([], 7)))).toBe(false);
    expect(needsLook(seen, lookablesOf([], 요약([], 8)))).toBe(true);
    // 본 때 자동 기록이 하나도 없었어도 같다.
    expect(needsLook(봤다([], 요약()), lookablesOf([], 요약([], 1)))).toBe(true);
  });

  // 티켓 29 「스펙과 다른 점」 — 수만 실었으면 못 보는 자리다. 앵커: 수는 그대로 하나다.
  it("출처 불명 하나가 사라지고 다른 하나가 생기면(수는 같다) 선다", () => {
    const seen = 봤다([], 요약([신원(500)]));
    const now = 요약([신원(777)]);
    expect(now.unknown).toHaveLength(요약([신원(500)]).unknown.length);
    expect(needsLook(seen, lookablesOf([], now))).toBe(true);
  });

  it("pid가 같아도 시작 시각이 다르면 다른 프로세스다 — 재사용된 pid", () => {
    const seen = 봤다([], 요약([신원(500)]));
    expect(needsLook(seen, lookablesOf([], 요약([{ pid: 500, startedUs: 1 }])))).toBe(true);
  });
});

describe("본 것은 남아 있어도 점을 안 켠다", () => {
  it("셋 모두 본 것이면 그대로 남아 있어도 안 선다", () => {
    const summary = 요약([신원(500), 신원(501)], 7);
    const seen = 봤다(["G-1"], summary);
    expect(needsLook(seen, lookablesOf(["G-1"], summary))).toBe(false);
  });

  it("본 것이 사라지기만 하면 안 선다", () => {
    const seen = 봤다(["G-1", "G-2"], 요약([신원(500), 신원(501)], 7));
    expect(needsLook(seen, lookablesOf(["G-2"], 요약([신원(501)], 7)))).toBe(false);
  });

  // 사람이 누른 ×, 종료, 새로고침, 아카이브, [끝내기], [정리]의 기록은 머리를 안 옮긴다(Rust L1). 그 사이 요약에서 바뀌는 것은 합계
  // 뿐이다 — 셸을 닫으면 메모리가 준다. 합계는 손볼 것이 아니다.
  it("사람 손 기록 — 머리가 그대로이고 합계만 바뀐 요약에는 안 선다", () => {
    const seen = 봤다([], 요약([], 7, 900));
    expect(needsLook(seen, lookablesOf([], 요약([], 7, 300)))).toBe(false);
    expect(needsLook(seen, lookablesOf([], 요약([], 7, null)))).toBe(false);
  });

  // 앵커: 같은 자리에서 새것은 켠다 — 「안 켠다」가 판정이 무너져서가 아니다.
  it("본 뒤 한 번 더 보면 새로 생긴 것도 본 것이 된다", () => {
    const first = 봤다(["G-1"], 요약([신원(500)], 7));
    const now = lookablesOf(["G-1", "G-2"], 요약([신원(500), 신원(600)], 8));
    expect(needsLook(first, now)).toBe(true);
    expect(needsLook(seenWith(first, now), now)).toBe(false);
  });
});

describe("주인 잃은 셸만 센다 — 화면 밖 셸은 안 켠다(S42)", () => {
  it("주인 잃음 표시가 선 셸의 키만 이름이 된다", () => {
    expect(ownerlessShellKeys([셸("G-1", true), 셸("G-2", false), 셸("G-3", true)])).toEqual(["G-1", "G-3"]);
  });

  // 도는 셸 · 사람이 연 셸은 손볼 것이 아니다. 화면 밖 셸(풀에는 있는데 스토어가 모르는 셸)은 스토어의 셸이 아니라 이 입력에 올
  // 길이 없다 — 판정의 입력은 스토어의 셸과 요약뿐이다.
  it("주인 잃음 표시가 없는 셸은 새로 떠도 안 켠다", () => {
    const seen = 봤다([], 요약());
    const now = lookablesOf(ownerlessShellKeys([셸("G-1", false), 셸("G-2", false)]), 요약());
    expect(needsLook(seen, now)).toBe(false);
  });

  // spawn 답 전이거나 못 뜬 칸 — 셸 키가 없다. 키가 서면 그때 센다(돌지 않는 칸은 손볼 것도 없다).
  it("셸 키가 아직 없는 주인 잃은 셸은 세지 않는다", () => {
    expect(ownerlessShellKeys([셸(null, true)])).toEqual([]);
  });

  it("요약이 아직 안 왔어도 주인 잃은 셸은 센다", () => {
    expect(needsLook([], lookablesOf(["G-1"], undefined))).toBe(true);
    expect(needsLook([], lookablesOf([], undefined))).toBe(false);
  });
});

describe("본 것의 집합", () => {
  it("셸 키 · 신원 · 기록 번호가 같은 글자여도 서로 안 겹친다", () => {
    const seen = 봤다(["7"], 요약());
    expect(needsLook(seen, lookablesOf([], 요약([], 7)))).toBe(true);
  });

  // 본 것을 지금 것으로 **갈아 끼우지 않는다** — 한 표본이 어떤 출처 불명을 잠깐 못 읽어 빠뜨린 순간에 보면, 갈아 끼운 집합에서는 그
  // 신원이 빠져 다음 표본에 다시 나타날 때 점이 선다. 본 적 있는 신원은 새로 생긴 것이 아니다.
  it("보는 사이 잠깐 빠졌던 것이 다시 나타나도 안 선다", () => {
    const first = 봤다([], 요약([신원(500), 신원(501)]));
    // 이 표본은 500을 빠뜨렸고 새 502를 싣는다 — 새것이 있어 본 것이 다시 지어지는 순간이다.
    const glitch = seenWith(first, lookablesOf([], 요약([신원(501), 신원(502)])));
    expect(needsLook(glitch, lookablesOf([], 요약([신원(500), 신원(501), 신원(502)])))).toBe(false);
  });

  // 같은 것을 돌려준다 — 화면이 열려 있는 동안 요약이 올 때마다 다시 보는데, 그때마다 새 집합이면 저장도 그때마다 한다.
  it("이미 본 것만 다시 보면 받은 집합을 그대로 돌려준다", () => {
    const seen = 봤다(["G-1"], 요약([신원(500)], 7));
    expect(seenWith(seen, lookablesOf(["G-1"], 요약([신원(500)], 7)))).toBe(seen);
    expect(seenWith(seen, lookablesOf([], 요약()))).toBe(seen);
  });

  // 앱을 몇 달 켜 두어도 저장한 집합이 안 불어난다. 넘치면 가장 먼저 본 것부터 빠진다 — 지금 것은 늘 남는다.
  it(`${SEEN_CAP}개를 넘으면 가장 먼저 본 것부터 빠지고, 지금 것은 남는다`, () => {
    let seen: ReadonlyArray<string> = [];
    for (let pid = 1; pid <= SEEN_CAP + 10; pid += 1) seen = seenWith(seen, lookablesOf([], 요약([신원(pid)])));
    expect(seen).toHaveLength(SEEN_CAP);
    expect(needsLook(seen, lookablesOf([], 요약([신원(SEEN_CAP + 10)])))).toBe(false);
    expect(needsLook(seen, lookablesOf([], 요약([신원(1)])))).toBe(true);
  });
});

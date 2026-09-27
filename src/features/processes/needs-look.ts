import type { ProcessSummary } from "./types";

// **nav 메타의 `●` 판정**(프로세스 결정 11 · 프로세스 스펙 S41 · S42 · 티켓 29). 순수 함수다 — 본 것의 집합과 지금 집합을 받아 점을
// 켤지 답한다. 무엇이 「지금」인지는 스토어(주인 잃은 셸)와 요약(출처 불명 · 기록 머리)이 주고, 언제 「봤다」인지는 화면이 정한다
// (`ProcessesNavMeta`).
//
// **손볼 것은 셋이다.** 주인 잃은 셸(셸 키로), 출처 불명(신원으로), 앱이 사람 손 없이 끝낸 정리 기록(머리 id로). 셋을 한 목록의
// 이름으로 편다 — 갈래를 앞에 붙여 셸 키와 기록 번호가 같은 글자여도 안 겹친다.
//
// **본 뒤 새로 생긴 것만 켠다.** 아직 남아 있어도 본 것이면 켜지 않는다 — 수만 견주면 하나가 사라지고 다른 하나가 생긴 것을 못 보고,
// 「있다」만 보면 사람이 두기로 한 출처 불명 하나가 점을 영영 켠다. 사람이 방금 한 일(×로 닫기 · [정리] …)에 점이 서지 않는 것은
// Rust가 그 기록으로 머리를 안 옮기기 때문이다(`cleanup_log::look_head`) — 까닭을 다 보는 자리가 거기뿐이다.
//
// 화면 밖 셸(풀에는 있는데 스토어가 모르는 셸, S42)은 켜지 않는다: 이 판정의 입력은 스토어의 셸과 요약뿐이라 그 셸이 올 길이 없다.

/**
 * 점의 접근성 이름 — 눈에는 점 하나지만 스크린리더에는 이 말이다. 점을 그리는 자리(`ProcessesNavMeta`)와 그것을 집는 L3가 이 글자
 * 하나를 읽는다.
 */
export const NEEDS_LOOK_LABEL = "손볼 것이 있어요";

/** 본 것의 집합이 쥐는 이름 수의 상한. 넘치면 가장 먼저 본 것부터 빠진다 — 앱을 몇 달 켜 두어도 저장한 집합이 안 불어난다. */
export const SEEN_CAP = 256;

/**
 * 주인 잃은 셸의 셸 키 — 두 세계의 것이 함께다(nav 메타는 「이 세계의 것만 센다」의 예외, 프로세스 결정 9). **셸 키로 센다**(티켓 23 ·
 * 29): 레지스트리 id는 이 실행의 프런트만 아는 번호다. 키가 아직 없는 칸(spawn 답 전 · 못 뜬 칸)은 안 센다 — 돌지 않는 칸은 손볼
 * 것도 없고, 뜬 칸은 곧 키가 선다.
 *
 * 문자열 배열을 돌려준다 — 스토어 셀렉터가 얕은 비교로 견주므로, 주인 잃음과 상관없는 셸의 변화(타이틀 · 도는 것)에는 같은 값이다.
 */
export function ownerlessShellKeys(shells: ReadonlyArray<{ ownerless: boolean; shellKey: string | null }>): string[] {
  return shells.flatMap((shell) => (shell.ownerless && shell.shellKey !== null ? [shell.shellKey] : []));
}

/** 지금 손볼 것의 이름들. 요약이 아직 안 왔으면(첫 답 전 · 거절) 주인 잃은 셸만이다. */
export function lookablesOf(ownerlessKeys: ReadonlyArray<string>, summary: ProcessSummary | undefined): string[] {
  const names = ownerlessKeys.map((key) => `shell:${key}`);
  if (summary === undefined) return names;
  // 신원은 pid와 시작 시각의 쌍이다 — pid만 쓰면 재사용된 pid의 새 프로세스를 본 것으로 친다.
  names.push(...summary.unknown.map(({ pid, startedUs }) => `unknown:${pid}@${startedUs}`));
  if (summary.recordHead !== null) names.push(`record:${summary.recordHead}`);
  return names;
}

/** **점을 켜나** — 지금 것 가운데 본 적 없는 것이 하나라도 있다. */
export function needsLook(seen: ReadonlyArray<string>, now: ReadonlyArray<string>): boolean {
  const known = new Set(seen);
  return now.some((name) => !known.has(name));
}

/**
 * 봤다 — 지금 것을 본 것에 **더한다**. 갈아 끼우지 않는다: 한 표본이 어떤 출처 불명을 잠깐 못 읽어 빠뜨린 순간에 보면, 갈아 끼운
 * 집합에서는 그 신원이 빠져 다음 표본에 다시 나타날 때 점이 선다. 셸 키 · 신원 · 기록 번호는 한 번 사라지면 다시 안 나타나는 이름이라
 * 남겨 두어도 새것을 못 가리지 않는다.
 *
 * **새것이 없으면 받은 집합을 그대로 돌려준다** — 화면이 열려 있는 동안 요약이 올 때마다 다시 보는데, 그때마다 새 집합이면 저장도
 * 그때마다 한다. 새것이 있으면 지금 것을 모두 뒤로 옮긴 뒤 앞에서 자른다(`SEEN_CAP`) — 지금 것은 잘리지 않는다.
 */
export function seenWith(seen: ReadonlyArray<string>, now: ReadonlyArray<string>): ReadonlyArray<string> {
  if (!needsLook(seen, now)) return seen;
  const current = new Set(now);
  return [...seen.filter((name) => !current.has(name)), ...current].slice(-SEEN_CAP);
}

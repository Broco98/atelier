// 「셸을 닫아도 남길 프로세스」 칸의 글자 ↔ 파일에 적을 값(프로세스 결정 5 · 프로세스 스펙 S7). 칸은 한 줄에
// 하나씩 쓰는 목록이고, 파일의 `null`은 「기본 목록을 쓴다」다.
//
// **기본 목록은 여기 없다.** 값을 정하는 자리는 판정이 쓰는 Rust 상수 하나이고(`processes/exceptions.rs`),
// 화면은 그것을 IPC로 받아(`settingsApi.defaultExceptions`) 이 함수들에 넘긴다 — 판정은 화면 없이 앱 안에서
// 돌기 때문이다(셸 닫기, 앱 종료). 여기 베껴 적으면 한쪽이 조용히 낡는다.
//
// 렌더 없이 L2가 잴 수 있게 화면에서 꺼냈다(`SettingsPage.tsx`의 `parseFontSize`와 같은 까닭).

/**
 * 칸에 보일 글자 — 한 줄에 하나. `null`(고치지 않음)이면 기본 목록을 보인다: 거기서 한 줄을 더하면
 * **기본 목록 + 그 이름**이 저장된다(판 04의 「예외로 두기」도 같은 규칙을 탄다).
 *
 * `null`인데 기본 목록을 아직 모르면(못 받았으면) **보일 글자가 없다**(`null`). 그때 빈 칸을 보이면 거기 한 줄을
 * 더해 저장하는 순간 기본 목록이 통째로 사라진다 — 칸을 잠그는 것은 부르는 쪽이다.
 */
export function exceptionsText(list: string[] | null, defaults: string[] | null): string | null {
  const shown = list ?? defaults;
  return shown === null ? null : shown.join("\n");
}

/**
 * 칸의 글자 → 파일에 적을 값. 줄마다 앞뒤 공백을 걷고 빈 줄은 버린다.
 *
 * **기본 목록과 같으면 `null`이다** — 파일에는 사람이 고친 것만 적는다(`settings.rs`의 규칙). 기본 목록을 글자로
 * 적어 두면 다음 판의 기본 목록이 이 사람에게 안 닿는다, 고친 적도 없는데. 칸을 건드렸다 되돌린 것이 저장을 여는
 * 일도 이것이 막는다. 기본 목록을 모르면 견주지 않는다.
 *
 * 모두 지운 칸은 빈 목록(「아무것도 남기지 않는다」)이지 `null`이 아니다 — 기본값으로 돌리는 길은 「기본값으로」
 * 하나다.
 */
export function exceptionsFromText(text: string, defaults: string[] | null): string[] | null {
  const list = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "");
  const same =
    defaults !== null &&
    list.length === defaults.length &&
    list.every((entry, i) => entry === defaults[i]);
  return same ? null : list;
}

// **localStorage를 만지는 문** — 앱을 껐다 켜도 남길 작은 편의(사이드바 접힘은 `shell-store.ts`, nav `Processes`의 본
// 것은 `features/processes/looked.ts`)가 이 둘로 읽고 적는다.
//
// **부를 때마다 확인하고 던지는 것을 삼킨다** — 있는지 한 번만 보고 모듈 상수로 굳히면 나중에 심어진 저장소를 영영 못 보고(라우터
// 테스트가 케이스마다 심는다), try 없이 만지면 사생활 모드처럼 **존재하지만 접근이 던지는** 저장소에서 앱이 통째로 안 뜬다.

/** 적어 둔 값. 저장소가 없거나 접근이 던지면 `null`이다 — 적은 적 없는 것과 같다. */
export function readStored(key: string): string | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** 값을 적는다. 적지 못하면 조용히 넘어간다. */
export function writeStored(key: string, value: string): void {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, value);
  } catch {
    // 적어 두지 못하는 것은 이번 실행의 편의를 잃는 일일 뿐이다 — 여기서 던지면 그 편의를 위해 화면이 죽는다.
  }
}

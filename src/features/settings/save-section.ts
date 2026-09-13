import { settingsApi } from "./api";
import type { Settings } from "./types";

// 설정 구획 하나를 **저장하는 규칙**(#225 · 결정 21). 터미널 설정과 알림 설정이 각자 저장
// 버튼을 갖게 되면서 화면에서 꺼냈다 — 렌더 없이 L2가 잴 수 있어야 하고, 두 구획이 한 줄을
// 함께 서야 해서다(아래 `tail`).
//
// 에이전트 훅은 여기 없다 — 앱 설정 파일이 아니라 사용자의 claude·codex 설정에 산다.

/** 앱 설정 파일에서 **저장 버튼을 가진** 구획들. */
export type SettingsSectionKey = "terminal" | "notifications";

/**
 * `(읽기, 쓰기) → 저장`. 돌려받은 `save(key, value)`는 **쓰는 순간 최신 설정을 읽어 그 구획
 * 칸만 덮어** 쓴다.
 *
 * 화면을 열 때 읽은 사본에서 나머지 칸을 가져오면 안 된다 — 그사이 다른 구획이 저장한 값을
 * 옛 사본이 덮는다. 쓰기는 파일 전체라(`api.ts`의 `write`) 「내 칸만 보낸다」가 없고, 그래서
 * 「내 칸만 **바꾼다**」를 읽기 한 번으로 산다. 모르는 최상위 키도 그 읽기에 실려 와 그대로
 * 돌아간다(`api.ts`의 규칙).
 *
 * **저장은 줄을 선다.** 두 구획이 거의 동시에 저장하면 둘 다 같은 최신을 읽은 뒤 뒤에 쓴 쪽이
 * 앞의 값을 지우고, `settings.rs`는 tmp 이름을 고정해 「쓰기는 한 번에 하나」를 전제로 적었다.
 * 예전엔 저장 버튼이 하나라 화면의 `saving`이 그 전제를 졌는데, 버튼이 둘이 되면서 그 일이
 * 여기로 왔다 — 그래서 이 함수가 돌려준 `save` **하나를 두 구획이 함께** 써야 한다
 * (`saveSettingsSection`).
 *
 * 돌려주는 것은 **파일에 쓴 그 설정**이다 — 부르는 쪽이 그것을 셸에 먹인다.
 */
export function sectionSaver(
  read: () => Promise<Settings>,
  write: (settings: Settings) => Promise<void>,
) {
  let tail: Promise<unknown> = Promise.resolve();
  return <K extends SettingsSectionKey>(key: K, value: Settings[K]): Promise<Settings> => {
    const run = tail.then(async () => {
      const latest = await read();
      const next: Settings = { ...latest, [key]: value };
      await write(next);
      return next;
    });
    // 실패한 저장이 줄을 막지 않는다 — 막히면 다음 저장이 영영 안 나가고 화면은 「저장 중…」에
    // 선다. 실패 자체는 `run`을 기다리는 쪽이 받는다.
    tail = run.catch(() => {});
    return run;
  };
}

/** 설정 화면의 두 구획이 **함께 쓰는** 저장 하나. 따로 만들면 줄이 둘이 된다. */
export const saveSettingsSection = sectionSaver(settingsApi.read, settingsApi.write);

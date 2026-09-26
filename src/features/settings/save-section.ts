import { settingsApi } from "./api";
import type { SettingsItemKey } from "./pages";
import type { Settings } from "./types";

// 설정 구획 하나를 **저장하는 규칙**(#225 · S17 · 결정 22·26). 터미널 설정과 알림 설정이 각자 저장
// 버튼을 갖게 되면서 화면에서 꺼냈다 — 렌더 없이 L2가 잴 수 있어야 하고, 두 구획이 한 줄을
// 함께 서야 해서다(아래 `tail`).
//
// 에이전트 훅은 여기 없다 — 앱 설정 파일이 아니라 사용자의 claude·codex 설정에 산다.

/**
 * 앱 설정 파일에서 **저장 버튼을 가진** 구획들 — 설정 항목 표(`SETTINGS_ITEMS`)에서 훅만 뺀다.
 * 손으로 적으면 저장할 항목을 표에 더한 날 이 목록만 조용히 낡는다. 빼는 쪽으로 적어서, 더한
 * 항목이 `Settings`에 칸이 없으면 `Settings[K]`가 타입에서 빨개진다.
 */
export type SettingsSectionKey = Exclude<SettingsItemKey, "hooks">;

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
 *
 * 값 대신 **고치는 함수**(`SectionUpdate`)를 받으면 줄 안에서 읽은 최신 구획으로 짓는다(프로세스 티켓 31 — 칸 하나만 고치는 쪽).
 */
/** 구획 하나를 고치는 함수 — 쓰는 순간의 최신 구획을 받아 쓸 구획을 돌려준다(`sectionSaver`). */
export type SectionUpdate<K extends SettingsSectionKey> = (latest: Settings[K]) => Settings[K];

export function sectionSaver(
  read: () => Promise<Settings>,
  write: (settings: Settings) => Promise<void>,
) {
  let tail: Promise<unknown> = Promise.resolve();
  return <K extends SettingsSectionKey>(key: K, value: Settings[K] | SectionUpdate<K>): Promise<Settings> => {
    const run = tail.then(async () => {
      const latest = await read();
      // 함수면 **쓰는 순간의 최신 구획**에서 짓는다 — 칸 하나만 고치는 쪽(`Processes`의 「예외로 두기」)이 줄 밖에서 읽은 구획을
      // 값으로 넘기면, 그사이 저장된 같은 구획의 다른 칸을 옛 사본으로 덮는다.
      const section = typeof value === "function" ? (value as SectionUpdate<K>)(latest[key]) : value;
      const next: Settings = { ...latest, [key]: section };
      await write(next);
      return next;
    });
    // 실패한 저장이 줄을 막지 않는다 — 막히면 다음 저장이 영영 안 나가고 화면은 「저장 중…」에
    // 선다. 실패 자체는 `run`을 기다리는 쪽이 받는다.
    tail = run.catch(() => {});
    return run;
  };
}

/**
 * 설정 화면의 두 구획이 **함께 쓰는** 저장 하나. 따로 만들면 줄이 둘이 된다 — 이 줄 밖에서
 * 쓰는 길이 안 생겼는지는 `save-section.test.ts`의 허용 목록이 센다.
 */
export const saveSettingsSection = sectionSaver(settingsApi.read, settingsApi.write);

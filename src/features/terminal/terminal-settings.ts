import { Store } from "@tanstack/react-store";
import { settingsApi } from "@/features/settings/api";
import type { TerminalSettings } from "@/features/settings/types";

/**
 * `~/.atelier/settings.json`의 `terminal` 구획이 셸에 도착하는 자리. **`null`은 「아직 못 읽었거나
 * 영영 못 읽는다」**이고, 그때 무엇으로 그리는지는 `terminalLook`이 답한다.
 *
 * **왜 TanStack Query가 아닌가:** 이 값을 읽는 쪽이 React가 아니다 — xterm 인스턴스는
 * `terminal-store.ts`의 모듈 싱글턴이 들고 있어 라우트 언마운트를 넘긴다(결정 21). 되읽을 신호도
 * 없다: `watcher.rs`가 보는 것은 works·projects 폴더뿐이라 `settings.json`에는 `works:changed`
 * 같은 길이 없다. 그래서 `terminalStore`·`shellStore`와 같은 모듈 스토어다.
 *
 * **왜 `terminal-store.ts`가 아닌가:** 이 값을 쓰는 쪽(설정 화면)과 앱이 뜰 때 읽는 쪽
 * (`main.tsx`)이 `@xterm/*`와 그 CSS를 딸고 올 이유가 없다.
 */
export const terminalSettingsStore = new Store<TerminalSettings | null>(null);

/**
 * 고른 값을 셸에 먹인다 — 설정 화면이 **저장에 성공한 뒤** 부른다.
 *
 * 이미 떠 있는 셸도 따라간다(결정 52). 재생성은 없다 — xterm은 `options`를 런타임에 받아 다시
 * 그린다. 그 일을 하는 곳은 이 스토어를 구독하는 `terminal-store.ts`다.
 *
 * **저장 뒤에 부르는 것이 계약이다.** 칸을 고칠 때마다 부르면 글자를 한 자 지운 순간의 이름
 * (`Menl`)이 셸에 먹고, 그때마다 폰트 청구와 `fit()`이 따라 돈다.
 */
export function applyTerminalSettings(terminal: TerminalSettings): void {
  terminalSettingsStore.setState(() => terminal);
}

/**
 * 앱이 뜰 때 **한 번** 읽는다(`main.tsx`). 셸을 만들 때마다 파일을 읽으면 ⌘T가 IPC 왕복을 탄다.
 *
 * **못 읽어도 셸은 뜬다.** 깨진 파일은 실패로 온다(경로를 실은 에러 — `settings.rs`). 여기서
 * 멈추면 사용자가 그 파일을 고칠 때까지 터미널을 통째로 못 쓰는데, 설정 한 장을 못 읽은 값으로는
 * 과하다 — `loadFont`의 「글꼴을 못 얻는 것은 셸의 실패가 아니다」와 같은 판단이다. 기본값으로
 * 흐르고 이유만 콘솔에 남긴다.
 *
 * **고칠 자리를 말하는 것은 설정 화면의 몫이다.** 같은 에러를 그 화면이 「다시 읽기」와 함께
 * 띄운다(`SettingsPage`의 `readError`). 여기서 화면 없는 알림을 새로 짓지 않는다.
 */
export async function loadTerminalSettings(): Promise<void> {
  try {
    const settings = await settingsApi.read();
    applyTerminalSettings(settings.terminal);
  } catch (error) {
    console.warn("atelier: 설정을 못 읽었다 — 터미널은 기본값으로 간다", error);
  }
}

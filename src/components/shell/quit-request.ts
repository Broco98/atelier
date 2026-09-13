import { invoke } from "@tauri-apps/api/core";
import { askDialog } from "@/components/ui/confirm-store";
import type { Shell } from "@/features/terminal/shell-registry";

/**
 * 백엔드가 「앱을 끄려 한다」고 알리는 이벤트(결정 14 · S16). 빨간 버튼이 `CloseRequested`에서
 * 창 닫기를 막고 이것을 쏜다(`src-tauri/src/quit.rs`) — 11의 델리게이트 훅도 같은 이름을 쏜다.
 *
 * **두 언어가 이 문자열로만 이어진다.** 어긋나면 빨간 버튼이 창을 막아 두고 프런트는 아무것도
 * 못 들어, 앱을 끌 길이 강제 종료뿐이 된다 — 그래서 `quit-request.test.ts`가 Rust 쪽 상수와 견준다.
 */
export const QUIT_REQUESTED_EVENT = "app:quit-requested";

/** 확인 창의 제목. L3가 이 이름으로 창을 집는다. */
export const QUIT_TITLE = "Atelier 종료";

/** 종료하면 닫힐 셸 수와, 그중 명령이 도는 셸 수(결정 15). 명령의 개수가 아니다. */
export interface QuitCounts {
  live: number;
  running: number;
}

/**
 * **두 세계를 합친** 살아 있는 셸을 센다. 명령이 도는지는 셸마다 **지금 물어서** 센다 — 1초
 * 폴링 값(`Shell.running`)은 늦을 수 있다. 물음은 병렬로 나간다.
 *
 * **판정이 「모름」이거나 물음이 실패하면 안 도는 것으로 센다** — 셸 닫기 확인도 모르면 안 묻는다
 * (`needsCloseConfirm`)와 같은 판정이다. 여기서 던지면 창이 안 뜨는데, 창이 안 뜨는 것보다 수가
 * 하나 적게 적힌 창이 낫다: 안전판이 없어서(결정 31) 창이 못 뜨는 길은 곧 끌 수 없는 길이다.
 *
 * 끝난 칸·못 뜬 칸은 목록에 남아 있어도 닫힐 프로세스가 없어 **세지도 묻지도 않는다.**
 */
export async function countQuitShells(
  shells: readonly Shell[],
  commandRunning: (id: number) => Promise<boolean | null>,
): Promise<QuitCounts> {
  const live = shells.filter((shell) => shell.status.kind === "running");
  const answers = await Promise.all(
    live.map((shell) => commandRunning(shell.id).catch(() => null)),
  );
  return { live: live.length, running: answers.filter((answer) => answer === true).length };
}

/**
 * 확인 창의 본문. **셸이 0개면 빈 문자열이다** — 그 줄이 아예 없다(결정 15 · 스토리 62). 그래도
 * 창은 뜬다: 셸이 없을 때의 실수 종료도 조건 밖에 남기지 않는다(결정 14).
 *
 * 「셸」·「명령」은 `CONTEXT.md`의 말이다 — 명령은 셸 안에서 도는 프로세스이지 셸 자신이 아니다.
 */
export function quitNotice({ live, running }: QuitCounts): string {
  if (live === 0) return "";
  return `셸 ${live} · 명령이 도는 셸 ${running}`;
}

/** 「종료」를 고른 뒤 백엔드에 끄라고 한다. Rust가 「확인됨」을 세우고 `app.exit(0)`을 부른다. */
export const quitApp = (): Promise<void> => invoke<void>("quit_app");

/**
 * 「종료를 묻는 중」. **모듈 수준에 동기로** 선다 — 이벤트가 와서 세기를 시작하는 그 틱에.
 *
 * 확인 창 스토어는 새 물음이 앞 물음을 「아니오」로 접으므로, 이 표시 없이 종료 요청이 연달아
 * 오면 창이 깜빡이고, 세는 동안에는 창이 아직 없어 「창이 떠 있나」로는 못 막는다.
 */
let asking = false;

/**
 * 종료 요청 하나를 받는다 — 세고, 묻고, 「종료」면 끈다.
 *
 * **표시는 확인 창의 답이 풀리는 자리에서 내린다** — 버튼 핸들러가 아니다. 「취소」 · Esc · 바깥
 * 클릭 · 다른 물음에 밀려남이 전부 그 약속을 「아니오」로 푸는 같은 길이라, 그 자리 하나에서
 * 내리면 빠지는 길이 없다. 세기가 던져도 `finally`가 내린다. 한 번이라도 선 채 남으면 그 뒤로
 * 앱을 끌 길이 강제 종료뿐이다(결정 31) — 이 함수가 지키는 가장 큰 것이 그것이다.
 *
 * **끄기 전에 내린다.** `quit_app`의 답은 앱이 꺼지면 영영 안 오므로, 그 뒤에 내리면 끄기가 어떤
 * 이유로 안 된 날 표시만 남는다.
 *
 * 세기와 끄기를 인자로 받는 것은 이 흐름을 값으로 재기 위해서다(`quit-request.test.ts`) — 셸
 * 목록을 쥔 스토어는 xterm을 끌고 와 그 seam에서 못 읽는다.
 */
export async function requestQuit(
  count: () => Promise<QuitCounts>,
  quit: () => Promise<unknown>,
): Promise<void> {
  if (asking) return;
  asking = true;
  let confirmed = false;
  try {
    const counts = await count();
    confirmed = await askDialog({
      title: QUIT_TITLE,
      body: quitNotice(counts),
      confirm: "종료",
      danger: true,
      focus: "cancel",
    });
  } finally {
    asking = false;
  }
  if (confirmed) await quit();
}

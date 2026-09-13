import { invoke } from "@tauri-apps/api/core";
import { askDialog } from "@/components/ui/confirm-store";
import { quitNotice } from "@/features/terminal/shell-registry";
import type { QuitCounts } from "@/features/terminal/shell-registry";

/**
 * 백엔드가 「앱을 끄려 한다」고 알리는 이벤트(결정 14 · #223). 빨간 버튼이 `CloseRequested`에서
 * 창 닫기를 막고 이것을 쏜다(`src-tauri/src/quit.rs`) — #224의 델리게이트 훅도 같은 이름을 쏜다.
 *
 * **두 언어가 이 문자열로만 이어진다.** 어긋나면 빨간 버튼이 창을 막아 두고 프런트는 아무것도
 * 못 들어, 앱을 끌 길이 강제 종료뿐이 된다 — 그래서 `quit-request.test.ts`가 Rust 쪽 상수와 견준다.
 */
export const QUIT_REQUESTED_EVENT = "app:quit-requested";

/** 확인 창의 제목. L3(`e2e/quit-confirm.spec.ts`)는 src를 안 읽어 같은 글자를 리터럴로 집는다. */
export const QUIT_TITLE = "Atelier 종료";

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
 * 종료 요청 하나를 받는다 — 세고, 묻고, 「종료」면 끈다. 무엇을 세는지는 `countQuitShells`
 * (`shell-registry.ts`)가 들고, 이 자리는 표시와 확인 창과 끄기만 든다.
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

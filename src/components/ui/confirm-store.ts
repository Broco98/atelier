import { Store } from "@tanstack/react-store";

/**
 * 앱이 사람에게 묻거나 알리는 창. **OS 창이 아니다.**
 *
 * 지금까지는 `@tauri-apps/plugin-dialog`의 `confirm`·`message`를 썼는데, 그것은 macOS가
 * 그리는 시트라 이 앱의 글꼴도 모서리도 색도 따르지 않는다 — 창 하나만 남의 것처럼 보인다.
 *
 * **스토어와 그림을 나눈다.** 묻는 쪽은 스토어(터미널 스토어 · 화면)이고 그리는 쪽은
 * React인데, 한 파일에 두면 스토어 쪽이 React를 끌고 온다. 여기는 값만 든다.
 */

export interface DialogAsk {
  title: string;
  body: string;
  /**
   * 진행 버튼의 글자. **할 일을 적는다** — 「예」는 무엇에 예인지를 말하지 않아, 확인 창을
   * 빠르게 넘기는 사람에게 아무 정보도 안 준다.
   */
  confirm: string;
  /** 되돌릴 수 없는 일인가 — 진행 버튼이 경고색으로 선다. */
  danger?: boolean;
  /** 물음이 아니라 **알림**이면. 취소 버튼이 서지 않고 답은 늘 `true`다. */
  notice?: boolean;
}

type Pending = DialogAsk & { answer: (ok: boolean) => void };

/** 지금 떠 있는 창. `null`이면 없다. **한 번에 하나다.** */
export const dialogStore = new Store<Pending | null>(null);

/**
 * 창을 띄우고 답을 기다린다.
 *
 * **앞의 물음이 아직 떠 있으면 그것을 취소로 접는다.** 겹쳐 띄우면 어느 것에 답했는지가
 * 화면에서 사라지고, 답을 기다리던 약속이 영영 안 풀린다.
 */
export function askDialog(ask: DialogAsk): Promise<boolean> {
  return new Promise((resolve) => {
    dialogStore.state?.answer(false);
    dialogStore.setState(() => ({
      ...ask,
      answer: (ok) => {
        dialogStore.setState(() => null);
        resolve(ok);
      },
    }));
  });
}

/** 되돌릴 수 없는 일을 묻는다. 진행 버튼이 경고색이다. */
export const askDanger = (title: string, body: string, confirm: string): Promise<boolean> =>
  askDialog({ title, body, confirm, danger: true });

/**
 * 못 한 일을 알린다. **제목이 고정인 것은 이 창이 늘 같은 뜻이기 때문이다** — 「오류」라는
 * 말을 부르는 쪽마다 다시 적으면 어떤 실패는 「실패」, 어떤 실패는 「문제」가 된다.
 */
export const showProblem = (body: string): Promise<boolean> =>
  askDialog({ title: "오류", body, confirm: "확인", notice: true });

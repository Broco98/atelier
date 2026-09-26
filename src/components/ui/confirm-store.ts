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
  /** 제목 아래 한 줄. **없으면 그 줄이 서지 않는다** — 셸이 0개인 종료 확인이 그렇다(결정 15). */
  body?: string;
  /**
   * 진행 버튼의 글자. **할 일을 적는다** — 「예」는 무엇에 예인지를 말하지 않아, 확인 창을
   * 빠르게 넘기는 사람에게 아무 정보도 안 준다.
   */
  confirm: string;
  /** 되돌릴 수 없는 일인가 — 진행 버튼이 경고색으로 선다. */
  danger?: boolean;
  /** 물음이 아니라 **알림**이면. 취소 버튼이 서지 않고 답은 늘 `true`다. */
  notice?: boolean;
  /**
   * 창이 뜰 때 포커스를 받는 버튼. 안 주면 진행 버튼이다(지금까지의 모든 물음).
   *
   * **종료 확인만 `cancel`로 부른다**(#223) — ⌘Q 뒤에 반사적으로 친 Enter가 앱을 끄면 실수 종료라는
   * 원래 문제가 그대로 돌아온다. 어느 쪽이든 포커스가 창 **안으로** 오는 성질은 같다.
   */
  focus?: "confirm" | "cancel";
  /**
   * 취소 버튼의 글자. 안 주면 「취소」다(지금까지의 모든 물음). 떠날 때 확인은 「계속 편집」이다 — 거기서
   * 취소가 무엇을 하는지(머문다)를 적는다. 진행 버튼이 할 일을 적는 것과 같은 까닭이다.
   */
  cancel?: string;
}

/**
 * 셋째 갈래를 받는 물음(spec 레이아웃 결정 27 — 떠날 때 확인). `extra`를 주면 그 글자의 버튼이 진행 버튼 **뒤**
 * (맨 오른쪽)에 주 버튼으로 선다. 안 주면 여느 물음처럼 둘이다 — 할 수 있을 때만 서는 버튼이 그렇다.
 *
 * 답은 `askChoice`로만 받는다. `askDialog`의 답은 참·거짓이라 셋째 자리가 없고, 그래서 그 물음은 이것을 못 준다.
 */
export interface ChoiceAsk extends DialogAsk {
  extra?: string;
}

/** 창의 답 — `true`는 진행 버튼, `false`는 취소(취소 버튼 · Esc · 바깥), `"extra"`는 셋째 버튼이다. */
export type DialogAnswer = boolean | "extra";

type Pending = ChoiceAsk & { answer: (answer: DialogAnswer) => void };

/** 지금 떠 있는 창. `null`이면 없다. **한 번에 하나다.** */
export const dialogStore = new Store<Pending | null>(null);

/**
 * 창을 띄우고 답(참 · 거짓 · 셋째)을 기다린다.
 *
 * **앞의 물음이 아직 떠 있으면 그것을 취소로 접는다.** 겹쳐 띄우면 어느 것에 답했는지가
 * 화면에서 사라지고, 답을 기다리던 약속이 영영 안 풀린다.
 */
export function askChoice(ask: ChoiceAsk): Promise<DialogAnswer> {
  return new Promise((resolve) => {
    dialogStore.state?.answer(false);
    dialogStore.setState(() => ({
      ...ask,
      answer: (answer) => {
        dialogStore.setState(() => null);
        resolve(answer);
      },
    }));
  });
}

/**
 * 두 갈래 물음 — `askChoice`의 참·거짓 판. 셋째 답이 없어 셋째 버튼(`extra`)도 받지 않는다. 앞의 물음을 접는
 * 규칙은 `askChoice`에 있다.
 */
export function askDialog(ask: DialogAsk): Promise<boolean> {
  return askChoice(ask).then((answer) => answer === true);
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

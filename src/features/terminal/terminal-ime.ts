/**
 * 한글 조합 다리 — WKWebView가 IME 입력을 xterm이 못 알아듣는 모양으로 주는 것을 잇는다.
 *
 * **판정만 여기 산다.** DOM도 xterm도 안 부르는 순수 함수 둘(`imeInput`·`imeKeyDown`)이
 * 「지금 무엇을 보내고 무엇을 붙들 것인가」를 혼자 정하고, 아래 `attachIme`은 그 답을
 * 이벤트에 물려 주기만 한다. 이 저장소의 웹뷰·IME는 Node 테스트로 못 도는데, 갈리는 판단은
 * 전부 위 둘에 있으므로 그물이 실제로 문다.
 *
 * ## 무엇이 문제였나 (2026-08-23, 실제 WKWebView에 두벌식을 프로그램으로 쳐 넣어 실측)
 *
 * xterm의 숨은 입력칸은 `xterm.css`에서 **`width: 0; height: 0`**이다. 크기가 0인 요소에
 * 한국어 IME가 붙으면 WebKit이 조합을 매 타자 끊어 버려, 「안녕」이 `ㅇㅏㄴ녕`으로 흩어지고
 * 스페이스마저 U+00A0으로 온다. **크기를 1px만 줘도** WebKit이 다른 경로를 쓴다(그 한 줄은
 * `index.css`에 있다). 화면 밖이든 투명이든 상관없었다 — 오직 크기 0이 갈랐다.
 *
 * 그 「다른 경로」에는 `compositionstart`/`update`/`end`가 **한 건도 없다.** 대신 이렇게 온다:
 *
 * ```
 *   insertText            "ㅇ"    입력칸: ""     → "ㅇ"
 *   insertReplacementText "아"    입력칸: "ㅇ"   → "아"
 *   insertReplacementText "안"    입력칸: "아"   → "안"
 *   insertText            "ㄴ"    입력칸: "안"   → "안ㄴ"   ← 여기서 「안」이 확정된다
 *   insertReplacementText "녀" …
 * ```
 *
 * xterm의 `_inputEvent`는 **`insertText`만** 받는다(번들 확인). 그래서 낱자 `ㅇ`·`ㄴ`만
 * 셸로 새고 완성된 `안`·`녕`은 통째로 버려진다 — 사용자가 본 그 증상이다.
 *
 * ## 그래서 이 다리가 하는 일
 *
 * **완성될 때까지 붙들었다가, 확정되는 순간 보낸다.** 마지막 글자는 아직 바뀔 수 있으므로
 * (`아`→`안`) 붙들고, 새 `insertText`가 오면 그것이 「앞 글자는 끝났다」는 신호다.
 *
 * **미룰 수 없어서 글자로 가른다.** `insertReplacementText`는 다음 타자와 함께 오지 스스로
 * 오지 않는다(실측: 다음 키를 누르기 전에는 영영 안 온다). 그러니 타이머로 기다릴 수 없고,
 * 넣는 순간 「이건 아직 바뀔 수 있는가」를 답해야 한다. 그 답이 한글 대역이다 —
 * 영문은 붙들지 않으므로 `hello`는 예전 그대로 한 타에 한 자씩 나간다(실측).
 */

/** IME가 아직 그 키를 물고 있다는 신호. xterm도 같은 값을 같은 뜻으로 쓴다. */
export const IME_KEYCODE = 229;

/**
 * 한글이 될 수 있는 글자. 한국어 IME가 실제로 내보내는 세 대역이다 —
 * 낱자(호환 자모, 실측에서 `ㅇ`=U+3147로 왔다) · 조합용 자모 · 완성 음절.
 * 옛한글 확장 대역(U+A960·U+D7B0)은 두벌식이 못 내므로 넣지 않았다.
 */
const HANGUL = /[ᄀ-ᇿ㄰-㆏가-힣]/;

export interface ImeStep {
  /** 지금 셸로 보낼 것. 빈 문자열이면 보내지 않는다. */
  send: string;
  /** 다음 상태 — 아직 바뀔 수 있어 붙들고 있는 꼬리. */
  held: string;
  /** xterm에게 이 이벤트를 넘기지 않는다. */
  swallow: boolean;
}

/**
 * 입력칸이 바뀌었다. `held`는 지금 붙들고 있는 꼬리다.
 *
 * `insertReplacementText`를 삼키는 것은 xterm이 어차피 버리기 때문이 아니라 **버리는 것이
 * 우리 몫이어야 하기 때문**이다. 상류가 언젠가 이 종류를 받기 시작하면(PR #5704) 두 곳이
 * 같은 글자를 보내게 되는데, 여기서 막아 두면 그때도 한 번만 나간다.
 */
export function imeInput(held: string, inputType: string, data: string | null): ImeStep {
  if (inputType === "insertReplacementText") {
    return { send: "", held: data ?? "", swallow: true };
  }
  if (inputType === "insertText" && data && HANGUL.test(data)) {
    // 새 낱자가 왔다 = 붙들고 있던 앞 글자가 여기서 확정된다.
    return { send: held, held: data, swallow: true };
  }
  // 한글이 아닌 입력은 xterm이 평소대로 처리한다. 다만 **앞 글자를 먼저 흘려보낸다** —
  // 이 핸들러가 xterm보다 앞서 도므로 순서가 뒤집히지 않는다.
  return { send: held, held: "", swallow: false };
}

/**
 * 키가 눌렸다. Enter·화살표·⌘조합처럼 **IME가 안 물고 있는 키**는 조합의 끝을 뜻한다.
 *
 * `IME_KEYCODE`를 그냥 두는 것이 이 함수의 전부다 — 한글 타자도, 조합 중 백스페이스도
 * 전부 229로 오므로(실측) 여기서 흘려보내면 방금 붙든 것을 곧바로 뱉게 된다.
 */
export function imeKeyDown(held: string, keyCode: number): { send: string; held: string } {
  if (keyCode === IME_KEYCODE) return { send: "", held };
  return { send: held, held: "" };
}

/**
 * 다리를 집(`wrapper`)에 건다. **입력칸이 아니라 집이고, capture 단계다.**
 *
 * xterm은 자기 리스너를 입력칸에 `open()` 안에서 건다 — 같은 요소·같은 단계에서는 등록
 * 순서가 이기므로 우리가 뒤로 밀린다. 조상의 capture는 대상의 어떤 리스너보다도 앞이라,
 * 여기라야 `stopPropagation()`이 뜻을 갖는다.
 *
 * 떼는 함수를 돌려주지 않는다. 리스너는 `wrapper`에 살고 `disposeInstance`가 그 집을 DOM에서
 * 빼며 인스턴스 참조까지 지우므로, 통째로 수거된다.
 */
export function attachIme(wrapper: HTMLElement, input: (data: string) => void): void {
  let held = "";

  wrapper.addEventListener(
    "input",
    (event) => {
      const ev = event as InputEvent;
      const step = imeInput(held, ev.inputType, ev.data);
      held = step.held;
      if (step.send) input(step.send);
      if (step.swallow) ev.stopPropagation();
    },
    true,
  );

  wrapper.addEventListener(
    "keydown",
    (event) => {
      const step = imeKeyDown(held, (event as KeyboardEvent).keyCode);
      held = step.held;
      if (step.send) input(step.send);
    },
    true,
  );

  // 초점이 떠나면 조합은 거기서 끝난다 — 붙들고 있던 글자를 안 보내면 **조용히 사라진다**
  // (한 음절 치다 말고 다른 칸을 누르는 경우). `focusout`은 올라오므로 집에서 받을 수 있다.
  wrapper.addEventListener("focusout", () => {
    if (held) {
      input(held);
      held = "";
    }
  });
}

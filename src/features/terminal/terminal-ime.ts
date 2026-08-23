/**
 * 한글 조합 다리 — WKWebView가 IME 입력을 xterm이 못 알아듣는 모양으로 주는 것을 잇는다.
 *
 * **판정만 여기 산다.** DOM도 xterm도 안 부르는 순수 함수 셋(`imeInput`·`imeKeyDown`·`imeBlur`)이
 * 「지금 무엇을 보내고 무엇을 붙들 것인가」를 혼자 정하고, 아래 `attachIme`은 그 답을 이벤트에
 * 물려 주기만 한다. 이 저장소의 웹뷰·IME는 Node 테스트로 못 도는데, 갈리는 판단은 전부 위 셋에
 * 있으므로 그물이 실제로 문다. 그 위를 `tools/ime-probe/`가 진짜 입력기로 한 번 더 덮는다.
 *
 * ## 무엇이 문제였나 (실측 — 진짜 WKWebView에 두벌식을 프로그램으로 쳐 넣어 갈랐다)
 *
 * 숨은 입력칸의 **쓰이는 크기가 0이면** 한국어 입력기가 붙을 때 WKWebView가 조합을 매 타자
 * 끊는다 — 「안녕」이 `ㅇㅏㄴ녕`으로 흩어지고 스페이스마저 U+00A0으로 온다. 그 크기 0으로
 * 가는 길이 **둘**이라 고침도 `index.css` 쪽에 있다(거기 주석이 정본이다).
 *
 * 크기가 0이 아닐 때 WebKit이 쓰는 경로에는 `compositionstart`가 **한 건도 없다.** 대신 이렇게 온다:
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
 * 셸로 새고 완성된 `안`·`녕`은 통째로 버려진다 — 앱에서 실제로 나던 증상이 이것이다.
 *
 * ## 그래서 이 다리가 하는 일
 *
 * **완성될 때까지 붙들었다가, 확정되는 순간 보낸다.** 마지막 글자는 아직 바뀔 수 있으므로
 * (`아`→`안`) 붙들고, 새 `insertText`가 오면 그것이 「앞 글자는 끝났다」는 신호다.
 *
 * 붙들고 있는 동안 그 글자는 셸에 없다. 그래서 **커서 자리에 겹쳐 보여 준다** — 안 그러면
 * 다음 글자를 칠 때에야 앞 글자가 나타나 한 박자 늦게 보인다. 자리는 xterm이 이미 잡아 준다
 * (`_syncTextArea`가 커서가 움직일 때마다 숨은 입력칸을 커서 셀에 맞춰 둔다).
 *
 * **미룰 수 없어서 글자로 가른다.** `insertReplacementText`는 다음 타자와 함께 오지 스스로
 * 오지 않는다(실측: 다음 키를 누르기 전에는 영영 안 온다). 그러니 타이머로 기다릴 수 없고,
 * 넣는 순간 「이건 아직 바뀔 수 있는가」를 답해야 한다. 그 답이 한글 대역이다 —
 * 영문은 붙들지 않으므로 `hello`는 예전 그대로 한 타에 한 자씩 나간다(실측).
 */

/** IME가 아직 그 키를 물고 있다는 신호. xterm도 같은 값을 같은 뜻으로 쓴다. */
export const IME_KEYCODE = 229;

/**
 * 조합을 **안 끝내는** 키. 누르는 것만으로는 아무 데이터도 안 만드는 키들이다.
 *
 * **이걸 빠뜨리면 한국어가 절반쯤 망가진다.** 두벌식에서 `ㄲㄸㅃㅆㅉ`·`ㅒㅖ`는 Shift로 치는데,
 * 그 Shift가 음절 **한가운데** 들어오면(`했`·`갔`·`있`·`얘`) 그 keydown이 아직 미완인 앞 음절을
 * 흘려보내고 곧이어 오는 `insertReplacementText`가 같은 음절을 다시 채워 **두 번 나간다**.
 * 실측: 「했다」가 `해했다`로, 조합 중 ⌘는 `해해`로 갔다.
 *
 * 상류도 같은 가드를 갖는다(`CompositionHelper.keydown`이 16·17·18·20을 걸러 낸다).
 * **`Meta`는 상류에 없는데 우리가 넣었다** — macOS에서 ⌘는 수식키이고, 이 앱은 그 터미널에
 * ⌘T·⌘W를 걸어 두어 조합 중에 실제로 눌린다. 위 `해해`가 그 실측이다.
 *
 * `keyCode`가 아니라 `key`로 보는 것은 이 이름들이 표준이고 배열·입력기를 안 타기 때문이다
 * (실측: 한글 타자 중에도 `key="Shift"`·`key="Meta"`로 그대로 왔다).
 */
const MODIFIERS = new Set(["Shift", "Control", "Alt", "AltGraph", "Meta", "CapsLock"]);

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
 * 키가 눌렸다. Enter·화살표처럼 **IME도 수식키도 아닌** 키는 조합의 끝을 뜻한다.
 *
 * 거르는 것이 둘이다. `IME_KEYCODE`는 한글 타자와 조합 중 백스페이스가 타고 오는 값이고
 * (그냥 두지 않으면 방금 붙든 것을 곧바로 뱉는다), `MODIFIERS`는 위에 적은 쌍자음 사고다.
 */
export function imeKeyDown(
  held: string,
  key: string,
  keyCode: number,
): { send: string; held: string } {
  if (keyCode === IME_KEYCODE || MODIFIERS.has(key)) return { send: "", held };
  return { send: held, held: "" };
}

/**
 * 초점이 떠났다. 조합은 거기서 끝난다 — 붙들고 있던 글자를 안 보내면 **조용히 사라진다**
 * (한 음절 치다 말고 다른 칸을 누르는 경우). 실측으로 확인했다: 초점을 옮기면 `녕`이
 * 그때 나가고, 중복은 없다.
 */
export function imeBlur(held: string): { send: string; held: string } {
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
export function attachIme(
  wrapper: HTMLElement,
  input: (data: string) => void,
  font: () => { family: string; size: number },
): void {
  let held = "";
  const apply = (step: { send: string; held: string }) => {
    held = step.held;
    if (step.send) input(step.send);
    showComposing(wrapper, held, font);
  };

  wrapper.addEventListener(
    "input",
    (event) => {
      const ev = event as InputEvent;
      const step = imeInput(held, ev.inputType, ev.data);
      apply(step);
      if (step.swallow) ev.stopPropagation();
    },
    true,
  );

  wrapper.addEventListener(
    "keydown",
    (event) => {
      const ev = event as KeyboardEvent;
      apply(imeKeyDown(held, ev.key, ev.keyCode));
    },
    true,
  );

  // `focusout`은 올라오므로 집에서 받을 수 있다(`blur`는 안 올라온다).
  wrapper.addEventListener("focusout", () => apply(imeBlur(held)));
}

/**
 * 조합 중인 글자를 커서 자리에 겹쳐 보여 준다. 빈 문자열이면 걷는다.
 *
 * **xterm이 이미 가진 칸을 쓴다.** `.composition-view`는 xterm이 자기 조합 표시용으로 만들어
 * 두는 요소이고 `xterm.css`가 모양(검은 바탕·흰 글자·숨김)까지 준다. 이 경로에는 조합
 * 이벤트가 안 오므로 xterm은 그 칸을 영영 안 쓴다 — 둘이 부딪힐 일이 없다. 조합 이벤트가
 * 오는 입력기(일본어·중국어)에서는 반대로 우리가 아무것도 안 붙들어 이 함수가 안 불린다.
 *
 * **자리는 숨은 입력칸에서 베낀다.** `_syncTextArea`가 커서가 움직일 때마다 그 칸을 커서
 * 셀에 맞춰 두므로, 우리가 커서 픽셀 위치를 따로 셀 필요가 없다(둘은 같은 부모 안에 있다).
 *
 * 글꼴은 **물려받지 않는다** — 그래서 xterm도 자기 조합 표시에 매번 직접 넣는다. 우리도
 * 지금 값을 그때그때 묻는다: 설정으로 글꼴이 바뀌어도 따라온다.
 */
function showComposing(
  wrapper: HTMLElement,
  text: string,
  font: () => { family: string; size: number },
): void {
  const view = wrapper.querySelector<HTMLElement>(".composition-view");
  const textarea = wrapper.querySelector<HTMLElement>(".xterm-helper-textarea");
  // 아직 `term.open()` 전이면 둘 다 없다. 그때는 보여 줄 화면도 없다.
  if (!view || !textarea) return;
  view.textContent = text;
  view.classList.toggle("active", text !== "");
  if (!text) return;
  const { family, size } = font();
  view.style.left = textarea.style.left;
  view.style.top = textarea.style.top;
  view.style.height = textarea.style.height;
  view.style.lineHeight = textarea.style.lineHeight;
  view.style.fontFamily = family;
  view.style.fontSize = `${size}px`;
}

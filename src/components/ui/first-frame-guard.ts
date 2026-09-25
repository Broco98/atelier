/**
 * **첫 프레임 가드**(S24). 떠 있는 표면(확인 창 · 검색 팔레트)이 열린 순간부터 **포커스가 처음 그
 * 안에 들어올 때까지** 키를 가로챈다.
 *
 * 왜 있나: Base UI는 열릴 때 첫 포커스를 **다음 프레임에** 옮긴다(`requestAnimationFrame`). 셸에
 * 포커스가 있는 채로 표면이 뜨면 그 한 프레임 사이에 친 키는 아직 셸의 숨은 입력칸으로 간다 —
 * 창이 떠 있는데 Enter가 셸에서 명령을 돌린다. 창(`window`)의 캡처 단계에서 받으므로 셸의 키
 * 처리보다 먼저다.
 *
 * **켜고 끄는 때를 못박는다.**
 * - 켠다(`arm`): 표면이 열리는 순간이다. 부르는 쪽이 「열린다」를 아는 **가장 이른 자리**에서 부른다 —
 *   확인 창은 스토어에 물음이 선 순간이다. DOM이 서거나 포커스가 움직이기를 기다리면 그 사이가 다시 샌다.
 * - 끈다: 그 열림에서 포커스가 **처음** 표면에 들어오면. 그 열림 안에서는 **다시 켜지지 않는다.**
 *   키마다 「열렸고 포커스가 밖인가」를 다시 따지면, 내용을 갈아 끼우며 버튼이 다시 그려지는 순간
 *   포커스가 잠깐 샌 것만으로 가드가 되살아나 Esc까지 삼킨다 — 키보드로 창을 못 닫는다.
 * - 새로 열리면 `arm`을 다시 부른다(새로 켠다). 닫히면 `disarm`이다.
 *
 * **삼킨 키는 어디로도 안 간다** — 셸로도 표면으로도. 표면이 받을 준비가 안 된 순간의 키라 넘길 곳이
 * 없다. 예외가 하나다: 글자 키를 넘길 입력칸(`typeIntoRef`)이 달려 있으면 글자 키는 삼키지 않고
 * 포커스를 그 칸으로 **먼저** 옮긴다. 그 글자가 칸에 들어가고, 셸로는 여전히 안 간다(P11 — 팔레트는
 * 첫 키부터 받는다). 확인 창은 입력칸을 달지 않으므로 모두 삼킨다.
 *
 * **React도 스토어도 모른다.** 확인 창과 팔레트가 여는 길이 서로 달라(스토어의 물음 · 화면의
 * state) 켜는 자리는 부르는 쪽이 고른다. 여기는 DOM 두 사건(키 · 포커스)만 본다.
 */
export interface FirstFrameGuard {
  /** 표면이 열리는 순간 부른다. 이미 켜져 있으면 새 열림으로 다시 켠다. */
  arm(): void;
  /** 표면이 닫히면 부른다. 이미 꺼져 있으면 아무 일도 없다. */
  disarm(): void;
  /** 표면(Popup)에 `ref`로 단다. 포커스가 이 안에 들어오면 가드가 꺼진다. */
  surfaceRef(element: HTMLElement | null): void;
  /**
   * 글자 키를 넘길 입력칸에 `ref`로 단다. 달려 있는 동안 글자 키는 삼키지 않고 포커스를 이 칸으로
   * 옮긴다(P11). 이 칸은 표면 **안에** 있어야 한다 — 포커스가 들어오는 순간 가드가 꺼진다.
   */
  typeIntoRef(element: HTMLElement | null): void;
}

/** 칸에 글자로 들어가는 키인가. ⌘·⌃ 화음은 글자가 아니라 명령이다. */
const isTyping = (event: KeyboardEvent) =>
  event.key.length === 1 && !event.metaKey && !event.ctrlKey;

export function createFirstFrameGuard(): FirstFrameGuard {
  let surface: HTMLElement | null = null;
  let typeInto: HTMLElement | null = null;
  let armed = false;

  const inside = (node: EventTarget | null) =>
    surface !== null && node instanceof Node && surface.contains(node);

  const onFocusIn = (event: FocusEvent) => {
    if (inside(event.target)) disarm();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    // 포커스가 이미 들어와 있으면 이 키부터 표면의 것이다. 포커스 사건을 못 본 채 들어온 길이 있다 —
    // 갈아 끼운 물음이 **이미 포커스가 있는** 버튼에 다시 포커스를 주면 사건이 안 난다.
    if (inside(document.activeElement)) {
      disarm();
      return;
    }
    event.stopImmediatePropagation();
    if (typeInto !== null && isTyping(event)) {
      // 기본 동작(글자 넣기)은 살린다 — 포커스가 옮겨 간 칸에 들어간다.
      typeInto.focus();
      return;
    }
    event.preventDefault();
  };

  function arm() {
    // 브라우저 밖(스토어를 재는 L2)에서도 여는 길이 불린다. 가로챌 키가 없는 자리다.
    if (typeof window === "undefined") return;
    disarm();
    armed = true;
    window.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("focusin", onFocusIn, true);
  }

  function disarm() {
    if (!armed) return;
    armed = false;
    window.removeEventListener("keydown", onKeyDown, true);
    document.removeEventListener("focusin", onFocusIn, true);
  }

  return {
    arm,
    disarm,
    surfaceRef(element) {
      surface = element;
    },
    typeIntoRef(element) {
      typeInto = element;
    },
  };
}

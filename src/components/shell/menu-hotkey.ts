// 네이티브 메뉴가 대신 받은 단축키를 창의 리스너들에게 되돌려 주는 자리 (#153).
//
// **왜 있나.** spec 문서의 `<iframe>`에 포커스가 들어가면 그 안에서 친 키가 부모 창을 못
// 넘어온다. 앱 단축키는 전부 부모 `window`의 keydown 리스너라, 그 순간 통째로 죽는다.
// OS 메뉴는 그 경계를 모르므로 같은 키를 메뉴 항목으로도 세워 뒀다(`src-tauri/src/lib.rs`).
//
// **메뉴는 동작을 안 든다 — 「이 code가 눌렸다」만 쏜다.** 같은 키가 화면마다 다른 것을
// 가리키기 때문이다:
//
//   ⌘1~9  works에서 문서와 셸 칸 — 다른 화면에는 아예 없다
//   ⌘↩    접는 패널이 화면마다 다르다 (works는 작업 패널, projects·archive는 목록 패널)
//   ⌘B    어디서나 사이드바 — 이것만 화면을 안 탄다
//   ⌘T    works에서 셸 열기
//
// 그 표를 메뉴가 들면 화면이 하나 늘 때마다 Rust와 프런트를 함께 고쳐야 한다. 그래서 이
// 모듈이 하는 일은 **받은 code로 합성 keydown을 만들어 창에 흘리는 것 하나**이고, 무엇을
// 할지는 지금 있는 리스너들이 그대로 판정한다.

/**
 * `KeyboardEvent.code`에서 `key`를 되찾는다.
 *
 * **둘 다 실어야 한다.** 리스너가 보는 값이 갈려 있다 — ⌘B·⌘T·⌘1~9는 `code`를 보고
 * (`AppShell` · `shell-registry`), ⌘↩은 `key`를 본다(`WorksPage` · `ProjectsPage` ·
 * `ArchivePage`). 한쪽만 채우면 그 절반이 조용히 안 먹는다.
 */
export function keyOfCode(code: string): string {
  const digit = /^Digit([1-9])$/.exec(code);
  if (digit) return digit[1];
  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1].toLowerCase();
  // Enter처럼 이름이 곧 key인 것들.
  return code;
}

/**
 * 지금 이 키를 창에 흘려야 하는가 — **프레임이 포커스를 쥔 동안만이다.**
 *
 * 앱에 포커스가 있을 때는 웹뷰가 그 키를 이미 받고 `preventDefault`까지 불러 메뉴가 아예
 * 안 불린다(실측 ⌘B 2/2 · ⌘T 1/1 · ⌘1 1/1 · ⌘↩ 1/1). **그 성질에 기대지 않는다** —
 * 리스너 한쪽이 preventDefault를 안 부르는 날 한 번 눌러 두 번 도는 자리가 조용히 생긴다.
 * 실제로 ⌘W가 그 모양이었고(앱 포커스에서 웹뷰와 메뉴에 **둘 다** 갔다, 2/2), 그것이 ⌘W를
 * 이 판에서 뺀 이유 중 하나다.
 *
 * 판정이 `activeElement`인 것은 `SpecViewer`의 `useFrameFocused`와 같은 근거다 — 프레임을
 * 클릭했을 때 부모가 받는 것은 `window`의 `blur` 하나뿐이고, 그 시점에 `activeElement`가
 * **이미** 그 `<iframe>`이다(L3 실측). 여기서는 어느 프레임인지까지는 안 따진다: 창에
 * 프레임이 하나든 여럿이든 「앱 단축키가 안 온다」는 사실은 같다.
 */
export function framePreemptsHotkeys(active: Element | null): boolean {
  return active?.tagName === "IFRAME";
}

/**
 * 메뉴가 쏜 code로 창에 흘릴 keydown의 **속성**을 만든다. 수식키는 ⌘ 하나다 — 살린 넷이
 * 다 그 화음이고, 리스너들이 전부 `!shiftKey && !altKey && !ctrlKey`를 함께 보므로
 * 하나라도 켜져 나가면 그 자리에서 통째로 안 먹는다.
 *
 * **`KeyboardEvent`를 여기서 만들지 않는다.** 이 저장소의 단위 층에는 DOM이 없어서
 * (jsdom도 happy-dom도 안 쓴다) 생성자를 부르는 순간 이 조각이 검사 밖으로 나간다.
 * 속성만 돌려주면 순수 함수라 전부 세어지고, 만드는 일은 창을 가진 쪽이 한 줄로 한다.
 */
export function menuHotkeyInit(code: string): KeyboardEventInit {
  return {
    code,
    key: keyOfCode(code),
    metaKey: true,
    // 나머지 셋을 **명시로 끈다.** 안 적어도 `KeyboardEvent`가 false로 채우지만, 리스너들이
    // 보는 것이 바로 이 셋이라 「꺼져 있어야 한다」가 계약이다 — 계약은 코드에 적힌다.
    shiftKey: false,
    altKey: false,
    ctrlKey: false,
    bubbles: true,
    cancelable: true,
  };
}

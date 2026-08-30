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
// 할지는 지금 있는 리스너들이 그대로 판정한다. 그 화면에서 뜻이 없는 키면 아무 일도 안
// 난다 — projects 화면에서 ⌘T를 **직접 눌렀을 때와 똑같다.**
//
// **조건 없이 흘린다.** 한때 「프레임이 포커스를 쥔 동안만」이라는 게이트가 있었다. 근거는
// 이중 발화였다 — 앱 포커스일 때 웹뷰가 이미 그 키를 받았는데 여기서 또 흘리면 한 번 눌러
// 두 번 돈다는 것. 그런데 실측은 그 경우가 **안 일어난다**고 말한다: 넷 다 앱 포커스에서
// `preventDefault`가 불려 메뉴 자체가 안 불린다(⌘B 2/2 · ⌘T 1/1 · ⌘1 1/1 · ⌘↩ 1/1).
// 갈린 것은 ⌘W 하나였고 그것은 이 표에 없다.
//
// 그 게이트가 대신 **진짜 기능을 죽였다.** 메뉴 항목을 마우스로 눌렀을 때는 웹뷰가 아무것도
// 안 받았고 `activeElement`도 iframe이 아니라, 보이는 열두 항목이 전부 눌러도 아무 일이
// 없는 죽은 항목이 됐다. 일어나지 않는 경우를 막으려다 일어나는 경우를 막은 것이라 걷었다.
//
// 남는 위험 하나를 적어 둔다: 이 넷을 듣는 리스너 중 하나가 `preventDefault`를 안 부르게
// 되는 날, 앱 포커스에서 그 키가 두 번 돈다. ⌘1~9처럼 「그 화면에 그 칸이 없으면 아무 일도
// 안 한다」는 자리는 두 번 돌아도 무해하지만, 셸을 여는 ⌘T가 그렇게 되면 두 개가 열린다.

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

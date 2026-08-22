# 한글 조합이 어디서 끊기는가 — 조사와 계측 설계

트랙 A-0. **코드는 한 줄도 안 고쳤다.** 번들 소스에서 확인한 사실, 원인 후보의 순위,
실물 앱에서 한 번에 가르는 계측, 원인별 처방을 적는다.

읽는 법: 「확인함」은 파일에서 눈으로 본 것이다. 「추측」은 추측이라고 적었다.
줄 번호는 원본 TypeScript 기준인데, 그것을 어떻게 얻었는지는 아래에 적어 둔다.

## 0. 무엇을 읽었나 — 번들에서 원본을 되찾는 법

`node_modules/@xterm/xterm/lib/xterm.js`는 **한 줄짜리 minified 번들**이라 그대로는 못 읽는다.
그런데 옆의 `lib/xterm.js.map`에 `sourcesContent`가 통째로 들어 있다(sources 109개, 확인함).
그래서 원본 `.ts`를 그대로 복원해 읽었다. 재현:

```js
const m = JSON.parse(require('fs').readFileSync('lib/xterm.js.map','utf8'));
m.sources.indexOf('webpack://@xterm/xterm/./src/browser/input/CompositionHelper.ts'); // 16
m.sourcesContent[16]; // 원본 전문
```

우리 저장소 쪽 줄 번호는 **2026-08-22 이 워크트리 기준**이다. 같은 워크트리에서 다른 트랙이
동시에 일하고 있으니(`shell-registry.ts`·`WorksPage.tsx` 등이 이미 수정 상태다) 숫자가 밀렸으면
인용한 코드 조각으로 찾을 것 — 조각은 안 밀린다.

설치된 판: **`@xterm/xterm` 6.1.0-beta.302** (`package.json`), 애드온은 fit 0.12.0-beta.299 ·
web-links 0.13.0-beta.299 · webgl 0.20.0-beta.298.

## 1. xterm의 조합 처리 경로 (확인함)

### 1.1 어디에 붙는가

`CompositionHelper`는 **있다**. `src/browser/CoreBrowserTerminal.ts:554`에서 만들어지고,
숨은 `<textarea class="xterm-helper-textarea">` 하나에 붙는다.

`src/browser/CoreBrowserTerminal.ts:413-431` (`_bindKeys`):

```ts
this._register(addDisposableListener(this.textarea!, 'keydown',  (ev) => this._keyDown(ev), true));
this._register(addDisposableListener(this.textarea!, 'keypress', (ev) => this._keyPress(ev), true));
this._register(addDisposableListener(this.textarea!, 'compositionstart', () => {
  this._syncTextArea();
  this._compositionHelper!.compositionstart();
  this._compositionHelper!.updateCompositionElements();
}));
this._register(addDisposableListener(this.textarea!, 'compositionupdate', (e) => this._compositionHelper!.compositionupdate(e)));
this._register(addDisposableListener(this.textarea!, 'compositionend',    () => this._compositionHelper!.compositionend()));
this._register(addDisposableListener(this.textarea!, 'input', (ev: InputEvent) => this._inputEvent(ev), true));
```

- 조건은 **없다.** 옵션·플래그로 켜고 끄는 물건이 아니다 — `open()`이 돌면 무조건 붙는다.
- 셋 다 **같은 요소**(숨은 textarea)에 붙는다. 위임도, 상위 요소도, 문서 레벨도 아니다.
- `keydown`·`input`은 capture(`true`), composition 셋은 bubble이다.

### 1.2 키 경로에서 `isComposing`을 보는가 — **안 본다**

이것이 이 조사의 핵심 사실이다. `_keyDown`(`CoreBrowserTerminal.ts:846-`)에는
`event.isComposing`이 **한 번도 안 나온다.** 조합 판정은 전부
`CompositionHelper.keydown()`에 위임돼 있고, 그 함수가 보는 것은 둘뿐이다
(`src/browser/input/CompositionHelper.ts:115-139`):

```ts
public keydown(ev: KeyboardEvent): boolean {
  if (this._isComposing || this._isSendingComposition) {   // ← 자기가 들고 있는 상태
    if (ev.keyCode === 20 || ev.keyCode === 229) return false;
    if (ev.keyCode === 16 || ev.keyCode === 17 || ev.keyCode === 18) return false;
    this._finalizeComposition(false);
  }
  if (ev.keyCode === 229) {                                 // ← DOM의 keyCode
    this._handleAnyTextareaChanges();
    return false;
  }
  return true;
}
```

- `_isComposing`은 **`compositionstart`가 와야만** true가 된다(같은 파일 73-85).
- 그러니까 **믿는 값은 `ev.isComposing`이 아니라 (1) 자기 상태 (2) `ev.keyCode === 229`** 둘이다.
- 이 둘이 다 안 서면 `keydown()`이 `true`를 돌려주고, `_keyDown`은 그대로 진행해
  `evaluateKeyboardEvent`로 간다. 거기서 `src/common/input/Keyboard.ts:365-368`:

```ts
} else if (ev.key && !ev.ctrlKey && !ev.altKey && !ev.metaKey && ev.keyCode >= 48 && ev.key.length === 1) {
  result.key = ev.key;
}
```

**`ev.key`가 그대로 나간다.** 한글 입력기가 켜져 있을 때 이 웹뷰가 `ev.key`에 자모를
넣어 준다는 것은 이 저장소가 이미 실측해 적어 뒀다 —
`src/features/terminal/shell-registry.ts:293-294`의 주석
「`key`는 배열과 IME를 탄다 — 한글 입력기가 켜져 있으면 같은 키가 자모로 온다(실측)」.
**조합이 안 서면 정확히 이 증상이 난다**는 것이 코드로 확인된다.

### 1.3 조합이 안 서도 데이터를 흘리는 길이 둘 더 있다

원인을 가릴 때 이 둘을 헷갈리면 안 된다. 자모가 나가는 문은 셋이다.

1. **`_keyDown` → `evaluateKeyboardEvent`** (위 1.2). `keyCode`가 229가 **아닐 때**만 열린다.
2. **`CompositionHelper._handleAnyTextareaChanges`** (`CompositionHelper.ts:212-237`).
   `keyCode === 229`인데 조합 상태가 아니면 여기로 온다. 0ms 타이머를 걸어 textarea 값을
   전후로 비교하고 **길이가 같은데 값이 다르면 `newValue`를 통째로** 보낸다(231-233).
   IME가 textarea를 제자리에서 갈아끼우는 방식이면 **타자 한 번에 한 건씩** 나간다.
3. **`_inputEvent`** (`CoreBrowserTerminal.ts:1029-1041`):

```ts
if (ev.data && ev.inputType === 'insertText' && (!ev.composed || !this._keyDownSeen) && !screenReaderMode) {
  ...
  this.coreService.triggerDataEvent(ev.data, true);
}
```

**`inputType`이 `insertText`인 것만 받는다.** `insertReplacementText`는 조건에서 아예 떨어진다.
설치된 번들에 `insertReplacementText` 문자열이 **0건**이다(`grep -c` 확인함).

### 1.4 조합에 영향을 주는 옵션 — 이 앱에서는 전부 꺼져 있다 (확인함)

`terminal-store.ts:189-194`가 주는 옵션은 `fontFamily`·`fontSize`·`theme`·`scrollback` 넷뿐이다.

- `screenReaderMode`: 기본 false → `_inputEvent`의 마지막 가드가 **안 막는다**(즉 이모지/IME 경로는 살아 있다).
- `macOptionIsMeta`: 기본 false → `_keyDown:855`의 `shouldIgnoreComposition`은
  `isMac && macOptionIsMeta && altKey`라 **항상 false**. 조합 경로를 건너뛰지 않는다.
- `vtExtensions`: 기본 `{}` (`OptionsService.ts:60`) → `useKitty`·`useWin32InputMode`가 둘 다 false.
  `claude`가 kitty 키보드 프로토콜을 요청해도 **옵션이 없으면 안 켜진다**(`KeyboardService.ts:59-66`).
  그래서 상류의 kitty+IME 이슈(#6112)는 우리 경우가 아니다.

**즉 옵션은 용의자가 아니다.**

### 1.5 `attachCustomKeyEventHandler` — **배제한다** (가장 값싼 표적이었다)

`_keyDown`의 맨 앞이 맞다(`CoreBrowserTerminal.ts:850`):

```ts
if (this._customKeyEventHandler && this._customKeyEventHandler(event) === false) {
  return false;   // ← 조합 처리보다 앞이다
}
```

자리는 위험하다. 그런데 우리가 거기 심은 함수는 위험할 수가 없다.
`terminal-store.ts:247-254`:

```ts
term.attachCustomKeyEventHandler((event) => {
  const hotkey = shellHotkey(event);
  if (!hotkey) return true;          // ← 여기서 끝난다
  event.preventDefault();
  ...
  return false;
});
```

`shellHotkey`(`shell-registry.ts:299-312`)의 첫 두 줄:

```ts
if (event.type !== "keydown") return null;
if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
```

**⌘가 없으면 무조건 `null`**이고, `null`이면 `true`를 돌려주고 `preventDefault`도 안 부른다.
한글 타자에는 ⌘가 없다. 그러니 이 핸들러는 조합 중 키를 **가로챌 수도, `false`를 돌려줄 수도,
`preventDefault`를 부를 수도 없다.** 게다가 `code`(물리 키)로만 보므로 IME가 `key`를 자모로
바꿔도 판정이 안 흔들린다 — 그 주석이 그렇게 적혀 있고 실제 코드가 그대로다.

**결론: 1판이 단 핸들러는 이 버그와 무관하다.** 다시 조사하지 말 것.

## 2. 가장 유력한 원인

### 순위 1 — WKWebView가 한글 IME에 대해 composition 이벤트를 **안 준다** (유력)

상류에 이 증상을 정확히 적은 미머지 PR이 있다:
[xtermjs/xterm.js#5704 "fix: handle insertReplacementText for Korean IME on WKWebView/Safari"](https://github.com/xtermjs/xterm.js/pull/5704)
(2026-02-16, **아직 open**). 본문 인용:

> WKWebView (used by Tauri, Capacitor, and Safari-based apps on macOS/iOS) does not fire
> `compositionstart`/`compositionupdate`/`compositionend` events for Korean IME input. Instead, it fires:
> - `insertText` with `inputType === 'insertText'` for the initial jamo (e.g. `ㅎ`)
> - `insertReplacementText` for composition updates (e.g. `ㅎ` → `하` → `한`)
>
> Since `_inputEvent()` only handles `inputType === 'insertText'`, the composed Korean syllables
> from `insertReplacementText` were silently dropped, causing only raw jamo to reach the terminal.

근거가 맞물리는 자리:

- `_inputEvent`가 `insertText`만 본다 — **우리 번들에서 확인함**(1.3).
- `insertReplacementText`가 번들에 **0건** — 그 PR은 우리 판(beta.302)에 안 들어 있다.
- 조합 이벤트가 안 오면 `_isComposing`이 영영 false → `CompositionHelper`가 **통째로 무력화**된다(1.2).
  이 앱의 증상 서술 「일부가 새는 것이 아니라 **조합이 아예 시작되지 않는다**」와 정확히 같은 말이다.
- 자모가 나가는 문 세 개(1.3)가 전부 열려 있어, 타자 한 번에 한 건씩 흘러나오는 그림이 된다.

**증상 개수도 이 그림과 맞는다.** 「안녕하세요」는 두벌식으로 **12타**(ㅇㅏㄴ·ㄴㅕㅇ·ㅎㅏ·ㅅㅔ·ㅇㅛ)인데
spec에 적힌 결과 `ㅇ ㅣ ㅣ ㅣ ㅣ ㅇ ㅣ ㅣ ㄱ ㅔ ㅔ ㅔ`도 **12자**다. 「타자 한 번에 한 건」이라는 뜻이다.
다만 **글자 하나하나는 믿지 말 것** — 자모 글리프가 폰트 폴백을 타고 폭도 어긋나 화면에서
읽은 것이라, 도착한 코드포인트와 다를 수 있다. 그래서 아래 계측은 **화면이 아니라 바이트**를 잰다.

### 순위 2 — 셸의 로케일이 없어서 멀쩡히 도착한 UTF-8이 셸에서 깨진다 (배제 안 됨)

이것을 순위 2로 올리는 이유는 실제 사고 기록이 있어서다.
[xtermjs/xterm.js#6084](https://github.com/xtermjs/xterm.js/issues/6084)은 **우리와 똑같은 제목**으로
열렸다가(「WKWebView: Korean IME fires no composition events — composed syllables dropped」)
사흘 뒤 보고자가 **철회**했다:

> The Korean input problem in my Tauri/WKWebView app was **not** xterm's IME handling. It was a
> missing UTF-8 locale: the app was launched from Finder, so it inherited no `LANG`/`LC_CTYPE` …
> Removing it entirely gives correct Hangul input with stock xterm in WKWebView.

우리 앱에도 **같은 구멍이 있다**. `src-tauri/src/pty.rs:328-333`의 `shell_builder`가 심는 환경변수는
`TERM`·`COLORTERM`·`CLAUDE_CODE_NO_FLICKER` 셋뿐이고 **`LANG`도 `LC_CTYPE`도 없다.**
바로 위 주석이 스스로 이렇게 적어 뒀다: 「Finder로 띄운 앱의 환경은 launchd의 빈약한 것」.

가리는 법은 아래 계측이 한 줄로 준다 — **웹뷰가 PTY로 무엇을 보냈는지**를 보면 된다.
`안녕하세요`(U+C548 U+B155 …)가 통째로 나갔는데 화면이 깨졌다면 xterm은 무죄고 로케일이 범인이다.

### 순위 3 — 이벤트는 오는데 xterm이 못 받는다 (낮음)

「붙는 자리·순서 문제」는 코드상 근거가 약하다. 리스너는 조건 없이 붙고(1.1), 우리 쪽
커스텀 핸들러는 무해하며(1.5), 옵션도 다 기본값이다(1.4). 앱이 숨은 textarea를 직접 건드리는
코드는 없다(`grep` 확인함). 터미널 화면에서 함께 도는 전역 `keydown` 리스너는
`AppShell.tsx:26-35` 하나뿐이고, 그것은 **⌘B만** 보고 그때만 `preventDefault`한다(확인함).
**그래도 계측이 「composition 3종이 정상으로 온다」를 보이면 이쪽이다.**

### 순위 4 — 웹뷰가 IME를 아예 안 태운다 (낮음)

`keyCode`가 229가 **아닌** 채 `key`에 자모가 들어오면 이쪽이다. 이 경우 1.2의 문 ①이 열려
`ev.key`가 그대로 나간다. 계측 로그의 `keyCode`가 바로 가른다.

## 3. 계측 설계 — 한 번에 가른다

**코드를 안 고친다.** 웹 인스펙터 콘솔에 붙여 넣는 스니펫 하나로 끝난다.

### 3.0 준비

- **디버그 빌드로 띄운다**: `nohup <워크트리>/target/debug/atelier-app &`.
  `src-tauri/Cargo.toml`에 `devtools` 피처가 없으므로 **릴리스/설치본에는 인스펙터가 없다**(확인함).
- 인스펙터 여는 자리: **사이드바 빈 곳**에서 우클릭 → `Inspect Element`.
  터미널 안에서 우클릭하면 textarea의 편집 메뉴가 떠서 안 나온다.
- **손으로 친다. CGEvent 자동 타이핑을 쓰지 말 것** — 한국어 IME가 켜져 있으면 그 경로가
  자체로 자모를 만들어서(실측 기록 있음) 재는 대상과 재는 도구가 같은 함정에 빠진다.
- 앱이 **여럿 떠 있으면** 인스펙터가 어느 창의 것인지 먼저 확인할 것(설치본과 이름이 같다).

### 3.1 붙이는 것 — 콘솔에 통째로 붙여 넣는다

터미널 화면을 띄워 셸이 보이는 상태에서 실행한다.

```js
(() => {
  const ta = document.querySelector('.xterm-helper-textarea');
  if (!ta) { console.warn('숨은 textarea가 없다 — 터미널이 보이는 화면에서 다시 하라'); return; }
  const t0 = performance.now(), log = (window.__ime = []);
  const cp = s => [...(s ?? '')].map(c => c.codePointAt(0).toString(16).toUpperCase().padStart(4,'0')).join(' ');
  const put = (k, d) => log.push(`${String(Math.round(performance.now()-t0)).padStart(6)}ms  ${k.padEnd(18)} ${d}`);

  for (const t of ['compositionstart','compositionupdate','compositionend'])
    ta.addEventListener(t, e => put(t, `data="${e.data ?? ''}"[${cp(e.data)}] value="${ta.value}"[${cp(ta.value)}]`), true);
  for (const t of ['beforeinput','input'])
    ta.addEventListener(t, e => put(t, `inputType=${e.inputType} isComposing=${e.isComposing} data="${e.data ?? ''}"[${cp(e.data)}] value="${ta.value}"[${cp(ta.value)}]`), true);
  for (const t of ['keydown','keyup'])
    ta.addEventListener(t, e => put(t, `key="${e.key}"[${cp(e.key.length === 1 ? e.key : '')}] code=${e.code} keyCode=${e.keyCode} isComposing=${e.isComposing} meta=${e.metaKey}`), true);

  // 이 한 줄이 「xterm이 결국 무엇을 셸로 보냈는가」다. api.ts가 invoke("pty_write", {id, data})를 부르고,
  // @tauri-apps/api의 invoke는 호출 시점에 window.__TAURI_INTERNALS__.invoke를 찾아가므로 여기서 가로챌 수 있다.
  const I = window.__TAURI_INTERNALS__, orig = I.invoke.bind(I);
  I.invoke = (cmd, args, opts) => {
    if (cmd === 'pty_write') put('→PTY', `"${args.data}" [${cp(args.data)}]`);
    return orig(cmd, args, opts);
  };

  window.__imeDump = () => console.log(log.join('\n'));
  console.log('계측 켜짐. 타자 다 친 뒤 __imeDump() 를 부르라.');
})();
```

찍히는 곳은 **콘솔**이다. 파일로 안 뽑는 이유: 웹뷰에서 파일을 쓰려면 앱 코드를 건드려야 하고
이 트랙은 그것을 안 한다. 콘솔 출력은 우클릭 → 복사로 통째로 가져올 수 있다.

**한계 하나(정직하게)**: 우리 리스너는 xterm이 먼저 등록해 둔 리스너 **뒤에** 불린다(같은 요소·같은
단계에서는 등록 순서다). xterm이 부르는 것은 `stopPropagation`이지 `stopImmediatePropagation`이
아니므로(`_keyDown` 확인함) **이벤트는 다 받는다.** 다만 `ta.value`는 xterm이 손댄 뒤의 값일 수 있다
(예: Enter에서 xterm이 `textarea.value = ''`로 비운다, `CoreBrowserTerminal.ts:916`). 그래서 값보다
**`data`와 `→PTY`를 먼저 읽을 것.**

### 3.2 사람이 칠 것 — 이 순서로, 이것만

1. `hello` + Enter — **대조군.** 계측이 도는지, 영문 경로가 멀쩡한지 확인.
2. `locale` + Enter — 셸의 로케일을 눈으로 본다(순위 2용).
3. `cat > /tmp/ime.bin` + Enter
4. **「안녕하세요」를 손으로 친다** (한/영 전환 후, 12타).
5. **⌘Enter를 한 번** 누른다. ← 결정 43의 미측정 하나를 여기서 공짜로 받는다.
6. Enter → `Ctrl-D`로 `cat` 끝내기
7. `xxd /tmp/ime.bin` + Enter — **셸이 실제로 받은 바이트**
8. 콘솔에서 `__imeDump()`

이어서 ⌘Enter의 **의미**만 따로:

9. `claude` 실행 → 영문으로 한 줄 치고 → **⌘Enter 한 번** →
   전송됐나 / 줄만 바뀌었나 / 아무 일도 없었나를 본다.

### 3.3 보고할 것 — 이 넷이면 끝난다

- (A) `__imeDump()` 출력 **전문**
- (B) `xxd /tmp/ime.bin` 출력
- (C) `locale` 출력
- (D) 9번에서 `claude`가 ⌘Enter에 무엇을 했나 (한 문장)

### 3.4 로그를 읽는 표 — 이 네 줄이 원인을 가른다

| 로그에서 보이는 것 | 결론 |
|---|---|
| `compositionstart/update/end`가 **0건**이고 `input`에 `inputType=insertReplacementText`가 보인다 | **순위 1 확정.** PR #5704가 말하는 그대로다 |
| `→PTY`에 `"안녕하세요" [C548 B155 D558 C138 C694]`가 **통째로** 나갔는데 `xxd`가 깨져 있다 | **순위 2 확정.** xterm 무죄, 셸 로케일이다. (C)의 `LANG`이 비었을 것이다 |
| composition 3종이 **정상으로 오는데** `→PTY`에 자모가 나간다 | **순위 3.** 붙는 자리·순서 또는 상류 버그 |
| `→PTY`에 자모가 나가고 그때 `keydown`의 `keyCode`가 **229가 아니다** | **순위 4.** 웹뷰가 IME를 안 태운다 — `ev.key`가 문 ①로 그대로 샌다 |

곁가지로 함께 읽을 것:

- `keydown`이 `input`보다 **앞인지 뒤인지**. 뒤면 `_inputEvent`의 `_keyDownSeen` 가드가
  두 번째 타자부터 막는다(상류 #5887이 그 경우다).
- textarea에 **U+00A0**(`00A0`)이 섞이는지. WebKit이 스페이스를 non-breaking space로 넣는
  버릇이 있다고 상류에 적혀 있다 — 그러면 `cd works`가 한 단어로 셸에 가서 「Tab이 깨졌다」로 보인다.
- Backspace의 **keydown이 통째로 사라지고 keyup만** 오는지(성공 기준 4번에 걸린다).

### 3.5 ⌘Enter — 코드가 예측하는 답 (계측이 확인만 하면 된다)

**예측: ⌘Enter는 그냥 `\r`(0x0D) 하나로 셸에 간다. Enter와 구분되지 않는다.**
근거는 둘이다.

- `shellHotkey`가 `KeyT`·`KeyW`만 보므로 ⌘Enter는 앱이 안 가져간다(`shell-registry.ts:309-311`).
- `Keyboard.ts:100-110`의 `case 13`은 `altKey`만 본다 — `result.key = ev.altKey ? ESC+CR : CR`.
  **`metaKey`를 아예 안 본다.**

그러니 `claude`는 이것을 「전송」으로 쓸 것이다(추측 — 9번이 확인한다).
`→PTY "\r" [000D]` 한 줄이 로그에 있으면 예측이 맞은 것이다.

## 4. 처방 갈래 — 원인별로 무엇을, 얼마나

### 순위 1이 맞을 때 (WKWebView가 조합 이벤트를 안 준다)

고쳐야 하는 것은 **「조합 중에는 xterm에게 키를 안 주고, 완성된 음절만 준다」** 한 가지다.
길이 셋 있는데 크기가 꽤 다르다.

**(a) 상류 PR #5704를 pnpm patch로 물린다 — 가장 작다.**
남이 이미 쓴 코드다. 우리는 6.1.0-beta.302에 리베이스만 하면 된다.
크기: patch 파일 1개(상류 diff 4파일) + `package.json` 한 줄. **작음.**
대가: 상류가 판을 올릴 때마다 리베이스한다. **그리고 그 PR은 아직 머지가 안 됐다** — 검토를
안 거친 남의 코드를 우리 입력 경로 한복판에 놓는다는 뜻이다. 그 코드가 무엇을 하는지는
우리가 읽고 판단해야 한다.

**(b) 우리 층을 만든다 — wrapper의 capture 단계에서 먼저 받는다.**
xterm의 리스너보다 **먼저 등록할 수는 없지만**(그것은 `open()` 안에서 붙는다), **상위 요소의
capture 단계**는 대상 요소의 어떤 리스너보다도 앞이다. `terminal-store.ts`의 `wrapper`가 바로
그 상위 요소다. 거기서 `keydown`·`input`을 capture로 받아, 조합 중이면 `stopPropagation()`으로
**xterm에게 안 넘기고**, 음절이 완성됐을 때만 `term.input(완성문자열, true)`로 되돌려 준다
(그러면 기존 `onData` → `pty_write` 한 길로 합류해 경로가 둘로 갈라지지 않는다).
크기: 새 파일 1개(150~250줄) + `createInstance`에 두어 줄 + 마크업 테스트. **중간.**
대가: 「조합이 끝났는가」를 우리가 판정해야 한다 — 상류가 못 한 그 판정이다.

**(c) `onData`에서 자모를 걸러낸다 — 하지 말 것.**
xterm이 이미 내보낸 것을 뒤에서 주워 담는 모양이라, 정상 입력의 자모(사람이 `ㅋㅋ`를 치는
경우)를 구분할 수 없다. 적어 두는 이유는 **이 안을 다시 꺼내지 않기 위해서**다.

### 순위 2가 맞을 때 (셸 로케일)

`src-tauri/src/pty.rs`의 `shell_builder`에 `LANG`/`LC_CTYPE`을 **없을 때만** 심는다
(`TERM`처럼 무조건 덮으면 사용자가 셸에서 정한 값을 뺏는다).
크기: **아주 작음** — 3~5줄 + 검사 1개. 다만 「어떤 값을 심을 것인가」가 결정거리다
(`en_US.UTF-8` 고정인가, macOS의 `AppleLocale`을 읽는가).

**주의**: 이건 원인이 아니어도 값어치가 있는 변경이다. 그래도 **원인이 아니면 이 티켓에 넣지 말 것** —
이 저장소는 모든 변경 줄이 자기 티켓으로 추적돼야 한다.

### 순위 3이 맞을 때 (이벤트는 오는데 못 받는다)

로그가 어느 이벤트에서 끊기는지를 바로 지목해 줄 것이다. 대개 상류 버그거나 우리 쪽의
한 줄짜리 어긋남이다. 크기: **작음** — 다만 상류 버그면 (a)와 같은 patch 길로 간다.

### 순위 4가 맞을 때 (웹뷰가 IME를 안 태운다)

우리가 웹 레이어에서 고칠 수 있는 것이 없다 — wry/WKWebView 쪽이다.
현실적인 길은 순위 1의 (b)와 같아진다(입력 위임층을 우리가 든다). **큼.**

## 5. 다음 사람이 안 되풀이했으면 하는 것

- `attachCustomKeyEventHandler`는 **끝났다**(1.5). 자리는 위험하지만 우리가 심은 함수는 무해하다.
- xterm 옵션도 **끝났다**(1.4). `screenReaderMode`·`macOptionIsMeta`·kitty 전부 기본값이라 경로를 안 바꾼다.
- 번들은 minified지만 **`.map`에 원본이 통째로 들어 있다**(0절). 「소스를 못 봤다」고 다시 적지 말 것.
- 화면에서 읽은 자모 글자는 **증거가 아니다.** 폰트 폴백과 폭이 섞인다. 바이트를 잴 것.

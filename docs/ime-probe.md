# 한글 조합이 어디서 끊기는가 — 조사와 계측 설계

**끝났다. 원인은 아래 §2에 있고 고침은 들어갔다**(2026-08-23). 다시 재려면
`sh tools/ime-probe/run.sh` — 사람이 한글을 칠 필요가 없다.

읽는 법: 「확인함」은 파일에서 눈으로 본 것이고, 「실측」은 진짜 WKWebView에 두벌식을
프로그램으로 쳐 넣어 받은 로그다. §0·§1은 처음 조사 그대로 두었다 — 여전히 맞고, 무엇을
배제했는지가 거기 있다.

## 한 문단으로

**xterm의 숨은 입력칸이 `width: 0; height: 0`인 것 하나가 원인이었다.** 크기 0인 요소에
한국어 입력기가 붙으면 WKWebView가 조합을 매 타자 끊어 「안녕」이 `ㅇㅏㄴ녕`으로 흩어진다.
크기를 1px만 줘도 WebKit은 멀쩡한 경로를 쓰는데 — 그 경로는 `compositionstart`를 **한 건도
안 보내고** 완성 음절을 `insertReplacementText`로 준다 — 이번엔 xterm이 그 종류를 안 봐서
낱자만 샌다. 그래서 고침도 둘이다: `index.css`의 크기 한 줄과 `terminal-ime.ts`의 조합 다리.

## 0. 무엇을 읽었나 — 번들에서 원본을 되찾는 법

`node_modules/@xterm/xterm/lib/xterm.js`는 **한 줄짜리 minified 번들**이라 그대로는 못 읽는다.
그런데 옆의 `lib/xterm.js.map`에 `sourcesContent`가 통째로 들어 있다(sources 109개, 확인함).
그래서 원본 `.ts`를 그대로 복원해 읽었다. 재현:

```js
const m = JSON.parse(require('fs').readFileSync('lib/xterm.js.map','utf8'));
m.sources.indexOf('webpack://@xterm/xterm/./src/browser/input/CompositionHelper.ts'); // 16
m.sourcesContent[16]; // 원본 전문
```

**저장소 쪽은 줄 번호를 안 적는다.** 처음 판에 적었던 숫자 셋이 그 뒤 편집으로 전부 다른 코드를
가리키게 됐다(리뷰가 잡았다). 이름과 인용한 조각으로 찾을 것 — 그쪽은 안 밀린다.
상류(`node_modules` 안) 줄 번호는 판이 고정돼 있으므로 그대로 둔다.

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
`src/features/terminal/shell-registry.ts`의 `shellHotkey` 머리말
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

`terminal-store.ts`의 `createInstance`가 주는 옵션은 다섯이다 —
`fontFamily`·`fontSize`·`theme`·`scrollback`·`minimumContrastRatio`. **그중에 조합 경로를 가르는
것은 없고**, 가를 수 있는 셋은 아래대로 전부 기본값이다.

- `screenReaderMode`: 기본 false → `_inputEvent`의 마지막 가드가 **안 막는다**(즉 이모지/IME 경로는 살아 있다).
- `macOptionIsMeta`: 기본 false → `_keyDown:855`의 `shouldIgnoreComposition`은
  `isMac && macOptionIsMeta && altKey`라 **항상 false**. 조합 경로를 건너뛰지 않는다.
- `vtExtensions`: 기본 `{}` (`OptionsService.ts:60`) → `useKitty`·`useWin32InputMode`가 둘 다 false.
  `claude`가 kitty 키보드 프로토콜을 요청해도 **옵션이 없으면 안 켜진다**(`KeyboardService.ts:59-66`).
  그래서 상류의 kitty+IME 이슈(#6112)는 우리 경우가 아니다.

다섯 중 기본값에서 옮긴 것은 `minimumContrastRatio` 하나다(1 → 4.5). 결정 54가 다크 팔레트를
들여오면서 함께 온 값이고 근거는 `terminal-theme.ts` 머리말에 있다. **조합과는 무관하다** —
번들 `.map`의 `sourcesContent` 109건을 전수 검색하면 그 이름이 나오는 소스는 다섯인데,
옵션을 선언하는 `Services.ts`·`OptionsService.ts`와 색을 쓰는
`ThemeService`·`RenderService`·`DomRendererRowFactory`다. `CoreBrowserTerminal.ts`·
`CompositionHelper.ts`·`Keyboard.ts`에는 **0건**이다. 하는 일이 「이미 정해진 색을 그리는 순간
끌어올리는 것」이라 키가 들어오는 길과 겹치는 자리가 없다.

**즉 옵션은 용의자가 아니다.**

### 1.5 `attachCustomKeyEventHandler` — **배제한다** (가장 값싼 표적이었다)

`_keyDown`의 맨 앞이 맞다(`CoreBrowserTerminal.ts:850`):

```ts
if (this._customKeyEventHandler && this._customKeyEventHandler(event) === false) {
  return false;   // ← 조합 처리보다 앞이다
}
```

자리는 위험하다. 그런데 우리가 거기 심은 함수는 위험할 수가 없다.
`terminal-store.ts`의 `createInstance`:

```ts
term.attachCustomKeyEventHandler((event) => {
  const hotkey = shellHotkey(event);
  if (!hotkey) return true;          // ← 여기서 끝난다
  event.preventDefault();
  ...
  return false;
});
```

`shellHotkey`(`shell-registry.ts`)의 첫 두 줄:

```ts
if (event.type !== "keydown") return null;
if (!event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return null;
```

**⌘가 없으면 무조건 `null`**이고, `null`이면 `true`를 돌려주고 `preventDefault`도 안 부른다.
한글 타자에는 ⌘가 없다. 그러니 이 핸들러는 조합 중 키를 **가로챌 수도, `false`를 돌려줄 수도,
`preventDefault`를 부를 수도 없다.** 게다가 `code`(물리 키)로만 보므로 IME가 `key`를 자모로
바꿔도 판정이 안 흔들린다 — 그 주석이 그렇게 적혀 있고 실제 코드가 그대로다.

**결론: 1판이 단 핸들러는 이 버그와 무관하다.** 다시 조사하지 말 것.

## 2. 원인 — 실측으로 갈린 것

계측기(`tools/ime-probe/`)가 진짜 WKWebView를 세우고 진짜 두벌식 입력기로 「안녕」을 친 뒤
xterm이 PTY로 내보낸 바이트를 읽었다. 아래는 그 로그에서 나온 사실이다.

### 갈린 자리 — 숨은 입력칸의 **크기**

같은 페이지에서 CSS 한 줄만 바꿔 두 번 쟀다.

| 숨은 입력칸 | WebKit이 쓰는 경로 | 입력칸 최종값 | xterm이 PTY로 보낸 것 |
|---|---|---|---|
| `width: 0; height: 0` (xterm 기본) | 조합이 **매 타자 끊긴다** | `ㅇㅏㄴ녕 ` ❌ | `ㅇㅏㄴ녕 ` ❌ |
| `width: 1px; height: 1px` | 조합 이벤트 **0건**, `insertReplacementText` | `안녕 ` ✅ | `ㅇㄴ ` ❌ |

**오직 크기만 갈랐다.** 화면 밖(`left: -9999em`)인 것도, 투명(`opacity: 0`)인 것도, `z-index: -5`도
전부 무해했다 — 셋을 그대로 두고 크기만 1px로 준 판이 위 둘째 줄이다.

### 크기 0으로 가는 길이 **둘**이다 — 고침이 `min-width`인 이유

1. **`xterm.css`의 시작값** `width: 0; height: 0`. 첫 커서 이동 전까지 이 값이다.
2. **xterm이 인라인으로 덮어쓴다.** `_syncTextArea()`가 `onCursorMove`·`onResize`마다 돌면서
   `width = 셀너비 × bufferLine.getWidth(커서칸)`을 넣는다. 커서가 **넓은 글자의 뒤칸**에 서면
   그 폭이 0이라 **`width: 0px`이 인라인으로** 들어간다.

둘째가 중요하다. 앱에서는 셸이 프롬프트를 찍는 순간 커서가 움직이므로 보통은 인라인
`width: 9.275px`(한 셀)이 서 있고 — 그래서 **앱의 평소 증상은 `ㅇㅏㄴ녕`이 아니라 `ㅇㄴ`**,
곧 낱자만 새는 쪽이다. 그러다 커서가 한글 뒤칸에 서면 인라인이 `0px`이 되어 조합이 끊기는
쪽으로 넘어간다(실측: `가` 찍고 왼쪽 한 칸 → 인라인 `0px` → `ㅇㅏㄴ녕`).

스타일시트로는 인라인을 못 이긴다. 그래서 **`width`가 아니라 `min-width`로 바닥만 깐다** —
인라인 `width`와 싸우지 않으므로 `!important`가 필요 없고, xterm이 입력칸을 커서 셀에 맞춰
두는 뜻(다른 입력기의 후보창 위치)도 안 뺏는다. 실측으로 셋을 나란히 재 봤다:

| 규칙 | 인라인 | 쓰이는 폭 | 결과 |
|---|---|---|---|
| 없음 | `0px` | 0 | `ㅇㅏㄴ녕` ❌ |
| `min-width: 1px` | `0px` | 1 | `안녕` ✅ |
| `width: 1px !important` | `0px` | 1 | `안녕` ✅ (다만 커서 추적까지 뺏는다) |

xterm 스스로도 조합 중에는 이 칸을 1×1 이상으로 만든다(`updateCompositionElements`의 주석:
"Ensure the text area is at least 1x1, otherwise certain IMEs may break"). 다만 그 손질은
`_isComposing`이 선 **뒤**라 이 경로(조합이 안 서는 경로)에는 영영 안 온다.

곁가지 둘도 이 한 줄에서 함께 나았다: 스페이스가 **U+00A0**으로 오던 것과, 조합 중
백스페이스가 먹통이던 것.

### 남은 절반 — xterm이 `insertReplacementText`를 안 본다

크기를 고친 뒤의 이벤트 흐름은 이렇다(실측 그대로):

```
insertText            "ㅇ"   입력칸: ""     → "ㅇ"
insertReplacementText "아"   입력칸: "ㅇ"   → "아"
insertReplacementText "안"   입력칸: "아"   → "안"
insertReplacementText "안"   입력칸: "안"   → "안"     ← 값이 안 바뀌는 헛것도 온다
insertText            "ㄴ"   입력칸: "안"   → "안ㄴ"   ← 여기서 「안」이 확정된다
insertReplacementText "녀" …
```

xterm의 `_inputEvent`는 **`insertText`만** 받는다(§1.3에서 번들로 확인함). 그래서 낱자
`ㅇ`·`ㄴ`만 새고 완성된 `안`·`녕`은 통째로 버려진다 — 상류 PR
[#5704](https://github.com/xtermjs/xterm.js/pull/5704)가 말하는 그 자리다. 다만 그 PR은
**크기 0을 원인으로 짚지 않았고**, 우리가 잰 바로는 조합 이벤트가 안 오는 것이 결과이지
원인이 아니다.

조합 중 백스페이스는 지우는 신호가 따로 오지 않는다 — `insertReplacementText`의 데이터가
한 겹 벗겨져 온다(`녕` → `녀` → `ㄴ`). 그래서 다리에 특별한 처리가 없다.

### 순위 2(셸 로케일)는 **배제됐다**

상류 [#6084](https://github.com/xtermjs/xterm.js/issues/6084)가 똑같은 증상을 `LANG` 없음으로
철회한 전례가 있어 의심했지만, 우리에게는 해당되지 않는다. `/etc/zprofile`(애플 기본 파일)에
이것이 있다:

```sh
if [ -z "$LANG" ]; then
	export LANG=C.UTF-8
fi
```

`shell_builder`가 `new_default_prog()`로 **로그인 셸**을 띄우므로 이 파일이 돌고, 로케일이
공짜로 따라온다. 실측으로도 확인했다 — 로케일 넷(`없음`·`C.UTF-8`·`en_US.UTF-8`·`ko_KR.UTF-8`)
아래 PTY에 `안녕하세요`를 흘려 넣고 에코를 받아 보니 **1398바이트로 전부 같았다.**

> 로그인 셸로 띄우는 것은 PATH 때문에 정한 것인데(`pty.rs` 주석) 로케일이 거기 얹혀 있다.
> 언젠가 비로그인 셸로 바꾸면 이 구멍이 열린다.

### 배제된 것들 (다시 조사하지 말 것)

- **렌더러·글리프 아틀라스** — 1판에서 WebGL을 끄고도 그대로였다
- **`attachCustomKeyEventHandler`** — §1.5. ⌘ 없이는 `null`을 돌려주므로 가로챌 수가 없다
- **xterm 옵션 전부** — §1.4. 우리가 옮긴 `minimumContrastRatio`까지 그리는 쪽이다
- **입력칸의 속성** — `autocorrect="off"`·`spellcheck="false"`를 그대로 단 맨 `<textarea>`는
  정상으로 돌았다(실측). 속성이 아니라 크기였다
- **`updateCompositionElements`가 조합 중 기하를 흔드는 것** — no-op으로 막아도 그대로였다(실측)

## 3. 다시 재는 법

`sh tools/ime-probe/run.sh`. 쓰는 법·한계·대본 늘리는 법은 `tools/ime-probe/README.md`에 있다.

**손으로 칠 일이 없다.** 예전에 여기 있던 「웹 인스펙터에 스니펫을 붙여 넣고 한글을 친다」
절차는 계측기가 대신한다. 화면에서 읽은 자모는 글꼴 폴백을 타서 증거가 못 되므로,
계측기는 **바이트**를 잰다.

## 4. 무엇을 고쳤나

| 자리 | 무엇 |
|---|---|
| `src/index.css` | `.xterm textarea.xterm-helper-textarea`에 `min-width`/`min-height: 1px`. 바닥만 깔아 인라인과 안 싸운다(위 표) |
| `src/features/terminal/terminal-ime.ts` | 조합 다리. 완성될 때까지 붙들었다가 확정되는 순간 보낸다 |
| `src/features/terminal/terminal-store.ts` | `createInstance`에서 집(`wrapper`)의 capture 단계에 건다 |
| `tools/ime-probe/` | 위 전부를 진짜 입력기로 재는 계측기. 여섯 대본 |

**수식키를 거르는 것이 다리의 절반이다.** 두벌식에서 `ㄲㄸㅃㅆㅉ`·`ㅒㅖ`는 Shift로 치는데,
그 Shift keydown이 음절 한가운데 들어오면 아직 미완인 앞 음절을 흘려보내고 곧이어 오는
replacement가 같은 음절을 다시 채워 **두 번 나간다**(실측: 「했다」→`해했다`, 조합 중 ⌘→`해해`).
상류도 `CompositionHelper.keydown`에서 16·17·18·20을 거른다. **`Meta`는 상류에 없는데 우리가
넣었다** — macOS에서 ⌘는 수식키이고 이 앱은 그 터미널에 ⌘T·⌘W를 걸어 두었다.

**꺼낸 안 하나**: 상류 PR #5704를 `pnpm patch`로 물리는 것. 크기 0을 안 고치면 그 PR만으로는
안 낫는다(조합이 매 타자 끊기는 쪽으로 가므로 `insertReplacementText`가 아예 안 온다).
검토 안 거친 남의 코드를 입력 경로 한복판에 놓는 값도 있어 접었다.

**안 한 것**: 조합 중인 글자를 화면에 보여 주는 것. 지금은 다음 글자를 치는 순간 앞 글자가
나타난다 — 바이트는 맞지만 한 박자 늦게 보인다. xterm의 조합 오버레이는 조합 이벤트에
기대는데 이 경로에는 그 이벤트가 없다. 실물에서 얼마나 거슬리는지 보고 판단할 일이다.

## 5. 다음 사람이 안 되풀이했으면 하는 것

- **크기 0이 원인의 절반이다.** 스타일시트와 **인라인** 둘 다에서 온다(§2). `width:`로 적으면
  인라인에 지므로 `min-*`이라야 한다 — `terminal-ime.test.ts`가 `width:`로 되돌리는 것을 막는다
- **수식키 keydown은 조합을 안 끝낸다.** 이걸 빼면 한국어의 절반(과거형·쌍받침)이 두 번 나간다.
  상류 가드를 읽고도 안 옮긴 것이 1차 리뷰에서 blocker로 잡혔다
- **계측기가 못 치는 것은 안 재는 것이다.** 처음 네 대본에 Shift가 하나도 없어서 위 blocker가
  초록인 채로 빠져나갔다. 대본을 늘릴 때 「이 대본이 무엇을 지키는가」를 README 표에 적을 것
- `attachCustomKeyEventHandler`는 **끝났다**(§1.5)
- xterm 옵션도 **끝났다**(§1.4)
- 번들은 minified지만 **`.map`에 원본이 통째로 들어 있다**(§0)
- 화면에서 읽은 자모 글자는 **증거가 아니다.** 폰트 폴백과 폭이 섞인다. 바이트를 잴 것
- **CGEvent 타이핑은 쓸 수 있다** — 오히려 그것이 맞다. 입력기를 거치는 유일한 길이고,
  계측기가 쓰는 방식이다. 쓰면 안 되는 것은 **유니코드 문자열 주입**이다(입력기를 건너뛴다)

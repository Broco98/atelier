# 번들한 글꼴 — `JetBrainsMonoNL Nerd Font`

앱 안 터미널이 쓰는 글꼴이다. **앱 전체 모노(`--font-mono`)는 여전히 `Geist Mono`다** —
여기 것이 가는 곳은 터미널 하나뿐이다.

## 무엇이 왜 여기 있나

사용자의 셸 프롬프트와 상태줄이 Nerd Font 아이콘을 쓰는데 `Geist Mono`에는 그 글리프가 없다.
그래서 앱 안 터미널에서 두부(￿)로 보였다. 지금 앱의 글꼴은 전부 `@fontsource-variable/*`로
오지만 **Nerd Font 패치본은 fontsource에 없어서** 파일을 저장소에 넣고 `src/index.css`가
`@font-face`로 직접 들인다.

| 파일 | 크기 | 무게 |
| --- | --- | --- |
| `JetBrainsMonoNLNerdFont-Regular.woff2` | 986,956 B (0.94 MB) | 400 |
| `JetBrainsMonoNLNerdFont-Bold.woff2` | 988,556 B (0.94 MB) | 700 |

무게가 둘뿐인 것은 셈이 아니라 사실이다 — ANSI bold는 실제로 쓰이고, italic은 xterm이
합성한다. 그 둘 말고는 터미널에 나올 길이 없다.

## 어느 변형인가 — `…NerdFont-*`이지 `…NerdFontMono-*`가 아니다

Nerd Fonts는 같은 글꼴을 세 벌로 낸다. 아이콘 폭이 갈린다.

- `…NerdFont-*` — 아이콘을 원래 크기로 둔다. **이것을 쓴다**(사용자 결정).
- `…NerdFontMono-*` — 아이콘을 한 칸에 맞춰 줄인다.
- `…NerdFontPropo-*` — 비례.

`NL`은 No Ligatures다. `index.css`가 이미 `--font-mono--font-feature-settings`로 합자를
끄고 있으니 방침이 같다 — 저쪽은 기능을 끄고 이쪽은 애초에 합자가 없는 판을 고른다.

**알려진 위험 — 아이콘이 제 칸을 넘는다.** 실측했다(fontTools, `unitsPerEm` 1000):
모든 글리프의 advance는 ASCII와 같은 600(= 한 칸)인데, 아이콘의 **잉크는 그보다 넓다.**

| 글리프 | 잉크 폭 | 칸 수 |
| --- | --- | --- |
| `M` (ASCII) | 456 | 0.76 |
| U+E0B0 powerline | 635 | 1.06 |
| U+E7A8 devicon | 799 | 1.33 |
| U+F09B font awesome | 894 | 1.49 |
| U+F408 octicon | 1000 | 1.67 |

xterm은 문자마다 칸 하나를 배정하고 PUA는 유니코드 폭표에서 1칸이므로, 잘리든 옆 칸을
침범하든 **둘 중 하나는 일어난다.** 어느 쪽인지는 렌더러가 정하고 실물에서만 보인다.
어긋나면 되돌리는 비용은 파일 교체 한 번이다(`…NerdFontMono-*`로 바꾸고 이 표를 다시 잰다).

**한글은 이 글꼴에 없다**(실측: `가` U+AC00이 cmap에 없다). 폴백 사슬 끝을 못박는 일은
`terminal-defaults.ts`의 `FONT_FAMILY`가 한다.

## 어디서 왔고 어떻게 만들었나

원본은 Nerd Fonts 3.4.0이 낸 TTF다(글꼴 `name` ID 5: `Version 2.304; ttfautohint
(v1.8.4.7-5d5b);Nerd Fonts 3.4.0`). TTF 각 2.3MB를 woff2로 옮겨 각 0.94MB가 됐다.
글리프는 11,985개, 손대지 않았다 — 부분집합(subset)을 뜨지 않았다는 뜻이다.

```
python3 -c '
from fontTools.ttLib import TTFont          # fontTools 4.60.2 + brotli
for w in ("Regular", "Bold"):
    f = TTFont(f"~/Library/Fonts/JetBrainsMonoNLNerdFont-{w}.ttf")
    f.flavor = "woff2"
    f.save(f"JetBrainsMonoNLNerdFont-{w}.woff2")
'
```

## 라이선스 — 원문이 옆에 있다

요약이 아니라 원문을 둔다. **OFL 1.1은 라이선스 동봉이 재배포의 조건**이고, 패치본의
아이콘은 출처가 여럿이라 저작자 표시가 필요하다.

| 파일 | 무엇 | 받은 곳 |
| --- | --- | --- |
| `LICENSE-JetBrainsMono-OFL.txt` | 원본 글꼴의 OFL 1.1 전문 | `ryanoasis/nerd-fonts` v3.4.0 `src/unpatched-fonts/JetBrainsMono/OFL.txt` |
| `AUTHORS-JetBrainsMono.txt` | 위 저작권 문구가 가리키는 「Project Authors」 | 같은 폴더 `AUTHORS.txt` |
| `LICENSE-NerdFonts.md` | 패처 쪽 MIT + OFL 1.1 | `ryanoasis/nerd-fonts` v3.4.0 `LICENSE` |
| `LICENSE-NerdFonts-glyph-sources.md` | 아이콘 출처별 라이선스 표 (Font Awesome · Devicons · Octicons · Material · Powerline …) | `ryanoasis/nerd-fonts` v3.4.0 `license-audit.md` |

`LICENSE-JetBrainsMono-OFL.txt`의 저작권 줄은 `JetBrains Mono Project Authors`인데 번들한
파일의 이름표(`name` ID 0)는 `JetBrains Mono NL Project Authors`다. **다른 글꼴이 아니다** —
NL은 같은 프로젝트의 합자 없는 판이고, nerd-fonts도 `Ligatures/`와 `NoLigatures/` 두 폴더를
OFL 파일 하나로 덮는다.

지켜야 하는 것: 재배포하되 **글꼴 자체를 팔지 않는다**, 라이선스를 함께 둔다. 이름 제약(RFN)은
`LICENSE-NerdFonts-glyph-sources.md`의 표가 JetBrains Mono를 `OFL-1.1-no-RFN`으로 적어 뒀다.

**저장소에는 아직 프로젝트 자신의 `LICENSE`가 없다.** 여기 넷은 번들한 글꼴의 것이지 이 앱의
것이 아니다.

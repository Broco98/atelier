import { createCn } from "cn/config";

// **클래스를 합칠 때 글자 단계의 이름을 크기로 읽게 한다**(codex-ds 결정 27 · 티켓 03). `index.css`의 `@theme`에 선
// DS 단계 가운데 `heading-lg` · `chat-meta` · `code` · `nav-row` 같은 이름은 Tailwind 기본 이름이 아니다. 알려 주지 않으면
// 합치기가 그것을 **글자색**으로 읽어 `text-chat-meta text-fg-tertiary`에서 크기를 조용히 지운다. 목록은 `@theme`의 DS 단계
// 전부다 — Tailwind도 아는 `sm` · `xs` …까지 함께 적어 `@theme`과 한 줄씩 맞댄다. 이름이 `@theme`과 같은지, 부품이 모두
// 여기서 `cn`을 받는지는 `type-scale.test.ts`가 잰다 — registry 부품은 `from "cn"`으로 오므로 들일 때 여기로 옮긴다.
//
// **반경 이름도 같다**(codex-ds 결정 27). `index.css`의 Codex 반경 가운데 Tailwind 크기 이름(`2xs` … `4xl` · `full`)은 합치기가
// 이미 모서리로 알고, Codex만의 둘(`bubble` · `composer`)은 알려 줘야 한다. 모르면 합치기가 부품의 `rounded-lg`와 부르는 자리의
// `rounded-bubble`을 둘 다 남겨, 어느 모서리가 서는지를 CSS의 순서가 정한다.
//
// **그림자 이름도 같다**(codex-ds 결정 27). Codex 그림자와 두 겹을 합친 이름(`modal` · `raised` · `lifted`)은 `shadow-2xl` 말고는
// Tailwind 이름이 아니다. 모르면 합치기가 그것을 그림자 **색**으로 읽어 `shadow-prominent shadow-none`에서 둘 다 남기고, 뒤에
// 그림자 색(`shadow-black`)이 오면 그림자를 지운다.
//
// **시간 · 곡선 이름도 같다**(codex-ds 결정 27). Codex 시간(`duration-basic` … `duration-panel`)과 곡선(`ease-default` …
// `ease-panel`)은 `ease-out` 말고는 Tailwind 이름이 아니다. 모르면 합치기가 부품의 `PANEL_MOTION`과 부르는 자리의 `duration-0`을 둘 다
// 남겨, 어느 길이가 서는지를 CSS의 순서가 정한다. 시간은 합치기의 이름표(theme)가 없어 갈래(`duration`)에 직접 더한다.
//
// **색 이름은 알려 주지 않는다**(codex-ds 결정 27). 합치기는 모르는 이름(`text-fg-tertiary` · `bg-fill-hover` ·
// `border-border-heavy` …)을 색으로 읽는다 — 위의 글자 단계와 그림자를 알려야 하는 까닭이 그것이고, 같은 까닭으로
// Codex 색은 알리지 않아도 색으로 합쳐진다. 같은 갈래의 색끼리는 뒤의 것이 이기고, 단계와는 함께 남는다(`type-scale.test.ts`의 「단계와 글자색을
// 함께 남긴다」).
export const cn = createCn({
  extend: {
    theme: {
      text: [
        "heading-5xl",
        "heading-4xl",
        "heading-3xl",
        "heading-2xl",
        "heading-xl",
        "heading-lg",
        "heading-md",
        "heading-sm",
        "heading-xs",
        "lg",
        "md",
        "sm",
        "xs",
        "2xs",
        "3xs",
        "chat-body",
        "chat-meta",
        "form-body",
        "caps-lg",
        "caps-md",
        "code",
        "nav-row",
      ],
      radius: ["bubble", "composer"],
      shadow: ["hairline", "100", "200", "300", "400", "card", "composer", "prominent", "modal", "raised", "lifted"],
      ease: ["default", "enter", "enter-snappy", "exit", "exit-snappy", "move", "panel"],
    },
    classGroups: {
      duration: [{ duration: ["basic", "relaxed", "chip", "dropdown", "word", "pulse", "tip", "peek-close", "panel"] }],
    },
  },
});

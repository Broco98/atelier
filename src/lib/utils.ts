import { createCn } from "cn/config";

// **클래스를 합칠 때 글자 단계의 이름을 크기로 읽게 한다**(ui-refresh 결정 25). `index.css`의 `@theme`에 선
// 열 단계(`text-meta` …)는 Tailwind 기본 이름이 아니다. 알려 주지 않으면 합치기가 그것을 **글자색**으로
// 읽어 `text-ui text-fg-tertiary`에서 크기를 조용히 지운다. 이름이 `@theme`과 같은지, 부품이 모두 여기서
// `cn`을 받는지는 `type-scale.test.ts`가 잰다 — registry 부품은 `from "cn"`으로 오므로 들일 때 여기로 옮긴다.
//
// **반경 이름(`rounded-card` …)도 같다**(ui-refresh 결정 6 · 25). 모르면 합치기가 부품의 `rounded-lg`와
// 부르는 자리의 `rounded-card`를 둘 다 남겨, 어느 모서리가 서는지를 CSS의 순서가 정한다.
//
// **떠 있는 것의 그림자(`shadow-float`)도 같다**(ui-refresh 결정 6). 모르면 합치기가 그것을 그림자 **색**으로 읽어
// `shadow-float shadow-none`에서 둘 다 남긴다.
//
// **색 이름은 알려 주지 않는다**(codex-ds 결정 27). 합치기는 모르는 이름(`text-fg-tertiary` · `bg-fill-hover` ·
// `border-border-heavy` …)을 색으로 읽는다 — 위의 글자 단계와 그림자를 알려야 하는 까닭이 그것이고, 같은 까닭으로
// Codex 색은 알리지 않아도 색으로 합쳐진다. 같은 갈래의 색끼리는 뒤의 것이 이기고, 단계와는 함께 남는다(`type-scale.test.ts`의 「단계와 글자색을
// 함께 남긴다」).
export const cn = createCn({
  extend: {
    theme: {
      text: ["meta", "caption", "ui", "row", "body", "h2", "title", "mono", "mono-sm", "mono-micro"],
      radius: ["card", "pill", "inner", "inline"],
      shadow: ["float"],
    },
  },
});

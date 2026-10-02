import { createCn } from "cn/config";

// **클래스를 합칠 때 글자 단계의 이름을 크기로 읽게 한다**(ui-refresh 결정 25). `index.css`의 `@theme`에 선
// 열 단계(`text-meta` …)는 Tailwind 기본 이름이 아니다. 알려 주지 않으면 합치기가 그것을 **글자색**으로
// 읽어 `text-ui text-tertiary`에서 크기를 조용히 지운다. 이름이 `@theme`과 같은지, 부품이 모두 여기서
// `cn`을 받는지는 `type-scale.test.ts`가 잰다 — registry 부품은 `from "cn"`으로 오므로 들일 때 여기로 옮긴다.
//
// **반경 이름(`rounded-card` …)도 같다**(ui-refresh 결정 6 · 25). 모르면 합치기가 부품의 `rounded-lg`와
// 부르는 자리의 `rounded-card`를 둘 다 남겨, 어느 모서리가 서는지를 CSS의 순서가 정한다.
export const cn = createCn({
  extend: {
    theme: {
      text: ["meta", "caption", "ui", "row", "body", "h2", "title", "mono", "mono-sm", "mono-micro"],
      radius: ["card", "pill", "inner", "inline"],
    },
  },
});

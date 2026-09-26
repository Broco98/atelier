// **Base UI 부품의 `className`을 그 부품의 state로 푼다.** Base UI는 `className`에 문자열뿐 아니라 state를 받는
// 함수도 받는다(`BaseUIComponentProps`). 부품 파일이 제 클래스를 state로 고르면(`className={(state) => cn(…)}` —
// 켜짐·눌림에 따라 갈리는 색이 그렇다) 쓰는 자리의 `className`도 같은 state로 풀어 그 뒤에 합쳐야 한다. registry는
// 문자열로만 합쳐, 함수를 넘기면 `cn`이 그것을 조용히 버린다.
//
// `lib/utils.ts`가 아니라 여기 사는 것은 그 파일이 `cn` 재수출 한 줄이기 때문이다(결정 6). 쓰는 자리는
// components/ui의 부품 파일뿐이다.
export function resolveClassName<State>(
  className: string | ((state: State) => string | undefined) | undefined,
  state: State
): string | undefined {
  return typeof className === "function" ? className(state) : className
}

import { describe, expect, it } from "vitest";
import { blankedSources, placesOf, where } from "./blank-comments";

// **맨 `<button>`은 `tabIndex`를 적는다**(`@/lib/roving` 머리말 · 02 코드 리뷰 C1 「맨 버튼도 앉는다」 · restart 03-13c). macOS WebKit의
// Tab은 `tabindex`를 적지 않은 `<button>`을 지나친다 — 「키보드 탐색」이 꺼진 기본값에서는 입력칸과 `tabindex`를 단 것만 다닌다. 그래서
// 키보드로는 닿지 않는 단추가 빌드도 타입 검사도 조용히 지나가고, 누르기로 재는 L3도 못 잡는다(03-13이 Tab 차례를 재어 목록 · 상세의
// 맨 단추를 찾았고, 03-13c가 남은 것을 쓸었다).
//   - 사람이 누르는 단추는 `tabIndex={0}`이다.
//   - 일부러 Tab에서 빼는 단추(같은 일을 하는 이웃이 있거나, 행의 대상 메뉴가 그 동작을 든 roving 행 안 단추)는 `tabIndex={-1}`이고 그
//     자리에 까닭을 한 줄 적는다.
//   - props를 펴 받는 단추(`{...props}`)는 넘기는 쪽이 정한다 — 이 검사가 거르지 않는다.
// 세는 것은 JSX에 직접 쓴 `<button`과, 제 요소 없이 서는 툴팁 트리거(`Hint` · `TooltipTrigger` — `render`가 없으면 맨 `<button>`을
// 그린다)다. `render`로 얹는 트리거는 얹힌 요소가 정한다(그것이 `<button`이면 따로 센다). 부품(`Button` · 메뉴 · Select 트리거)은 제
// 자리에서 이미 `tabindex`를 단다. 주석은 세지 않는다(`blank-comments.ts`).

/** 여는 꼬리 — 이름 뒤에서 그 끝(`>`)까지. 중괄호(식) 안과 따옴표 안의 `>`는 끝이 아니다. */
function openingTag(text: string, from: number, name: string): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = from + name.length; i < text.length; i++) {
    const c = text[i];
    if (quote !== null) {
      if (c === quote) quote = null;
    } else if (depth > 0) {
      if (c === "{") depth++;
      else if (c === "}") depth--;
      else if (c === '"' || c === "'" || c === "`") quote = c;
    } else if (c === "{") depth++;
    else if (c === '"' || c === "'") quote = c;
    else if (c === ">") return text.slice(from, i + 1);
  }
  return text.slice(from);
}

/** 여는 꼬리에 `tabIndex`도 props 펼침(`{...`)도 없는 맨 단추 — 툴팁 트리거는 `render`도 없을 때다. */
const bareButtons = () =>
  placesOf(
    /<(?:button|Hint|TooltipTrigger)(?=[\s>])/g,
    blankedSources().filter(({ file }) => file.endsWith(".tsx")),
  ).filter(({ match }) => {
    const tag = openingTag(match.input, match.index, match[0]);
    if (/\btabIndex=/.test(tag) || /\{\s*\.\.\./.test(tag)) return false;
    return match[0] === "<button" || !/\brender=/.test(tag);
  });

describe("맨 단추의 Tab", () => {
  it("JSX에 쓴 <button>과 제 요소 없는 툴팁 트리거는 모두 tabIndex를 적는다(WebKit Tab이 지나치지 않게)", () => {
    expect(bareButtons().map(where)).toEqual([]);
  });
});

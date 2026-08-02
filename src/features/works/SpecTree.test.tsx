import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SpecTree from "./SpecTree";

// 경로 복사는 **진짜 button**이어야 하고 파일 이름 선택 버튼의 **형제**여야 한다.
// 이 둘이 깨진 적이 있다: 복사가 이름 버튼 안에 span role="button"으로 들어가 있었고,
// 그러면 Tab으로 도달할 수 없을뿐더러 ARIA의 presentational-children 규칙상
// 스크린리더에는 존재조차 읽히지 않는다. 화면에는 멀쩡히 보이므로 눈으로는 안 잡힌다.

function render(onCopy?: (path: string) => void): string {
  return renderToStaticMarkup(
    <SpecTree
      files={["overview.md", "01-판/spec.md"]}
      current="overview.md"
      onSelect={() => {}}
      onCopy={onCopy}
    />,
  );
}

describe("SpecTree 경로 복사 버튼", () => {
  it("파일마다 하나씩, button으로 렌더된다", () => {
    const markup = render(() => {});
    expect(markup.match(/aria-label="[^"]*경로 복사"/g)).toHaveLength(2);
    // aria-label을 가진 자리가 button 태그인지 — span role="button"으로 되돌아가면 여기서 걸린다
    expect(markup).toMatch(/<button[^>]*aria-label="overview\.md 경로 복사"/);
  });

  it("이름 선택 버튼 안에 중첩되지 않는다", () => {
    // 중첩 버튼은 HTML에서 허용되지 않는다. 여는 button과 닫는 button 사이에
    // 또 다른 여는 button이 오면 중첩이다.
    const markup = render(() => {});
    expect(markup).not.toMatch(/<button(?:(?!<\/button>)[\s\S])*<button/);
  });

  it("onCopy가 없으면 복사 버튼도 없다", () => {
    expect(render()).not.toMatch(/경로 복사/);
  });
});

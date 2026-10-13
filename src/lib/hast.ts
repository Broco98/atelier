// 마크다운 hast(react-markdown이 렌더러에 넘기는 `node`)를 읽는 작은 손들 — 문서 보기(`SpecViewer`)와 대화창의 답(`ChatMarkdown`)이
// 함께 쓴다. 렌더러의 표(components)는 둘이 따로 갖는다 — 글자 단계와 딸린 플러그인이 다르다.

/** hast 노드 아래의 글만 이어 붙인다 — 코드 블록 본문 · mermaid 원문 · 문단의 글. */
export function hastText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const one = node as { type?: string; value?: string; children?: unknown[] };
  if (one.type === "text") return one.value ?? "";
  return (one.children ?? []).map(hastText).join("");
}

/** 코드 블록의 언어 — `pre`의 첫 자식 `<code>`에 붙은 `language-…` 클래스. 적지 않은 블록이면 `undefined`다. */
export function codeLang(code: unknown): string | undefined {
  if (!code || typeof code !== "object") return undefined;
  const className = (code as { properties?: { className?: unknown } }).properties?.className;
  if (!Array.isArray(className)) return undefined;
  return className
    .map(String)
    .find((one) => one.startsWith("language-"))
    ?.slice("language-".length);
}

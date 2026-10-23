import { memo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Copy } from "lucide-react";
import { codeLang, hastText } from "@/lib/hast";
import { cn } from "@/lib/utils";

// Agent 답의 본문(v1 티켓 05 · 캔버스 Messages 보드 「Agent 답변」 · 「스트리밍」) — 말풍선 없이 본문 그대로다(14/22.75 · 블록 사이 12).
// three-axes 답(`chat/ChatMarkdown.tsx`)을 옮겨 왔고, 달라진 것은 둘이다.
// - **코드 블록**은 보드의 `.cb`다 — `radius-3xl`(20) · `surface-code` 면 하나, 머리 34에 언어와 복사. 테두리가 없다.
// - **흐르는 답은 낱말이 도착하는 방식으로 선다**(`streaming`). 새로 온 낱말만 `duration-word` 동안 옅었다가 선명해진다(`word-in`,
//   index.css) — 깜빡이는 커서는 쓰지 않는다. 낱말을 감싸는 것은 hast 단계의 작은 플러그인이다(`rehypeWords`): 렌더러는 같은 자리의
//   요소를 다시 쓰므로 이미 선 낱말은 다시 움직이지 않고, 끝에 붙은 낱말만 새로 선다. 턴이 끝나면 감싸지 않는다(낱말마다 요소를 두지
//   않게).
//
// 링크는 바깥 URL만 연다 — Tauri 웹뷰에서 `<a>`가 그대로 주소를 바꾸면 앱이 그 페이지로 간다.

/** 0.5px 가름선 — 작업 머리줄 아래 · 답 안의 `---`(DS `.at-hr` — `border-heavy`). */
export const RULE = "h-[0.5px] shrink-0 border-0 bg-border-heavy";

const components: Components = {
  h1: ({ children }) => <h3 className="text-heading-lg">{children}</h3>,
  h2: ({ children }) => <h3 className="text-heading-sm">{children}</h3>,
  h3: ({ children }) => <h3 className="text-heading-xs">{children}</h3>,
  h4: ({ children }) => <h4 className="text-heading-xs">{children}</h4>,
  h5: ({ children }) => <h5 className="text-heading-xs">{children}</h5>,
  h6: ({ children }) => <h6 className="text-heading-xs">{children}</h6>,
  ul: ({ children }) => <ul className="flex list-disc flex-col gap-1 pl-5 marker:text-fg-tertiary">{children}</ul>,
  ol: ({ children }) => <ol className="flex list-decimal flex-col gap-1 pl-5 marker:text-fg-tertiary">{children}</ol>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  blockquote: ({ children }) => <blockquote className="border-l-[3px] border-rule pl-4 text-fg-secondary">{children}</blockquote>,
  hr: () => <hr className={RULE} />,
  a: ({ children, href }) => (
    <a
      href={href}
      onClick={(event) => {
        event.preventDefault();
        if (href && /^https?:\/\//.test(href)) void openUrl(href);
      }}
      className="text-link"
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="overflow-x-auto scroll-quiet">
      <table className="w-full border-collapse text-chat-meta">{children}</table>
    </div>
  ),
  th: ({ children }) => <th className="border-b border-rule py-2 pr-4 text-left font-semibold">{children}</th>,
  td: ({ children }) => (
    <td className="relative py-2 pr-4 align-top after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[0.5px] after:bg-border">
      {children}
    </td>
  ),
  // 코드 블록 — 안쪽 `<code>`를 여기서 직접 쓴다. `children`을 그리면 언어를 안 적은 블록이 아래 인라인 갈래로 빠진다.
  pre: ({ node }) => {
    const code = node?.children?.[0];
    return <CodeBlock lang={codeLang(code)} code={hastText(code).replace(/\n$/, "")} />;
  },
  code: ({ children }) => (
    <code className="rounded-sm bg-surface-code px-1 py-px font-mono text-code wrap-anywhere">{children}</code>
  ),
};

/** 코드 블록 — 머리(언어 · 복사)와 고정폭 본문. 보드의 `.cb`(20 · `surface-code` · 머리 34)다. */
function CodeBlock({ lang, code }: { lang: string | undefined; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <figure className="overflow-hidden rounded-3xl bg-surface-code">
      <div className="flex h-8.5 items-center gap-2 pr-1.5 pl-4 text-xs text-fg-tertiary">
        <span className="min-w-0 flex-1 truncate">{lang ?? "코드"}</span>
        <button
          type="button"
          aria-label="코드 복사"
          onClick={() => {
            void navigator.clipboard?.writeText(code).then(() => setCopied(true));
          }}
          className="icon-button-quiet icon-button-sm text-fg-secondary focus-ring"
        >
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 pb-3.5 font-mono text-code scroll-quiet">
        <code className={lang ? `language-${lang}` : undefined}>{code}</code>
      </pre>
    </figure>
  );
}

/** hast 노드 — 플러그인이 읽고 고치는 칸만. */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

/** 낱말을 감싸지 않는 요소 — 코드는 글자 그대로 선다. */
const WHOLE = new Set(["pre", "code"]);

/** 글 마디를 낱말마다 `word-in` 요소로 감싼다(머리말). 빈칸은 그대로 글이다 — 줄바꿈 자리가 바뀌지 않는다. */
function rehypeWords() {
  const walk = (node: HastNode) => {
    if (!node.children || (node.tagName && WHOLE.has(node.tagName))) return;
    node.children = node.children.flatMap((child): HastNode[] => {
      if (child.type !== "text" || !child.value) {
        walk(child);
        return [child];
      }
      return child.value
        .split(/(\s+)/)
        .filter((part) => part !== "")
        .map((part) =>
          /^\s+$/.test(part)
            ? { type: "text", value: part }
            : { type: "element", tagName: "span", properties: { className: ["word-in"] }, children: [{ type: "text", value: part }] },
        );
    });
  };
  return (tree: HastNode) => walk(tree);
}

const STREAMING = [rehypeWords];

/** 답 한 덩어리. 흐르는 동안 글이 늘 때마다 다시 그리므로 같은 글이면 건너뛴다. */
function ThreadMarkdown({ text, streaming = false, className }: { text: string; streaming?: boolean; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-3 wrap-anywhere", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={streaming ? STREAMING : undefined} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default memo(ThreadMarkdown);

import { memo, useEffect, useRef, useState, type ReactElement } from "react";
import ReactMarkdown, { type Components, type Options } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { codeLang, hastText } from "@/lib/hast";
import { cn } from "@/lib/utils";
import { CopyButton } from "./CopyButton";
import { continueBlocks, type BlockScan } from "./markdown-blocks";

// Agent 답의 본문(v1 티켓 05 · 캔버스 Messages 보드 「Agent 답변」 · 「스트리밍」) — 말풍선 없이 본문 그대로다(14/22.75 · 블록 사이 12).
// three-axes 답(`chat/ChatMarkdown.tsx`)을 옮겨 왔고, 달라진 것은 둘이다.
// - **코드 블록**은 Cards 보드의 `.at-code`다 — `radius-3xl`(20) · `surface-code` 면에 1 `border-light` 링, 머리에 언어와 복사(`CodeBlock`).
// - **흐르는 답은 조각이 도착하는 방식으로 선다**(`streaming` — 02 구현 스펙 §12 「답 글자 도착」 · 스토리 99). 새로 온 낱말만
//   .7s(`duration-arrive`) 동안 옅었다가 또렷해진다(`word-in`, index.css) — 깜빡이는 커서는 쓰지 않는다. 낱말을 감싸는 것은 hast 단계의
//   작은 플러그인이다(`rehypeStream`): 렌더러는 같은 자리의 요소를 다시 쓰므로 이미 선 낱말은 다시 움직이지 않고, 끝에 붙은 낱말만 새로
//   선다. **조각 사이 늦음은 없다** — 한 번에 온 낱말들이 함께 선다(Codex `fadeSegmentDelayMs` 0 — v1의 낱말마다 70ms 늦음을 걷었다).
//   흐르는 동안은 마지막 글덩이의 끝 240px이 옅다(`stream-tail`). 낱말이 다 서면 감쌈을 걷는다(낱말마다 요소를 두지 않게).
// - **긴 답은 덩어리로 나눠 그린다**(restart 티켓 01b-9). 흐르는 글은 조각마다 다시 그리므로 글 전체를 풀면 글이 길어질수록 화면이 멎는다. 앞서 닫힌 덩어리는
//   글이 그대로이니 건너뛰고 끝 덩어리만 다시 푼다(`markdownBlocks`). 닫힌 덩어리는 낱말의 움직임이 끝나면 감싸지 않은 모양으로 한 번 다시 그린다 — 흐름이
//   끝날 때는 끝 덩어리만 남아 있어, 긴 답이 기록 줄이 되어도 다시 그리지 않는다.
//
// 링크는 바깥 URL만 연다 — Tauri 웹뷰에서 `<a>`가 그대로 주소를 바꾸면 앱이 그 페이지로 간다.

/** 0.5px 가름선 — 턴 머리 아래(States 보드 `.ra-rule`) · 답 안의 `---`(DS `.at-hr` — `border-heavy`). */
export const RULE = "h-[0.5px] shrink-0 border-0 bg-border-heavy";

const components: Components = {
  h1: ({ children }) => <h3 className="text-heading-lg">{children}</h3>,
  h2: ({ children }) => <h3 className="text-heading-sm">{children}</h3>,
  h3: ({ children }) => <h3 className="text-heading-xs">{children}</h3>,
  h4: ({ children }) => <h4 className="text-heading-xs">{children}</h4>,
  h5: ({ children }) => <h5 className="text-heading-xs">{children}</h5>,
  h6: ({ children }) => <h6 className="text-heading-xs">{children}</h6>,
  // 목록(Cards 보드 「답 본문」 · DS `.at-prose ul`) — 안쪽 22 · 줄 사이 4.
  ul: ({ children }) => <ul className="flex list-disc flex-col gap-1 pl-5.5 marker:text-fg-tertiary">{children}</ul>,
  ol: ({ children }) => <ol className="flex list-decimal flex-col gap-1 pl-5.5 marker:text-fg-tertiary">{children}</ol>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  // 인용(DS `.at-prose blockquote`) — 왼쪽 16 안쪽에 `fg-secondary` 글, 3 폭의 둥근 막대가 위아래 2를 비우고 선다.
  blockquote: ({ children }) => (
    <blockquote className="relative pl-4 text-fg-secondary before:absolute before:inset-y-0.5 before:left-0 before:w-[3px] before:rounded-2xs before:bg-rule">
      {children}
    </blockquote>
  ),
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
  // 인라인 코드(Thread 보드 `.ra-prose code`) — 둘레 글자의 .92(고정 13px가 아니다) · 바탕 `fill-soft` · 안쪽 1 / 6 · 둥글기 6(superellipse를
  // 쓰는 창은 7.5)이라 높이가 17이다. 한때 Codex 실측의 바탕 `surface-codespan`(#e8e9e9)이었다. 코드 블록은 그대로다(`CodeBlock`).
  code: ({ children }) => (
    <code className="rounded-codespan corner-superellipse bg-fill-soft px-1.5 py-px font-mono text-codespan wrap-anywhere">
      {children}
    </code>
  ),
};

/**
 * 코드 블록(Cards 보드 「코드 블록」 · DS `.at-code` · restart 02b-6) — 둥근 20 · `surface-code` 면에 안쪽 1 `border-light` 링. 머리는 안쪽 12 12 4 16 ·
 * 13 / 18에 언어(글 빛 그대로)와 오른쪽 복사(`CopyButton` — 26 · 글리프 14 · `fg-tertiary`, 스토리 72)이고, 본문은 안쪽 6 16 16 · 고정폭 13 / 20이다.
 * 한때 보드의 `.cb`(머리 34 · 12 `fg-tertiary` 언어 · 링 없음)였다.
 */
function CodeBlock({ lang, code }: { lang: string | undefined; code: string }) {
  return (
    <figure className="overflow-hidden rounded-3xl bg-surface-code inset-ring inset-ring-border-light">
      <figcaption className="flex items-center gap-2 pt-3 pr-3 pb-1 pl-4 text-chat-meta">
        <span className="min-w-0 flex-1 truncate">{lang ?? "코드"}</span>
        <CopyButton text={code} label="코드 복사" />
      </figcaption>
      <pre className="overflow-x-auto px-4 pt-1.5 pb-4 font-mono text-code scroll-quiet">
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

/** 끝이 옅어질 글덩이 — 글줄을 담는 블록. 표 칸은 넣지 않는다(표는 줄 상자 하나로 이어 흐르지 않는다). */
const TEXT_BLOCKS = new Set(["p", "h1", "h2", "h3", "h4", "h5", "h6", "li"]);

/** 블록 요소 — 이것을 품은 목록 줄은 그 안의 글덩이가 끝을 든다. */
const BLOCKS = new Set([...TEXT_BLOCKS, "ul", "ol", "pre", "blockquote", "table", "hr", "div"]);

/** 글이 아닌 것으로 끝나는 블록 — 답이 이것으로 끝나면 가릴 꼬리가 없다. */
const NOT_TEXT = new Set(["pre", "table", "hr"]);

/**
 * **흐르는 답을 감싼다**(머리말). 글 마디를 낱말마다 `word-in` 요소로 감싼다 — 빈칸은 그대로 글이라 줄바꿈 자리가 바뀌지 않는다. 늦음은
 * 없다. 글줄을 담는 블록(문단 · 제목 · 목록 줄)의 안은 줄 상자(`span`) 하나로 다시 감싸고, 답의 맨 끝 글덩이의 줄 상자에만
 * `stream-tail`을 단다 — 줄 상자는 모든 글덩이에 서 있어 마지막이 다음 글덩이로 넘어가도 같은 요소가 이름표만 바뀐다(낱말이 다시
 * 서지 않는다). 답이 코드 블록 · 표 · 가름선으로 끝나면 가릴 꼬리가 없다.
 */
function rehypeStream({ tail: marksTail }: { tail: boolean }) {
  const word = (value: string): HastNode => ({
    type: "element",
    tagName: "span",
    properties: { className: ["word-in"] },
    children: [{ type: "text", value }],
  });
  return (tree: HastNode) => {
    let tail: HastNode | null = null;
    const walk = (node: HastNode) => {
      if (node.tagName && NOT_TEXT.has(node.tagName)) tail = null;
      if (!node.children || (node.tagName && WHOLE.has(node.tagName))) return;
      node.children = node.children.flatMap((child): HastNode[] => {
        if (child.type !== "text" || !child.value) {
          walk(child);
          return [child];
        }
        return child.value
          .split(/(\s+)/)
          .filter((part) => part !== "")
          .map((part) => (/^\s+$/.test(part) ? { type: "text", value: part } : word(part)));
      });
      const inline = !node.children.some((child) => child.tagName !== undefined && BLOCKS.has(child.tagName));
      const said = node.children.some((child) => child.type !== "text" || /\S/.test(child.value ?? ""));
      if (node.tagName && TEXT_BLOCKS.has(node.tagName) && inline && said) {
        const run: HastNode = { type: "element", tagName: "span", properties: {}, children: node.children };
        node.children = [run];
        tail = run;
      }
    };
    walk(tree);
    if (marksTail && tail !== null) (tail as HastNode).properties = { className: ["stream-tail"] };
  };
}

const REMARK_PLUGINS: Options["remarkPlugins"] = [remarkGfm];
/** 흐르는 답의 닫힌 덩어리 — 낱말을 감싸되 끝을 가리지 않는다. */
const WORDS: Options["rehypePlugins"] = [[rehypeStream, { tail: false }]];
/** 흐르는 답의 끝 덩어리. */
const TAIL: Options["rehypePlugins"] = [[rehypeStream, { tail: true }]];

/** 낱말이 다 서는 시간 — `duration-arrive`다(`tokens.test.ts`가 700ms를 지킨다). */
const ARRIVE_MS = 700;

interface MarkdownBlockProps {
  text: string;
  /** 흐르는 답의 덩어리인가 — 처음에 낱말을 감싼다. */
  flowed: boolean;
  /** 흐르는 답의 끝 덩어리인가. */
  tail: boolean;
}

/** 덩어리 하나 — 글이 그대로면 다시 풀지 않는다. */
const MarkdownBlock = memo(function MarkdownBlock({ text, flowed, tail }: MarkdownBlockProps) {
  const [settled, setSettled] = useState(!flowed);
  useEffect(() => {
    if (tail || settled) return;
    const timer = window.setTimeout(() => setSettled(true), ARRIVE_MS);
    return () => window.clearTimeout(timer);
  }, [tail, settled]);
  const plugins = tail ? TAIL : settled ? undefined : WORDS;
  return (
    <ReactMarkdown remarkPlugins={REMARK_PLUGINS} rehypePlugins={plugins} components={components}>
      {text}
    </ReactMarkdown>
  );
});

/** 상자 하나에 두는 덩어리 수 — 뒤의 덩어리는 이만큼씩 묶음 상자에 든다. 묶음은 처음부터 그 상자에 서므로 옮겨 그리는 일이 없다. */
const GROUP_SIZE = 64;

/** 덩어리 묶음 — WebKit은 flex 상자의 자식 하나가 바뀌어도 자식 모두를 다시 잰다. 긴 답의 자식 수를 줄인다. 틈은 바깥 상자와 같다. */
const BlockGroup = memo(
  function BlockGroup({ items }: { items: readonly ReactElement[] }) {
    return <div className="flex min-w-0 flex-col gap-3">{items}</div>;
  },
  (a, b) => a.items.length === b.items.length && a.items.every((item, at) => item === b.items[at]),
);

/** 답 하나. 흐르는 동안 글이 늘 때마다 다시 그리므로 같은 글이면 건너뛴다. */
function ThreadMarkdown({ text, streaming = false, className }: { text: string; streaming?: boolean; className?: string }) {
  const scan = useRef<BlockScan | null>(null);
  if (scan.current?.text !== text) scan.current = continueBlocks(scan.current, text);
  const { blocks } = scan.current;
  // 처음에 흘렀으면 기록 줄이 된 뒤에도 흐른 답이다 — 그려 둔 덩어리를 다시 그리지 않는다.
  const [flowed] = useState(streaming);
  // 그대로인 덩어리는 요소도 그대로 쓴다 — 덩어리가 수백 개인 긴 답에서는 조각마다 요소를 새로 짓는 값이 든다.
  const made = useRef<ReactElement<MarkdownBlockProps>[]>([]);
  const elements = blocks.map((block, at) => {
    const tail = streaming && at === blocks.length - 1;
    const had = made.current[at];
    return had?.props.text === block && had.props.tail === tail ? had : <MarkdownBlock key={at} text={block} flowed={flowed} tail={tail} />;
  });
  made.current = elements;
  const groups: ReactElement[] = [];
  for (let at = GROUP_SIZE; at < elements.length; at += GROUP_SIZE) {
    groups.push(<BlockGroup key={`group-${at}`} items={elements.slice(at, at + GROUP_SIZE)} />);
  }
  return (
    <div className={cn("flex min-w-0 flex-col gap-3 wrap-anywhere", className)}>
      {elements.slice(0, GROUP_SIZE)}
      {groups}
    </div>
  );
}

export default memo(ThreadMarkdown);

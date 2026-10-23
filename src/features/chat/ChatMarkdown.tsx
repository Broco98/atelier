import { memo, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Check, Copy } from "lucide-react";
import { codeLang, hastText } from "@/lib/hast";
import { cn } from "@/lib/utils";

// 대화창의 마크다운 답(three-axes 티켓 17) — `agent_message_chunk`를 이어 붙인 글을 본문과 코드 블록으로 그린다. 값은 캔버스의
// `.cx-prose`(14/22.75 · 블록 사이 12 · 목록 pl 22 gap 4 · 인라인 코드 mono 13 pad 1 5)와 `.cx-code`다 — DS 토큰으로 적는다(three-axes
// 결정 31 · codex-ds 스펙 S2).
//
// **문서 보기(`SpecViewer`)의 표를 빌리지 않는다.** 그쪽은 문서용이고 원문 줄 위치를 모으는 플러그인이 딸려 있다. 답 안의 제목은
// 캔버스대로 24 · 18 · 16이다(DS `heading-lg` · `heading-sm` · `heading-xs`) — 한때 앱 글자 단계에 그 크기가 없어 15 하나로 모았다(구현
// 노트 「화면 부품과 설정」 §3).
//
// 링크는 바깥 URL만 연다 — Tauri 웹뷰에서 `<a>`가 그대로 주소를 바꾸면 앱이 그 페이지로 간다. 답 본문 안의 문서 링크(spec 파일의
// 상대 경로 · `file:`)는 열지 않는다 — 누르면 아무 일도 없다. 스펙 창으로 여는 문서 링크는 도구 줄의 파일 링크(티켓 18)와 알약
// 목록의 파일 링크(티켓 26)에만 있고(`chat` 탭(티켓 24)에서 눌러도 같다), 답 본문의 링크를 스펙 창에 잇는 일은 남아 있다.

/** 0.5px 가름선 — 턴의 머리줄 아래 · 답 안의 `---`(DS `.at-hr` — `border-heavy`). 0.5px 테두리는 엔진마다 굵기가 갈려 면으로 칠한다. */
export const RULE = "h-[0.5px] shrink-0 border-0 bg-border-heavy";

const components: Components = {
  h1: ({ children }) => <h3 className="text-heading-lg">{children}</h3>,
  h2: ({ children }) => <h3 className="text-heading-sm">{children}</h3>,
  h3: ({ children }) => <h3 className="text-heading-xs">{children}</h3>,
  h4: ({ children }) => <h4 className="text-heading-xs">{children}</h4>,
  h5: ({ children }) => <h5 className="text-heading-xs">{children}</h5>,
  h6: ({ children }) => <h6 className="text-heading-xs">{children}</h6>,
  ul: ({ children }) => <ul className="flex list-disc flex-col gap-1 pl-5.5 marker:text-fg-tertiary">{children}</ul>,
  ol: ({ children }) => <ol className="flex list-decimal flex-col gap-1 pl-5.5 marker:text-fg-tertiary">{children}</ol>,
  strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-[3px] border-rule pl-4 text-fg-secondary">{children}</blockquote>
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
  th: ({ children }) => (
    <th className="border-b border-rule py-2 pr-4 text-left font-semibold">{children}</th>
  ),
  td: ({ children }) => (
    <td className="relative py-2 pr-4 align-top after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[0.5px] after:bg-border">
      {children}
    </td>
  ),
  // 코드 블록 — 안쪽 `<code>`를 여기서 직접 쓴다. `children`을 그리면 언어를 안 적은 블록이 아래 인라인 갈래로 빠진다
  // (`SpecViewer`의 같은 자리에 적힌 사고).
  pre: ({ node }) => {
    const code = node?.children?.[0];
    return <CodeBlock lang={codeLang(code)} code={hastText(code).replace(/\n$/, "")} />;
  },
  code: ({ children }) => (
    <code className="rounded-xs bg-fill-soft px-1.25 py-px font-mono text-code wrap-anywhere">
      {children}
    </code>
  ),
};

/** 코드 블록 — 머리(언어 · 복사)와 고정폭 본문. 캔버스 `.cx-code`(옅은 면 · 안쪽 테두리 한 겹)다. */
function CodeBlock({ lang, code }: { lang: string | undefined; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <figure className="rounded-xl bg-surface-code inset-ring inset-ring-border-light">
      <div className="flex items-center gap-2 pb-1 pl-4 pr-3 pt-3 text-xs text-fg-secondary">
        <span className="min-w-0 flex-1 truncate">{lang ?? "코드"}</span>
        <button
          type="button"
          aria-label="코드 복사"
          onClick={() => {
            void navigator.clipboard?.writeText(code).then(() => setCopied(true));
          }}
          className="icon-button-quiet icon-button-xs text-fg-tertiary focus-ring"
        >
          {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
        </button>
      </div>
      <pre className="overflow-x-auto px-4 pb-4 pt-1.5 font-mono text-code scroll-quiet">
        <code className={lang ? `language-${lang}` : undefined}>{code}</code>
      </pre>
    </figure>
  );
}

/** 답 한 덩어리. 흐르는 동안 글이 늘 때마다 다시 그리므로 같은 글이면 건너뛴다. */
function ChatMarkdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-3 wrap-anywhere", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default memo(ChatMarkdown);

import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { AlignLeft, Check, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpecFile } from "./hooks";
import MermaidBlock from "./MermaidBlock";
import SpecTree from "./SpecTree";
import type { WorkView } from "./types";

interface SpecViewerProps {
  work: WorkView;
}

function defaultFile(files: string[]): string | null {
  if (files.includes("overview.md")) return "overview.md";
  return files[0] ?? null;
}

function SpecViewer({ work }: SpecViewerProps) {
  const files = work.specFiles;
  const [selected, setSelected] = useState<string | null>(null);
  // 파일이 삭제되면 기본 파일로 폴백
  const current = selected && files.includes(selected) ? selected : defaultFile(files);
  const [showSource, setShowSource] = useState(false);
  const [treeOpen, setTreeOpen] = useState(true);
  const { data: content } = useSpecFile(work.slug, current);

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const showToast = (message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1600);
  };
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const copyRef = (start: number, end: number) => {
    const range = end > start ? `L${start}-${end}` : `L${start}`;
    const ref = `spec/${current}:${range}`;
    navigator.clipboard.writeText(ref);
    showToast(`${ref} 복사됨`);
  };

  if (files.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center p-10">
        <div className="flex max-w-[440px] flex-col items-center gap-[7px] text-center">
          <div className="mb-2.5 flex size-[46px] items-center justify-center rounded-[16px] border bg-inset text-tertiary">
            <FileText className="size-5" strokeWidth={1.6} />
          </div>
          <span className="text-[16.5px] font-semibold tracking-[-0.01em]">아직 spec이 없어요</span>
          <span className="text-[14px] leading-[1.65] text-tertiary">
            AI가 아래 폴더에 문서를 작성하면 여기 표시돼요.
          </span>
          <code className="mt-2 select-all rounded-[9px] border bg-inset px-2.5 py-1.5 font-mono text-[12px] text-muted-foreground">
            ~/.atelier/works/{work.slug}/spec/
          </code>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      {/* 파일 스트립 */}
      <div className="flex h-10 shrink-0 items-center justify-between gap-2.5 border-b px-3.5">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-mono text-[12.5px] text-muted-foreground">
            spec/{current}
          </span>
          <span className="shrink-0 text-[11.5px] text-tertiary">
            · 블록을 클릭하면 참조가 복사돼요
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => setTreeOpen((v) => !v)}
            title={treeOpen ? "파일 트리 접기" : "파일 트리 펼치기"}
            className={cn(
              "flex size-[26px] items-center justify-center rounded-[9px] border transition-colors hover:bg-accent",
              treeOpen ? "text-primary" : "text-tertiary",
            )}
          >
            <AlignLeft className="size-3.5" strokeWidth={1.8} />
          </button>
          <button
            type="button"
            onClick={() => setShowSource((v) => !v)}
            className={cn(
              "h-[26px] rounded-[9px] border px-[9px] text-[12.5px] transition-colors hover:bg-accent",
              showSource ? "bg-accent text-foreground" : "text-tertiary",
            )}
          >
            소스
          </button>
          <button
            type="button"
            onClick={() => {
              navigator.clipboard.writeText(`spec/${current}`);
              showToast(`spec/${current} 복사됨`);
            }}
            className="h-[26px] rounded-[9px] border px-[9px] text-[12.5px] text-tertiary transition-colors hover:bg-accent hover:text-muted-foreground"
          >
            경로 복사
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {showSource ? (
          <SourceView content={content ?? ""} />
        ) : (
          <PrettyView content={content ?? ""} onCopyBlock={copyRef} />
        )}
      </div>

      {treeOpen && (
        <aside className="absolute right-3.5 top-[52px] z-10 flex max-h-[calc(100%-66px)] w-[232px] flex-col overflow-hidden rounded-[14px] border bg-panel shadow-lg">
          <div className="flex h-[38px] shrink-0 items-center border-b px-3.5">
            <span className="font-mono text-[12px] text-tertiary">spec/</span>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-1.5">
            <SpecTree files={files} current={current} onSelect={setSelected} />
          </div>
        </aside>
      )}

      {toast && (
        <div className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-[10px] border border-border-strong bg-background px-3.5 py-2 text-[12.5px] shadow-lg">
          <Check className="size-3.5 text-green-700" strokeWidth={2.4} />
          {toast}
        </div>
      )}
    </div>
  );
}

// ─── 소스 보기 ───

function SourceView({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    <div className="px-3.5 py-4 font-mono text-[12.5px] leading-[1.75]">
      {lines.map((line, i) => (
        <div key={i} className="grid grid-cols-[52px_1fr] gap-3.5">
          <span className="select-none text-right text-tertiary">{i + 1}</span>
          <span className="whitespace-pre text-muted-foreground">{line}</span>
        </div>
      ))}
    </div>
  );
}

// ─── 예쁜 보기 ───

interface PrettyViewProps {
  content: string;
  onCopyBlock: (start: number, end: number) => void;
}

// 클릭 → 참조 복사되는 최상위 블록 래퍼 (좌측 거터에 원본 라인 범위)
function BlockWrapper({
  start,
  end,
  spacing,
  onCopy,
  children,
}: {
  start: number;
  end: number;
  spacing: string;
  onCopy: (start: number, end: number) => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onClick={() => onCopy(start, end)}
      className={cn(
        "relative -mx-3 cursor-copy rounded-[9px] px-3 py-1 transition-colors hover:bg-accent",
        spacing,
      )}
    >
      <span className="absolute -left-[30px] top-[9px] w-[34px] select-none text-right font-mono text-[10.5px] text-tertiary opacity-65">
        {end !== start ? `${start}–${end}` : start}
      </span>
      {children}
    </div>
  );
}

function PrettyView({ content, onCopyBlock }: PrettyViewProps) {
  // 최상위 블록의 시작 라인 집합 — 중첩 블록(인용 안 문단 등)은 래핑하지 않기 위해
  const topLines = useRef<Set<number>>(new Set());
  const collectTopLevel = () => (tree: { children: { position?: { start: { line: number } } }[] }) => {
    topLines.current = new Set(
      tree.children.map((c) => c.position?.start.line).filter((n): n is number => n !== undefined),
    );
  };

  const components = useMemo(() => {
    // react-markdown 컴포넌트 props에서 소스 라인 범위를 꺼낸다 — hast 노드라 any로 좁힌다
    const lines = (node: any): { start: number; end: number } | null => {
      const start: number | undefined = node?.position?.start?.line;
      if (start === undefined || !topLines.current.has(start)) return null;
      return { start, end: node?.position?.end?.line ?? start };
    };

    const block =
      (Tag: keyof React.JSX.IntrinsicElements, className: string, spacing: string) =>
      ({ node, children, ...props }: any) => {
        const el = (
          <Tag className={className} {...props}>
            {children}
          </Tag>
        );
        const range = lines(node);
        if (!range) return el;
        return (
          <BlockWrapper start={range.start} end={range.end} spacing={spacing} onCopy={onCopyBlock}>
            {el}
          </BlockWrapper>
        );
      };

    const components: Components = {
      h1: block("h1", "text-[26px] font-bold tracking-[-0.018em]", ""),
      h2: block("h2", "text-[18px] font-semibold tracking-[-0.01em]", "mt-6"),
      h3: block("h3", "text-[15.5px] font-semibold", "mt-4"),
      h4: block("h4", "text-[14px] font-semibold", "mt-3"),
      p: block("p", "leading-[1.7] text-muted-foreground", "mt-1.5"),
      ul: block("ul", "flex list-disc flex-col gap-1.5 pl-[22px] leading-[1.7] text-muted-foreground", "mt-1.5"),
      ol: block("ol", "flex list-decimal flex-col gap-1.5 pl-[22px] leading-[1.7] text-muted-foreground", "mt-1.5"),
      blockquote: block(
        "blockquote",
        "border-l-2 border-border-strong pl-3.5 text-muted-foreground",
        "mt-1.5",
      ),
      hr: block("hr", "border-border", "mt-4"),
      table: block("table", "w-full border-collapse text-[13.5px]", "mt-2"),
      th: ({ children }) => (
        <th className="border-b border-border-strong px-3 py-2 text-left text-[12.5px] font-medium text-tertiary">
          {children}
        </th>
      ),
      td: ({ children }) => (
        <td className="border-b px-3 py-2 text-muted-foreground">{children}</td>
      ),
      a: ({ children, href }) => (
        <a href={href} target="_blank" rel="noreferrer" className="text-primary hover:underline">
          {children}
        </a>
      ),
      pre: (({ node, children, ...props }: any) => {
        const code = node?.children?.[0];
        const lang: string | undefined = code?.properties?.className
          ?.find?.((c: string) => c.startsWith("language-"))
          ?.slice("language-".length);
        const inner =
          lang === "mermaid" ? (
            <MermaidBlock code={hastText(code)} />
          ) : (
            <pre
              className="overflow-x-auto rounded-[12px] border bg-inset px-4 py-3.5 font-mono text-[12.5px] leading-[1.7]"
              {...props}
            >
              {children}
            </pre>
          );
        const range = lines(node);
        if (!range) return inner;
        return (
          <BlockWrapper start={range.start} end={range.end} spacing="mt-2" onCopy={onCopyBlock}>
            {inner}
          </BlockWrapper>
        );
      }) as Components["pre"],
      code: ({ children, className }) =>
        className?.includes("language-") ? (
          <code className={className}>{children}</code>
        ) : (
          <code className="rounded-[6px] border bg-inset px-[5px] py-px font-mono text-[0.88em]">
            {children}
          </code>
        ),
    };
    return components;
  }, [onCopyBlock]);

  return (
    <article className="max-w-[820px] px-10 pb-16 pl-[62px] pt-8 text-[15px]">
      <ReactMarkdown remarkPlugins={[remarkGfm, collectTopLevel]} components={components}>
        {content}
      </ReactMarkdown>
    </article>
  );
}

// hast 노드에서 텍스트만 추출 (mermaid 코드 등)
function hastText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; value?: string; children?: unknown[] };
  if (n.type === "text") return n.value ?? "";
  return (n.children ?? []).map(hastText).join("");
}

export default SpecViewer;

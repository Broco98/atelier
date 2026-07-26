import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpecFile } from "./hooks";
import { specRef } from "./refs";
import MermaidBlock from "./MermaidBlock";
import WorkPanel from "./WorkPanel";
import type { WorkView } from "./types";

interface SpecViewerProps {
  work: WorkView;
  showSource: boolean;
  panelOpen: boolean;
}

function defaultFile(files: string[]): string | null {
  if (files.includes("overview.md")) return "overview.md";
  return files[0] ?? null;
}

function SpecViewer({ work, showSource, panelOpen }: SpecViewerProps) {
  const files = work.specFiles;
  const [selected, setSelected] = useState<string | null>(null);
  // 파일이 삭제되면 기본 파일로 폴백
  const current = selected && files.includes(selected) ? selected : defaultFile(files);
  const { data: content } = useSpecFile(work.slug, current);
  // 결정 6: 비-md 파일은 마크다운 렌더 대신 줄번호 코드뷰 고정 ("소스" 토글과 무관)
  const isMarkdown = current?.toLowerCase().endsWith(".md") ?? true;

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const showToast = useCallback((message: string) => {
    setToast(message);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 1600);
  }, []);
  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  // 참조가 안정적이어야 토스트 표시/해제 리렌더 때 마크다운 트리가 리마운트(깜빡임)되지 않는다
  const copyText = useCallback(
    (text: string) => {
      navigator.clipboard.writeText(text);
      showToast(`${text} 복사됨`);
    },
    [showToast],
  );

  const copyRef = useCallback(
    (start: number, end: number) => {
      if (!current) return;
      copyText(specRef(work.slug, current, start, end));
    },
    [work.slug, current, copyText],
  );

  return (
    <div className="flex min-h-0 flex-1">
      {/* 본문 영역 — 스크롤 경계는 여기까지다. 작업 패널은 형제라 본문과 함께 스크롤되지 않는다 */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {/* 넓은 콘텐츠는 자기 안에서 가로 스크롤한다 — 이 영역은 가로로 확장되지 않는다 */}
        <div className="min-h-0 flex-1 overflow-y-auto scroll-quiet">
          <div className="flex min-h-full min-w-0 flex-col">
            {files.length === 0 ? (
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
            ) : showSource || !isMarkdown ? (
              <SourceView content={content ?? ""} />
            ) : (
              <PrettyView content={content ?? ""} onCopyBlock={copyRef} />
            )}
          </div>
        </div>

        {toast && (
          <div className="absolute bottom-5 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-[10px] border border-border-strong bg-background px-3.5 py-2 text-[12.5px] shadow-lg">
            <Check className="size-3.5 text-green-700" strokeWidth={2.4} />
            {toast}
          </div>
        )}
      </div>

      {panelOpen && (
        <WorkPanel
          work={work}
          currentFile={current}
          onSelectFile={setSelected}
          onCopy={copyText}
        />
      )}
    </div>
  );
}

// ─── 소스 보기 ───

function SourceView({ content }: { content: string }) {
  const lines = content.split("\n");
  return (
    // 본문 열 규격은 예쁜 보기와 같은 것을 쓴다 — 세로 여백만 소스 보기의 값이다.
    <div className={cn(bodyColumn, "py-4")}>
      {/* 가로 스크롤은 여기서 끝난다 — 본문 스크롤 영역은 가로로 확장되지 않는다 */}
      <div className="overflow-x-auto font-mono text-[12.5px] leading-[1.75] [tab-size:4] scroll-quiet">
        {/* 폭의 단일 출처 — 가장 긴 줄이 폭을 정하고 모든 줄이 그 폭을 그대로 받는다 */}
        <div className="w-max min-w-full">
          {lines.map((line, i) => (
            <div key={i} className="flex">
              {/* 줄번호는 스크롤포트 왼쪽에 고정된다. 표시 전용 정보이지 버튼이 아니다 */}
              <span className="sticky left-0 z-10 w-[66px] shrink-0 select-none bg-background pr-3.5 text-right text-tertiary">
                {i + 1}
              </span>
              <span className="whitespace-pre text-muted-foreground">{line}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── 예쁜 보기 ───

// 본문 열 레이아웃 규격 — 예쁜 보기와 소스 보기가 공유하는 단일 출처.
// w-full: 부모가 column-flex인데 mx-auto가 붙으면 stretch가 꺼져 폭이 fit-content로
//   잡힌다. 짧은 문서에서 열이 쪼그라들어 두 보기의 좌우 위치가 어긋나는 걸 막는다.
// 좌우가 비대칭인 이유: 좌측 62px은 여백이 아니라 거터의 자리다.
//   세 자리 줄범위 "123–145"는 10.5px mono(0.6em/자)에서 44.1px이고
//   본문과 16px 떨어져야 하므로, 62px은 줄일 수 있는 값이 아니라 하한이다.
export const bodyColumn = "mx-auto w-full max-w-[900px] pl-[62px] pr-10";

interface PrettyViewProps {
  content: string;
  onCopyBlock: (start: number, end: number) => void;
}

// 최상위 블록 래퍼 — 본문은 어떤 포인터 제스처도 가로채지 않는다.
// 참조 복사는 좌측 거터의 버튼이 맡고, 블록에 접근(호버·키보드 포커스)할 때만 나타난다.
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
  const range = end !== start ? `${start}–${end}` : `${start}`;
  return (
    <div className={cn("group relative py-1", spacing)}>
      {/* 거터는 본문 좌측 여백(bodyColumn의 pl) 안쪽에 오른쪽 정렬로 얹힌다 —
          줄범위가 길어지면 왼쪽으로 자라고 본문과의 간격 16px은 그대로다 */}
      <button
        type="button"
        onClick={() => onCopy(start, end)}
        aria-label={`${range}줄 참조 복사`}
        title={`${range}줄 참조 복사`}
        className="absolute right-full top-[9px] mr-4 cursor-copy select-none whitespace-nowrap rounded-[4px] font-mono text-[10.5px] text-tertiary opacity-0 outline-none transition-opacity hover:text-foreground group-hover:opacity-100 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {range}
      </button>
      {children}
    </div>
  );
}

// memo: 토스트 등 뷰어 상태 변화에 content·onCopyBlock이 그대로면 재파싱·리마운트를 건너뛴다
const PrettyView = memo(function PrettyView({ content, onCopyBlock }: PrettyViewProps) {
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
      // 넓은 표는 자기 안에서만 가로로 스크롤한다 — 본문 스크롤 영역은 가로로 확장되지 않는다
      table: (({ node, children, ...props }: any) => {
        const inner = (
          <div className="overflow-x-auto scroll-quiet">
            <table className="w-full border-collapse text-[13.5px]" {...props}>
              {children}
            </table>
          </div>
        );
        const range = lines(node);
        if (!range) return inner;
        return (
          <BlockWrapper start={range.start} end={range.end} spacing="mt-2" onCopy={onCopyBlock}>
            {inner}
          </BlockWrapper>
        );
      }) as Components["table"],
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
              className="overflow-x-auto rounded-[12px] border bg-inset px-4 py-3.5 font-mono text-[12.5px] leading-[1.7] scroll-quiet"
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
          <code className="rounded-[6px] border bg-inset px-[5px] py-px font-mono text-[0.88em] wrap-anywhere">
            {children}
          </code>
        ),
    };
    return components;
  }, [onCopyBlock]);

  return (
    <article className={cn(bodyColumn, "pb-16 pt-8 text-[15px]")}>
      <ReactMarkdown remarkPlugins={[remarkGfm, collectTopLevel]} components={components}>
        {content}
      </ReactMarkdown>
    </article>
  );
});

// hast 노드에서 텍스트만 추출 (mermaid 코드 등)
function hastText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; value?: string; children?: unknown[] };
  if (n.type === "text") return n.value ?? "";
  return (n.children ?? []).map(hastText).join("");
}

export default SpecViewer;

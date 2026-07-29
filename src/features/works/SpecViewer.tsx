import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Copy, FileText } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSpecFile } from "./hooks";
import { specRef } from "./refs";
import MermaidBlock from "./MermaidBlock";
import SpecTable, { ColumnResizeHandle } from "./SpecTable";
import WorkPanel, { PANEL_ANIM_MS } from "./WorkPanel";
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

  // 패널은 닫는 즉시 사라지면 퇴장 애니메이션을 재생할 틈이 없다 — 길이만큼 언마운트를 늦춘다.
  // 늦출 뿐 끝내 언마운트하므로, 스펙 트리의 접힘이 패널 토글을 넘지 않는다는 계약은 그대로다.
  const [panelMounted, setPanelMounted] = useState(panelOpen);
  useEffect(() => {
    if (panelOpen) {
      setPanelMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setPanelMounted(false), PANEL_ANIM_MS);
    return () => window.clearTimeout(timer);
  }, [panelOpen]);

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
              <PrettyView file={current ?? ""} content={content ?? ""} onCopyBlock={copyRef} />
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

      {panelMounted && (
        <WorkPanel
          work={work}
          currentFile={current}
          onSelectFile={setSelected}
          onCopy={copyText}
          closing={!panelOpen}
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
      {/* 가로 스크롤은 여기서 끝난다 — 본문 스크롤 영역은 가로로 확장되지 않는다.
          -ml로 규격의 좌측 여백(62px)만큼 되돌린다 — 그 여백은 거터의 자리이고,
          소스 보기에서는 줄번호 열이 바로 그 자리를 채운다. 이래야 코드 첫 글자가
          예쁜 보기 본문과 같은 x에서 시작한다 (규격의 폭·최대폭·우측 여백은 그대로다) */}
      <div className="-ml-[62px] overflow-x-auto font-mono text-[12.5px] leading-[1.75] [tab-size:4] scroll-quiet">
        {/* 폭의 단일 출처 — 가장 긴 줄이 폭을 정하고 모든 줄이 그 폭을 그대로 받는다 */}
        <div className="w-max min-w-full">
          {lines.map((line, i) => (
            <div key={i} className="flex">
              {/* 줄번호는 스크롤포트 왼쪽에 고정된다. 표시 전용 정보이지 버튼이 아니다.
                  폭 62px · 우측 여백 16px → 숫자 오른쪽 끝이 예쁜 보기 거터와 같은 자리에 온다 */}
              <span className="sticky left-0 z-10 w-[62px] shrink-0 select-none bg-background pr-4 text-right text-tertiary">
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

// 목록 거터 — 불릿과 번호가 서는 자리다. 체크박스 항목은 불릿 대신 체크박스가 여기 선다.
// 둘은 반드시 함께 움직인다. 들여쓰기를 바꾸면 체크박스를 되돌리는 폭도 같이 바꿔야
// 체크박스 항목의 본문 첫 글자가 불릿 항목의 본문과 같은 x에 선다.
// 우측 여백 5px의 근거: 거터 22 - 체크박스 13 - 체크박스 뒤에 오는 공백 한 칸 4.17 = 4.83.
// 4.17px은 본문 글꼴(Geist 15px)에서 실측한 값이다 — 글꼴이나 본문 크기가 바뀌면 다시 재야 한다.
const listIndent = "pl-[22px]";
const checkboxGutter = "-ml-[22px] mr-[5px]";

interface PrettyViewProps {
  // 지금 보고 있는 파일 — 표의 열 폭이 문서를 넘어 살아남지 않게 하는 데만 쓴다
  file: string;
  content: string;
  onCopyBlock: (start: number, end: number) => void;
}

// 최상위 블록 래퍼 — 본문은 어떤 포인터 제스처도 가로채지 않는다.
// 참조 복사는 좌측 거터의 버튼이 맡는다. 줄번호는 항상 보이고(그 자체가 정보다),
// 블록에 접근하면 같은 자리에서 복사 아이콘으로 바뀌어 누를 수 있다는 걸 알린다.
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
          줄범위가 길어지면 왼쪽으로 자라고 본문과의 간격 16px은 그대로다.
          숫자와 아이콘을 grid 한 칸에 겹쳐 쌓아 트랙 폭을 긴 쪽(숫자)이 정한다 —
          교체되는 동안 상자 폭이 변하지 않아 아이콘이 숫자의 오른쪽 끝에 그대로 선다 */}
      <button
        type="button"
        onClick={() => onCopy(start, end)}
        aria-label={`${range}줄 참조 복사`}
        title={`${range}줄 참조 복사`}
        className="absolute right-full top-[9px] mr-4 grid cursor-copy select-none place-items-end rounded-[4px] font-mono text-[10.5px] text-tertiary outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="col-start-1 row-start-1 whitespace-nowrap group-hover:invisible group-focus-within:invisible">
          {range}
        </span>
        <Copy
          className="invisible col-start-1 row-start-1 size-3 group-hover:visible group-focus-within:visible"
          strokeWidth={1.8}
          aria-hidden
        />
      </button>
      {children}
    </div>
  );
}

// memo: 토스트 등 뷰어 상태 변화에 content·onCopyBlock이 그대로면 재파싱·리마운트를 건너뛴다
const PrettyView = memo(function PrettyView({ file, content, onCopyBlock }: PrettyViewProps) {
  // 지금 파일을 ref로 들고 간다 — components를 file에 의존시키면 렌더러 함수의 정체가
  // 파일마다 바뀌어, 표 하나 되돌리자고 마크다운 트리를 통째로 새로 마운트하게 된다.
  const fileRef = useRef(file);
  fileRef.current = file;

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
      ({ node, children, className: hastClass, ...props }: any) => {
        const el = (
          // hast가 들고 온 클래스는 덮지 않고 합친다 — remark-gfm이 체크박스가 든 목록의
          // ul·ol에 contains-task-list를 붙이는데, {...props}가 뒤에 오면 그게 이겨서
          // 목록 스타일(들여쓰기·불릿·행간)이 통째로 사라진다.
          <Tag className={cn(className, hastClass)} {...props}>
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
      ul: block("ul", `flex list-disc flex-col gap-1.5 ${listIndent} leading-[1.7] text-muted-foreground`, "mt-1.5"),
      ol: block("ol", `flex list-decimal flex-col gap-1.5 ${listIndent} leading-[1.7] text-muted-foreground`, "mt-1.5"),
      blockquote: block(
        "blockquote",
        "border-l-2 border-border-strong pl-3.5 text-muted-foreground",
        "mt-1.5",
      ),
      hr: block("hr", "border-border", "mt-4"),
      // 표는 가로 스크롤과 전체화면 확대와 열 폭 조절을 자기가 챙긴다 — 규격도 거기 있다.
      // key: 조절한 열 폭이 다른 문서로 넘어가지 않는다는 계약이 사는 자리다.
      // 오늘은 이게 없어도 초기화되긴 한다 — useSpecFile이 파일을 바꿀 때 내용을 한 번
      // 비우고 시작해서(hooks.ts의 placeholderData) 블록이 전부 새로 마운트되기 때문이다.
      // 그건 다른 파일의 로딩 정책일 뿐이라 언제든 바뀔 수 있다. 계약은 여기에 적어 둔다.
      // 같은 파일이 밖에서 수정돼 다시 읽힐 때는 내용만 갈리고 폭은 남는다.
      table: ({ node, children, ...props }) => {
        const inner = (
          <SpecTable key={fileRef.current} {...props}>
            {children}
          </SpecTable>
        );
        const range = lines(node);
        if (!range) return inner;
        return (
          <BlockWrapper start={range.start} end={range.end} spacing="mt-2" onCopy={onCopyBlock}>
            {inner}
          </BlockWrapper>
        );
      },
      // relative: 열 폭 손잡이가 이 칸의 오른쪽 끝(열 경계)에 서기 위한 기준 상자다
      th: ({ children }) => (
        <th className="relative border-b border-border-strong px-3 py-2 text-left text-[12.5px] font-medium text-tertiary">
          {children}
          <ColumnResizeHandle />
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
      // 체크박스 목록 — remark-gfm은 체크박스가 있는 항목의 li에만 task-list-item을 붙인다
      // (ul·ol 둘 다). 그 항목만 불릿을 지우므로 한 목록에 섞여 있어도 나머지는 그대로다.
      li: ({ node, children, className, ...props }) => (
        <li
          className={className?.includes("task-list-item") ? cn(className, "list-none") : className}
          {...props}
        >
          {children}
        </li>
      ),
      // 체크박스를 거터로 빼내 불릿이 서던 자리에 세운다 (근거는 checkboxGutter 위 주석).
      // 본문은 흐름에 남으므로 둘째 줄부터도 첫 줄과 같은 x에서 시작한다.
      // 마크다운이 만드는 input은 GFM 체크박스뿐이라(원시 HTML은 켜져 있지 않다) 분기하지 않는다.
      // disabled는 remark-gfm이 붙여 보낸 것을 그대로 둔다 — 눌러도 문서가 바뀌지 않는다.
      input: ({ node, ...props }) => (
        <input {...props} className={cn(checkboxGutter, "size-[13px] align-middle accent-primary")} />
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

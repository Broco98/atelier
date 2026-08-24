import { Children, cloneElement, isValidElement, memo, useCallback, useMemo, useRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { convertFileSrc } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import {
  Copy,
  FileText,
  ImageOff,
  Info,
  Lightbulb,
  MessageSquareWarning,
  OctagonAlert,
  TriangleAlert,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useHomeDir, useSpecFile } from "./hooks";
import { calloutKind, expandHome, resolveHref, resolveImageSrc } from "./doc-refs";
import type { CalloutKind } from "./doc-refs";
import { specRef } from "./refs";
import MermaidBlock from "./MermaidBlock";
import SpecTable, { ColumnResizeHandle } from "./SpecTable";
import type { WorkView } from "./types";

interface SpecViewerProps {
  work: WorkView;
  // 화면의 머리행(브레드크럼)을 **본문 열 안에** 그린다.
  //
  // 작업 패널은 머리행과 **같은 층의 옆 컬럼**이다 — 창 맨 위에서 시작해 아래까지
  // 내려온다. 그래서 머리행이 패널 위를 지나갈 수 없고, 화면이 그것을 자기 자리에서
  // 그리면 패널은 그 아래에서 시작하게 된다. 슬롯으로 받아 본문 열이 이고 있는 이유다.
  header?: React.ReactNode;
  // 본문이 넓어지는 조건 — 접을 수 있는 것을 **둘 다** 접었을 때만이다(결정 5·13).
  // 패널 자체는 이제 이 컴포넌트가 그리지 않지만(결정 49), 그 폭은 여전히 본문 폭을 정한다.
  panelOpen: boolean;
  sidebarOpen: boolean;
  // 보고 있는 문서. **주소가 정본이고**(이슈 #25) 없는 파일을 가리킬 때의 폴백까지
  // 화면(WorksPage)이 이미 풀어서 내려준다 — 트리의 "지금 이 문서" 표시와 본문이 같은
  // 값을 봐야 하고, 그 트리가 이제 형제 컬럼에 살기 때문이다.
  file: string | null;
  // 본문이 소스 보기인가. **버튼의 켜짐 그대로가 아니다** — 거기에 파일 종류가 얹혀 있다
  // (결정 6의 비-md 고정). 그 식도 화면이 든다: 켜짐은 패널 버튼이, 본문은 여기가 쓰는데
  // 둘의 공통 조상이 화면뿐이다.
  sourceView: boolean;
  // 문서 안 링크를 따라갈 때. 히스토리를 **만든다** — 따라 들어갔으면 돌아올 수 있어야 한다.
  // (히스토리를 만들지 않는 트리 훑기는 패널 쪽 길이라 여기를 지나지 않는다.)
  onNavigate: (path: string) => void;
  // 완성된 참조 문자열을 클립보드에 복사 (+토스트). 토스트 표면의 주인은 화면이다(결정 47).
  onCopy: (text: string) => void;
}

function SpecViewer({
  work,
  header,
  panelOpen,
  sidebarOpen,
  file,
  sourceView,
  onNavigate,
  onCopy,
}: SpecViewerProps) {
  // 화면을 비웠을 때만 넓어진다 — 사이드바 하나만 접은 상태는 아직 비운 것이 아니다
  const wide = !sidebarOpen && !panelOpen;
  const files = work.specFiles;
  const { data: content } = useSpecFile(work.slug, file);
  // 이미지가 읽힐 자리. 코어는 홈을 축약해 내려 주므로(`~/.atelier/…`) 펴 두어야 URL이 된다
  const { data: home } = useHomeDir();
  const specRoot = home ? expandHome(work.specDir, home) : null;

  const copyRef = useCallback(
    (start: number, end: number) => {
      if (!file) return;
      onCopy(specRef(work.slug, file, start, end));
    },
    [work.slug, file, onCopy],
  );

  return (
    // 본문 열 — 스크롤 경계는 여기까지다. 작업 패널은 이 열의 형제이고 **이제 화면이
    // 그린다**(결정 49). 머리행이 여기 안에 있는 것은 그대로다: 패널이 이 열의 형제이자
    // **머리행과 같은 층**이라(창 맨 위에서 시작한다) 머리행은 이 열의 폭만 차지해야 한다.
    //
    // 이 열을 감싸던 행(min-w-0을 들고 있던 자리)은 화면으로 올라갔다 — 그 행이 있던 이유가
    // "본문과 패널을 나란히 세우는 것" 하나였고, 그 일이 여기서 사라졌다.
    <main className="relative flex min-h-0 min-w-0 flex-1 flex-col">
      {header}
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
          ) : sourceView ? (
            <SourceView content={content ?? ""} wide={wide} />
          ) : (
            <PrettyView
              file={file ?? ""}
              content={content ?? ""}
              onCopyBlock={copyRef}
              wide={wide}
              files={files}
              onNavigate={onNavigate}
              specRoot={specRoot}
            />
          )}
        </div>
      </div>
    </main>
  );
}

// ─── 소스 보기 ───

// 아카이브 화면도 같은 두 보기를 쓴다 — 문서를 그리는 규칙이 갈라지면 같은 spec이
// 어디서 열렸느냐에 따라 다르게 보인다. 둘 다 work에 의존하지 않아 그대로 나간다.
export function SourceView({ content, wide = false }: { content: string; wide?: boolean }) {
  const lines = content.split("\n");
  return (
    // 본문 열 규격은 예쁜 보기와 같은 것을 쓴다 — 세로 여백만 소스 보기의 값이다.
    <div className={cn(bodyColumn(wide), "py-4")}>
      {/* 가로 스크롤은 여기서 끝난다 — 본문 스크롤 영역은 가로로 확장되지 않는다.
          -ml로 규격의 좌측 여백(48px)만큼 되돌린다 — 그 여백은 거터의 자리이고,
          소스 보기에서는 줄번호 열이 바로 그 자리를 채운다. 이래야 코드 첫 글자가
          예쁜 보기 본문과 같은 x에서 시작한다 (규격의 폭·최대폭·우측 여백은 그대로다) */}
      <div className="-ml-12 overflow-x-auto font-mono text-[12.5px] leading-[1.75] [tab-size:4] scroll-quiet">
        {/* 폭의 단일 출처 — 가장 긴 줄이 폭을 정하고 모든 줄이 그 폭을 그대로 받는다 */}
        <div className="w-max min-w-full">
          {lines.map((line, i) => (
            <div key={i} className="flex">
              {/* 줄번호는 스크롤포트 왼쪽에 고정된다. 표시 전용 정보이지 버튼이 아니다.
                  폭 48px · 우측 여백 16px → 숫자 오른쪽 끝이 예쁜 보기 거터 버튼의
                  오른쪽 끝과 같은 자리에 온다. 남는 32px이 네 자리 줄번호(30px)의 자리다 */}
              <span className="sticky left-0 z-10 w-12 shrink-0 select-none bg-background pr-4 text-right text-tertiary">
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
// 48px 대칭인 이유: 좌측은 여백이면서 동시에 거터의 자리다. 거터에서 줄범위 숫자가
//   사라진 뒤로 그 자리를 정하는 건 소스 보기의 줄번호 열이다 —
//   네 자리 "1024"는 12.5px mono(0.6em/자)에서 30px, 코드와 16px 떨어져야 하므로
//   46px이 하한이고 48px은 그 위의 가장 작은 대칭값이다. 더 줄이려면 줄번호 글자 크기부터 바꿔야 한다.
// 화면을 비웠는데 본문이 안 넓어지던 것을 없앤다 — 접을 수 있는 것을 **둘 다** 접었을
// 때만 넓어진다(결정 5·13). 원래 짝은 사이드바 + 목록 패널이었는데 nav 개편이 목록
// 컬럼을 지워, 그 자리를 작업 패널 접기가 물려받았다.
export const bodyColumn = (wide: boolean) =>
  cn("mx-auto w-full px-12", wide ? "max-w-[1200px]" : "max-w-[900px]");

// 목록 거터 — 불릿과 번호가 서는 자리다. 체크박스 항목은 불릿 대신 체크박스가 여기 선다.
// 둘은 반드시 함께 움직인다. 들여쓰기를 바꾸면 체크박스를 되돌리는 폭도 같이 바꿔야
// 체크박스 항목의 본문 첫 글자가 불릿 항목의 본문과 같은 x에 선다.
// 우측 여백 5px의 근거: 거터 22 - 체크박스 13 - 체크박스 뒤에 오는 공백 한 칸 4.17 = 4.83.
// 4.17px은 본문 글꼴(Geist 15px)에서 실측한 값이다 — 글꼴이나 본문 크기가 바뀌면 다시 재야 한다.
const listIndent = "pl-[22px]";
const checkboxGutter = "-ml-[22px] mr-[5px]";

interface PrettyViewProps {
  // 지금 보고 있는 파일 — 표의 열 폭이 문서를 넘어 살아남지 않게 하는 데 쓰고,
  // 문서 안 상대경로 링크를 푸는 기준이기도 하다
  file: string;
  content: string;
  onCopyBlock: (start: number, end: number) => void;
  // 접을 수 있는 것을 둘 다 접었나 — 본문 열이 넓어지는 조건 (결정 13)
  wide?: boolean;
  // 문서 간 링크의 존재 판정이 서는 자리 — 이 목록에 없는 경로는 missing이다.
  // 파일 시스템을 묻지 않는 이유는 이 목록이 감시자를 통해 이미 최신이기 때문이다.
  files: readonly string[];
  // 문서 링크를 눌렀을 때 갈 곳. 파일 선택은 뷰어가 소유하므로 트리의 현재 파일 표시도 따라온다
  onNavigate: (path: string) => void;
  // 이미지를 읽을 절대 경로의 기준. 모르면(아카이브 화면) 로컬 이미지는 그리지 않는다 —
  // 아카이브 목록은 경량이라 문서 위치를 담지 않는다.
  specRoot: string | null;
}

// 최상위 블록 래퍼 — 본문은 어떤 포인터 제스처도 가로채지 않는다.
// 참조 복사는 좌측 거터의 버튼이 맡는다. 거터는 평소 비어 있고, 블록에 접근할 때만
// 복사 아이콘이 나타난다 — 줄번호는 읽는 동안 계속 보일 이유가 없고, 정작 쓰이는 건
// 참조를 복사하는 순간뿐이다. 복사되는 참조 문자열은 숫자를 지우기 전과 완전히 같다.
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
      {/* 거터는 본문 좌측 여백(bodyColumn의 px) 안쪽에 오른쪽 정렬로 얹힌다 —
          버튼의 오른쪽 끝이 본문과 16px 떨어져, 소스 보기 줄번호의 오른쪽 끝과 같은 자리에 온다.
          top-1은 버튼 중심(4+12=16px)을 숫자가 있던 자리의 중심에 그대로 둔다.
          키보드로 도달했을 때도 보여야 하므로 focus-visible에서도 나타난다.

          이 버튼이 페이드로 뜨지 않는 것은 실수가 아니다 — 숨은 버튼은 즉시 나타나고 즉시
          사라진다(그 규칙은 icon-button-quiet이 갖는다: transition에 opacity가 없다).
          블록마다 버튼이 하나씩이고 거터라 x가 모두 같아서, 페이드를 걸면 블록을 옮겨 갈 때
          앞 버튼이 사라지는 페이드와 뒤 버튼이 나타나는 페이드가 겹친다. 같은 아이콘이 같은
          x에서 40px 아래로 크로스페이드하면 눈에는 버튼이 미끄러진 것으로 보인다
          (제보: "스르륵 뜨면서 움직이는 것처럼 보인다"). 배경·글자색은 계속 전환한다 —
          그건 한 버튼 안에서 일어나는 일이라 겹칠 상대가 없다 */}
      <button
        type="button"
        onClick={() => onCopy(start, end)}
        aria-label={`${range}줄 참조 복사`}
        title={`${range}줄 참조 복사`}
        className="icon-button-quiet absolute right-full top-1 mr-4 cursor-copy text-tertiary opacity-0 outline-none focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <Copy className="size-3" strokeWidth={1.8} aria-hidden />
      </button>
      {children}
    </div>
  );
}

// 블록의 시작 위치를 여는 열쇠 — 최상위를 담을 때와 꺼내 볼 때가 같은 문자열을 써야 한다
const blockKey = (line: number, column: number) => `${line}:${column}`;

// memo: 토스트 등 뷰어 상태 변화에 content·onCopyBlock이 그대로면 재파싱·리마운트를 건너뛴다
export const PrettyView = memo(function PrettyView({
  file,
  content,
  onCopyBlock,
  wide = false,
  files,
  onNavigate,
  specRoot,
}: PrettyViewProps) {
  // 지금 파일을 ref로 들고 간다 — components를 file에 의존시키면 렌더러 함수의 정체가
  // 파일마다 바뀌어, 표 하나 되돌리자고 마크다운 트리를 통째로 새로 마운트하게 된다.
  const fileRef = useRef(file);
  fileRef.current = file;

  // 링크 해석에 필요한 나머지도 같은 이유로 ref다. 파일 목록은 감시자가 폴더를 훑을
  // 때마다 새 배열로 도착하므로, components가 그것에 의존하면 스펙을 저장할 때마다
  // 본문이 통째로 다시 마운트된다.
  const linkRef = useRef({ files, onNavigate, specRoot });
  linkRef.current = { files, onNavigate, specRoot };

  // 최상위 블록의 시작 위치 집합 — 중첩 블록(인용 안 문단 등)은 래핑하지 않기 위해.
  // 라인만으로는 갈리지 않는다: "> 문단"은 인용과 그 안 문단의 시작 라인이 같아 둘 다
  // 최상위로 통과하고, 복사 버튼이 인용 들여쓰기만큼 어긋난 채 겹쳐 그려진다. 열까지 봐야 갈린다.
  const topBlocks = useRef<Set<string>>(new Set());
  const collectTopLevel =
    () => (tree: { children: { position?: { start: { line: number; column: number } } }[] }) => {
      topBlocks.current = new Set(
        tree.children
          .map((c) => c.position && blockKey(c.position.start.line, c.position.start.column))
          .filter((k): k is string => k !== undefined),
      );
    };

  const components = useMemo(() => {
    // react-markdown 컴포넌트 props에서 소스 라인 범위를 꺼낸다 — hast 노드라 any로 좁힌다
    const lines = (node: any): { start: number; end: number } | null => {
      const start: number | undefined = node?.position?.start?.line;
      const column: number | undefined = node?.position?.start?.column;
      if (start === undefined || column === undefined) return null;
      if (!topBlocks.current.has(blockKey(start, column))) return null;
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
      // 인용은 두 얼굴이다 — 첫 줄에 `[!TYPE]` 마커가 있으면 콜아웃, 없으면 지금 모양 그대로.
      // 마커가 있을 때**만** 갈리는 것이 이 자리의 계약이다: 기존 스펙들이
      // `> **커버:** …` 같은 평범한 인용을 많이 쓰고 있어, 그것들이 색을 갖는 순간 회귀다.
      blockquote: ({ node, children, className: hastClass, ...props }: any) => {
        const first = firstLineOf(node) ?? "";
        const callout = calloutKind(first);
        // 첫 줄은 머리글이 대신 말하므로 본문에서 걷어낸다. 걷어낼 수 없으면(null) 제목도
        // 쓰지 않는다 — 제목만 취하고 본문을 그대로 두면 같은 말이 두 번 보인다.
        const body = callout ? stripFirstLine(children, first.length) : null;
        const inner = callout ? (
          <Callout kind={callout.kind} title={body ? callout.title : null}>
            {body ?? children}
          </Callout>
        ) : (
          <blockquote
            className={cn("border-l-2 border-border-strong pl-3.5 text-muted-foreground", hastClass)}
            {...props}
          >
            {children}
          </blockquote>
        );
        const range = lines(node);
        if (!range) return inner;
        return (
          <BlockWrapper start={range.start} end={range.end} spacing="mt-1.5" onCopy={onCopyBlock}>
            {inner}
          </BlockWrapper>
        );
      },
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
      // 링크는 두 가지만 산다 — 문서 간 이동과 외부 URL (결정 3).
      // target="_blank"는 **Tauri 웹뷰에서 아무 일도 하지 않는다.** 그래서 여기가 직접 연다.
      // none(앵커·기타 스킴)도 기본 동작을 막는다 — 주소가 바뀌면 라우터가 반응한다.
      a: ({ children, href }) => {
        const target = resolveHref(fileRef.current, href, linkRef.current.files);
        if (target.kind === "missing") {
          return (
            <span
              title={`문서를 찾을 수 없어요 — ${target.path}`}
              className="text-tertiary underline decoration-dotted underline-offset-2"
            >
              {children}
            </span>
          );
        }
        return (
          <a
            href={href}
            onClick={(e) => {
              e.preventDefault();
              if (target.kind === "doc") linkRef.current.onNavigate(target.path);
              else if (target.kind === "external") void openUrl(target.url);
            }}
            className="text-primary hover:underline"
          >
            {children}
          </a>
        );
      },
      // 이미지 — 처리가 아예 없어 **스펙에 스크린샷을 붙여도 아무것도 나타나지 않았다.**
      // Tauri 웹뷰는 로컬 파일을 직접 읽지 못하므로 asset 프로토콜을 거친다. 어디까지
      // 읽을 수 있는지는 tauri.conf.json의 스코프가 정한다 — 아틀리에 데이터 폴더 아래뿐이다.
      img: ({ src, alt }) => {
        const source = resolveImageSrc(
          linkRef.current.specRoot,
          fileRef.current,
          typeof src === "string" ? src : undefined,
          linkRef.current.files,
        );
        // 깨진 아이콘 대신 무엇이 없는지 말한다 — 스펙을 쓰는 쪽이 경로를 고칠 수 있게.
        // **보여주는 것은 경로다.** 대체글이 있을 때 그것만 보여주면 정작 고쳐야 할
        // 문자열이 화면에 없어, 이 자리표시가 존재하는 이유가 사라진다.
        if (source.kind === "missing") {
          return (
            <span
              title={alt || undefined}
              className="inline-flex items-center gap-1.5 rounded-[8px] border border-dashed bg-inset px-2 py-1 align-middle font-mono text-[12px] text-tertiary"
            >
              <ImageOff className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
              {source.path ?? (typeof src === "string" && src ? src : alt || "이미지")}
            </span>
          );
        }
        return (
          <img
            src={source.kind === "url" ? source.url : convertFileSrc(source.path)}
            alt={alt}
            className="my-1 h-auto max-w-full rounded-[10px] border"
          />
        );
      },
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
    // pt-3: 블록 래퍼의 py-1(4px)을 더하면 첫 글자가 헤더 아래 16px에 온다 —
    // 소스 보기의 첫 줄(py-4)과 같은 y다. 좌우를 656px에서 맞춘 것과 같은 계약을
    // 세로에도 건다. 토글할 때 본문이 위아래로 튀지 않는다
    <article className={cn(bodyColumn(wide), "pb-16 pt-3 text-[15px]")}>
      <ReactMarkdown remarkPlugins={[remarkGfm, collectTopLevel]} components={components}>
        {content}
      </ReactMarkdown>
    </article>
  );
});

// ─── 콜아웃 ───

// 종류마다 다른 것은 아이콘·강조선·제목색 셋뿐이다. 배경을 두지 않는 이유는 인용과
// 형제로 보여야 하기 때문이다 — GitHub도 같은 자리에서 좌측 선과 제목색만 바꾼다.
// 라벨은 마커와 같은 영문이다: 같은 파일을 GitHub·Obsidian에서 열어도 같게 보이는 것이
// 이 다섯 종을 고른 이유였다 (결정 9).
//
// **색이 CSS 변수가 아닌 이유.** index.css의 스케일은 상태를 말하는 무채색 4단이라
// 다섯 종의 뜻을 담을 자리가 없고, 여기서 다섯 쌍을 새로 올리면 그 자체가 시각 어휘를
// 늘리는 일이다. 어휘를 정하는 것은 `ui-시각-통일` 계열 Work의 몫이므로, 그때까지는
// status.tsx가 배지 색을 직접 적은 것과 같은 자리에 둔다. 다크 값을 함께 적어 두는 것도
// 그 이유다 — index.css가 .dark 토큰을 이미 정의해 두었고, 여기만 따로 갈리면 안 된다.
const CALLOUT_STYLE: Record<
  CalloutKind,
  { label: string; Glyph: typeof Info; line: string; tone: string }
> = {
  NOTE: { label: "Note", Glyph: Info, line: "border-blue-500", tone: "text-blue-700 dark:text-blue-400" },
  TIP: {
    label: "Tip",
    Glyph: Lightbulb,
    line: "border-emerald-500",
    tone: "text-emerald-700 dark:text-emerald-400",
  },
  IMPORTANT: {
    label: "Important",
    Glyph: MessageSquareWarning,
    line: "border-violet-500",
    tone: "text-violet-700 dark:text-violet-400",
  },
  WARNING: {
    label: "Warning",
    Glyph: TriangleAlert,
    line: "border-amber-500",
    tone: "text-amber-700 dark:text-amber-400",
  },
  CAUTION: {
    label: "Caution",
    Glyph: OctagonAlert,
    line: "border-red-500",
    tone: "text-red-700 dark:text-red-400",
  },
};

function Callout({
  kind,
  title,
  children,
}: {
  kind: CalloutKind;
  // 없으면 종류 이름이 제목이다
  title: string | null;
  children: React.ReactNode;
}) {
  const { label, Glyph, line, tone } = CALLOUT_STYLE[kind];
  return (
    <div className={cn("border-l-2 pl-3.5 text-muted-foreground", line)}>
      <div className={cn("flex items-center gap-1.5 font-medium", tone)}>
        <Glyph className="size-4 shrink-0" strokeWidth={2} aria-hidden />
        {title ?? label}
      </div>
      {children}
    </div>
  );
}

// 인용문의 첫 줄. 첫 문단의 텍스트만 보므로 뒤따르는 문단·목록은 건드리지 않는다.
function firstLineOf(node: any): string | null {
  const paragraph = node?.children?.find((child: any) => child.type === "element");
  return paragraph ? hastText(paragraph).split("\n")[0] : null;
}

// 마커가 있던 첫 줄을 본문에서 걷어낸다. **걷어내지 못하면 null이다** — 그때는 부르는
// 쪽이 제목도 함께 포기해, 같은 말이 제목과 본문에 두 번 나오지 않게 한다.
//
// 걷어낼 수 있는 조건은 하나다: 첫 줄이 **한 조각의 문자열 안에 통째로** 들어 있을 것.
// 제목에 마크업이 섞이면(`> [!NOTE] 제목 **강조**`) 첫 줄이 여러 노드로 쪼개지는데,
// 길이는 납작하게 편 텍스트에서 재고 자르기는 첫 조각에만 하므로 앞부분만 잘려
// **강조가 본문에 남는다.** 그 모양을 막는 것이 길이 비교다.
function stripFirstLine(children: React.ReactNode, skip: number): React.ReactNode | null {
  const items = Children.toArray(children);
  const index = items.findIndex(isValidElement);
  if (index < 0) return null;
  const paragraph = items[index] as React.ReactElement<{ children?: React.ReactNode }>;
  const inner = Children.toArray(paragraph.props.children);
  if (typeof inner[0] !== "string" || inner[0].length < skip) return null;
  const rest = inner[0].slice(skip).replace(/^\n/, "");
  const next = rest ? [rest, ...inner.slice(1)] : inner.slice(1);
  // 마커 한 줄뿐인 문단은 통째로 뺀다 — 빈 문단이 남으면 머리글 아래가 벌어진다
  if (next.length === 0) return items.filter((_, i) => i !== index);
  return items.map((item, i) => (i === index ? cloneElement(paragraph, undefined, ...next) : item));
}

// hast 노드에서 텍스트만 추출 (mermaid 코드 등)
function hastText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as { type?: string; value?: string; children?: unknown[] };
  if (n.type === "text") return n.value ?? "";
  return (n.children ?? []).map(hastText).join("");
}

export default SpecViewer;

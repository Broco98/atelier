import {
  Children,
  cloneElement,
  isValidElement,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
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
import { PopoverPortal } from "@/components/ui/popover-portal";
import { cn } from "@/lib/utils";
import { useHomeDir, useSpecFile } from "./hooks";
import { calloutKind, docBody, expandHome, resolveHref, resolveImageSrc } from "./doc-refs";
import type { CalloutKind, DocBody } from "./doc-refs";
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
  // `[소스]`가 켜져 있는가 — **사람이 정한 값 그대로**다. 파일 종류를 얹는 일은 표
  // (`docBody`)가 하므로 화면은 식을 안 든다. 상태의 주인이 화면인 것은 그대로다:
  // 켜짐은 패널 버튼이, 본문은 여기가 쓰는데 둘의 공통 조상이 화면뿐이다.
  showSource: boolean;
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
  showSource,
  onNavigate,
  onCopy,
}: SpecViewerProps) {
  // 화면을 비웠을 때만 넓어진다 — 사이드바 하나만 접은 상태는 아직 비운 것이 아니다
  const wide = !sidebarOpen && !panelOpen;
  const files = work.specFiles;
  // 본문이 무엇으로 서는가 — **표가 정한다**(결정 7). 이 화면은 그 값으로 갈리기만 한다.
  //
  // **읽을지 말지도 그 값이다**: PNG를 UTF-8 문자열로 읽으면 쓸 수 없는 값이 오고, 화면은
  // 줄번호 `1` 하나만 있는 빈 소스 보기가 된다(실물에서 그랬다). 그림은 asset URL로 바로
  // 건다. 여기서 그림 판정을 따로 부르면 표가 바뀔 때 읽기만 옛 규칙을 따른다.
  const body = docBody(file, showSource);
  const { data: content } = useSpecFile(work.slug, body === "image" ? null : file);
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

  // 표의 값 하나가 본문 하나로 간다. **`switch`인 것이 계약이다** — 표에 칸이 하나 늘면
  // (`doc-refs.ts`의 표 머리말이 이미 다섯째 칸의 여지를 말한다) 여기가 컴파일에서 깨진다.
  // 마지막을 `else`로 두면 새 칸이 **조용히 소스 보기로** 떨어지고 아무 데서도 안 잡힌다.
  // 아카이브 화면에도 같은 네 갈래가 있고(인자와 근거가 갈려 한 컴포넌트로는 안 묶는다)
  // 거기도 같은 모양이다 — 칸이 늘면 두 자리가 함께 깨져야 한다.
  const bodyView = (body: DocBody): React.ReactNode => {
    switch (body) {
      case "image":
        return <ImageDoc path={specRoot && file ? `${specRoot}/${file}` : null} name={file ?? ""} />;
      case "html":
        // `?? ""`로 뭉개지 않는다 — 안 온 것과 빈 파일이 프레임 경로에서 갈린다(결정 9)
        return <HtmlDoc content={content} name={file ?? ""} />;
      case "pretty":
        return (
          <PrettyView
            file={file ?? ""}
            content={content ?? ""}
            onCopyBlock={copyRef}
            wide={wide}
            files={files}
            onNavigate={onNavigate}
            specRoot={specRoot}
          />
        );
      case "source":
        return <SourceView content={content ?? ""} wide={wide} />;
      // 반환 타입만으로는 빠진 칸이 안 잡힌다 — `ReactNode`가 `undefined`를 품는다. 이웃
      // `hitTarget`이 `default` 없이 사는 것은 그 반환 타입이 좁아서다.
      default: {
        const unhandled: never = body;
        return unhandled;
      }
    }
  };

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
          ) : (
            bodyView(body)
          )}
        </div>
      </div>
    </main>
  );
}

/**
 * 그림 한 장을 본문에 세운다 — 트리에서 그림 파일을 고른 자리.
 *
 * 자리표시의 모양과 문구는 본문 안 `![](…)`가 깨졌을 때와 **같은 것을 쓴다**(아래 `img`
 * 렌더러) — 같은 「그릴 수 없다」가 어디서 났느냐에 따라 달리 보이면 안 된다.
 *
 * `specRoot`를 모르면(아카이브 화면, 홈을 아직 못 읽음) 그릴 수 없다.
 *
 * 아카이브 화면도 이것을 쓴다 — 같은 표(`docBody`)로 갈리는데 그림 자리만 화면마다 다른
 * 것을 그리면 그 표가 「유일한 자리」가 아니게 된다. 아래 두 보기와 같은 근거다.
 */
export function ImageDoc({ path, name }: { path: string | null; name: string }) {
  return (
    <div className="flex flex-1 items-center justify-center p-8">
      {path === null ? (
        <span className="inline-flex items-center gap-1.5 rounded-[8px] border border-dashed bg-inset px-2 py-1 font-mono text-[12px] text-tertiary">
          <ImageOff className="size-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
          {name}
        </span>
      ) : (
        // `max-h-full`이 있어야 세로로 긴 그림이 본문을 넘어 스크롤을 만들지 않는다 —
        // 이 영역은 이미 스크롤 상자 안이라 두 겹이 되면 어느 쪽이 도는지가 갈린다.
        <img
          src={convertFileSrc(path)}
          alt={name}
          className="max-h-full max-w-full rounded-[10px] border object-contain"
        />
      )}
    </div>
  );
}

// ─── HTML 프레임 ───

/**
 * 아티팩트 발행 껍데기 — **발행 쪽에서 그대로 베낀 것이다**(결정 2).
 *
 * `data-theme="light"`를 박는 것은 앱이 라이트 전용이기 때문이다(결정 3). 아티팩트는
 * 뷰어의 명시적 선택을 root에 찍고 목업이 그 값으로 갈리므로, 이 값이 「뷰어가 라이트를
 * 골랐다」와 같은 상태가 되어 1:1이 성립한다.
 *
 * **전부 베끼는 근거는 「지금 이 파일」이 아니라 「다음 파일」이다.** 실측상 지금 목업이
 * 여기서 실제로 얻는 것은 `body{margin:0}` 한 줄뿐이지만(`srcdoc` 문서는 doctype이 없어도
 * quirks mode로 안 떨어져, 갈리는 것이 그 여백 하나다 — e2e/spec-html.spec.ts 머리말),
 * 앞으로 들어올 조각이 어느 줄에 기댈지는 미리 알 수 없고 비용은 CSS 네 줄이다.
 *
 * **아래 문자열은 발행본 원문에서 떠 온 것이다** — 2026-08-29, 그 목업의 발행본
 * (artifact `99087708`)의 `<head>`. 따옴표 유무까지 그대로다: 「근사해 그리지 않는다」가
 * 규칙이라(결정 2) 다음 사람이 발행본과 **문자열로** 견줄 수 있어야 한다. 발행 쪽의
 * 프레임 런타임 스크립트와 `<base>`는 안 베낀다 — 그것은 문서 리셋이 아니라 호스트다.
 * `<html>`에 `data-theme`는 발행 시점엔 없고 런타임이 뷰어 테마로 찍는다(결정 3).
 *
 * 처음 판은 이 값을 **말로 풀어 쓴 설명에서 근사해** 적었고 네 자리가 어긋나 있었다
 * (`background` `#fbfbfc`→`#faf9f5`, `color` 누락, 글꼴 `system-ui`, `padding:0` 누락,
 * `[hidden]`의 `:not([hidden=until-found])`). 목업은 배경·글자색·글꼴을 자기가 정해서
 * 화소로 안 갈렸지만(실측: 1000px 폭 12,800,000화소 전부 일치), **껍데기에 기대는 조각을
 * 하나 세우자 전 화소가 갈렸다** — 이 상수가 지키려던 「다음 파일」이 바로 그것이다.
 */
const ARTIFACT_SHELL_HEAD =
  '<!doctype html>\n<html data-theme="light">\n<head>\n' +
  '<meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1">\n' +
  "<style>:root{color-scheme:light}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#faf9f5;color:#141413}\n" +
  "img{max-width:100%}[hidden]:not([hidden=until-found]){display:none!important}</style>\n" +
  "</head><body>";
const ARTIFACT_SHELL_TAIL = "</body></html>";

/**
 * 파일 내용을 프레임이 항해할 문서로 만든다 — **껍데기는 없을 때만 씌운다**(결정 2).
 *
 * 내용이 `<!doctype` 또는 `<html`로 시작하면 온전한 문서로 보고 그대로 통과시킨다.
 * 온전한 문서에 껍데기를 또 씌우면 `<html>`이 겹치고, 반대로 늘 안 씌우면 아티팩트 조각이
 * 발행본과 갈린다. 가르는 값이 doctype 하나라 규칙이 한 줄이다.
 *
 * 판정은 **BOM과 선행 공백을 버린 뒤 대소문자를 무시한다** — spec 문서는 사람이 손으로도
 * 넣는 파일이라 셋 다 실재한다.
 */
export function htmlSrcdoc(content: string): string {
  const head = content.replace(/^\uFEFF/, "").trimStart().toLowerCase();
  if (head.startsWith("<!doctype") || head.startsWith("<html")) return content;
  return ARTIFACT_SHELL_HEAD + content + ARTIFACT_SHELL_TAIL;
}

/**
 * HTML 문서 한 장을 본문에 **렌더로** 세운다 — `ImageDoc`과 같은 자리, 같은 모양이다.
 *
 * 프레임은 본문 열을 채우고 **자기 안에서** 구른다(결정 9). 바깥 스크롤 상자는 넘치지
 * 않으므로 막대가 한 개만 산다. 좁은 열에서는 프레임 안이 가로로도 구른다 — 안 잘라낸다.
 * **본문 열 폭 규격(900/1200px)을 안 쓴다**: 아티팩트 1:1이 목적이다.
 *
 * **그 한 개는 저장소 공통 막대가 아니다 — 결정 32의 유일한 예외다.** 구르는 것은 프레임
 * **안** 문서라 `scroll-quiet`이 닿을 자리가 없고(그 문서의 CSS는 `ARTIFACT_SHELL_HEAD`가
 * 전부다), `allow-same-origin`이 없어 부모는 그 스크롤을 **볼 수도 없다**. 맞추려면 껍데기에
 * `scrollbar-width:none`을 얹어야 하는데 그것은 결정 2(「발행본 원문에서 떠 온 것이다 —
 * 따옴표 유무까지 그대로」)와 정면으로 부딪히고, 발행본도 브라우저에서 네이티브 막대로
 * 보이므로 1:1이 목적인 여기서는 네이티브가 오히려 맞다. `scroll-overlay.test.ts`의 소스
 * 스캔은 이 안을 **구조적으로 못 본다** — 그래서 예외가 여기 적혀 있어야 한다.
 *
 * 아카이브 화면도 이것을 쓴다 — 같은 표(`docBody`)로 갈리는데 프레임만 화면마다 다르면
 * 그 표가 「유일한 자리」가 아니게 된다.
 *
 * **감수 — 프레임에 포커스가 들어가면 앱 단축키가 죽는다**(결정 13 · 이슈 #153). ⌘1~9·⌃Tab·
 * ⌘B·⌘T·⌘W·⌘↩가 전부 부모 창의 리스너라 프레임 경계를 안 넘는다. **⇧⇧(검색 팔레트)도
 * 같이 죽는다** — 이 목록을 처음 적을 때는 그 키가 아직 없었고, 판 03이 들이면서 같은
 * 리스너에 붙었다. 프레임 밖을 한 번 클릭하면 돌아온다 — 뿌리는 iframe이 아니라 「단축키의
 * 정본이 JS window 리스너다」이고, 거기서 고친다.
 *
 * **「원인이 화면 어디에도 없다」는 이 판으로 거짓이 됐다** — 죽는 것은 그대로 죽고
 * (`FrameFocusHint` 머리말), 그 사실과 돌아오는 길을 화면이 말한다. 감수가 없어진 것이
 * 아니라 **보이게 된 것이다.**
 */
export function HtmlDoc({ content, name }: { content: string | undefined; name: string }) {
  // 카드가 붙을 앵커이자 「포커스가 여기 있나」의 대조 대상이다 — 훅이 이 ref로 잰다.
  const frameRef = useRef<HTMLIFrameElement>(null);
  // **훅은 이른 반환보다 위에 있어야 한다.** 아래 `content === undefined` 갈래가 훅을
  // 건너뛰면 렌더마다 훅 개수가 갈린다.
  const focused = useFrameFocused(frameRef);
  // **안 온 것과 빈 파일을 가른다.** 안 왔으면 아예 안 그린다 — 빈 문서로 한 번 항해했다
  // 다시 항해하는 깜빡임을 만들지 않는다(결정 9). 빈 문자열은 **온 것이라** 껍데기를
  // 씌워 그린다: `?? ""`로 뭉치면 진짜 빈 `.html`이 영영 빈 화면이 된다.
  if (content === undefined) return null;
  return (
    <>
      <iframe
        ref={frameRef}
        // 이름이 없으면 「프레임」으로만 읽힌다. 그림 본문이 `alt`에 파일 경로를 넣는
        // 관습을 그대로 따른다.
        title={name}
        // **React가 값으로만 넣는다**(결정 5). 마크업을 문자열로 조립하거나
        // `dangerouslySetInnerHTML`로 넣으면 파일 안의 따옴표가 속성을 깨고 나와 **부모
        // 문서에** 스크립트를 심고, 그 순간 아래 sandbox도 IPC 키도 우회된다.
        srcDoc={htmlSrcdoc(content)}
        // **값에 조건을 달지 않는다**(결정 5). 「신뢰하는 파일이면」 같은 갈래를 만드는 순간
        // 그 갈래가 구멍이다. `allow-scripts`는 필요하고(목업의 토글이 스크립트다),
        // `allow-same-origin`은 **주면 안 된다** — 둘을 함께 주면 프레임이 앱과 같은 출처가
        // 되어 부모에 있는 자기 sandbox 속성을 지우고 리로드할 수 있다(결정 4).
        sandbox="allow-scripts"
        className="min-h-0 w-full flex-1 border-0"
      />
      {focused && <FrameFocusHint anchorRef={frameRef} />}
    </>
  );
}

/**
 * 프레임이 지금 포커스를 쥐고 있는가 — **부모 `window`의 `blur`/`focus`로 알고,
 * `document.activeElement`로 가른다.**
 *
 * **`focusin`/`focusout`은 안 온다.** 프레임 안을 클릭했을 때 부모 문서가 받는 것은 그 둘이
 * 아니라 `window`의 `blur` 하나뿐이다 — L3로 쟀다(2026-08-30 · WebKit, 앱이 사는
 * WKWebView와 같은 엔진). 프로그램으로 `iframe.focus()`를 부를 때만 `focusin`이 온다.
 * 그러니 「프레임에 포커스가 갔다」를 그 둘로 들으면 사람이 클릭하는 실제 경로에서 한 번도
 * 안 선다. 대신 그 `blur` 핸들러 시점에 `activeElement`는 **이미** 그 `<iframe>`이다.
 *
 * **`blur`만으로도 못 가른다.** 다른 앱으로 넘어갈 때도 같은 이벤트가 오는데, 그때
 * `activeElement`는 프레임이 아니다(같은 실측). 그래서 이벤트는 「무엇인가 움직였다」만
 * 알리고 판정은 `activeElement`가 든다 — `focus` 쪽도 같은 이유로 같은 식이다(프레임 밖을
 * 클릭해 돌아온 것과, 프레임을 쥔 채 앱으로 돌아온 것이 갈린다).
 */
function useFrameFocused(frameRef: RefObject<HTMLIFrameElement | null>) {
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const sync = () => setFocused(document.activeElement === frameRef.current);
    window.addEventListener("blur", sync);
    window.addEventListener("focus", sync);
    return () => {
      window.removeEventListener("blur", sync);
      window.removeEventListener("focus", sync);
    };
  }, [frameRef]);
  return focused;
}

// 두 줄이 각각 한 번씩만 접히는 폭. 확인 창의 `w-[330px]`과 같은 가족이다.
const FRAME_HINT_WIDTH = 300;

/**
 * 프레임이 포커스를 쥔 **동안에만** 서서, 앱 단축키가 지금 안 먹는다는 것과 **돌아오는
 * 길**을 말한다 — 이슈 #153의 **완화**다. 근본 수정이 아니다: 단축키는 여전히 안 먹고,
 * 정본을 네이티브 메뉴로 올리는 일이 그 이슈에 남아 있다. 여기가 갚는 것은 그 이슈가 짚은
 * 다른 한 가지, 「원인이 화면 어디에도 없다」쪽이다.
 *
 * **#153이 이미 기각한 셋을 다시 걷지 않는다.** 포커스를 도로 안 뺏고(프레임 안 토글이
 * 계속 눌려야 한다 — 결정 4), 덮개를 안 두며(`pointer-events-none`이라 클릭이 그대로
 * 통과한다), 껍데기에 스크립트를 안 넣는다(그러면 doctype 있는 파일은 여전히 죽는다).
 *
 * 표면은 **새로 안 짓는다** — 호버 카드와 같은 `PopoverPortal`이다. `bottom`+`right`로
 * 프레임에 매면 그 카드의 화면 물리기 규칙이 창 오른쪽 아래로 끌어당겨, 프레임 위에 뜨되
 * 본문 시작 자리는 안 가린다. 등장 모션이 없는 것도 이 저장소의 떠 있는 표면 그대로다
 * (아카이브 토스트) — 움직이는 것이 없어 `prefers-reduced-motion`이 끌 것도 없다.
 */
function FrameFocusHint({ anchorRef }: { anchorRef: RefObject<HTMLIFrameElement | null> }) {
  return (
    <PopoverPortal
      anchorRef={anchorRef}
      align="right"
      width={FRAME_HINT_WIDTH}
      // **덮개가 아니라는 증거가 이 한 줄이다.** 포인터를 안 받으므로 카드 밑의 프레임이
      // 계속 눌린다. `onClose`도 안 넘긴다 — 그쪽은 바깥 클릭을 받는 투명 막을 함께 깔고,
      // 그 막이 곧 덮개다.
      className="pointer-events-none px-3.5 py-2.5"
    >
      {/* 살아 있는 동안 화면에 새로 뜬 말이라 `status`다 — 읽는 사람이 눈으로 못 잡아도 듣는다 */}
      <div data-frame-hint role="status" className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold tracking-[-0.01em]">앱 단축키가 지금 안 먹어요</span>
        <span className="text-[12.5px] leading-[1.6] text-tertiary">
          ⌘1~9·⌃Tab·⌘B·⌘T·⌘W·⌘↩·⇧⇧가 이 문서 안으로 들어가요. 문서 바깥을 한 번 클릭하면
          돌아와요.
        </span>
      </div>
    </PopoverPortal>
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
      pre: (({ node, ...props }: any) => {
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
              {/* **안쪽 `<code>`를 여기서 직접 쓴다 — `children`을 그리면 안 된다.**
                  아래 `code` 컴포넌트는 「`language-`가 없으면 인라인 코드」로 가르는데,
                  **언어를 안 적은 코드블록도 className이 없다.** 그대로 흘리면 여러 줄짜리
                  블록이 인라인 껍데기(테두리·둥근 모서리·배경·0.88em)를 뒤집어쓰고, 인라인
                  요소의 테두리가 줄마다 끊겨 **줄 사이에 선이 그어진 것처럼** 보인다
                  (실물에서 그렇게 났다 — 사람이 「이상하게 겹친거잖아?」라고 지적한 그 화면).
                  ```mermaid처럼 언어를 적은 블록은 멀쩡해서 오래 안 걸렸다.

                  우리가 JSX로 쓴 이 `<code>`는 마크다운 변환을 안 거치므로 그 갈래에 아예
                  들어가지 않는다. `language-*`는 그대로 실어 둔다 — 지금 읽는 것은 없지만
                  하이라이팅을 붙이는 날 그 이름이 붙을 자리다. */}
              <code className={lang ? `language-${lang}` : undefined}>{hastText(code)}</code>
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

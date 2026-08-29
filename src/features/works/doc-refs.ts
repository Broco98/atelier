// 본문 문서 안의 참조를 해석하는 자리. 렌더 컴포넌트는 여기가 돌려준 결정을 그리기만 한다.
//
// refs.ts와 헷갈리지 말 것 — 그쪽은 아틀리에 **밖으로 내보내는** 참조 문자열
// (`~/.atelier/works/…:L19`)을 조립하고, 여기는 문서 **안에서 읽은** 링크·이미지 경로를
// 앱이 아는 것으로 되돌린다. 방향이 반대다.

export type HrefTarget =
  | { kind: "doc"; path: string } // spec 루트 기준 상대경로. 앱 안에서 연다
  | { kind: "external"; url: string } // 기본 브라우저로 넘긴다
  | { kind: "missing"; path: string } // spec 안이지만 목록에 없다
  | { kind: "none" }; // 앵커·기타 스킴 — 렌더만 하고 아무 동작도 하지 않는다

/**
 * spec 루트 기준으로 상대경로를 편다. 루트를 벗어나면 null.
 *
 * `base`는 기준이 되는 **디렉터리**다(빈 문자열이면 루트). 결과에 `.`과 빈 조각은 남지 않는다.
 */
function normalizePath(base: string, relative: string): string | null {
  const segments = [...base.split("/"), ...relative.split("/")];
  const out: string[] = [];
  for (const segment of segments) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      // 루트 위로는 못 올라간다 — spec 밖은 이 앱이 열 수 있는 곳이 아니다
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(segment);
  }
  return out.join("/");
}

/**
 * 마크다운 렌더러가 퍼센트 인코딩해 넘긴 경로를 파일 목록의 이름으로 되돌린다.
 *
 * 판 폴더 이름이 한글이라(`01-삭제-관통/`) 이 되돌리기가 없으면 **모든 판 문서 링크가
 * missing이 된다** — mdast→hast 변환이 비ASCII를 통째로 인코딩하기 때문이다.
 * 잘못된 인코딩은 그대로 두고 넘긴다(그 경우 목록에 없어 missing으로 떨어진다).
 */
function decodePath(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * 문서 안의 링크 하나를 앱이 할 수 있는 일로 바꾼다.
 *
 * 존재 판정에 파일 시스템을 묻지 않는다 — `files`가 감시자를 통해 이미 최신이다.
 */
export function resolveHref(
  currentFile: string | null,
  href: string | undefined,
  files: readonly string[],
): HrefTarget {
  if (!href) return { kind: "none" };
  if (/^https?:\/\//i.test(href)) return { kind: "external", url: href };
  // 앵커 단독은 같은 문서 안 이동이라 범위 밖. 스킴이 붙은 나머지(mailto:·file:·javascript:)도 여기서 걸린다
  if (href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(href)) return { kind: "none" };
  // 기준 문서가 없으면 상대경로를 풀 자리가 없다
  if (!currentFile) return { kind: "none" };

  // 경로 뒤에 붙은 앵커·쿼리는 떼고 문서만 연다. 앵커로 스크롤하지는 않는다(범위 밖)
  const path = href.split(/[#?]/)[0];
  if (!path) return { kind: "none" };

  const dir = currentFile.includes("/") ? currentFile.slice(0, currentFile.lastIndexOf("/")) : "";
  const resolved = normalizePath(dir, decodePath(path));
  if (resolved === null) return { kind: "none" };
  return files.includes(resolved) ? { kind: "doc", path: resolved } : { kind: "missing", path: resolved };
}

/**
 * 홈이 `~`로 축약된 경로를 편다.
 *
 * 코어가 spec 디렉터리를 축약 표기로 내려 주므로(`~/.atelier/works/…`) 그대로는 URL을
 * 만들 수 없다. 홈은 플랫폼 API가 알려 주는데 **끝에 슬래시를 붙여 준다** — 겹치면
 * 경로가 어긋나므로 여기서 한 번만 다듬는다.
 */
export function expandHome(path: string, home: string): string {
  if (!path.startsWith("~/")) return path;
  return home.replace(/\/+$/, "") + path.slice(1);
}

/**
 * 본문에 **그림으로** 세울 수 있는 파일인가.
 *
 * 트리에서 고른 파일이 그림인데 글로 읽으면 화면이 텅 빈다 — PNG를 UTF-8로 읽은 결과가
 * 줄번호 `1` 하나로 서는 것이 실물에서 난 모습이다. 여기 없는 확장자는 글로 읽는다.
 *
 * **마크다운 안의 `![](…)`와 다른 판정이다.** 저쪽은 문서가 「이건 그림이다」라고 이미
 * 말해 준 것을 자리로 옮기는 일이고, 이쪽은 확장자만 보고 정해야 한다.
 *
 * **밖으로 내보내지 않는다.** 이 판정은 아래 표 안에서만 쓰인다 — 화면이 따로 부르면
 * 술어가 하나 살아남아, 표가 바뀔 때 그 자리만 옛 규칙을 따르는 어긋남이 생긴다.
 */
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg", "avif", "bmp", "ico"];

function isImageFile(path: string | null): boolean {
  if (!path) return false;
  const dot = path.lastIndexOf(".");
  return dot > 0 && IMAGE_EXTENSIONS.includes(path.slice(dot + 1).toLowerCase());
}

/** 본문이 무엇으로 서는가. */
export type DocBody = "pretty" | "source" | "image" | "html";

/**
 * 「어떤 파일을 어떻게 그리는가」의 표 — **본문이 무엇으로 서는지를 정하는 유일한 자리다.**
 *
 * | 파일 | 본문 기본 | `[소스]` 토글 |
 * | --- | --- | --- |
 * | `.md` | 예쁜 보기 | 살아 있음 |
 * | `.html` · `.htm` | 렌더 | 살아 있음 |
 * | 그림 | 그림 | 잠김 |
 * | 그 외 | 소스 | 잠김 |
 *
 * `showSource`는 **사람이 정한 값 그대로**다(버튼의 켜짐). 파일 종류를 얹는 일은 여기가
 * 한다 — 화면이 각자 얹으면 트리와 본문과 아카이브가 다른 말을 한다.
 *
 * **읽을지 말지도 여기서 나온다**: `"image"`면 파일을 안 읽는다(위 `isImageFile` 머리말).
 *
 * `.svg`는 **그림 칸이다** — 마크업이기도 하지만 이미 그림 확장자이고, 표는 그림을 먼저 본다.
 *
 * `.html`은 **볼 것이면서 글이기도 하다** — 그림과 갈리는 지점이다(그림은 읽을 소스가 없어서
 * 잠긴 것이 옳았다). 두 칸을 함께 넣어야 한다: 렌더만 켜고 토글을 잠그면 **소스를 볼 길이
 * 사라진다** — 이 표에서 지금보다 나빠지는 유일한 경로다.
 *
 * 고른 문서가 없으면(spec이 하나도 없는 work) 마크다운으로 떨어진다. 그 기본값은 **본문
 * 분기를 위한 것이지 「누를 것이 있다」는 뜻이 아니다** — 잠그는 것은 화면의 사정이다.
 */
export function docBody(file: string | null, showSource: boolean): DocBody {
  if (isImageFile(file)) return "image";
  const rendered = renderedBody(file);
  if (rendered === null) return "source";
  return showSource ? "source" : rendered;
}

/** 원문을 안 켰을 때 이 파일이 서는 모양. `null`이면 켜든 끄든 소스다. */
function renderedBody(file: string | null): "pretty" | "html" | null {
  if (file === null) return "pretty";
  const lower = file.toLowerCase();
  if (lower.endsWith(".md")) return "pretty";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  return null;
}

/**
 * 이 파일이 `[소스]` 토글을 무시하는가 — 그러면 두 칸을 함께 잠근다(결정 21).
 *
 * **표에서 파생한다.** 「켜든 끄든 본문이 같다」가 곧 「눌러도 아무 일이 없다」이므로,
 * 잠김 규칙을 따로 적으면 표가 바뀔 때 한쪽만 늙는다.
 */
export function ignoresSourceToggle(file: string | null): boolean {
  return docBody(file, false) === docBody(file, true);
}

export type ImageSource =
  | { kind: "file"; path: string } // 절대 파일 경로. 그리는 쪽이 asset URL로 바꾼다
  | { kind: "url"; url: string } // http·https는 변환 없이 그대로
  // 그릴 수 없다 — 자리표시가 대신 선다. `path`는 **사람이 읽을 수 있게 되돌린** 경로다.
  // 원본 문자열을 그대로 보여주면 한글 파일명이 `%EC%97%86…`으로 나와, 정작 고쳐야 할
  // 이름이 화면에 없게 된다. spec 밖을 가리켜 경로 자체가 서지 않으면 null이다.
  | { kind: "missing"; path: string | null };

/**
 * 본문 이미지 하나를 그릴 수 있는 것으로 바꾼다.
 *
 * 경로 규칙은 링크와 **같은 것을 쓴다**(resolveHref) — 같은 문서 안에서 `./shot.png`가
 * 링크일 때와 이미지일 때 다른 곳을 가리키면 안 된다. 다른 점은 결과의 쓰임뿐이다:
 * 링크는 앱 안에서 열고, 이미지는 파일을 읽어야 하므로 절대 경로가 필요하다.
 *
 * `specRoot`는 홈이 펴진 절대 경로다. 모르면(아카이브 화면) 로컬 이미지는 그리지 않는다.
 */
export function resolveImageSrc(
  specRoot: string | null,
  currentFile: string | null,
  src: string | undefined,
  files: readonly string[],
): ImageSource {
  const target = resolveHref(currentFile, src, files);
  if (target.kind === "external") return { kind: "url", url: target.url };
  if (target.kind === "doc" && specRoot) return { kind: "file", path: `${specRoot}/${target.path}` };
  // doc이면서 specRoot를 모르는 경우(아카이브)에도 경로는 말해 줄 수 있다
  return { kind: "missing", path: target.kind === "none" ? null : target.path };
}

// GitHub 표준 5종. Obsidian 전용 13종은 기각했다 — 색과 아이콘을 전부 정해야 하는데
// 실제로 쓸 종류는 몇 개 안 되고, 이 다섯이라야 **같은 파일을 어디서 열든 같게 보인다**.
export const CALLOUT_KINDS = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"] as const;

export type CalloutKind = (typeof CALLOUT_KINDS)[number];

/**
 * 인용문의 첫 줄이 콜아웃 마커인지 본다.
 *
 * **마커가 있을 때만** 콜아웃이다. 기존 스펙들이 `> **커버:** …` 같은 평범한 인용을
 * 많이 쓰고 있어서, 그것들이 색을 갖게 되면 그 자체가 회귀다.
 *
 * `title`이 null이면 종류 이름을 제목으로 쓴다 — 그리는 쪽의 몫이다.
 */
export function calloutKind(
  firstLine: string,
): { kind: CalloutKind; title: string | null } | null {
  const match = /^\[!([a-z]+)\]\s*(.*)$/i.exec(firstLine);
  if (!match) return null;
  const kind = match[1].toUpperCase();
  if (!(CALLOUT_KINDS as readonly string[]).includes(kind)) return null;
  const title = match[2].trim();
  return { kind: kind as CalloutKind, title: title || null };
}

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

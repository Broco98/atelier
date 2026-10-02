// 참조 생성기 — 클립보드로 나가는 모든 경로 참조는 여기서 만든다.
//
// 이 형식은 MCP 서버 지침(crates/atelier-cli/src/mcp/instructions.rs)의 "블록 참조
// 해석" 규약과 한 몸이다: 형식을 바꾸면 반드시 같은 커밋에서 규약도 함께 갱신할 것.
// instructions.rs의 `refs_ts_still_emits_the_same_line_range_shape`가 이 파일을 읽어 그
// 결합을 지킨다. 뿌리 짝(`the_instructions_read_the_roots_the_app_writes`)도 이 파일을 읽는다 —
// 아래 두 상수가 지침의 예시 문장이 든 뿌리와 같은지를 **이름까지 붙여** 잰다.
// `~` 축약은 Rust collapse_home(crates/atelier-core/src/paths.rs)과 같은 표기다.

/**
 * 참조의 뿌리 둘 — 작업 폴더와 아카이브. 뒤에 `<slug>/`가 붙는다.
 *
 * **MCP 서버 지침과 한 몸이다.** 앱이 복사해 준 참조를 에이전트가 그대로 여는 것이 이 값의 쓸모라, 지침이 읽는
 * 뿌리와 갈리면 없는 경로가 된다. 이 값이나 두 이름을 갈면 같은 커밋에서 지침도 함께 갱신해야 한다. 뿌리 글자는
 * 이 파일에서 **여기 한 번씩만** 선다(`refs.test.ts`) — 생성기가 글자를 따로 들면 상수가 죽은 값이 된 채 지침과
 * 맞대는 검사만 초록이다.
 */
const WORK_ROOT = "~/.atelier/works/";
const ARCHIVE_ROOT = "~/.atelier/archive/";

/** 작업 폴더: work 루트 + `<slug>/` */
export function workDirRef(slug: string): string {
  return `${WORK_ROOT}${slug}/`;
}

/** 워크트리: Rust가 내려준 `~` 축약 경로(`worktrees[].path`)에 트레일링 `/`만 보장한다.
 *  **뿌리를 여기서 짓지 않는다** — 코어가 이미 완성해 내려준 경로라, 여기서 앞머리를 다시
 *  지으면 `ATELIER_HOME`을 옮긴 설치에서 앱이 지은 경로와 실물이 갈린다. */
export function worktreeDirRef(worktreePath: string): string {
  return asDir(worktreePath);
}

/** 레이아웃: Rust가 내려준 `~` 축약 경로(레이아웃 상태의 `folder`)에 트레일링 `/`만 보장한다.
 *  설정의 [부탁]이 복사하는 한 줄이다(spec 레이아웃 결정 23). **뿌리를 여기서 짓지 않는다** —
 *  워크트리와 같은 이유로, 옮긴 데이터 루트에서도 코어가 준 경로가 실물이다. 그 모양이 MCP 도구
 *  설명이 가르치는 참조와 같은지는 Rust가 엔진 안에서 잰다. */
export function layoutDirRef(folder: string): string {
  return asDir(folder);
}

/** 코어가 완성해 내려준 폴더 경로를 폴더 참조로 — 끝의 `/` 하나만 보장한다. */
function asDir(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}

/** spec 폴더: 작업 폴더 + `spec/` */
export function specDirRef(slug: string): string {
  return `${workDirRef(slug)}spec/`;
}

/** 줄범위 꼬리표. 형식이 한 곳에만 있어야 spec 참조와 아카이브 참조가 갈라지지 않는다. */
function withLines(base: string, start?: number, end?: number): string {
  if (start === undefined) return base;
  return end !== undefined && end > start ? `${base}:L${start}-${end}` : `${base}:L${start}`;
}

/** spec 파일(+줄범위): `<작업 폴더>spec/<path>[:L<n>[-<m>]]` */
export function specRef(slug: string, path: string, start?: number, end?: number): string {
  const base = `${specDirRef(slug)}${path}`;
  return withLines(base, start, end);
}

/** 아카이브 문서(+줄범위): `<아카이브 루트><slug>/<path>[:L<n>[-<m>]]`.
 *  path는 **work 루트 기준**이라 기록(`record.md`)과 spec(`spec/…`)이 한 형식으로 나온다 —
 *  아카이브에서 복사한 참조를 에이전트에게 그대로 넘길 수 있어야 한다. */
export function archiveRef(slug: string, path: string, start?: number, end?: number): string {
  const base = `${ARCHIVE_ROOT}${slug}/${path}`;
  return withLines(base, start, end);
}

// 참조 생성기 — 클립보드로 나가는 모든 경로 참조는 여기서 만든다.
//
// **형식은 여기, 루트는 `@/mode`.** 세계마다 다른 앞머리는 `refPrefixesOf`가 든 표 하나에서
// 꺼내 온다 — 두 벌을 여기 다시 적으면 Maison만 고친 커밋이 Atelier 참조를 조용히 바꾼다.
// 그래서 이 파일에는 **루트가 글자로 하나도 없다**: 예시로라도 적어 두면 루트를 재는 검사가
// 주석을 읽고 초록이 된다.
//
// 이 형식은 MCP 서버 지침(crates/atelier-cli/src/mcp/instructions.rs)의 "블록 참조
// 해석" 규약과 한 몸이다: 형식을 바꾸면 반드시 같은 커밋에서 규약도 함께 갱신할 것.
// instructions.rs의 `refs_ts_still_emits_the_same_line_range_shape`가 이 파일을 읽어 그
// 결합을 지킨다. 루트는 이 파일을 떠났으므로 그쪽 짝(`the_instructions_read_the_roots_the_app_writes`)은
// `src/mode.ts`를 읽는다 — 표를 옮기거나 필드 이름을 갈면 그 검사가 터진다. 그 검사는 **이
// 파일도 함께 읽어** 뿌리가 여기 글자로 되돌아오지 않았는지 본다: 그러지 않으면 표가 죽은
// 값이 된 채 지침과 앱이 갈려도 아무것도 안 빨개진다(refs.test.ts의 소스 검사가 짝이다).
// `~` 축약은 Rust collapse_home(crates/atelier-core/src/paths.rs)과 같은 표기다.

import { refPrefixesOf, type Mode } from "@/mode";

/** 작업 폴더: 그 세계의 work 루트 + `<slug>/` (Atelier는 works, Maison은 rooms 아래다) */
export function workDirRef(mode: Mode, slug: string): string {
  return `${refPrefixesOf(mode).work}${slug}/`;
}

/** 워크트리: Rust가 내려준 `~` 축약 경로(`worktrees[].path`)에 트레일링 `/`만 보장한다.
 *  **모드를 안 받는다** — 코어가 이미 완성해 내려준 경로라, 여기서 세계별 앞머리를 다시
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
export function specDirRef(mode: Mode, slug: string): string {
  return `${workDirRef(mode, slug)}spec/`;
}

/** 줄범위 꼬리표. 형식이 한 곳에만 있어야 spec 참조와 아카이브 참조가 갈라지지 않는다. */
function withLines(base: string, start?: number, end?: number): string {
  if (start === undefined) return base;
  return end !== undefined && end > start ? `${base}:L${start}-${end}` : `${base}:L${start}`;
}

/** spec 파일(+줄범위): `<작업 폴더>spec/<path>[:L<n>[-<m>]]` */
export function specRef(
  mode: Mode,
  slug: string,
  path: string,
  start?: number,
  end?: number,
): string {
  const base = `${specDirRef(mode, slug)}${path}`;
  return withLines(base, start, end);
}

/** 아카이브 문서(+줄범위): `<아카이브 루트><slug>/<path>[:L<n>[-<m>]]`.
 *  path는 **work 루트 기준**이라 기록(`record.md`)과 spec(`spec/…`)이 한 형식으로 나온다 —
 *  아카이브에서 복사한 참조를 에이전트에게 그대로 넘길 수 있어야 한다. */
export function archiveRef(
  mode: Mode,
  slug: string,
  path: string,
  start?: number,
  end?: number,
): string {
  const base = `${refPrefixesOf(mode).archive}${slug}/${path}`;
  return withLines(base, start, end);
}

// **core 오류 글을 갈래로 읽는 자리 — 한 곳**(03 코드 리뷰 D5). 앱 명령은 core 오류를 표시 글로 납작하게 넘기고(`src-tauri/src/commands.rs`의
// `err()` — 03 결정 10 · 11이 「화면이 옮긴다」를 받아들였다), 화면이 그 글을 사람의 말로 옮긴다. 갈래를 구조로 넘기려면 앱 명령 · core를
// 바꿔야 해 이 판에서는 글을 맞댄다 — 정본은 core `Error`의 `#[error("…")]`(`crates/atelier-core/src/lib.rs`)와, Space 되돌리기가 지나는 엔진
// `HostError`의 표시 글(`crates/atelier-acp/src/host.rs`)이다. `core-errors.test.ts`가 두 파일을 읽어 그 틀로 지은 글이 아래 정규식에 그 갈래 ·
// 그 칸으로 걸리는지 잰다 — core가 글을 고치면 거기서 빨갛다.
//
// 읽는 쪽: Project 재설정의 거절(`relocateProblem`) · Project 되돌리기(`restoreProblem`) · Space 되돌리기(`restoreSpaceProblem`).

/** 갈래마다 그 글의 꼴 — 칸은 틀에 선 차례로 잡는다. 글 전체를 잇는다(앞뒤에 다른 말이 붙은 글은 그 갈래가 아니다). */
export const CORE_ERRORS = {
  /** `FolderMissing` — 「folder does not exist: {경로}」 */
  folderMissing: /^folder does not exist: (.*)$/,
  /** `NotGitRepo` — 「not a git repository: {경로}」 */
  notGitRepo: /^not a git repository: (.*)$/,
  /** `NotRepoRoot { path, root }` — 고른 폴더 · 그 저장소의 뿌리 */
  notRepoRoot: /^not the root of a git repository: (.*) \(its root is (.*)\)$/,
  /** `AlreadyRegistered { slug, path }` — 그 폴더를 가진 Project의 slug · 경로 */
  alreadyRegistered: /^already registered as project '(.*)': (.*)$/,
  /** `SlugReused` — 되돌리려는 slug가 그사이 다시 쓰였다(Project · Space 둘 다) */
  slugReused: /^slug is in use again: (.*)$/,
  /** `NotFound` — 「project not found: {slug}」 */
  projectNotFound: /^project not found: (.*)$/,
  /** `SpaceNotFound` — core와 엔진(`HostError::SpaceNotFound`)이 같은 글이다 */
  spaceNotFound: /^Space를 찾지 못했어요: (.*)$/,
} as const;

export type CoreErrorKind = keyof typeof CORE_ERRORS;

/** 그 글의 갈래와 칸들 — 모르는 글(입출력 오류 · git의 글 …)은 `null`이고, 부르는 쪽이 글을 그대로 보인다. */
export function coreError(error: string): { kind: CoreErrorKind; fields: string[] } | null {
  for (const kind of Object.keys(CORE_ERRORS) as CoreErrorKind[]) {
    const hit = error.match(CORE_ERRORS[kind]);
    if (hit) return { kind, fields: hit.slice(1) };
  }
  return null;
}

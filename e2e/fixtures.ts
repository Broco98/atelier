import type { ProjectView } from "@/features/projects/types";
import type { Settings } from "@/features/settings/types";

// L3가 쓰는 고정 데이터는 여기 한 곳에만 있다. 테스트마다 제각각인 가짜 데이터가
// 생기면 무엇이 기대값인지가 테스트 수만큼 갈라진다.
export const PROJECTS: ProjectView[] = [
  {
    slug: "billing",
    name: "빌링",
    path: "~/dev/billing",
    baseBranch: "main",
    createdAt: "2026-01-02T03:04:05Z",
    description: "결제 도메인",
    git: { remoteSlug: "acme/billing", currentBranch: "main", localBranches: ["main"] },
    missing: false,
  },
  {
    slug: "ledger",
    name: "원장",
    path: "~/dev/ledger",
    baseBranch: "develop",
    createdAt: "2026-01-03T03:04:05Z",
    description: "",
    git: null,
    missing: false,
  },
];

/**
 * L3에서 우리 커맨드에 답하는 표. L4에서는 이 자리를 다리가 대신한다.
 * 이름이 낡는 것은 `src/tauri-commands.test.ts`가 Rust 등록부와 대조해 잡는다.
 */
export const FIXTURE_COMMANDS: Record<string, unknown> = {
  list_projects: PROJECTS,
  list_works: [],
  list_archive: [],
  // 앱이 뜰 때 무조건 한 번 부른다(`main.tsx` → `loadTerminalSettings`). 목록 화면만 보는
  // 시나리오도 이 호출을 지나므로 표에 없으면 화이트리스트 탐지기가 그때마다 문다.
  //
  // **파일이 없는 상태를 답한다** — 그것이 첫 실행의 정상 경로이고(`settings.rs`의 `read`),
  // 고르지 않은 값이 `null`인 것도 그 파일의 규칙 그대로다. 여기서 글꼴 이름을 지어내면
  // 「값을 정하는 유일한 지점」이 `terminal-defaults.ts` 말고 하나 더 생긴다.
  read_settings: { terminal: { fontFamily: null, fontSize: null, theme: "dark" } } satisfies Settings,
};

// `write_settings`는 아직 없다 — 설정을 저장하는 시나리오가 없고, **태우지 않는 스텁은
// 조용히 낡는다**(harness.ts의 플러그인 표가 같은 이유로 둘을 비워 뒀다). 그 시나리오를
// 쓰는 판이 같이 넣는다.

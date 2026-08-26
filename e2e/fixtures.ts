import type { ProjectView } from "@/features/projects/types";
import type { WorkView } from "@/features/works/types";
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

// 사이드바 작업 목록. **고정된 것과 아닌 것을 둘 다** 둔다 — 이 목록이 갈리는 자리가
// 그 둘이기 때문이다(결정 82의 구획, 결정 85의 채운 핀). 순서는 코어가 정하므로
// (결정 100) 고정된 것이 먼저 온다.
export const WORKS: WorkView[] = [
  {
    slug: "pinned-work",
    title: "고정된 일",
    status: "active",
    branch: "feat/pinned-work",
    createdAt: "2026-08-20",
    projects: ["billing"],
    pinned: true,
    worktrees: [
      {
        project: "billing",
        path: "~/.atelier/works/pinned-work/trees/billing",
        exists: true,
        dirty: false,
      },
    ],
    specDir: "~/.atelier/works/pinned-work/spec",
    // **그림 파일을 하나 둔다** — 트리에서 그림을 고르면 본문이 그림으로 서는지가 이
    // 층에서만 보인다(글로 읽으면 줄번호 `1` 하나만 있는 빈 화면이 된다).
    specFiles: ["overview.md", "증거/샷.png"],
  },
  {
    slug: "plain-work",
    title: "그냥 일",
    status: "active",
    branch: null,
    createdAt: "2026-08-21",
    projects: [],
    pinned: false,
    worktrees: [],
    specDir: "~/.atelier/works/plain-work/spec",
    specFiles: [],
  },
];

/**
 * L3에서 우리 커맨드에 답하는 표. L4에서는 이 자리를 다리가 대신한다.
 * 이름이 낡는 것은 `src/tauri-commands.test.ts`가 Rust 등록부와 대조해 잡는다.
 */
export const FIXTURE_COMMANDS: Record<string, unknown> = {
  list_projects: PROJECTS,
  list_works: WORKS,
  list_archive: [],
  // 핀을 누르면 나가는 쓰기다. 돌려주는 값은 쓰이지 않는다 — 성공하면 목록을
  // 다시 읽어 오는 것이 화면을 고치는 자리다(useSetWorkPinned).
  set_work_pinned: null,
  // 앱이 뜰 때 무조건 한 번 부른다(`main.tsx` → `loadTerminalSettings`). 목록 화면만 보는
  // 시나리오도 이 호출을 지나므로 표에 없으면 화이트리스트 탐지기가 그때마다 문다.
  //
  // **파일이 없는 상태를 답한다** — 그것이 첫 실행의 정상 경로이고(`settings.rs`의 `read`),
  // 고르지 않은 값이 `null`인 것도 그 파일의 규칙 그대로다. 여기서 글꼴 이름을 지어내면
  // 「값을 정하는 유일한 지점」이 `terminal-defaults.ts` 말고 하나 더 생긴다.
  read_settings: { terminal: { fontFamily: null, fontSize: null, theme: "dark" } } satisfies Settings,
  // 판 05가 태운다 — 분할이면 본문에 **터미널 열이 함께 선다**(결정 87)므로 Works 화면을
  // 여는 것만으로 셸 하나가 뜬다. 앞 판까지는 문서 본문만 서서 이 길을 안 지났다.
  //
  // 프레임은 오지 않는다: 출력은 `onFrame` 채널로 오고 그 채널은 앱이 만든다 —
  // 여기서 답하는 것은 「띄웠다」 하나뿐이라 셸은 빈 화면으로 선다. 이 층에서 볼 것도
  // 그것뿐이다(진짜 바이트는 L4의 몫이고, 거기서도 안 탄다).
  // 사이드바 검사가 spec 파일이 있는 work으로 옮겨 가면서 태운다 — 본문 뷰어가 문서를 읽는다.
  // 내용은 **한 줄이면 족하다**: 여기서 보는 것은 사이드바이고, 문서 렌더의 규칙은
  // SpecViewer.test.tsx가 든다.
  read_spec_file: "# 개요\n\n한 줄.\n",
  pty_spawn: { id: 1, shellName: "zsh" },
  // 셸을 띄운 직후 한 번, 그리고 열 폭이 바뀔 때마다 나간다 — 분할 경계를 끄는 검사가
  // 바로 그 두 번째를 센다(works-split.spec.ts).
  pty_resize: null,
  // 닫기 직전에만 묻는다(결정 92). **`true`인 것은 물어야 하는 쪽을 태우기 위해서다** —
  // 셸 닫기 확인 창이 이 앱의 것인지(OS 시트가 아닌지)를 보는 검사가 그 길을 지난다.
  pty_command_running: true,
  pty_kill: null,
};

// 여기 없는 pty 커맨드(`pty_write`)는 **일부러 뺐다.** 지금 타자를 치는 시나리오가 없고,
// 아래 `write_settings` 주석이 적어 둔 규칙이 그대로 걸린다 — **태우지 않는 스텁은 조용히
// 낡는다.** 그 시나리오를 쓰는 판이 같이 넣는다.

// `write_settings`는 아직 없다 — 설정을 저장하는 시나리오가 없고, **태우지 않는 스텁은
// 조용히 낡는다**(harness.ts의 플러그인 표가 같은 이유로 둘을 비워 뒀다). 그 시나리오를
// 쓰는 판이 같이 넣는다.

import type { ArchiveEntry } from "@/features/archive/types";
import type { ProjectView } from "@/features/projects/types";
import type { SearchHit, SearchResults } from "@/features/search/types";
import type { WorkView } from "@/features/works/types";
import type { Settings } from "@/features/settings/types";
import type { Mode } from "@/mode";

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
//
// **제목 길이도 둘로 갈라 둔다**(결정 9~12). 사이드바 280px에서 제목에 남는 폭은 194px이라
// 첫 제목은 넘치고 둘째는 안 넘치는데, 「넘치면 흐르고 안 넘치면 가만히 있다」를 보려면
// 그 둘이 다 있어야 한다 — 짧은 제목만 두면 마퀴 검사가 **아무것도 안 흐르는 화면에서도**
// 초록이 된다.
export const WORKS: WorkView[] = [
  {
    slug: "pinned-work",
    title: "고정된 일 — 사이드바에서 잘리는 아주 긴 제목",
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
    // **파일 종류 표의 네 줄이 여기 다 있다** — 트리에서 고를 수 있는 것이 곧 이 층에서
    // 볼 수 있는 것이다. 그림은 글로 읽으면 줄번호 `1` 하나만 있는 빈 화면이 되고,
    // `.html`은 프레임으로 서고, `.json`은 그 옆에서 **지금 그대로**임을 받쳐 준다.
    // **뒤에 더한다** — 앞 검사 하나가 이 목록을 자리로 집는다(`specFiles[1]`이 그림이다).
    specFiles: ["overview.md", "증거/샷.png", "목업/조각.html", "메타.json"],
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
 * Maison의 Rooms. **Atelier work과 겹치는 값이 하나도 없다** — slug도 제목도 문서 경로도
 * 본문도 다르다. 같은 데이터를 두 세계가 나눠 쓰면 「maison으로 물었다」와 「atelier로
 * 물었다」가 화면에서 갈리지 않아, `mode`를 통째로 빠뜨려도 초록이 된다. 백엔드에서 `mode`가
 * 아직 **선택 인자**라(없으면 Atelier — #187이 닫는다) 빠뜨린 호출은 오류가 아니라 조용히
 * Atelier 데이터를 받는다. 이 층에서 그것이 보이려면 답이 갈려 있어야 한다.
 *
 * 브랜치도 워크트리도 프로젝트도 없다 — Room은 토픽이고 저장소에 안 붙는다(결정 17).
 * 그래서 `projects`·`worktrees`가 빈 것은 안 채운 게 아니라 이 세계의 모양이다.
 *
 * **초안이 먼저 온다.** `/maison/rooms`의 정규화가 「초안 아닌 첫 Room」을 고르는데, 목록이
 * 초안 아닌 것뿐이면 그 규칙이 **그냥 첫 줄을 고르는 것**과 구별되지 않는다 — 규칙이 퇴화해도
 * 초록이 된다.
 */
export const ROOMS: WorkView[] = [
  {
    slug: "draft-room",
    title: "아직 초안인 방",
    status: "draft",
    branch: null,
    createdAt: "2026-09-01",
    projects: [],
    pinned: false,
    worktrees: [],
    specDir: "~/.atelier/maison/rooms/draft-room/spec",
    specFiles: [],
  },
  {
    slug: "reading-room",
    title: "읽는 방",
    status: "active",
    branch: null,
    createdAt: "2026-09-02",
    projects: [],
    pinned: false,
    worktrees: [],
    specDir: "~/.atelier/maison/rooms/reading-room/spec",
    // **`overview.md`가 아니다.** 그 이름은 화면이 기본 문서로 특별 대접하는 값이라
    // (`WorksPage`의 `defaultFile`), Atelier의 문서 이름을 그대로 쓰면 「Room 자신의 목록에서
    // 골랐다」와 「이름을 보고 집었다」가 갈리지 않는다.
    specFiles: ["개요.md"],
  },
];

// 아카이브 목록. **둘이다 — 문서가 있는 것과 없는 것.** 그 둘이 `[소스]` 잠김이 갈리는
// 자리다: 문서가 하나도 없으면 파일 종류 표는 마크다운으로 떨어지는데 그 기본값은 본문
// 분기를 위한 것이지 「누를 것이 있다」는 뜻이 아니라, 화면이 `current === null`을 따로
// 얹어 잠근다(ArchivePage의 `locked`). 하나만 두면 그 항이 빠져도 초록이 된다.
//
// 목록은 **경량이다** — spec 파일 목록을 담지 않는다(`ArchiveEntry`). 문서 목록은 아래
// `ARCHIVED_DOCS`가 `list_archived_docs`로 따로 답한다.
export const ARCHIVE: ArchiveEntry[] = [
  {
    slug: "shipped-work",
    title: "치운 일",
    // 아카이브가 done을 뜻하지는 않지만(치운 시점 상태를 그대로 보존한다), 흔한 쪽을 둔다
    status: "done",
    archivedAt: "2026-08-10T03:04:05Z",
    projects: ["billing"],
  },
  {
    // 손으로 옮겨 둔 폴더 — 기록도 spec도 없다. `archivedAt`이 없는 것도 같은 사정이다
    // (`ArchiveEntry.archivedAt` 주석). `record.md`를 지운 아카이브가 같은 모양이 된다.
    slug: "bare-archive",
    title: "문서가 남지 않은 것",
    status: "active",
    archivedAt: null,
    projects: [],
  },
];

/**
 * 팔레트가 그리는 줄들. **이 표는 질의를 못 본다** — 이름 → 고정 값이라 어떤 질의에도 같은
 * 답이 온다. 좁혀지는 것을 여기서 재려 하지 말 것: 그것은 코어 단위의 몫이고 이 층이
 * 재는 것은 배선이다. (예외가 딱 하나 있고, 그 이유는 아래 `SEARCH_DESTINATION_QUERY`가 든다.)
 *
 * 경로는 `pinned-work`가 **실제로 가진 spec 파일 그대로**여야 한다. 주소의 `file`이 그
 * work의 목록에 없으면 본문이 기본 문서로 되돌아가, 「고른 것이 열렸다」가 조용히 거짓이 된다.
 */
export const SEARCH_HITS: SearchHit[] = WORKS[0].specFiles.map((path) => ({
  kind: "doc",
  slug: WORKS[0].slug,
  title: WORKS[0].title,
  path,
  archived: false,
}));

/**
 * 한 질의의 답 통째. **「잘렸다」는 안 켠다** — 이 층이 재는 것은 배선이고, 상한에 걸렸는지를
 * 가르는 것은 코어 단위가 든다(딱 20줄과 잘린 것을 여기서 흉내내면 상한이 두 자리에 산다).
 */
export const SEARCH_RESULTS: SearchResults = { hits: SEARCH_HITS, truncated: false };

/**
 * **질의 하나에만 답을 심어 둔다.** 위 표는 문서 줄만 내므로 「가는 곳」 줄이 이 층에 영영
 * 안 서는데, 그러면 **목록에는 뜨는데 Enter가 아무 일도 안 하는** 실패를 아무 층도 못 잡는다:
 * 목적지의 `key`를 주소로 푸는 자리가 프런트에 따로 있고(`destinations.ts`), 설정은 `navItems`
 * 밖에 사는 유일한 목적지라 바로 그 자리에서 빠지기 쉽다(결정 51).
 *
 * 좁혀지는 것을 흉내내는 것이 **아니다** — 맞추는 규칙과 상한은 그대로 코어 단위의 몫이고,
 * 여기서 재는 것은 **그 줄을 골랐을 때 실제로 그 화면에 가는가** 하나다. 그래서 심는 질의도
 * 하나뿐이고 나머지는 전부 위 고정 답으로 떨어진다 — 앞 검사들이 그대로 돈다.
 */
export const SEARCH_DESTINATION_QUERY = "Set";
export const SEARCH_DESTINATION_RESULTS: SearchResults = {
  // **`key`뿐이다**(결정 21). 라벨과 라우트는 프런트가 되찾는 것이고, 그 되찾기가 실제로
  // 도는지가 이 층이 보려는 것이라 — 여기에 라벨을 실으면 그것을 안 보고도 초록이 된다.
  hits: [{ kind: "destination", key: "settings" }],
  truncated: false,
};

/**
 * L3에서 우리 커맨드에 답하는 표. L4에서는 이 자리를 다리가 대신한다.
 * 이름이 낡는 것은 `src/tauri-commands.test.ts`가 Rust 등록부와 대조해 잡는다.
 *
 * **모드로 갈리는 커맨드는 여기 없다** — 아래 `FIXTURE_BY_MODE`가 따로 든다. 이름으로만
 * 답하는 줄을 남겨 두면 `mode`를 빠뜨린 호출이 그 줄로 조용히 떨어져, 이 층이 세운 그물이
 * 통째로 무력해진다(그 표의 머리말).
 */
export const FIXTURE_COMMANDS: Record<string, unknown> = {
  list_projects: PROJECTS,
  // `list_archive`는 **모드를 안 본다.** 인자로는 실려 오지만(archiveApi) Maison 아카이브를
  // 여는 시나리오가 아직 없어서 답을 가를 이유가 없다 — **태우지 않는 스텁은 조용히 낡는다**
  // (이 파일의 `write_settings` 주석과 같은 규칙). 그 화면을 여는 판이 이 줄을
  // `FIXTURE_BY_MODE`로 옮긴다.
  list_archive: ARCHIVE,
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
  // ⇧⇧로 여는 팔레트가 뜨자마자 부르고, 글자를 칠 때마다 다시 부른다 — 캐시도 디바운스도
  // 없다. **답은 질의와 무관하게 늘 같다**(위 표의 머리말).
  search: SEARCH_RESULTS,
  // **`pty_spawn`은 여기 없다** — 셸이 뜰 때 세계가 함께 나가므로(결정 10) 아래
  // `FIXTURE_BY_MODE`가 든다. 이 줄을 되돌리면 `mode`를 빠뜨린 spawn이 이름으로 답을
  // 받아, Maison 터미널이 Atelier 홈에서 뜨는 것을 이 층이 통째로 못 본다.

  // 셸을 띄운 직후 한 번, 그리고 열 폭이 바뀔 때마다 나간다 — 분할 경계를 끄는 검사가
  // 바로 그 두 번째를 센다(works-split.spec.ts).
  pty_resize: null,
  // 닫기 직전에만 묻는다(결정 92). **`true`인 것은 물어야 하는 쪽을 태우기 위해서다** —
  // 셸 닫기 확인 창이 이 앱의 것인지(OS 시트가 아닌지)를 보는 검사가 그 길을 지난다.
  pty_command_running: true,
  pty_kill: null,
};

/**
 * 경로별 답이 없을 때 Atelier가 내는 한 줄. 사이드바 검사가 spec 파일이 있는 work으로 옮겨
 * 가면서 태운다 — 본문 뷰어가 문서를 읽는다. **한 줄이면 족하다**: 그 검사가 보는 것은
 * 사이드바이고, 문서 렌더의 규칙은 SpecViewer.test.tsx가 든다.
 *
 * Maison 쪽에는 짝이 **없다**(아래 `FIXTURE_BY_MODE`) — 그 세계에서 열리는 문서가 하나뿐이라
 * 폴백을 두면 아무도 안 태우는 답이 되고, 그러면 「Room 자신의 문서를 읽었다」가 **폴백이라서**
 * 초록인지 정말 그 문서라서 초록인지 갈리지 않는다.
 */
export const SPEC_FALLBACK_BODY = "# 개요\n\n한 줄.\n";

/**
 * spec 파일 읽기의 **경로별** 답. `read_spec_file`이 경로와 무관하게 한 문자열로 답하던
 * 자리를 넓힌 것이다 — 같은 시나리오에서 `.md`·`.html`·`.json`을 각각 열어야 한다.
 *
 * **여기 없는 경로는 위 `SPEC_FALLBACK_BODY`가 계속 답한다** — 앞 시나리오들이 그대로 돈다.
 *
 * `.html`은 **실물 목업을 안 넣는다.** 27KB짜리 남의 work 파일이 이 저장소의 검사에
 * 들어오면 그 파일이 바뀔 때 여기가 깨지고, 그 문서가 증명하는 두 값(264px·32px)은
 * 껍데기와 무관하게 통과해 자동 검사로서 아무것도 못 지킨다. **몇 줄짜리 합성**이
 * 껍데기가 실제로 섰는지(`body` 여백)와 스크립트가 돌았는지, 그리고 프레임 안이 여전히
 * 눌리는지를 다 잰다.
 */
export const SPEC_FILE_BODIES: Record<string, string> = {
  // **doctype이 없다** — 아티팩트 조각이라 껍데기를 받는 쪽이다. 껍데기가 섰는지는
  // `body` 여백으로 갈린다(껍데기가 없으면 UA 기본 8px이다).
  "목업/조각.html": [
    "<title>조각</title>",
    '<p id="조각">껍데기 없는 아티팩트 조각</p>',
    // **프레임 안이 여전히 눌리는지**를 재는 자리(spec-html.spec.ts). 목업의 토글을 살리는
    // 것이 결정 4의 목적이라, 포커스 완화책이 그것을 죽이지 않았다는 증거가 필요하다.
    '<button id="토글" type="button">토글</button>',
    // 프레임 안에서 스크립트가 돌았다는 증거. `allow-scripts`가 빠지면 여기가 안 남는다.
    // 그 아래 한 줄은 위 버튼의 손잡이다 — 눌리면 `toggled`가 선다.
    '<script>document.body.dataset.ran = "1";',
    'document.getElementById("토글").onclick = () => { document.body.dataset.toggled = "1"; };',
    "</script>",
    "",
  ].join("\n"),
  "메타.json": '{\n  "종류": "그 외",\n  "본문": "소스 고정"\n}\n',
};

/**
 * Room 문서의 본문 — **Atelier 쪽과 한 글자도 안 겹친다.** 겹치면 `mode`가 어긋난 읽기가
 * 화면에서 안 보인다(`ROOMS` 머리말). 특히 위 `SPEC_FALLBACK_BODY`의 「한 줄.」이 여기 있으면,
 * Maison 화면이 Atelier 문서를 읽어 와도 검사가 통과한다.
 */
export const ROOM_SPEC_FILE_BODIES: Record<string, string> = {
  "개요.md": "# 읽는 방\n\n이 방에만 있는 문서다.\n",
};

// 여기 없는 pty 커맨드(`pty_write`)는 **일부러 뺐다.** 지금 타자를 치는 시나리오가 없고,
// 아래 `write_settings` 주석이 적어 둔 규칙이 그대로 걸린다 — **태우지 않는 스텁은 조용히
// 낡는다.** 그 시나리오를 쓰는 판이 같이 넣는다.

// `write_settings`는 아직 없다 — 설정을 저장하는 시나리오가 없고, **태우지 않는 스텁은
// 조용히 낡는다**(harness.ts의 플러그인 표가 같은 이유로 둘을 비워 뒀다). 그 시나리오를
// 쓰는 판이 같이 넣는다.

/**
 * 아카이브의 문서 목록 — **slug별**이다. 경로는 work 루트 기준이라 기록(`record.md`)과
 * spec(`spec/…`)이 한 목록에 함께 오고, 기록이 맨 앞이다(코어 `list_archived_docs`).
 *
 * 파일 종류 표의 세 줄을 담는다: `.md` · 그림 · `.html`. **뒤에 더한다** — 위 `specFiles`와
 * 같은 규칙이다(검사가 목록을 자리로 집을 수 있다).
 *
 * `bare-archive`가 `[]`인 것은 지어낸 상태가 아니다 — 손으로 옮겨 둔 폴더에는 기록이 없고,
 * 코어도 없으면 안 넣는다.
 */
export const ARCHIVED_DOCS: Record<string, string[]> = {
  "shipped-work": ["record.md", "spec/증거/샷.png", "spec/목업/조각.html"],
  "bare-archive": [],
};

/**
 * 아카이브 문서 읽기의 **경로별** 답.
 *
 * **그림이 여기 없는 것이 그물이다**(결정 15). 읽을지 말지도 파일 종류 표가 정하므로
 * 아카이브 화면은 그림을 아예 안 읽는데, 그 항이 빠지면 `spec/증거/샷.png`로 읽기가
 * 나가고 표에 없는 경로라 하네스가 문다 — 「안 읽는다」가 화이트리스트 탐지기에 걸린다.
 * 여기에 답을 채워 두면 그 신호가 사라진다.
 *
 * `.html`은 spec 쪽과 **같은 조각**이다 — 두 화면이 같은 `HtmlDoc`을 쓰는 것이 결정 11의
 * 요지라, 조각이 갈리면 무엇이 같은지가 이 층에서 안 보인다.
 */
export const ARCHIVED_FILE_BODIES: Record<string, string> = {
  "record.md": "# 기록 — 치운 일\n\n한 줄.\n",
  "spec/목업/조각.html": SPEC_FILE_BODIES["목업/조각.html"],
};

/**
 * **인자를 한 겹 더 보는** 커맨드들의 답: 커맨드 이름 → 가르는 인자 이름 + 그 값별 답.
 *
 * 위 `FIXTURE_COMMANDS`는 커맨드 이름으로만 갈리는데, 한 시나리오가 문서 셋을 열어야 하고
 * (`read_spec_file`·`read_archived_file`) 아카이브 둘이 서로 다른 문서 목록을 가져야 한다
 * (`list_archived_docs`). 여기서 못 찾은 값은 그대로 `FIXTURE_COMMANDS`가 답한다 —
 * `read_spec_file`의 그 한 줄이 앞 시나리오들을 그대로 돌린다.
 *
 * 아카이브 쪽 둘은 **여기에만** 있다. `FIXTURE_COMMANDS`에 폴백을 두면 표에 없는 경로가
 * 조용히 답을 받아, 위 `ARCHIVED_FILE_BODIES`가 그림으로 세운 그물이 무력해진다.
 * 이름이 낡는 것은 `src/tauri-commands.test.ts`가 이 표도 함께 대조해 잡는다.
 */
export const FIXTURE_BY_ARG: Record<string, { arg: string; answers: Record<string, unknown> }> = {
  // 심어 둔 질의 하나만 다른 답을 받고 나머지는 위 고정 답으로 떨어진다 — 왜 하나뿐인지는
  // `SEARCH_DESTINATION_QUERY` 머리말이 든다.
  search: { arg: "query", answers: { [SEARCH_DESTINATION_QUERY]: SEARCH_DESTINATION_RESULTS } },
  // 아카이브 둘은 **모드를 안 본다** — 위 `list_archive` 곁 주석과 같은 이유다.
  list_archived_docs: { arg: "slug", answers: ARCHIVED_DOCS },
  read_archived_file: { arg: "path", answers: ARCHIVED_FILE_BODIES },
};

/**
 * 모드로 갈리는 커맨드의 **한 모드 몫**. 값 하나면 `value`, 인자를 한 겹 더 봐야 하면
 * `arg`·`answers`를 함께 든다(그 모드에 기본 답이 있으면 `value`도 같이).
 *
 * `value`가 **선택인 것이 그물이다**: 없으면 그 모드는 표에 적힌 인자 값에만 답하고 나머지는
 * 하네스가 문다. 폴백은 안 태우는 순간 낡으므로, 태울 것이 없는 모드는 안 두는 쪽이 맞다.
 */
export interface ModeAnswer {
  readonly value?: unknown;
  readonly arg?: string;
  readonly answers?: Record<string, unknown>;
}

/**
 * **모드로 갈리는 커맨드의 답.** 위 두 표보다 먼저 보고, **여기 있는 커맨드는 두 표로
 * 안 떨어진다** — 답을 못 찾으면 하네스가 문다(harness.ts).
 *
 * 그 fail-closed가 이 표의 존재 이유다. 백엔드에서 `mode`가 아직 선택 인자라(#187) 프런트가
 * 한 자리에서 빠뜨리면 **오류 없이 Atelier 데이터**가 오는데, 이름으로만 답하는 표로 떨어지게
 * 두면 이 층에서도 똑같이 조용하다 — 「Maison 화면인데 Atelier 것이 떴다」가 아무 데도
 * 안 걸린다.
 *
 * `Record<Mode, ModeAnswer>`가 둘째 그물이다: 모드가 하나 느는 날 칸을 빠뜨린 것을 L0가
 * 잡는다. 값이 실제로 갈려 있어야 하는 것은 타입이 못 보므로 그쪽은 `ROOMS` 머리말이 든다.
 *
 * **여기 있는 커맨드가 셋뿐인 것은 지금 태우는 것이 셋뿐이기 때문이다.** 모드를 인자로
 * 받는 커맨드는 더 있지만(아카이브 셋·쓰기들), 그 화면을 Maison에서 여는 시나리오가 아직
 * 없다 — 그 판이 이리로 옮긴다.
 */
export const FIXTURE_BY_MODE: Record<string, Record<Mode, ModeAnswer>> = {
  list_works: { atelier: { value: WORKS }, maison: { value: ROOMS } },
  /**
   * **두 모드의 답이 같다 — 그래도 여기다.** spawn 응답(`{id, shellName}`)은 세계를 안 탄다:
   * pty 번호도 `$SHELL`의 basename도 어느 루트에서 떴는지와 무관하다. 여기서 답을 가르면
   * 그것은 실물에 없는 차이를 지어내는 것이라 「모드가 갈렸다」가 픽스처의 거짓말 위에 선다.
   *
   * 이 줄이 사는 이유는 **fail-closed 하나다.** 백엔드에서 `mode`가 선택 인자라(`or_atelier`)
   * 빠뜨린 spawn은 오류 없이 Atelier 홈에서 뜨고 셸 env도 `atelier`가 된다 — 이름으로 답하는
   * 표에 두면 이 층은 그때도 조용히 초록이다. 여기 있으면 하네스가 그 자리에서 문다.
   *
   * 그래서 **어느 모드가 실렸는지**까지는 이 표가 못 본다. 그 값을 읽는 자리는 IPC 기록이고
   * (`terminal-worlds.spec.ts`), 셸 env까지 실물로 잇는 자리는 `src-tauri/tests/top_terminal.rs`다.
   *
   * 프레임은 오지 않는다: 출력은 `onFrame` 채널로 오고 그 채널은 앱이 만든다 — 여기서
   * 답하는 것은 「띄웠다」 하나뿐이라 셸은 빈 화면으로 선다. 이 층에서 볼 것도 그것뿐이다
   * (진짜 바이트는 L4의 몫이고, 거기서도 안 탄다).
   *
   * 두 칸이 다 태워진다: Atelier는 work 화면의 터미널 열(결정 87)과 `/terminal`이,
   * Maison은 `/maison/terminal`이 지난다.
   */
  pty_spawn: {
    atelier: { value: { id: 1, shellName: "zsh" } },
    maison: { value: { id: 1, shellName: "zsh" } },
  },
  read_spec_file: {
    atelier: { value: SPEC_FALLBACK_BODY, arg: "path", answers: SPEC_FILE_BODIES },
    // 폴백이 없다 — 위 `SPEC_FALLBACK_BODY` 머리말의 이유다. Room이 자기 목록에 없는 문서를
    // 읽으려 하면 그 자리에서 문다.
    maison: { arg: "path", answers: ROOM_SPEC_FILE_BODIES },
  },
};

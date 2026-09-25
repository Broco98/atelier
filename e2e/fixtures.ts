import type { ArchiveEntry } from "@/features/archive/types";
import type { ProjectView } from "@/features/projects/types";
import type { SearchHit, SearchResults } from "@/features/search/types";
import type { WorkView } from "@/features/works/types";
import type { HookStatus, Settings } from "@/features/settings/types";
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
    // **로컬 브랜치가 둘이다** — 기준 브랜치 목록(프로젝트 화면의 Select)에서 「지금 값이 아닌 가지를 고르면」을
    // 재려면 고를 다른 가지가 있어야 한다(`projects-list.spec.ts`). 지금 값(`main`)이 목록에 들어 있어, 앞에
    // 붙이는 규칙(지금 값이 목록에 없을 때)은 이 프로젝트에서 안 탄다.
    git: { remoteSlug: "acme/billing", currentBranch: "main", localBranches: ["main", "release"] },
    missing: false,
  },
  {
    slug: "ledger",
    name: "원장",
    path: "~/dev/ledger",
    baseBranch: "develop",
    createdAt: "2026-01-03T03:04:05Z",
    description: "",
    // git 정보가 없다 — 로컬 브랜치가 없는 프로젝트다. 기준 브랜치가 목록 대신 직접 적는 입력칸으로 선다.
    git: null,
    missing: false,
  },
];

// 사이드바 작업 목록. **고정된 것과 아닌 것을 둘 다** 둔다 — 이 목록이 갈리는 자리가
// 그 둘이기 때문이다(결정 82의 구획, 결정 85의 채운 핀). 순서는 코어가 정하므로
// (결정 100) 고정된 것이 먼저 온다.
//
// **제목 길이도 둘로 갈라 둔다**(결정 9~12). 「넘치면 흐르고 안 넘치면 가만히 있다」를 보려면
// 그 둘이 다 있어야 한다 — 짧은 제목만 두면 마퀴 검사가 **아무것도 안 흐르는 화면에서도**
// 초록이 된다.
//
// **넘치는 쪽은 넉넉히 넘쳐야 한다.** 사이드바 280px · 셸이 없는 행에서 제목에 남는 폭이
// 222px이고 첫 제목이 283.52px이라 넘침이 61.52px이다(L3 WebKit 실측 2026-08-30). 이 여유가
// 마퀴 속도를 재는 그물의 폭이다: 흐르는 시간이 「(넘침 + 페이드 12) ÷ 50px/s」인데 두 점을
// 0.4초 사이에 두고 찍으므로, 넘침이 25px 아래로 내려가면 두 점이 **도착한 뒤**로 밀려 기울기가
// 0이 된다. 2열의 28px 예약을 걷어 제목이 27.91px 넓어졌을 때 실제로 그렇게 됐고(넘침
// 51.14 → 23.23px), 그래서 제목을 그만큼 늘려 여유를 되돌렸다.
export const WORKS: WorkView[] = [
  {
    slug: "pinned-work",
    title: "고정된 일 — 사이드바에서 잘리고도 남는 아주 긴 제목",
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
  // **프로젝트가 둘인 work**(UI개선 결정 17~19·30). 새 셸 자리가 갈리는 곳이 이 모양 하나다 —
  // ⌘T는 「모든 프로젝트」(워크트리들의 부모 폴더)에, `+` 메뉴는 고른 프로젝트에 열고, 들어가도
  // 셸이 저절로 안 선다. 모드 표의 `list_works`는 테스트마다 못 덮으므로 여기 한 벌을 둔다.
  //
  // **끝에 더한다** — 앞 두 줄을 자리로 집는 검사가 여럿이다(`const [pinnedWork, plainWork] = WORKS`).
  {
    slug: "multi-work",
    title: "두 저장소 일",
    status: "active",
    branch: "feat/multi-work",
    createdAt: "2026-08-22",
    projects: ["billing", "ledger"],
    pinned: false,
    worktrees: [
      {
        project: "billing",
        path: "~/.atelier/works/multi-work/trees/billing",
        exists: true,
        dirty: false,
      },
      {
        project: "ledger",
        path: "~/.atelier/works/multi-work/trees/ledger",
        exists: true,
        dirty: false,
      },
    ],
    specDir: "~/.atelier/works/multi-work/spec",
    // 문서 하나 — 본문 열보다 넓은 문서다(`SPEC_FILE_BODIES`의 「넓은.md」). 첫 work에 두지 않는
    // 것은 그 목록이 검색 답(`SEARCH_HITS`)의 줄이라 줄 수를 재는 검사가 따라 흔들려서다.
    specFiles: ["넓은.md"],
  },
];

/**
 * Maison의 Rooms. **Atelier work과 겹치는 값이 하나도 없다** — slug도 제목도 문서 경로도
 * 본문도 다르다. 같은 데이터를 두 세계가 나눠 쓰면 「maison으로 물었다」와 「atelier로
 * 물었다」가 화면에서 갈리지 않아, `mode`가 어긋나도 초록이 된다. 백엔드가 이제 `mode`를
 * **필수로** 받으므로(#187) 통째로 빠뜨린 호출은 거절되지만, **저쪽 세계의 값을 실은**
 * 갈래는 여전히 멀쩡한 인자다 — 그것이 보이려면 이 층의 답이 갈려 있어야 한다.
 *
 * 브랜치도 워크트리도 프로젝트도 없다 — Room은 토픽이고 저장소에 안 붙는다(결정 17).
 * 그래서 `projects`·`worktrees`가 빈 것은 안 채운 게 아니라 이 세계의 모양이다.
 *
 * **초안이 먼저 온다.** `/maison/rooms`의 정규화는 상태와 무관하게 「목록 첫 줄」을 고른다
 * (UI개선 결정 6). 첫 줄이 초안이 아니면 옛 규칙(「초안 아닌 첫 Room」)이 되살아나도 같은 줄을
 * 골라 초록이 된다 — 초안이 첫 줄이어야 그 되돌림이 갈린다. 사이드바에서 초안이 따로 된 구역
 * 없이 `Rooms` 안에 서는 것(UI개선 결정 5)을 재는 것도 이 줄이다.
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

/**
 * 무선택 주소(`/maison/rooms`)가 정규화로 고르는 Room — **목록 첫 줄**이고, 초안이어도 안
 * 건너뛴다(UI개선 결정 6). 규칙이 바뀌면 이 한 줄만 고친다: spec마다 `ROOMS`를 따로 풀어
 * 이름을 붙이면 규칙이 갈릴 때 여러 파일을 함께 고쳐야 하고, 같은 `room`이 파일마다 다른
 * Room을 가리키게 된다. 이것이 초안이어야 하는 까닭은 위 `ROOMS` 머리말이다.
 */
export const MAISON_LANDING_ROOM: WorkView = ROOMS[0];

/**
 * 작업 행을 끌어 놓았을 때 `move_work`가 돌려주는 목록(UI개선 티켓 05). **인자와 무관한 한 벌이고,
 * 원래 목록을 뒤집어 짓는다** — fixture 백엔드에는 상태가 없어 「옮긴 결과」를 지을 수 없으니,
 * 원래와 **확실히 다른** 순서를 주어 「응답으로 캐시를 갈아 끼웠다」를 화면에서 잰다.
 *
 * 리터럴로 적지 않고 파생한다: `WORKS` 끝에 줄이 더해져도(티켓 08) 이 값이 저절로 따라온다.
 * 뒤집어도 `pinned`는 그대로라 화면의 구획은 안 흔들리고 구획 **안** 순서만 뒤집힌다.
 */
export const WORKS_MOVED: WorkView[] = [...WORKS].reverse();
export const ROOMS_MOVED: WorkView[] = [...ROOMS].reverse();

// 사이드바 구획 머리의 접근성 이름. 라벨과 옅은 숫자가 같은 버튼 안이라 **이름에 개수가 함께
// 든다.** 수는 `WORKS`에서 파생한다 — 줄이 더해질 때마다(티켓 08의 멀티 프로젝트 work) 숫자를
// 손으로 고치지 않게, 그리고 이 이름을 드는 spec(`works-sidebar`·`sidebar-quiet`)이 따로 고치지
// 않게 여기 한 벌만 둔다.
export const PINNED_HEADER = `고정 ${WORKS.filter((work) => work.pinned).length}`;
export const MAIN_HEADER = `작업 ${WORKS.filter((work) => !work.pinned).length}`;

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
export const SEARCH_RESULTS: SearchResults = { hits: SEARCH_HITS };

/**
 * Maison에서 ⇧⇧를 눌렀을 때 오는 줄들. **Atelier의 답과 수도 값도 겹치지 않는다** — 겹치면
 * `mode`를 통째로 빠뜨려도 화면이 같아 보인다(`ROOMS` 머리말). 줄 수가 갈리는 것이 제일 굵은
 * 그물이다: 저쪽 답이 오면 넷이 서고 이쪽은 둘이다.
 *
 * 갈래가 둘인 것은 **도착지가 둘**이기 때문이다 — Room 자체와 그 안의 문서(같은 주소에
 * `file`이 얹힌다). 순서는 코어가 세우는 층 순서 그대로다(작업 → 문서).
 *
 * **아카이브 줄은 없다.** `/maison/archive/<slug>`로 가는 것은 순수 함수 층이 들고
 * (`hit-target.test.ts`), 이 층에서 그 화면을 세우려면 아카이브 목록도 세계별로 갈라야 하는데
 * 그 시나리오가 아직 없다 — **태우지 않는 스텁은 조용히 낡는다**(아래 `write_settings` 주석).
 */
export const MAISON_SEARCH_HITS: SearchHit[] = [
  { kind: "work", slug: ROOMS[1].slug, title: ROOMS[1].title, archived: false },
  {
    kind: "doc",
    slug: ROOMS[1].slug,
    title: ROOMS[1].title,
    // Room이 **실제로 가진** 문서여야 한다(위 `SEARCH_HITS` 머리말과 같은 규칙). 여기서는 한
    // 겹 더 물린다: Maison 쪽 `read_spec_file`에는 폴백이 없어, 목록에 없는 경로를 도착지로
    // 삼으면 본문이 조용히 되돌아가는 게 아니라 하네스가 그 자리에서 문다.
    path: ROOMS[1].specFiles[0],
    archived: false,
  },
];

export const MAISON_SEARCH_RESULTS: SearchResults = { hits: MAISON_SEARCH_HITS };

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
  hits: [
    // **`key`뿐이다**(결정 21). 라벨과 라우트는 프런트가 되찾는 것이고, 그 되찾기가 실제로
    // 도는지가 이 층이 보려는 것이라 — 여기에 라벨을 실으면 그것을 안 보고도 초록이 된다.
    { kind: "destination", key: "settings" },
    // **아래 둘은 거터를 재려고 있다**(결정 17·18). 위 고정 답이 문서 줄만 내므로, 이 답이
    // 아니면 **작업 줄과 본문 줄이 이 층에 영영 안 선다** — 그런데 「글자 시작점이 층을
    // 가로질러 하나다」는 층이 여럿 떠 있을 때만 재지는 성질이다. 순서는 코어의 층 순서
    // 그대로다(가는 곳 → 작업 → … → 본문): 프런트는 받은 순서로 그리므로 여기서 뒤집으면
    // 이 층이 실물과 다른 화면을 재게 된다.
    { kind: "work", slug: WORKS[1].slug, title: WORKS[1].title, archived: false },
    // **본문 줄이라야 스니펫이 선다.** 제목과 경로를 긴 쪽으로 잡는 것은 스니펫이 `grow`로
    // 남는 폭을 다 먹으면 **바닥이 안 재지기 때문이다** — 줄이 꽉 차야 `basis-1/3`이 실제로
    // 바닥으로 드러난다.
    {
      kind: "text",
      slug: WORKS[0].slug,
      title: WORKS[0].title,
      path: WORKS[0].specFiles[0],
      archived: false,
      snippet:
        "본문에서 맞은 문단을 한 줄로 편 것이다. 줄이 꽉 차도록 넉넉히 길게 둔다 — 짧으면 " +
        "스니펫이 바닥이 아니라 제 내용 폭으로 서서, 바닥을 재려는 검사가 아무것도 안 잰다.",
    },
  ],
};

/**
 * Maison 쪽에 심어 둔 질의. 위 `Settings`를 그대로 쓰지 **않는** 이유는 그 화면에 모드
 * 접두사가 없어서다 — 두 세계가 같은 `/settings`로 가므로, 고르고 나서도 어느 세계의 표에서
 * 주소를 풀었는지가 화면에 안 남는다. `Terminal`은 남는다(`/maison/terminal`).
 *
 * 라벨도 여기서 함께 걸린다: 코어는 `key`만 돌려주므로(결정 21) 줄에 말이 서려면 프런트가
 * **그 세계의 표에서** 되찾아야 한다.
 */
export const MAISON_SEARCH_DESTINATION_QUERY = "Ter";
export const MAISON_SEARCH_DESTINATION_RESULTS: SearchResults = {
  hits: [{ kind: "destination", key: "terminal" }],
};

/**
 * L3에서 우리 커맨드에 답하는 표. L4에서는 이 자리를 다리가 대신한다.
 * 이름이 낡는 것은 `src/tauri-commands.test.ts`가 Rust 등록부와 대조해 잡는다.
 *
 * **모드를 받는 커맨드는 여기 하나도 없다** — 아래 `FIXTURE_BY_MODE`가 전부 든다. 이름으로만
 * 답하는 줄을 남겨 두면 `mode`가 없거나 모르는 값인 호출이 그 줄로 조용히 떨어져, 이 층이
 * 세운 그물이 통째로 무력해진다(그 표의 머리말).
 *
 * **그 경계를 눈으로 지키지 않는다**(#187). `src/tauri-commands.test.ts`가 `commands.rs`에서
 * 「`mode: Mode`를 받는 명령」을 뽑아 이 표와 겹치는 이름이 하나라도 있으면 문다 — 새 명령이
 * 모드를 받기 시작했는데 답을 여기에 적는 것이 그 검사가 막는 실패다.
 */
/**
 * 픽스처의 `pty_spawn`이 답하는 셸 이름. **검사가 이 값을 여러 자리에서 쓴다** — 칸에 적히는
 * 이름이자, 그 칸이 spawn 응답을 받았다는 유일한 화면 신호다(`harness`의 `awaitSpawned`).
 */
export const FIXTURE_SHELL_NAME = "zsh";

/**
 * 부를 때마다 답의 한 값을 **하나씩 올리는** 커맨드: 커맨드 이름 → 그 답에서 올릴 키
 * (`harness`의 `incrementing`). 이름이 곧 하는 일이다 — 아래 표의 값은 **첫 값**이고,
 * 여기 적힌 커맨드는 부를 때마다 그 키가 1씩 커진 답을 받는다.
 *
 * `pty_spawn`이 늘 같은 id를 답하면 셸이 몇이든 백엔드 쪽 번호가 하나뿐이고, 백엔드가
 * **셸마다** 쏘는 값(`pty:running`, 그리고 이 판이 더할 것들)이 전부 맨 앞 칸에 앉는다
 * — `shellOfPty`가 그 id를 가진 첫 인스턴스를 주기 때문이다. 그래서 「서로 다른 상태의
 * 셸 둘」이라는 그림 자체를 못 세운다(terminal-tabs.spec.ts의 티켓 #198 마디).
 *
 * **고정 답 표에 함수를 둘 수 없어 여기가 따로 선다.** `responses`는 `addInitScript`의
 * 인자로 직렬화되어 브라우저로 건너가므로 함수는 그 길을 못 지난다 — 수를 올리는 일은
 * 브라우저 안에서 일어나야 하고, 여기는 **어느 커맨드의 어느 키인가**만 말한다.
 */
export const FIXTURE_INCREMENTING_KEYS: Record<string, string> = { pty_spawn: "id" };

export const FIXTURE_COMMANDS: Record<string, unknown> = {
  // **모드를 안 받는다** — Maison에는 프로젝트 등록부가 없어서(`commands.rs`의
  // `shared_projects_root`) 이 명령은 세계를 묻지 않는다. 그래서 이름으로 답해도 위 경계에
  // 안 걸린다.
  list_projects: PROJECTS,
  // 앱이 뜰 때 무조건 한 번 부른다(`main.tsx` → `loadTerminalSettings`). 목록 화면만 보는
  // 시나리오도 이 호출을 지나므로 표에 없으면 화이트리스트 탐지기가 그때마다 문다.
  //
  // **파일이 없는 상태를 답한다** — 그것이 첫 실행의 정상 경로이고(`settings.rs`의 `read`),
  // 고르지 않은 값이 `null`인 것도 그 파일의 규칙 그대로다. 여기서 글꼴 이름을 지어내면
  // 「값을 정하는 유일한 지점」이 `terminal-defaults.ts` 말고 하나 더 생긴다.
  read_settings: { terminal: { fontFamily: null, fontSize: null, theme: "dark" } } satisfies Settings,
  // 설정 화면의 **저장**이 나가는 자리(#206). 돌려주는 값은 쓰이지 않는다 — 화면이 보는
  // 것은 「실패하지 않았다」뿐이고, 그 뒤에 고른 값이 알림 배선으로 간다
  // (`SettingsPage.tsx`의 `useSectionSave`). 그 한 줄이 이 표에 이 이름이 있는 이유 전부다:
  // 답이 없으면 L3에서 쓰기가 거절당해 `save`가 오류 가지로 빠지고, 그러면 저장 뒤의
  // 배선을 재는 검사가 **아무것도 못 재면서 초록**이 된다.
  //
  // **태우는 시나리오와 함께 들어왔다** — 「설정에서 소리를 끄면 그 자리에서 조용해진다」
  // (`shell-notify.spec.ts`), 그리고 「알림 저장에 터미널 초안이 안 실린다」(`settings-save.spec.ts`).
  // **이 답은 쓰기를 기억하지 않는다** — 저장이 쓰기 직전에 다시 읽는 `read_settings`는 늘 위
  // 고정 값을 돌려준다(#225). 「그사이 저장된 값을 안 덮는다」는 그래서 L2가 잰다.
  // 태우지 않는 스텁은 조용히 낡는다는 것이 이 표의 규칙이고, 그래서 이 자리는 그 검사들이
  // 사는 동안만 정당하다.
  write_settings: null,
  // 설정 화면이 뜨자마자 한 번 부른다(#207). **깔린 것이 없는 상태를 답한다** — 그것이
  // 처음 여는 사람의 화면이고, 미리보기·경로·상태가 그때도 다 서는지를 L3가 본다.
  //
  // `preview`는 **짧은 합성**이다: 백엔드가 내는 진짜 조각을 여기 베껴 두면 병합 함수를
  // 고칠 때마다 이 표가 낡고, 그 낡음은 「미리보기가 실물과 같은가」를 재지도 못한다 —
  // 그 물음은 Rust 쪽 `the_preview_is_what_goes_into_an_empty_home`이 실물로 잰다.
  agent_hooks: [
    {
      agent: "claude",
      path: "~/.claude/settings.json",
      installed: false,
      error: null,
      writeError: null,
      preview: '{ "hooks": { "Stop": [] } }',
    },
    {
      agent: "codex",
      path: "~/.codex/config.toml",
      installed: false,
      error: null,
      writeError: null,
      preview: "[[hooks.Stop]]",
    },
  ] satisfies HookStatus[],
  // 판 05가 태운다 — 분할이면 본문에 **터미널 열이 함께 선다**(결정 87)므로 Works 화면을
  // 여는 것만으로 셸 하나가 뜬다. 앞 판까지는 문서 본문만 서서 이 길을 안 지났다.
  //
  // 프레임은 오지 않는다: 출력은 `onFrame` 채널로 오고 그 채널은 앱이 만든다 —
  // 여기서 답하는 것은 「띄웠다」 하나뿐이라 셸은 빈 화면으로 선다. 이 층에서 볼 것도
  // 그것뿐이다(진짜 바이트는 L4의 몫이고, 거기서도 안 탄다).
  // 남은 셋은 **id로 이미 뜬 셸을 가리킨다** — 그 셸의 세계는 뜰 때 pty에 굳으므로 인자에
  // 모드가 없다(`features/terminal/api.ts`). `pty_spawn`이 여기 없는 것도 같은 사정의
  // 반대쪽이다: 셸이 **뜨는** 순간에는 세계가 함께 나가므로(결정 10) 아래 표가 든다.
  //
  // 셸을 띄운 직후 한 번, 그리고 열 폭이 바뀔 때마다 나간다 — 분할 경계를 끄는 검사가
  // 바로 그 두 번째를 센다(works-split.spec.ts).
  pty_resize: null,
  // 닫기 직전에만 묻는다(결정 92). **`true`인 것은 물어야 하는 쪽을 태우기 위해서다** —
  // 셸 닫기 확인 창이 이 앱의 것인지(OS 시트가 아닌지)를 보는 검사가 그 길을 지난다.
  pty_command_running: true,
  pty_kill: null,
  // **타자를 치는 시나리오가 이 판에 생겼다**(#208 리뷰). 사람이 키를 친 직후의 첫 프레임만
  // xterm이 **동기로** 파싱하는데(`WriteBuffer.write`의 `_didUserInput` 갈래), 그 갈래에서
  // 출력 알림과 OSC의 순서가 뒤집히면 방금 선 앰버가 그 자리에서 꺼진다 — 그 순서를 재려면
  // 진짜 키를 쳐야 하고, 그러면 xterm의 `onData`가 이 커맨드로 나간다. 값은 안 쓰이지만
  // **답이 있어야 화이트리스트를 안 넘는다.**
  pty_write: null,
  // 프로젝트 화면의 기준 브랜치를 바꾸는 쓰기(판 3 — `projects-list.spec.ts`의 기준 브랜치 절). **모드를 안
  // 받는다** — 위 `list_projects`와 같은 등록부의 명령이다. 돌려주는 값은 쓰이지 않는다 — 성공하면 목록을 다시
  // 읽어 오는 것이 화면을 고치는 자리다(`useUpdateProject`). 그래서 답은 `null`이고, 바꾼 값을 **기억하지
  // 않는다** — 다시 읽은 목록은 그대로 `PROJECTS`다. 검사가 재는 것은 「무엇이 나갔나」이고 그것은 IPC 기록에 있다.
  update_project: null,
  // 종료 확인의 「종료」(UI개선 결정 14). 값은 안 쓰인다 — 검사가 보는 것은 **나갔는가**이고 그것은 IPC
  // 기록에서 읽는다(`quit-confirm.spec.ts`). 그래도 **답이 있어야 화이트리스트를 안 넘는다** —
  // 없으면 「종료」를 누르는 검사가 매번 모르는 호출을 지고 선다.
  quit_app: null,
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
  // **본문 열의 내용 폭이 창보다 넓은 문서**(`tab-row-floor.spec.ts`). 끊을 자리가 없는 한 줄과
  // 넓은 표 — 이 둘이 본문 열의 min-content를 창보다 크게 만든다. 그 폭이 탭 줄의 바닥에
  // 섞이면 작업 패널이 창 밖으로 밀린다.
  "넓은.md": [
    "# 넓은 문서",
    "",
    "```",
    "넓은줄".repeat(400),
    "```",
    "",
    `| ${Array.from({ length: 40 }, (_, at) => `열${at}`).join(" | ")} |`,
    `| ${Array.from({ length: 40 }, () => "---").join(" | ")} |`,
    `| ${Array.from({ length: 40 }, () => "끊기지않는칸값").join(" | ")} |`,
    "",
  ].join("\n"),
};

/**
 * Room 문서의 본문 — **Atelier 쪽과 한 글자도 안 겹친다.** 겹치면 `mode`가 어긋난 읽기가
 * 화면에서 안 보인다(`ROOMS` 머리말). 특히 위 `SPEC_FALLBACK_BODY`의 「한 줄.」이 여기 있으면,
 * Maison 화면이 Atelier 문서를 읽어 와도 검사가 통과한다.
 */
export const ROOM_SPEC_FILE_BODIES: Record<string, string> = {
  "개요.md": "# 읽는 방\n\n이 방에만 있는 문서다.\n",
};

// (`write_settings`는 위 표에 있다 — 설정 화면의 저장을 태우는 시나리오가 생기면서 그
// 시나리오와 함께 들어왔다. 아직 없는 것은 `plugin:opener|open_url` 쪽이고, 그 규율은
// harness.ts의 플러그인 표가 든다.)

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
 * 모드로 갈리는 커맨드의 **한 모드 몫**. 값 하나면 `value`, 인자를 한 겹 더 봐야 하면
 * `arg`·`answers`를 함께 든다(그 모드에 기본 답이 있으면 `value`도 같이).
 *
 * `value`가 **선택인 것이 그물이다**: 없으면 그 모드는 표에 적힌 인자 값에만 답하고 나머지는
 * 하네스가 문다. 폴백은 안 태우는 순간 낡으므로, 태울 것이 없는 모드는 안 두는 쪽이 맞다.
 * 칸을 통째로 비우면(`{}`) 그 세계의 그 명령은 **아무 답도 없다** — 아직 아무도 안 태우는
 * 세계를 그렇게 적는다. 지어낸 답을 앉히는 것보다 낫다: 지어낸 답은 그 화면이 생기는 날
 * 아무도 안 고치는 채로 초록을 준다.
 */
export interface ModeAnswer {
  readonly value?: unknown;
  readonly arg?: string;
  readonly answers?: Record<string, unknown>;
}

/**
 * **모드로 갈리는 커맨드의 답.** 위 이름 표보다 먼저 보고, **여기 있는 커맨드는 그 표로
 * 안 떨어진다** — 답을 못 찾으면 하네스가 문다(harness.ts).
 *
 * 그 fail-closed가 이 표의 존재 이유다. 백엔드는 이제 `mode`를 필수로 받지만(#187) 그 거절은
 * **실물에서만** 온다 — L3의 백엔드는 이 표이고, 이름으로만 답하는 표로 떨어지게 두면 `mode`가
 * 없거나 모르는 값인 호출이 조용히 Atelier 데이터를 받아 「Maison 화면인데 Atelier 것이 떴다」가
 * 아무 데도 안 걸린다. 그 fail-closed를 **음성 케이스로** 세우는 자리는
 * `e2e/mode-fail-closed.spec.ts`이고, 이 표의 이름을 그대로 훑으므로 줄이 늘면 저절로 따라온다.
 *
 * `Record<Mode, ModeAnswer>`가 둘째 그물이다: 모드가 하나 느는 날 칸을 빠뜨린 것을 L0가
 * 잡는다. 값이 실제로 갈려 있어야 하는 것은 타입이 못 보므로 그쪽은 `ROOMS` 머리말이 든다.
 *
 * **모드를 받는 커맨드는 전부 여기 있어야 한다**(#187) — 그 경계는 `src/tauri-commands.test.ts`가
 * `commands.rs`에서 뽑아 **양쪽으로** 지킨다: 이름 표에 있으면 물고, 여기 없어도 문다.
 * 그래서 아직 어느 시나리오도 안 태우는 커맨드도 여기 있고, 그 칸은 비어 있다
 * (`ModeAnswer` 머리말). 한 방향만 잠그면 새로 모드를 받기 시작한 커맨드가 **어느 표에도
 * 없는 채로** 초록이 되고, 그러면 위 음성 케이스가 그것을 안 본다.
 */
export const FIXTURE_BY_MODE: Record<string, Record<Mode, ModeAnswer>> = {
  list_works: { atelier: { value: WORKS }, maison: { value: ROOMS } },
  /**
   * **두 칸이 다 빈 둘.** work 한 건을 slug로 집어 읽거나 고치는 명령들이라 L3 시나리오가
   * 아직 하나도 안 태운다 — 목록 화면은 `list_works`가, 문서는 `read_spec_file`이 답한다.
   *
   * 그래도 **여기 있어야 한다.** 없으면 하네스가 이름 표로 떨어뜨리는 것이 아니라 화이트리스트
   * 탐지기로 보내니 당장은 똑같이 물리지만, 위 머리말이 든 경계가 그만큼 헐거워져 「전부
   * 여기 있다」가 거짓이 된다 — 그리고 `mode-fail-closed.spec.ts`의 음성 케이스가 이 표를
   * 훑으므로, 안 적힌 명령은 「mode를 빼면 답이 없다」를 **한 번도 안 재고** 지나간다.
   *
   * 답을 지어내 앉히지 않는 것은 위 `ModeAnswer` 머리말 그대로다. 이 중 하나를 태우는
   * 화면이 생기는 날 그 호출이 하네스에 물려, 그때 이 칸을 채우라고 말해 준다.
   */
  get_work: { atelier: {}, maison: {} },
  remove_work: { atelier: {}, maison: {} },
  /**
   * 이름 바꾸기 창에서 저장하면 나가는 쓰기(판 3 — `works-floating.spec.ts`의 이름 바꾸기 절). 돌려주는 값은
   * 쓰이지 않는다 — 성공하면 목록을 다시 읽어 오는 것이 화면을 고치는 자리다(`useSetWorkTitle`). 그래서 답은
   * 아래 `set_work_status`와 같은 `null`이고, 이름을 **기억하지 않는다**. 검사가 재는 것은 「무엇이 나갔나」다.
   * Maison 칸이 빈 것은 Room 이름 바꾸기를 태우는 시나리오가 아직 없어서다 — 그것을 잴 때 채운다.
   */
  set_work_title: { atelier: { value: null }, maison: {} },
  /**
   * 상태 메뉴에서 다른 상태를 고르면 나가는 쓰기(판 3 — `works-floating.spec.ts`의 상태 메뉴 절). 돌려주는
   * 값은 쓰이지 않는다 — 성공하면 목록을 다시 읽어 오는 것이 화면을 고치는 자리다(`useSetWorkStatus`).
   * 그래서 답은 `set_work_pinned`와 같은 `null`이다. 이 답은 상태를 **기억하지 않는다** — 다시 읽은 목록은
   * 그대로 `WORKS`라 배지가 옛 상태로 남는다. 검사가 재는 것은 「무엇이 나갔나」이고 그것은 IPC 기록에 있다.
   * Maison 칸이 빈 것은 아래 `list_archive`와 같은 이유다(Room 상태 메뉴를 태우는 시나리오가 아직 없다).
   */
  set_work_status: { atelier: { value: null }, maison: {} },
  /**
   * **Atelier 칸만 찼다** — 아카이빙이 셸을 거두는 자리(`closeShellsOf`)를 태우는 시나리오가
   * 생겼다(`shell-cold-start.spec.ts`). 답은 비어 있다: 코어가 돌려주는 것이 없고, 화면은
   * 성공인지만 본다. 목록은 그대로 그 work을 답하므로 행이 안 사라지지만, 거기서 재는 것은 셸뿐이다.
   */
  archive_work: { atelier: { value: null }, maison: {} },
  /**
   * 아카이브 목록. **Maison 칸이 비었다** — 저 세계의 아카이브를 여는 시나리오가 아직 없다.
   * 값을 지어내면 아무도 안 태우는 답이 되어 조용히 낡고(이 파일의 `write_settings` 주석과
   * 같은 규칙), 그 화면이 생기는 날 Maison에서 나간 첫 호출이 하네스에 물려 여기를 채우라고
   * 말한다.
   *
   * 한때 이 줄은 **이름 표에** 있었다(#187이 옮겼다). 거기서는 `mode`가 어긋난 호출도 답을
   * 받아, 「Maison 아카이브를 열었는데 Atelier 것이 떴다」가 이 층에 안 걸렸다.
   */
  list_archive: { atelier: { value: ARCHIVE }, maison: {} },
  /**
   * 아카이브의 문서 목록과 본문 — **인자를 한 겹 더 본다.** 한 시나리오가 아카이브 둘의
   * 서로 다른 목록을 보고, 그 안의 문서를 각각 연다.
   *
   * 두 칸 다 **폴백(`value`)이 없다.** 표에 없는 경로로 읽기가 나가면 그 자리에서 물려,
   * 아카이브가 그림을 **안 읽는다**는 것이 신호로 잡힌다(위 `ARCHIVED_FILE_BODIES` 머리말) —
   * 폴백을 두면 그 그물이 통째로 사라진다. Maison 칸이 빈 것은 위 `list_archive`와 같은 이유다.
   *
   * 이 둘은 한때 모드를 안 보는 **따로 있는 표**(`FIXTURE_BY_ARG`)가 들었다. #187이 이리로
   * 옮기면서 그 표는 마지막 줄까지 비어 통째로 사라졌다 — 하네스의 갈래도 함께 걷었다.
   */
  list_archived_docs: {
    atelier: { arg: "slug", answers: ARCHIVED_DOCS },
    maison: {},
  },
  read_archived_file: {
    atelier: { arg: "path", answers: ARCHIVED_FILE_BODIES },
    maison: {},
  },
  /**
   * 핀을 누르면 나가는 쓰기. 돌려주는 값은 쓰이지 않는다 — 성공하면 목록을 다시 읽어 오는
   * 것이 화면을 고치는 자리다(`useSetWorkPinned`). Maison 칸이 빈 것도, 이 줄이 이름 표에서
   * 온 것도 위 `list_archive`와 같다.
   */
  set_work_pinned: { atelier: { value: null }, maison: {} },
  /**
   * 작업 행을 끌어 놓으면 나가는 쓰기(UI개선 S3 · 티켓 05). 답은 **뒤집은 목록**이고 인자와
   * 무관하다(`WORKS_MOVED` 머리말) — 화면이 이 답으로 캐시를 갈아 끼우는지를 `work-row-drag.spec.ts`가
   * 그 순서로 잰다. 두 세계의 답이 갈리는 것은 `list_works`와 같은 이유다: 한 벌을 나눠 쓰면
   * 「maison으로 물었다」가 화면에서 안 갈린다.
   */
  move_work: { atelier: { value: WORKS_MOVED }, maison: { value: ROOMS_MOVED } },
  /**
   * **두 모드의 답이 같다 — 그래도 여기다.** spawn 응답(`{id, shellName}`)은 세계를 안 탄다:
   * pty 번호도 `$SHELL`의 basename도 어느 루트에서 떴는지와 무관하다. 여기서 답을 가르면
   * 그것은 실물에 없는 차이를 지어내는 것이라 「모드가 갈렸다」가 픽스처의 거짓말 위에 선다.
   *
   * 이 줄이 사는 이유는 **fail-closed 하나다.** 이름으로 답하는 표에 두면 `mode`를 빠뜨린
   * spawn도 답을 받아, 이 층은 조용히 초록인 채 Maison 터미널이 Atelier 홈에서 뜨는 것을
   * 못 본다. 여기 있으면 하네스가 그 자리에서 문다 — 실물 백엔드의 거절(#187)은 L3에 안 온다.
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
    atelier: { value: { id: 1, shellName: FIXTURE_SHELL_NAME } },
    maison: { value: { id: 1, shellName: FIXTURE_SHELL_NAME } },
  },
  /**
   * work 화면이 설 때마다 한 번 나간다(팔레트 결정 14). 답은 안 쓰인다 — 순서를 세우는 것은
   * 코어의 검색이고 화면은 이 값을 도로 안 읽는다. **표에서 빠뜨리면 work 화면을 여는
   * spec들이 한꺼번에 터지는데**, 하네스가 던지는 것을 react-query가 삼켜 콘솔에도 안 남는다.
   *
   * **두 칸이 다 `null`이다 — 그래도 여기다.** 답이 세계를 안 타는 것은 `pty_spawn`과 같은
   * 사정이고(위 머리말), 이 줄이 이름 표가 아니라 여기 사는 이유도 같다: 이력은 세계마다
   * 한 장이라 `mode`를 빠뜨린 호출은 저쪽 장부에 적는다. 이름으로 답하면 그 어긋남이 이
   * 층에서 조용히 초록이다.
   */
  touch_recent_work: { atelier: { value: null }, maison: { value: null } },
  read_spec_file: {
    atelier: { value: SPEC_FALLBACK_BODY, arg: "path", answers: SPEC_FILE_BODIES },
    // 폴백이 없다 — 위 `SPEC_FALLBACK_BODY` 머리말의 이유다. Room이 자기 목록에 없는 문서를
    // 읽으려 하면 그 자리에서 문다.
    maison: { arg: "path", answers: ROOM_SPEC_FILE_BODIES },
  },
  /**
   * 팔레트가 뜨자마자 한 번, 그리고 글자마다 다시 나간다 — 캐시도 디바운스도 없다.
   *
   * **두 세계의 답이 실제로 갈려 있다**(`MAISON_SEARCH_HITS`). 여기가 이름 표에 있으면 세계를
   * 안 실은 물음도 답을 받아, Maison에서 누른 ⇧⇧에 Atelier work이 서는 화면이 오류 하나 없이
   * 지나간다.
   *
   * 모드마다 **기본 답과 심어 둔 질의를 함께** 든다. 질의를 한 겹 더 보는 이유는 위
   * `SEARCH_DESTINATION_QUERY` 머리말이 들고, 나머지 질의는 전부 그 모드의 `value`로 떨어진다 —
   * 좁혀지는 규칙은 여기서 흉내내지 않는다.
   */
  search: {
    atelier: {
      value: SEARCH_RESULTS,
      arg: "query",
      answers: { [SEARCH_DESTINATION_QUERY]: SEARCH_DESTINATION_RESULTS },
    },
    maison: {
      value: MAISON_SEARCH_RESULTS,
      arg: "query",
      answers: { [MAISON_SEARCH_DESTINATION_QUERY]: MAISON_SEARCH_DESTINATION_RESULTS },
    },
  },
};

// **표가 낡으면 이 자리에서, 표를 가리키며 터진다.** 두 표를 잇는 것은 커맨드 이름 문자열
// 하나뿐인데, 하네스는 답을 찾은 커맨드에 대해서만 올릴 키를 찾아본다 — 이름이 틀렸거나
// 개명돼 짝이 끊기면 그 행은 **아무 데도 안 걸린 채 조용히 지나가고** `pty_spawn`은 다시 고정
// id를 답한다. 그때 나는 유일한 신호는 한참 뒤 `markRunning`이 「pty 2에 도는 칸이 안 생겼다」로
// 던지는 것이고, 그 말은 표가 아니라 검사를 가리켜 원인을 한 칸 옆으로 옮겨 놓는다.
//
// **모드 표를 본다** — 수를 올리는 유일한 커맨드(`pty_spawn`)가 #187에서 이 표로 옮겨 갔다.
// 모드마다 따로 세는 것이 아니라 값 하나가 호출 순서대로 오르므로(하네스의 `seen`), 여기서는
// **모든 칸의 첫 값이 수인가**를 본다 — 한 칸만 모양이 달라도 그 모드의 시나리오에서만
// `base + n`이 조용히 문자열이 된다.
for (const [cmd, key] of Object.entries(FIXTURE_INCREMENTING_KEYS)) {
  const forCmd = FIXTURE_BY_MODE[cmd];
  if (forCmd === undefined) {
    throw new Error(`수를 올릴 커맨드가 모드 표에 없습니다: ${cmd}`);
  }
  for (const [mode, answer] of Object.entries(forCmd)) {
    const value = answer.value as Record<string, unknown> | undefined;
    if (value === undefined || typeof value[key] !== "number") {
      throw new Error(`수를 올릴 값이 수가 아닙니다: ${cmd}.${mode}.${key}`);
    }
  }
}

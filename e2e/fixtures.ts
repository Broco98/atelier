import type { ArchivedDocs, ArchiveEntry } from "@/features/archive/types";
import type { ProjectView } from "@/features/projects/types";
import type { SearchHit, SearchResults } from "@/features/search/types";
import type { SpecTree, SpecTreeItem, WorkView } from "@/features/works/types";
import type { HookStatus, Settings } from "@/features/settings/types";
import { terminalSettings } from "@/features/settings/settings-fixture";
import type { StartupReport } from "@/components/shell/startup-report";
import type { ProcessesEnded } from "@/components/shell/processes-ended";
import type { CloseCheck } from "@/features/terminal/types";
import { snapshotFixture } from "@/features/processes/process-fixture";
import type { CleanupEvent, ProcessSnapshot, ProcessSummary, TrendPoint } from "@/features/processes/types";
import type {
  LayoutPreview,
  SaveAnswer,
  SpecLayoutState,
  UnreadableSpecLayout,
  ReadableSpecLayout,
} from "@/features/spec-layout/types";

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

/**
 * spec 트리를 **손으로 적는** 조각들(spec 레이아웃 구현 스펙 Testing 「앱」). 이 층의 백엔드는 이 표라
 * 엔진이 없다 — 트리는 엔진이 내장본으로 가른 모양을 옮겨 적은 것이고, 앱은 그것을 그대로 그린다.
 *
 * **아이콘은 레이아웃의 자리를 받은 것에만 있다.** 내장본에서 파일로 아이콘을 받는 것은 최상위
 * `overview.md`(`compass`) 하나다. 아이콘을 받은 파일 행은 확장자 라벨 대신 아이콘을 그리므로
 * (spec 레이아웃 티켓 05), 이름으로 행을 찾는 검사가 `overview.md`는 라벨 없이, `개요.md`는
 * `MD 개요.md`로 집는다. 그 둘이 지금 화면과 같게 하려고 `개요.md`에는 아이콘을 주지 않는다.
 */
const specFile = (path: string, icon: string | null = null): SpecTreeItem => ({
  name: path.slice(path.lastIndexOf("/") + 1),
  path,
  kind: "file",
  icon,
  group: null,
  children: [],
});
const specFolder = (path: string, children: SpecTreeItem[]): SpecTreeItem => ({
  ...specFile(path),
  kind: "folder",
  children,
});
/** 문서가 하나도 없는 work의 트리 — 기본 문서도 없다. */
const emptySpecTree = (): SpecTree => ({
  fallback: null,
  defaultDoc: null,
  items: [],
});

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
    // 내장본의 자리를 받는 것은 `overview.md`뿐이고 기본 문서도 그것이다. 나머지는 맞지 않은 것이라
    // 맨 뒤에 코드포인트순으로 선다(폴더는 이름 뒤에 `/`를 붙여 견준다).
    specTree: {
      fallback: null,
      defaultDoc: "overview.md",
      items: [
        specFile("overview.md", "compass"),
        specFile("메타.json"),
        specFolder("목업", [specFile("목업/조각.html")]),
        specFolder("증거", [specFile("증거/샷.png")]),
      ],
    },
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
    // **빈 spec 폴더의 work.** 트리도 비고 기본 문서가 없다 — 화면은 「아직 spec이 없어요」로 선다.
    specFiles: [],
    specTree: emptySpecTree(),
  },
  // **프로젝트가 둘인 work**(UI개선 결정 17~19·30). 새 셸 자리가 갈리는 곳이 이 모양 하나다 —
  // ⌘T는 「모든 프로젝트」(워크트리들의 부모 폴더)에, `+` 메뉴는 고른 프로젝트에 열고, 들어가도
  // 셸이 저절로 안 선다. 그 모양을 재는 검사가 여럿이라 고정 목록에 한 벌을 둔다.
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
    // 문서 둘 — 본문 열보다 넓은 문서(「넓은.md」)와 mermaid 블록 하나를 가진 문서(「다이어그램.md」)다.
    // 본문은 `SPEC_FILE_BODIES`에 있다. 첫 work에 두지 않는 것은 그 목록이 검색 답(`SEARCH_HITS`)의
    // 줄이라 줄 수를 재는 검사가 따라 흔들려서다.
    //
    // **새 문서는 뒤에 붙인다** — 파일을 안 고르고 들어오면 트리의 기본 문서(`specTree.defaultDoc` —
    // 내장본의 어느 자리에도 안 맞아 코드포인트순 첫 파일, 「넓은.md」)가 열린다. 뒤에 붙이는 이름은
    // 코드포인트순으로도 뒤에 서야 그 화면이 그대로다.
    specFiles: ["넓은.md", "다이어그램.md"],
    // 내장본의 어느 자리에도 안 맞는다 — 기본 문서 후보가 없어 첫 파일이 기본 문서다.
    specTree: {
      fallback: null,
      defaultDoc: "넓은.md",
      items: [specFile("넓은.md"), specFile("다이어그램.md")],
    },
  },
];

/**
 * 작업 행을 끌어 놓았을 때 `move_work`가 돌려주는 목록(UI개선 티켓 05). **인자와 무관한 한 벌이고,
 * 원래 목록을 뒤집어 짓는다** — fixture 백엔드에는 상태가 없어 「옮긴 결과」를 지을 수 없으니,
 * 원래와 **확실히 다른** 순서를 주어 「응답으로 캐시를 갈아 끼웠다」를 화면에서 잰다.
 *
 * 리터럴로 적지 않고 파생한다: `WORKS` 끝에 줄이 더해져도(티켓 08) 이 값이 저절로 따라온다.
 * 뒤집어도 `pinned`는 그대로라 화면의 구획은 안 흔들리고 구획 **안** 순서만 뒤집힌다.
 */
export const WORKS_MOVED: WorkView[] = [...WORKS].reverse();

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
 * 레이아웃 상태(spec 레이아웃 티켓 08) — 고친 폴더(템플릿 1개)다. 모양은 엔진의 `layout_state`가 내는
 * 그대로이고(다리로 실물과 맞춰 봤다), 폴더는 기본 데이터 루트에서 홈을 `~`로 줄인 경로다 — 설정 페이지는
 * 이것에 `/`만 붙여 참조로 복사한다.
 */
export const SPEC_LAYOUT_STATE: SpecLayoutState = {
  folder: "~/.atelier/layouts/atelier",
  edited: true,
  errors: [],
  fallback: null,
  templateCount: 1,
  otherFileCount: 0,
};

/** 폴더가 아직 없는 레이아웃 — 내장본 그대로다. 되돌릴 것이 없어 ⋯ 메뉴가 안 선다. */
export const BUILTIN_LAYOUT_STATE: SpecLayoutState = {
  ...SPEC_LAYOUT_STATE,
  edited: false,
  templateCount: 0,
};

/**
 * 읽지 못해 내장본으로 물러선 레이아웃 — `layout.json`의 셋째 항목에 `kind`가 없다. 오류와 까닭의 글은
 * 엔진이 그 파일에 내는 것 그대로다. 무엇이 템플릿인지 모르므로 템플릿 개수가 없다.
 */
export const BROKEN_LAYOUT_STATE: SpecLayoutState = {
  folder: "~/.atelier/layouts/atelier",
  edited: true,
  errors: [{ path: [2], message: '`kind` is missing ("file" or "folder")' }],
  fallback: 'root.children[2]: `kind` is missing ("file" or "folder")',
  templateCount: null,
  otherFileCount: 1,
};

/**
 * 편집기가 여는 Atelier 레이아웃(spec 레이아웃 티켓 11) — 위 상태의 「고친 폴더, 템플릿 1개」와 같은
 * 폴더다. 모양은 엔진의 `read_layout`이 내는 그대로이고(다리로 실물과 맞춰 봤다), **손으로 적은 모르는
 * 키가 둘** 섞여 있다 — 레이아웃 층의 `owner`와 항목 층의 `since`. 편집기가 한 칸을 고쳐 저장해도 그
 * 둘이 저장에 실려야 한다. 템플릿 본문은 저장에 **늘 전부** 돌아간다.
 */
export const SPEC_LAYOUT_READ: ReadableSpecLayout = {
  folder: "~/.atelier/layouts/atelier",
  edited: true,
  layout: {
    owner: "사람",
    root: {
      description: "spec 폴더의 방침 문단.",
      children: [
        { pattern: "overview.md", kind: "file", icon: "compass", description: "work의 요약" },
        {
          pattern: "decisions.md",
          kind: "file",
          description: "정한 것과 그 이유",
          template: "decisions.md",
          since: "0.14",
        },
        {
          pattern: "{n}-{name}",
          kind: "folder",
          icon: "layers",
          description: "판 하나",
          children: [
            { pattern: "tickets", kind: "folder", icon: "list-checks", description: "그 판의 티켓" },
          ],
        },
      ],
    },
  },
  templates: { "decisions.md": "# 결정\n" },
  warnings: [],
};

/**
 * 템플릿 파일이 디스크에서 사라진 Atelier 레이아웃(spec 레이아웃 티켓 12) — 위 읽기와 같은 레이아웃인데
 * `decisions.md` 항목이 가리키는 템플릿 파일이 폴더에 없다. 읽기는 그 본문 없이 누락 경고를 준다(경고의
 * 글은 엔진이 내는 그대로다). 편집기는 그 항목을 「있음」, 빈 본문 칸, 경고로 세운다.
 */
export const MISSING_TEMPLATE_READ: ReadableSpecLayout = {
  ...SPEC_LAYOUT_READ,
  templates: {},
  warnings: ["missing template for `decisions.md`: ~/.atelier/layouts/atelier/decisions.md"],
};

/**
 * 읽지 못하는 레이아웃 — 위 `BROKEN_LAYOUT_STATE`와 같은 폴더를 편집기가 읽은 답이다. 오류와 원문은
 * 엔진이 그 파일에 내는 그대로다. 편집기는 이때 편집 UI를 세우지 않는다. 편집기가 연 뒤에 **밖에서 깨진**
 * 레이아웃(티켓 15)도 이 답이다 — 그쪽은 도중에 읽기의 답으로 갈아 끼운다.
 */
export const UNREADABLE_ATELIER_READ: UnreadableSpecLayout = {
  folder: "~/.atelier/layouts/atelier",
  edited: true,
  errors: [{ path: [2], message: '`kind` is missing ("file" or "folder")' }],
  raw: '{ "root": { "children": [ { "pattern": "a.md", "kind": "file" }, { "pattern": "b", "kind": "folder" }, { "pattern": "c.md" } ] } }\n',
};

/**
 * 편집기가 연 뒤에 **밖에서 고쳐진** Atelier 레이아웃(spec 레이아웃 티켓 15) — `SPEC_LAYOUT_READ`에서 에이전트가
 * `decisions.md` 항목의 설명 한 칸을 고쳐 저장한 것이다. 처음부터 답하면 편집기가 이것을 기준본으로 읽으므로,
 * 시나리오 도중에 읽기의 답으로 갈아 끼운다(`harness`의 `replaceAnswer`).
 */
export const CHANGED_SPEC_LAYOUT_READ: ReadableSpecLayout = {
  ...SPEC_LAYOUT_READ,
  layout: {
    ...SPEC_LAYOUT_READ.layout,
    root: {
      ...SPEC_LAYOUT_READ.layout.root,
      children: SPEC_LAYOUT_READ.layout.root.children!.map((entry) =>
        entry.pattern === "decisions.md" ? { ...entry, description: "정한 것, 그 이유, 에이전트가 더한 버린 안" } : entry,
      ),
    },
  },
};

/** 저장이 된 답 — 검증 오류가 없다. 거절은 문자열이 아니라 이 모양의 `errors`로 온다. */
export const SPEC_LAYOUT_SAVED: SaveAnswer = { errors: [] };

/**
 * 편집기의 미리보기 답(spec 레이아웃 티켓 14) — **오류 없음 + 고정 글.** 글과 항목의 줄은 엔진의 `preview_layout`이 위
 * 읽기(`SPEC_LAYOUT_READ`)를 고치지 않은 초안에 내는 그대로다(엔진으로 맞춰 봤다). 하네스는 인자마다 다른 답을 주지
 * 못하므로 초안을 고쳐도 이 글이 온다 — 「고친 초안이 실려 나갔다」는 IPC 기록으로 잰다.
 */
export const SPEC_LAYOUT_RENDERED: LayoutPreview = {
  text: [
    "Spec layout — how to arrange documents inside `specDir`.",
    "",
    "spec 폴더의 방침 문단.",
    "",
    "  overview.md   work의 요약",
    "  decisions.md  정한 것과 그 이유",
    "                Template: ~/.atelier/layouts/atelier/decisions.md",
    "  {n}-{name}/   판 하나",
    "    tickets/    그 판의 티켓",
    "",
    "`{n}` is a number and `{name}` is any name without `/`. A trailing `/` marks a folder, and indentation shows " +
      "what goes inside it. Where a file has a `Template:` line, read that template before you create the file " +
      "and follow its shape.",
  ].join("\n"),
  lines: [
    { path: [], start: 2, count: 1 },
    { path: [0], start: 4, count: 1 },
    { path: [1], start: 5, count: 2 },
    { path: [2], start: 7, count: 1 },
    { path: [2, 0], start: 8, count: 1 },
  ],
  errors: [],
  warnings: [],
};

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
 * **고정 답 표에 함수를 둘 수 없어 여기가 따로 선다.** 표(하네스의 `byName`)는 `addInitScript`의
 * 인자로 직렬화되어 브라우저로 건너가므로 함수는 그 길을 못 지난다 — 수를 올리는 일은
 * 브라우저 안에서 일어나야 하고, 여기는 **어느 커맨드의 어느 키인가**만 말한다.
 *
 * **셸 키도 그 수를 따라 오른다**(프로세스 스펙 S34 · 티켓 23). 셸 키는 `<세대>-<PTY 번호>`라 번호가 오르면 키도
 * 함께 갈려야 한다 — 수만 올리고 키를 고정 답으로 두면 셸이 몇이든 키가 하나뿐이라, 키로 셸을 찾는 길(방금 부른
 * 셸로 · 알림 클릭)이 늘 첫 셸로 간다. 그래서 줄마다 **오른 수를 뒤에 붙여 다시 짓는 글자 칸**을 함께 적는다.
 */
export interface Incrementing {
  /** 부를 때마다 1씩 올리는 수의 칸. */
  key: string;
  /** 오른 수를 뒤에 붙여 다시 짓는 칸: 칸 이름 → 앞말. 표의 첫 값도 `앞말 + 첫 수`여야 한다(아래 자기 검사). */
  follow: Record<string, string>;
}

/**
 * 픽스처 백엔드의 **세대** — 셸 키의 앞머리(`<세대>-<PTY 번호>`, Rust `processes/shell_key.rs`의 `mint`). 훅 사건을 흉내 내는
 * 손잡이(`harness`의 `fireAttention`)가 셸 id를 이것으로 짓는다 — 두 자리가 같은 값을 봐야 셸 키와 훅의 셸 id가
 * 같은 셸을 가리킨다(실물에서 둘은 같은 문자열 하나다).
 */
export const FIXTURE_GENERATION = "l3";

export const FIXTURE_INCREMENTING_KEYS: Record<string, Incrementing> = {
  pty_spawn: { key: "id", follow: { shellKey: `${FIXTURE_GENERATION}-` } },
};

/**
 * 픽스처의 `pty_spawn`이 **n번째로 띄운 셸**(pty n)에 준 셸 키 — 위 줄이 짓는 `<세대>-<번호>`다. 스냅샷 픽스처의 풀 ·
 * 판정이 이 키를 실으면 `Processes` 화면이 스토어의 그 셸과 잇는다(실물에서 둘이 같은 셸 키 하나인 것과 같다).
 */
export const shellKeyOf = (pty: number): string => `${FIXTURE_GENERATION}-${pty}`;

/**
 * `Processes` 화면의 스냅샷(티켓 26)이 기본으로 답하는 것 — **아무 셸도 없고 판정이 가른 것도 없는 앱**이다. 화면을 여는 검사만
 * 부르므로 모든 spec이 지나는 답은 아니지만, 이름 표에 서야 시나리오가 덮어쓴다(`installFixtureBackend`의 덮어쓰기).
 *
 * 풀을 비워 두는 것은 픽스처의 셸이 여기 안 서게 하려는 것이다 — 픽스처의 `pty_spawn`이 띄운 셸과 이 답의 풀은 서로를 모른다.
 * 기본 답에 셸이 서 있으면 화면을 여는 모든 검사가 스토어가 모르는 셸(32의 화면 밖 셸)을 지고 선다. 셸 수를 재는 검사가 제
 * 풀로 덮는다(`processes.spec.ts`).
 *
 * 모양은 L2와 같은 한 자리(`process-fixture.ts`의 `snapshotFixture`)가 짓는다 — 스냅샷을 덮어쓰는 spec도 그것을 불러 제 칸만 고치고,
 * 행 · 풀의 셸 · 지표도 거기서 짓는다.
 */
export const PROCESS_SNAPSHOT: ProcessSnapshot = snapshotFixture();

/**
 * nav 메타의 요약(티켓 29)이 기본으로 답하는 것 — **손볼 것이 하나도 없는 앱**이다: 출처 불명도, `●`를 켜는 정리 기록도 없다. 그래서
 * 어느 화면에서든 nav `Processes` 옆에 합계만 서고 `●`는 안 선다. 합계 · CPU · 앱 본체는 프로세스 결정 10 그림의 「아틀리에 합계 3.4GB … CPU
 * 42% … 앱 본체 610MB」다. **웹뷰를 센 앱이다**(티켓 30 — WebContent 귀속 시험이 됐다) — 「웹뷰 제외」는 그것을 재는 검사가 덮어 세운다.
 *
 * **모든 spec이 지나는 답이다** — nav 메타가 모든 화면에 서서 앱이 뜨자마자 묻는다(시작 보고와 같은 논리). 이름 표에 서야
 * 시나리오가 덮어쓰고(`installFixtureBackend`), 뜬 뒤에 갈아 끼운다(`replaceAnswer` — `●`를 켜는 검사).
 */
export const PROCESS_SUMMARY: ProcessSummary = {
  total: 3_650_722_202,
  cpu: 42,
  app: 639_631_360,
  webviewExcluded: false,
  unknown: [],
  recordHead: null,
};

/** 위 요약에서 `over`의 칸만 바꾼 것 — 합계 · `●`를 켜는 것을 재는 검사가 제 칸만 덮어쓴다. */
export const summaryWith = (over: Partial<ProcessSummary>): ProcessSummary => ({ ...PROCESS_SUMMARY, ...over });

/**
 * 요약 카드의 추이(티켓 30)가 기본으로 답하는 것 — **막 뜬 앱**이라 아직 한 점도 없다. `Processes` 화면을 여는 검사만 부르므로(요약이
 * 올 때마다 한 번) 모든 spec이 지나는 답은 아니지만, 이름 표에 서야 화면을 여는 검사가 화이트리스트 탐지기에 안 물리고 시나리오가
 * 덮어쓴다(`processes-summary.spec.ts`).
 */
export const PROCESS_TREND: TrendPoint[] = [];

/**
 * 정리 기록(티켓 32)이 기본으로 답하는 것 — **빈 기록**이다: 앱이 아직 아무것도 안 끝냈다. `Processes` 화면이 스냅샷이 올 때마다 한 번
 * 부르므로 화면을 여는 검사가 모두 지난다. 기록을 재는 검사가 덮어쓴다(`processes-shells.spec.ts`).
 */
export const CLEANUP_LOG: CleanupEvent[] = [];

/** 시작 정리가 `count`개를 끝낸 시작 보고(`startup_report`의 답). 무엇을 끝냈는지는 토스트가 안 적는다 — 수만 본다. */
export const startupCleaned = (count: number): StartupReport => ({
  cleaned: Array.from({ length: count }, (_, i) => ({ pid: 40_000 + i, name: "node" })),
  hooksUpdated: [],
});

/** 셸 `shellId`가 스스로 끝나며 그 셸에서 띄운 것을 `count`개 끝냈다는 이벤트(`processes:ended`)의 실을 것. */
export const shellExitEnded = (shellId: number, count: number): ProcessesEnded => ({ reason: "shellExit", shellId, count });

/**
 * 닫기 전 물음(`pty_close_check` · `pty_close_checks`)에 **조용하지 않은 셸**이 주는 답 — 명령이 돈다(띄운 프로세스는 0).
 * claude가 대답하는 셸의 모양이다. MCP 아카이브는 이 셸을 닫지 않고 주인 잃은 셸로 남기고, 셸 하나의 닫기는 확인 창으로 묻는다.
 */
export const BUSY_SHELL: CloseCheck = { command: true, descendants: 0 };

/**
 * 닫기 전 물음에 **조용한 셸**이 주는 답 — 명령도 사람이 띄운 프로세스도 없다(셸 도우미는 Rust가 이미 뺀 수다). 묻지 않고
 * 닫히는 셸이다.
 */
export const QUIET_SHELL: CloseCheck = { command: false, descendants: 0 };

/**
 * 경로별 답이 없을 때 내는 한 줄. 사이드바 검사가 spec 파일이 있는 work으로 옮겨
 * 가면서 태운다 — 본문 뷰어가 문서를 읽는다. **한 줄이면 족하다**: 그 검사가 보는 것은
 * 사이드바이고, 문서 렌더의 규칙은 SpecViewer.test.tsx가 든다.
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
  // **mermaid 블록 하나를 가진 문서**(`works-floating.spec.ts`의 전체화면 · Mermaid 「코드」). 다이어그램은
  // 일부러 작다 — 전체화면이 창에 맞춘 배율이 100%가 아니게 되어(상한 300%에 닿는다) 「맞춤 배율로
  // 열렸다」가 화면에서 갈린다.
  "다이어그램.md": [
    "# 다이어그램 문서",
    "",
    "```mermaid",
    "graph LR",
    "  A[시작] --> B[끝]",
    "```",
    "",
  ].join("\n"),
};

// (`write_settings`는 위 표에 있다 — 설정 화면의 저장을 태우는 시나리오가 생기면서 그
// 시나리오와 함께 들어왔다. 아직 없는 것은 `plugin:opener|open_url` 쪽이고, 그 규율은
// harness.ts의 플러그인 표가 든다.)

/**
 * 아카이브의 문서 답 — **slug별**이다. 경로는 work 루트 기준이라 기록(`record.md`)과
 * spec(`spec/…`)이 한 목록에 함께 오고, 기록이 맨 앞이다(코어 `list_archived_docs`). 그중 `spec/`
 * 아래를 엔진이 가른 spec 트리가 같은 답에 실린다 — 경로는 spec 기준이다.
 *
 * 파일 종류 표의 세 줄을 담는다: `.md` · 그림 · `.html`. **뒤에 더한다** — 위 `specFiles`와
 * 같은 규칙이다(검사가 목록을 자리로 집을 수 있다).
 *
 * **최상위 `tickets/`가 든다**(spec 레이아웃 구현 스펙 7절 허용 차이 4). 내장본에서 `tickets/`는 판
 * 폴더 안의 자리라, 최상위의 것은 맞지 않은 폴더로 아이콘 없이 선다 — 이름으로 알아보던 앱은 여기
 * `list-checks`를 줬다. 트리는 엔진이 내장본으로 가른 모양을 옮겨 적은 것이다(다리로 확인했다): 맞은
 * 것이 없어 셋 다 맨 뒤에 코드포인트순으로 서고, 기본 문서도 코드포인트순 첫 파일이다. 아카이브
 * 화면은 그 기본 문서를 쓰지 않고 목록의 첫 문서를 연다.
 *
 * `bare-archive`가 빈 목록인 것은 지어낸 상태가 아니다 — 손으로 옮겨 둔 폴더에는 기록이 없고,
 * 코어도 없으면 안 넣는다.
 */
export const ARCHIVED_DOCS: Record<string, ArchivedDocs> = {
  "shipped-work": {
    docs: ["record.md", "spec/증거/샷.png", "spec/목업/조각.html", "spec/tickets/할일.md"],
    specTree: {
      fallback: null,
      defaultDoc: "tickets/할일.md",
      items: [
        specFolder("tickets", [specFile("tickets/할일.md")]),
        specFolder("목업", [specFile("목업/조각.html")]),
        specFolder("증거", [specFile("증거/샷.png")]),
      ],
    },
  },
  "bare-archive": { docs: [], specTree: emptySpecTree() },
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
  "spec/tickets/할일.md": "# 치운 일의 할 일\n\n남은 것 하나.\n",
};

/**
 * 표의 한 줄을 **브라우저가 푸는 모양**(`harness.ts`의 `pick`). 값 하나면 `value`, 인자를 한 겹 더 봐야 하면
 * `arg`·`answers`를 함께 든다(기본 답이 있으면 `value`도 같이).
 *
 * `value`가 **선택인 것이 그물이다**: 없으면 그 줄은 적힌 인자 값에만 답하고 나머지는 하네스가 문다.
 *
 * 인자 값은 **문자열로 바꿔** 견주고, `arg`가 호출에 **아예 없으면** `value`가 있어도 문다.
 */
export interface AnswerEntry {
  readonly value?: unknown;
  readonly arg?: string;
  readonly answers?: Record<string, unknown>;
}

/**
 * **인자별 답**(프로세스 관리 티켓 01) — 위 `AnswerEntry`의 `arg` · `answers`로 풀린다(`harness.ts`의 `pick`). 받는
 * 자리는 고정 표(`FIXTURE_COMMANDS`)와 `installFixtureBackend`의 덮어쓰기, `replaceAnswer`다. 인자에 맞는 답이 없으면
 * **기본 답**으로 간다 — `otherwise`를 주면 그것이고, 안 주면 덮어쓰기 · 답 바꾸기에서는 고정 표의 기본 답이다.
 * 둘 다 없으면 하네스가 문다.
 *
 * **무엇을 재려고 있는가**: 셸마다 다른 답. 이름 표의 덮어쓰기는 커맨드 이름에 값 하나라, 셸 id를
 * 인자로 받는 커맨드(`pty_close_check`)가 셸 둘에 다른 말을 못 했다(`quit-confirm.spec.ts`의 「세기」
 * 머리말). 「조용한 셸은 닫히고 조용하지 않은 셸은 남는다」를 한 시나리오로 세우려면 이것이 있어야 한다.
 *
 * **무엇을 잘못 쓰면 헛도는가**
 * - 표의 키는 문자열이고(JS 객체의 키) 하네스가 **인자를 문자열로 바꿔** 견준다 — `{ 1: … }`는 수 `1`과
 *   문자열 `"1"`에 함께 맞는다. 수와 문자열을 갈라야 하는 인자에는 못 쓴다.
 * - 맞는 답이 없으면 기본 답이 조용히 온다. **기본 답과 같은 값을 인자별로 적으면** 표가 안 먹어도
 *   초록이다 — 가르려는 셸에는 기본 답과 다른 값을 준다.
 * - 인자 이름(`arg`)이 호출에 **아예 없으면** 하네스가 문다(기본 답으로 안 떨어진다). 인자 이름이 바뀌면
 *   조용히 기본 답을 받는 대신 그 자리에서 빨개지라는 것이다.
 */
export class ArgAnswers {
  readonly arg: string;
  readonly answers: Readonly<Record<string, unknown>>;
  /** 인자에 맞는 답이 없을 때의 답. 칸으로 싸 둔 것은 `null` · `undefined`도 답일 수 있어서다. */
  readonly otherwise?: { readonly value: unknown };
  constructor(arg: string, answers: Readonly<Record<string, unknown>>, otherwise?: { readonly value: unknown }) {
    this.arg = arg;
    this.answers = answers;
    this.otherwise = otherwise;
  }
}

/** `arg` 인자의 값마다 다른 답. 키는 인자 값을 문자열로 적은 것이다(`ArgAnswers` 머리말). */
export const answerByArg = (
  arg: string,
  answers: Readonly<Record<string, unknown>>,
  options?: { readonly otherwise: unknown },
): ArgAnswers => new ArgAnswers(arg, answers, options && { value: options.otherwise });

/**
 * L3에서 우리 커맨드에 답하는 표. L4에서는 이 자리를 다리가 대신한다.
 * 이름이 낡는 것은 `src/tauri-commands.test.ts`가 Rust 등록부와 대조해 잡는다.
 *
 * 값은 답 그대로이거나 인자별 답(`answerByArg`)이다. 페이지를 열 때 덮어쓰는 것은 `installFixtureBackend`,
 * 뜬 뒤에 가는 것은 `replaceAnswer`다(`harness.ts`).
 *
 * **아직 어느 시나리오도 태우지 않는 명령은 표에 없다**(`get_work` · `remove_work` 등) — 답을 지어내 앉히지 않는다. 그
 * 명령을 태우는 화면이 생기는 날 그 호출이 화이트리스트 탐지기에 물려, 이 표에 줄을 더하라고 말해 준다.
 */
export const FIXTURE_COMMANDS: Record<string, unknown> = {
  list_projects: PROJECTS,
  // 앱이 뜰 때 무조건 한 번 부른다(`main.tsx` → `loadTerminalSettings`). 목록 화면만 보는
  // 시나리오도 이 호출을 지나므로 표에 없으면 화이트리스트 탐지기가 그때마다 문다.
  //
  // **파일이 없는 상태를 답한다** — 그것이 첫 실행의 정상 경로이고(`settings.rs`의 `read`),
  // 고르지 않은 값이 `null`인 것도 그 파일의 규칙 그대로다. 여기서 글꼴 이름을 지어내면
  // 「값을 정하는 유일한 지점」이 `terminal-defaults.ts` 말고 하나 더 생긴다. 구획의 모양은 L2와 같은 한 자리
  // (`settings-fixture.ts`의 `terminalSettings`)가 짓는다 — 설정을 덮어쓰는 spec도 그것을 불러 제 칸만 고친다.
  read_settings: { terminal: terminalSettings() } satisfies Settings,
  // 예외 목록의 기본값(프로세스 스펙 S7). 설정 › 터미널이 열릴 때 한 번 부른다(`SettingsPage.tsx`) — 그 페이지를
  // 여는 spec이 모두 지나므로 표에 선다. 파일의 `processExceptions`가 `null`이면 칸에 이 목록이 보인다.
  //
  // **진짜 목록을 베껴 적지 않는다.** 값을 정하는 자리는 Rust 상수 하나이고(`processes/exceptions.rs`의
  // `DEFAULTS`), 그것이 프로세스 결정 5의 이름을 다 드는지는 그쪽 L1이 잰다. 이 층이 재는 것은 「백엔드가 준 목록을 칸에
  // 보이고, 고친 것을 저장에 싣는다」라 짧은 합성으로 족하다 — 진짜처럼 적어 두면 그쪽이 바뀔 때 조용히 낡는다.
  default_process_exceptions: ["tmux", "docker*"],
  // 시작 보고(프로세스 스펙 S11). 위 설정 읽기처럼 **앱이 뜰 때 한 번** 부른다(`main.tsx` →
  // `loadStartupReport`) — 그래서 이 줄이 없으면 모든 spec이 화이트리스트 탐지기에 물린다.
  //
  // **아무것도 안 한 시작을 답한다**(정리 0, 훅 갱신 없음) — 지난 실행이 깨끗하게 끝났으면 그것이
  // 정상 경로이고, 토스트가 안 서는 쪽이다. 정리 토스트를 재는 검사만 덮어쓴다(`startup-report.spec.ts`).
  startup_report: { cleaned: [], hooksUpdated: [] } satisfies StartupReport,
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
      installed: "none",
      error: null,
      writeError: null,
      preview: '{ "hooks": { "Stop": [] } }',
    },
    {
      agent: "codex",
      path: "~/.codex/config.toml",
      installed: "none",
      error: null,
      writeError: null,
      preview: "[[hooks.Stop]]",
    },
  ] satisfies HookStatus[],
  // 설정의 「spec 레이아웃」 페이지가 열릴 때와 [다시 읽기]에 나간다(spec 레이아웃 티켓 08). **인자가
  // 없다** — 레이아웃은 하나다(ui-refresh 결정 23). 태우는 시나리오는 `spec-layout-page.spec.ts`다.
  spec_layout_state: SPEC_LAYOUT_STATE,
  // 설정의 ⋯ → 「기본값으로 되돌리기」가 확인을 거친 뒤에 나간다(티켓 10). 답은 쓰이지 않는다 — 화면은
  // 「실패하지 않았다」만 보고 상태를 다시 부른다. 인자가 없다. 태우는 시나리오는 `spec-layout-page.spec.ts`다.
  revert_spec_layout: null,
  // 편집기가 열릴 때 한 번 나간다(티켓 11). 인자가 없다. 태우는 시나리오는 `spec-layout-editor.spec.ts`다.
  read_spec_layout: SPEC_LAYOUT_READ,
  // 편집기의 [저장]이 나간다(티켓 11). **검증 거절도 성공 답이다** — 오류를 재는 시나리오는 이것을 오류
  // 데이터로 덮어쓴다(`ipcFailure`가 아니다). 태우는 시나리오는 `spec-layout-editor.spec.ts`다.
  write_spec_layout: SPEC_LAYOUT_SAVED,
  // 편집기가 초안이 바뀔 때마다 짧은 지연 뒤에 나간다 — 연 초안에도 한 번 나간다(티켓 14). 그래서 **편집기를 여는
  // 시나리오는 모두 이것을 부르고**, 저장 버튼은 지금 초안의 답이 도착해야 풀린다. 초안이 무엇이든 같은 답을 받는다. 오류를
  // 재는 시나리오는 이것을 오류 데이터로 덮어쓴다. 태우는 시나리오는 `spec-layout-editor.spec.ts`다.
  render_spec_layout: SPEC_LAYOUT_RENDERED,
  // 판 05가 태운다 — 분할이면 본문에 **터미널 열이 함께 선다**(결정 87)므로 Works 화면을
  // 여는 것만으로 셸 하나가 뜬다. 앞 판까지는 문서 본문만 서서 이 길을 안 지났다.
  //
  // 프레임은 오지 않는다: 출력은 `onFrame` 채널로 오고 그 채널은 앱이 만든다 —
  // 여기서 답하는 것은 「띄웠다」 하나뿐이라 셸은 빈 화면으로 선다. 이 층에서 볼 것도
  // 그것뿐이다(진짜 바이트는 L4의 몫이고, 거기서도 안 탄다).
  // 셸을 띄운 직후 한 번, 그리고 열 폭이 바뀔 때마다 나간다 — 분할 경계를 끄는 검사가
  // 바로 그 두 번째를 센다(works-split.spec.ts).
  pty_resize: null,
  // 셸을 닫기 직전에만 묻는다 — 명령이 도는가와 함께 끝날 프로세스 수(프로세스 결정 3이 ux-papercuts 결정 92의
  // 「명령이 도는가」를 넓혔다). **명령이 도는 답인 것은 물어야 하는 쪽을 태우기 위해서다** — 셸 닫기 확인 창이 이
  // 앱의 것인지(OS 시트가 아닌지)를 보는 검사가 그 길을 지난다. 수는 0이다: 창의 둘째 줄은 그것을 재는 검사
  // (`close-confirm-count.spec.ts`)가 덮어 세운다.
  pty_close_check: BUSY_SHELL,
  // 셸 여럿의 닫기 전 물음(티켓 08) — 종료 확인 창과 아카이브 확인 창이 셀 때 **한 번** 부른다. 답은 pty id → 그
  // 셸의 답이고, 답한 셸만 싣는다.
  //
  // **기본은 빈 답이다** — 아무 셸도 답하지 않았다(명령 없음, 띄운 프로세스 없음으로 센다). 고정 답은 어느 pty id가
  // 설지 모르고, 셸마다 같은 답을 주는 길이 이 표에 없다. 세기를 재는 검사가 그 시나리오의 pty id로 덮는다
  // (`quit-confirm.spec.ts`의 「세기」, `close-confirm-count.spec.ts`).
  pty_close_checks: {} satisfies Record<number, CloseCheck>,
  // `Processes` 화면이 열려 있는 동안 2초마다 묻는다(티켓 26). 답은 위 `PROCESS_SNAPSHOT`이고, 화면을 여는 검사가 덮어쓴다.
  processes_snapshot: PROCESS_SNAPSHOT,
  // nav 메타의 요약(티켓 29). nav `Processes` 옆 메타가 모든 화면에 서므로 **앱이 뜨자마자, 그 뒤 10초마다** 부른다 — 이
  // 줄이 없으면 사이드바가 선 모든 spec이 화이트리스트 탐지기에 물린다. 답은 위 `PROCESS_SUMMARY`(손볼 것 없음)이고, `●`를 재는
  // 검사가 덮어쓰거나 갈아 끼운다(`processes-nav-meta.spec.ts`).
  processes_summary: PROCESS_SUMMARY,
  // 요약 카드의 추이(티켓 30) — `Processes` 화면이 열려 있는 동안 요약이 올 때마다 한 번 부른다. 답은 위 `PROCESS_TREND`(빈 고리)이고,
  // 스파크라인을 재는 검사가 덮어쓴다.
  processes_trend: PROCESS_TREND,
  // 신원 목록 끝내기(티켓 31) — `Processes`의 자손 행 [끝내기]와 고아 묶음의 [정리]가 부른다. 값은 안 쓰인다(신호까지 보내고
  // 돌아온다). 검사가 보는 것은 나갔는가와 그 인자(화면에 보인 신원)다(IPC 기록).
  processes_end: null,
  // 정리 기록 읽기(티켓 32) — `Processes` 화면이 스냅샷이 올 때마다 한 번 부른다. 답은 위 `CLEANUP_LOG`(빈 기록)이다.
  processes_cleanup_log: CLEANUP_LOG,
  pty_kill: null,
  // 셸의 첫 사람 입력(프로세스 결정 7). 키를 치는 시나리오마다 셸 하나에 한 번 나간다 — 값은 안 쓰이지만
  // **답이 있어야 화이트리스트를 안 넘는다.** 검사가 보는 것은 나갔는가와 그 인자다(IPC 기록).
  pty_first_input: null,
  // **타자를 치는 시나리오가 이 판에 생겼다**(#208 리뷰). 사람이 키를 친 직후의 첫 프레임만
  // xterm이 **동기로** 파싱하는데(`WriteBuffer.write`의 `_didUserInput` 갈래), 그 갈래에서
  // 출력 알림과 OSC의 순서가 뒤집히면 방금 선 앰버가 그 자리에서 꺼진다 — 그 순서를 재려면
  // 진짜 키를 쳐야 하고, 그러면 xterm의 `onData`가 이 커맨드로 나간다. 값은 안 쓰이지만
  // **답이 있어야 화이트리스트를 안 넘는다.**
  pty_write: null,
  // 프로젝트 화면의 기준 브랜치를 바꾸는 쓰기(판 3 — `projects-list.spec.ts`의 기준 브랜치 절). 돌려주는 값은 쓰이지 않는다 — 성공하면 목록을 다시
  // 읽어 오는 것이 화면을 고치는 자리다(`useUpdateProject`). 그래서 답은 `null`이고, 바꾼 값을 **기억하지
  // 않는다** — 다시 읽은 목록은 그대로 `PROJECTS`다. 검사가 재는 것은 「무엇이 나갔나」이고 그것은 IPC 기록에 있다.
  update_project: null,
  // 종료 확인의 「종료」(UI개선 결정 14). 값은 안 쓰인다 — 검사가 보는 것은 **나갔는가**이고 그것은 IPC
  // 기록에서 읽는다(`quit-confirm.spec.ts`). 그래도 **답이 있어야 화이트리스트를 안 넘는다** —
  // 없으면 「종료」를 누르는 검사가 매번 모르는 호출을 지고 선다.
  quit_app: null,
  // ── 작업 · 아카이브 · 검색 · 셸 띄우기 ──
  list_works: WORKS,
  // 이름 바꾸기 창에서 저장하면 나가는 쓰기(판 3 — `works-floating.spec.ts`의 이름 바꾸기 절). 돌려주는 값은
  // 쓰이지 않는다 — 성공하면 목록을 다시 읽어 오는 것이 화면을 고치는 자리다(`useSetWorkTitle`). 그래서 답은
  // `null`이고, 이름을 **기억하지 않는다**. 검사가 재는 것은 「무엇이 나갔나」다.
  set_work_title: null,
  // 상태 메뉴에서 다른 상태를 고르면 나가는 쓰기(판 3 — `works-floating.spec.ts`의 상태 메뉴 절). 돌려주는
  // 값은 쓰이지 않는다(`useSetWorkStatus`). 이 답은 상태를 **기억하지 않는다** — 다시 읽은 목록은 그대로
  // `WORKS`라 배지가 옛 상태로 남는다. 검사가 재는 것은 「무엇이 나갔나」이고 그것은 IPC 기록에 있다.
  set_work_status: null,
  // 아카이빙이 셸을 거두는 자리(`closeShellsOf`)를 태우는 시나리오가 있다(`shell-cold-start.spec.ts`). 답은 비어 있다:
  // 코어가 돌려주는 것이 없고, 화면은 성공인지만 본다. 목록은 그대로 그 work을 답하므로 행이 안 사라지지만, 거기서
  // 재는 것은 셸뿐이다.
  archive_work: null,
  list_archive: ARCHIVE,
  // 아카이브의 문서 목록과 본문 — **인자를 한 겹 더 본다.** 한 시나리오가 아카이브 둘의 서로 다른 목록을 보고,
  // 그 안의 문서를 각각 연다.
  //
  // 둘 다 **기본 답이 없다.** 표에 없는 경로로 읽기가 나가면 그 자리에서 물려, 아카이브가 그림을 **안 읽는다**는
  // 것이 신호로 잡힌다(위 `ARCHIVED_FILE_BODIES` 머리말) — 기본 답을 두면 그 그물이 통째로 사라진다.
  list_archived_docs: answerByArg("slug", ARCHIVED_DOCS),
  read_archived_file: answerByArg("path", ARCHIVED_FILE_BODIES),
  // 핀을 누르면 나가는 쓰기. 돌려주는 값은 쓰이지 않는다 — 성공하면 목록을 다시 읽어 오는 것이 화면을 고치는
  // 자리다(`useSetWorkPinned`).
  set_work_pinned: null,
  // 작업 행을 끌어 놓으면 나가는 쓰기(UI개선 S3 · 티켓 05). 답은 **뒤집은 목록**이고 인자와 무관하다(`WORKS_MOVED`
  // 머리말) — 화면이 이 답으로 캐시를 갈아 끼우는지를 `work-row-drag.spec.ts`가 그 순서로 잰다.
  move_work: WORKS_MOVED,
  // spawn 응답(`{id, shellKey, shellName}`). 번호와 셸 키는 부를 때마다 함께 오른다(`FIXTURE_INCREMENTING_KEYS`).
  //
  // 프레임은 오지 않는다: 출력은 `onFrame` 채널로 오고 그 채널은 앱이 만든다 — 여기서 답하는 것은 「띄웠다」
  // 하나뿐이라 셸은 빈 화면으로 선다. 이 층에서 볼 것도 그것뿐이다(진짜 바이트는 L4의 몫이고, 거기서도 안 탄다).
  // 셸 env까지 실물로 잇는 자리는 `src-tauri/tests/top_terminal.rs`다.
  //
  // work 화면의 터미널 열(결정 87)과 `/terminal`이 지난다.
  pty_spawn: { id: 1, shellKey: `${FIXTURE_GENERATION}-1`, shellName: FIXTURE_SHELL_NAME },
  // work 화면이 설 때마다 한 번 나간다(팔레트 결정 14). 답은 안 쓰인다 — 순서를 세우는 것은 코어의 검색이고
  // 화면은 이 값을 도로 안 읽는다. **표에서 빠뜨리면 work 화면을 여는 spec들이 한꺼번에 터지는데**, 하네스가
  // 던지는 것을 react-query가 삼켜 콘솔에도 안 남는다.
  touch_recent_work: null,
  read_spec_file: answerByArg("path", SPEC_FILE_BODIES, { otherwise: SPEC_FALLBACK_BODY }),
  // 팔레트가 뜨자마자 한 번, 그리고 글자마다 다시 나간다 — 캐시도 디바운스도 없다.
  //
  // **기본 답과 심어 둔 질의를 함께** 든다. 질의를 한 겹 더 보는 이유는 위 `SEARCH_DESTINATION_QUERY` 머리말이
  // 들고, 나머지 질의는 전부 기본 답으로 떨어진다 — 좁혀지는 규칙은 여기서 흉내내지 않는다.
  search: answerByArg(
    "query",
    { [SEARCH_DESTINATION_QUERY]: SEARCH_DESTINATION_RESULTS },
    { otherwise: SEARCH_RESULTS },
  ),
};

// **표가 낡으면 이 자리에서, 표를 가리키며 터진다.** 두 표를 잇는 것은 커맨드 이름 문자열
// 하나뿐인데, 하네스는 답을 찾은 커맨드에 대해서만 올릴 키를 찾아본다 — 이름이 틀렸거나
// 개명돼 짝이 끊기면 그 행은 **아무 데도 안 걸린 채 조용히 지나가고** `pty_spawn`은 다시 고정
// id를 답한다. 그때 나는 유일한 신호는 한참 뒤 `markRunning`이 「pty 2에 도는 칸이 안 생겼다」로
// 던지는 것이고, 그 말은 표가 아니라 검사를 가리켜 원인을 한 칸 옆으로 옮겨 놓는다.
//
// **따라 짓는 칸도 첫 값이 `앞말 + 첫 수`인가**를 본다(셸 키 — 티켓 23). 하네스는 오른 뒤의 값만 다시 지으므로,
// 첫 값이 어긋나 있으면 첫 셸만 다른 모양의 키를 받는다 — 둘째 셸부터는 맞아 보여 눈에 안 띈다.
for (const [cmd, { key, follow }] of Object.entries(FIXTURE_INCREMENTING_KEYS)) {
  if (!Object.prototype.hasOwnProperty.call(FIXTURE_COMMANDS, cmd)) {
    throw new Error(`수를 올릴 커맨드가 고정 답 표에 없습니다: ${cmd}`);
  }
  const value = FIXTURE_COMMANDS[cmd] as Record<string, unknown> | undefined;
  if (value === undefined || value === null || typeof value[key] !== "number") {
    throw new Error(`수를 올릴 값이 수가 아닙니다: ${cmd}.${key}`);
  }
  for (const [field, prefix] of Object.entries(follow)) {
    if (value[field] !== `${prefix}${value[key]}`) {
      throw new Error(`따라 짓는 값이 「앞말 + 첫 수」가 아닙니다: ${cmd}.${field}`);
    }
  }
}

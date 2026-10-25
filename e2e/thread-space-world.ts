import type { ProjectView } from "@/features/projects/types";
import type { SearchResults } from "@/features/search/types";
import type { ReadingScope } from "@/features/spaces/scope";
import type { Space, SpaceDetail } from "@/features/spaces/types";
import type { WorkView } from "@/features/works/types";
import { answerByArg, SEARCH_RESULTS } from "./fixtures";
import { workView } from "./thread-records";

// 03 흐름 「트레이」(`thread-tray` · `thread-work-chip`) · 「대화 속 Space와 설정」(`thread-space-setting`)의 **세계** — 캔버스 v52
// F4-KitComposer · F4-KitChat이 그린 Project 셋 · Space 셋 · Work 넷이고, L1이 축복한 Space 기록(`thread-space*` · `thread-setting` ·
// `thread-project-add`)의 세계와 이름이 같다(L1 sandbox가 web-app · api-server · backoffice를 등록하고 「결제 서비스」 · 「사내 도구」를
// 적었다). fixture 기본(billing · ledger, 「결제」 · 「원장 도구」)은 다른 흐름이 딛고 있어 그대로 두고, 두 흐름이 이 세계로 덮어쓴다
// (`installFixtureBackend`의 덮어쓰기 — 아래 `WORLD`).
//
// 읽는 범위는 core `reading_scope`가 짓는 모양 그대로 손으로 적는다 — 이 층에는 core가 없다. 범위 줄 · Space 줄의 글은 그 답에서 나온다.

/** 등록된 Project 셋 — 등록부 차례(이름순)다. */
export const WORLD_PROJECTS: ProjectView[] = ["api-server", "backoffice", "web-app"].map((slug) => ({
  slug,
  name: slug,
  path: `~/MyProjects/${slug}`,
  baseBranch: "main",
  createdAt: "2026-10-01T09:00:00Z",
  description: "",
  git: { remoteSlug: `team/${slug}`, currentBranch: "main", localBranches: ["main"], remoteBranches: [] },
  missing: false,
}));

const space = (slug: string, name: string, projects: string[]): Space => ({
  slug,
  name,
  projects,
  createdAt: "2026-10-20",
  createdBy: null,
  description: "",
  problems: [],
});

/** Space 셋 — 「결제 서비스」(web-app · api-server) · 「사내 도구」(api-server · backoffice) · Project가 없는 「정산」. */
export const PAYMENTS = space("결제-서비스", "결제 서비스", ["web-app", "api-server"]);
export const TOOLS = space("사내-도구", "사내 도구", ["api-server", "backoffice"]);
export const SETTLEMENT = space("정산", "정산", []);
export const WORLD_SPACES: Space[] = [PAYMENTS, TOOLS, SETTLEMENT];

/** Space 상세의 답(core `space_detail`이 짓는 모양) — 함께 쓰는 Space는 겹치는 Project가 있는 다른 Space다(「결제 서비스」 ↔ 「사내 도구」는 api-server). */
export const WORLD_SPACE_DETAILS: Record<string, SpaceDetail> = Object.fromEntries(
  WORLD_SPACES.map((one) => [
    one.slug,
    {
      ...one,
      shared: WORLD_SPACES.flatMap((other) => {
        const overlap = one.projects.filter((slug) => other.projects.includes(slug));
        return other.slug !== one.slug && overlap.length > 0
          ? [{ slug: other.slug, name: other.name, overlap, projects: other.projects }]
          : [];
      }),
    },
  ]),
);

/** 범위 하나 — Space(없으면 `null`)와 그 Project. Project가 없으면 빈 Space다. */
const scopeOf = (of: Space | null, registered = WORLD_PROJECTS.length): ReadingScope => {
  if (registered === 0) return { space: null, projects: [], worked: [], kind: "noProjects", registered };
  if (of === null) {
    return { space: null, projects: WORLD_PROJECTS.map(({ slug, name }) => ({ slug, name, why: "all" })), worked: [], kind: "all", registered };
  }
  return {
    space: { slug: of.slug, name: of.name, troubled: false },
    projects: of.projects.map((slug) => ({ slug, name: slug, why: "space" })),
    worked: [],
    kind: of.projects.length > 0 ? "space" : "emptySpace",
    registered,
  };
};

/**
 * 범위 다섯 — 갈래 넷(03 §5 · F4-KitComposer 「범위 줄」: 전부 · Space · 빈 Space · 등록된 Project 없음)에, Space 갈래가 이 세계의 Project 있는
 * Space 둘(결제 서비스 · 사내 도구)이라 다섯이다.
 */
export const SCOPES = {
  all: scopeOf(null),
  payments: scopeOf(PAYMENTS),
  tools: scopeOf(TOOLS),
  settlement: scopeOf(SETTLEMENT),
  none: scopeOf(null, 0),
} satisfies Record<string, ReadingScope>;

/** Space slug마다의 범위 — 입력창이 쥔 Space로 범위를 셀 때(`reading_scope`의 `space`) 답한다. 쥔 것이 없으면 전부다. */
export const SCOPE_BY_SPACE: Record<string, ReadingScope> = {
  [PAYMENTS.slug]: SCOPES.payments,
  [TOOLS.slug]: SCOPES.tools,
  [SETTLEMENT.slug]: SCOPES.settlement,
};

/** Work 넷 — 시안 「최근 Work」의 그 이름 · Space다. 마지막은 Space가 없다. */
const work = (slug: string, title: string, linked: Space | null): WorkView => ({
  ...workView({ slug, title, branch: `fix/${slug}`, projects: linked ? linked.projects.slice(0, 1) : [] }),
  ...(linked && { space: linked.slug }),
});
export const REFUND = work("refund-api", "환불 API 버그 수정", PAYMENTS);
export const WORLD_WORKS: WorkView[] = [
  REFUND,
  work("checkout-redesign", "결제 페이지 리디자인", PAYMENTS),
  work("deploy-scripts", "배포 스크립트 정리", TOOLS),
  work("docs-move", "문서 사이트 이전", null),
];

/** 빈 질의 검색의 Work 줄 — 최근 Work 메뉴가 이 차례로 선다(`recentWorks`). */
export const RECENT_HITS: SearchResults = {
  hits: WORLD_WORKS.map(({ slug, title }) => ({ kind: "work" as const, slug, title, archived: false })),
};

/**
 * 이 세계의 답 — 세 spec이 `installFixtureBackend`의 덮어쓰기로 깐다. Project · Space · Work 목록이 이 세계이고, 빈 질의 검색(최근 Work
 * 메뉴)이 이 세계의 Work를 싣는다(질의가 있으면 fixture의 검색 답). 흐름 하나만 쓰는 답(입력창이 쥔 Space로 센 범위 · Space 상세)은 그
 * spec이 이 위에 더 덮는다.
 */
export const WORLD = {
  list_projects: WORLD_PROJECTS,
  list_spaces: WORLD_SPACES,
  list_works: WORLD_WORKS,
  search: answerByArg("query", { "": RECENT_HITS }, { otherwise: SEARCH_RESULTS }),
};

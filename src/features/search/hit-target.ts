import { fileSearch, recallView, viewSearch } from "@/routes/-work-search";
import type { WorkSearch } from "@/routes/-work-search";
import type { FileSearch } from "@/routes/-file-search";
import { destinationTo } from "./destinations";
import type { SearchHit } from "./types";

/**
 * 고른 줄이 가리키는 **주소**. 라우터에 그대로 넘어간다.
 *
 * **갈래마다 가는 곳이 다르고, 그 갈림이 여기 한 자리다.** 목적지는 main nav가 가는 곳으로,
 * work은 그 work의 마지막 화면으로, 프로젝트는 그 프로젝트 화면으로, 문서는 그 문서로 간다 —
 * 넷 다 「가서 본다」 하나의 뜻이라 Enter가 갈래를 안 탄다(결정 1).
 *
 * 화면이 둘로 갈리는 것은 `archived` 하나다 — 아카이브 것은 아카이브 화면에서 열린다.
 * `file` 검증기는 두 화면이 이미 공유하므로(`-file-search.ts`) 경로의 뜻은 하나다.
 */
export type HitTarget =
  | { to: "/works/$slug"; params: { slug: string }; search: WorkSearch }
  | { to: "/archive/$slug"; params: { slug: string }; search: FileSearch }
  | { to: "/projects/$slug"; params: { slug: string } }
  | { to: NonNullable<ReturnType<typeof destinationTo>> };

/**
 * **모양을 여기서 다시 적지 않는다.** 주소를 짓는 규칙은 이미 한 자리씩 있고(`fileSearch` ·
 * `viewSearch` · `nav-items.ts`), 팔레트가 그것을 베껴 적으면 검사하는 쪽도 베껴 적게 되어
 * 실제 이동이 퇴화해도 초록이 된다.
 *
 * - **문서 줄은 「그 work의 기억 위에 문서를 얹어」 간다**(결정 16·77). 합성 하나로 같은
 *   work·다른 work가 함께 풀린다 — 같은 work이면 그 기억이 지금 화면과 같게 유지되고 있고,
 *   다른 work이면 그 work의 마지막 화면이 씨앗이 된다. 그래서 **분할해 둔 채로 문서를 골라도
 *   분할이 안 무너진다.** 탭은 spec으로 돌아온다(결정 50).
 * - **work 줄은 문서를 안 얹는다**(결정 14) — 그것이 문서 줄과 갈리는 자리다. 주소는
 *   **사이드바의 work 행과 똑같이** 짓는다(`SidebarWorkList`의 `goTo`): work을 고르는 길이
 *   둘인데 도착지가 갈리면, 어긋나도 화면에 티가 안 난다.
 *
 * 모르는 목적지 `key`에는 **`null`을 준다.** 코어는 프런트가 건넨 key만 돌려주므로(결정 21)
 * 그런 줄은 계약이 깨진 것이고, 여기서 대신 갈 곳을 지어내면 엉뚱한 화면으로 데려간다.
 */
export function hitTarget(hit: SearchHit): HitTarget | null {
  switch (hit.kind) {
    case "destination": {
      const to = destinationTo(hit.key);
      return to ? { to } : null;
    }
    case "work":
      return hit.archived
        ? { to: "/archive/$slug", params: { slug: hit.slug }, search: {} }
        : {
            to: "/works/$slug",
            params: { slug: hit.slug },
            search: viewSearch({}, recallView(hit.slug)),
          };
    case "project":
      return { to: "/projects/$slug", params: { slug: hit.slug } };
    case "doc":
      return hit.archived
        ? { to: "/archive/$slug", params: { slug: hit.slug }, search: { file: hit.path } }
        : {
            to: "/works/$slug",
            params: { slug: hit.slug },
            search: fileSearch(viewSearch({}, recallView(hit.slug)), hit.path),
          };
  }
}

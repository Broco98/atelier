import { fileSearch, recallView, viewSearch } from "@/routes/-work-search";
import type { WorkSearch } from "@/routes/-work-search";
import type { FileSearch } from "@/routes/-file-search";
import type { SearchHit } from "./types";

/**
 * 고른 줄이 가리키는 **주소**. 라우터에 그대로 넘어간다.
 *
 * 두 화면으로 갈리는 것은 `archived` 하나다 — 아카이브 문서는 아카이브 화면에서 열린다.
 * `file` 검증기는 두 화면이 이미 공유하므로(`-file-search.ts`) 경로의 뜻은 하나다.
 */
export type HitTarget =
  | { to: "/works/$slug"; params: { slug: string }; search: WorkSearch }
  | { to: "/archive/$slug"; params: { slug: string }; search: FileSearch };

/**
 * 문서 줄은 **「그 work의 기억 위에 문서를 얹어」** 간다(결정 16·77).
 *
 * 합성 하나로 같은 work·다른 work가 함께 풀린다 — 같은 work이면 그 기억이 지금 화면과 같게
 * 유지되고 있고(`rememberView`가 주소를 그대로 적는다), 다른 work이면 그 work의 마지막
 * 화면이 씨앗이 된다. 그래서 **분할해 둔 채로 문서를 골라도 분할이 안 무너진다.**
 *
 * **모양을 여기서 다시 적지 않는다.** 「문서를 고르면 spec으로 돌아오고 분할은 안 건드린다」는
 * 규칙은 `fileSearch` 하나에 있다(그 함수의 머리말이 이 자리가 왜 오래 틀려 있었는지를
 * 적어 두었다). 팔레트가 그 모양을 베껴 적으면 검사하는 쪽도 베껴 적게 되어, 실제 이동이
 * 퇴화해도 초록이 된다.
 */
export function hitTarget(hit: SearchHit): HitTarget {
  const { slug, path, archived } = hit;
  return archived
    ? { to: "/archive/$slug", params: { slug }, search: { file: path } }
    : {
        to: "/works/$slug",
        params: { slug },
        search: fileSearch(viewSearch({}, recallView(slug)), path),
      };
}

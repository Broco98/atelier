import { queryOptions } from "@tanstack/react-query";
import { specLayoutApi } from "./api";

// ["spec-layout"]으로 시작하는 쿼리(상태, 뒤에 붙을 레이아웃 읽기)가 한 번에 무효화된다 — 레이아웃
// 폴더가 바뀌면 둘 다 낡는다(구현 스펙 3절).
const SPEC_LAYOUT_KEY = ["spec-layout"] as const;

/**
 * 모드 둘의 레이아웃 상태. **신선도를 시간에 맡기지 않는다**(`staleTime` 없음) — 설정의 「spec
 * 레이아웃」 페이지를 열 때마다 새로 읽고, [다시 읽기]가 다시 부른다. 에이전트가 레이아웃을
 * 고쳤는데 옛 상태가 서 있으면 사람은 부탁이 안 먹었다고 읽는다.
 */
export const specLayoutStatesQuery = () =>
  queryOptions({
    queryKey: [...SPEC_LAYOUT_KEY, "states"],
    queryFn: specLayoutApi.states,
  });

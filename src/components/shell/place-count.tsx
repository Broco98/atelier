import { useProjects } from "@/features/projects/hooks";
import { useSpaces } from "@/features/spaces/hooks";
import type { NavKey } from "./nav-items";

/**
 * 사람 메뉴 줄 끝의 수(03 구현 스펙 §4 · 스토리 8) — `Projects` · `Space`만 센다. 몇 개를 두었는지 열기 전에 안다. 0도 수다 — 아무것도
 * 없다는 것을 말한다(셸 메타가 0을 숨기는 것과 다르다: 셸은 「연 것」이고 이것은 「둔 것」이다). 아직 못 읽었으면 서지 않는다.
 *
 * 메뉴의 줄 안에서만 그려진다 — 메뉴를 연 동안만 등록부 · Space 폴더의 종을 듣는다(`PersonMenu` 머리말).
 */
export function PlaceCount({ place }: { place: NavKey }) {
  if (place === "projects") return <ProjectsCount />;
  if (place === "spaces") return <SpacesCount />;
  return null;
}

function ProjectsCount() {
  return <Count value={useProjects().data?.length} />;
}

function SpacesCount() {
  return <Count value={useSpaces().data?.length} />;
}

// 규격은 메뉴 줄 끝 글자 한 벌(`row-meta` — 12px)이고 색은 옅은 `fg-tertiary`다(시안 `.mi .end` — rgba(26,28,31,.495)).
function Count({ value }: { value: number | undefined }) {
  if (value === undefined) return null;
  return <span className="row-meta text-fg-tertiary tabular-nums">{value}</span>;
}

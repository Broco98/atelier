import type { SpecTreeItem } from "@/features/works/types";
import type { ArchivedDocs } from "./types";

// 아카이브의 경로는 work 폴더 기준이고(`record.md`, `spec/…`) spec 트리의 경로는 spec 기준이다. 둘을
// 잇는 앞머리가 이것 하나다 — 엔진이 트리를 가를 때 떼어 낸 것을 화면이 다시 붙인다. 선택 표시,
// 경로 복사(아카이브 참조), 문서 읽기가 모두 work 폴더 기준 경로를 쓰기 때문이다.
const SPEC_PREFIX = "spec/";

/**
 * 아카이브 문서 트리의 뿌리. spec 밖의 문서(기록)가 목록의 순서대로 서고, 그 뒤에 접히는 `spec/`
 * 폴더 행이 선다. `spec/` 아래는 **받은 spec 트리 그대로다** — 순서도 아이콘도 번호 묶음도 엔진이
 * 정했다(spec 레이아웃 결정 13). 여기서는 경로에 앞머리를 붙일 뿐 다시 세우지 않는다.
 *
 * spec 문서가 하나도 없으면 `spec/` 행을 세우지 않는다 — 비어 있는 폴더를 펼치게 하지 않는다.
 */
export function archiveTreeItems({ docs, specTree }: ArchivedDocs): SpecTreeItem[] {
  const outside = docs.filter((doc) => !doc.startsWith(SPEC_PREFIX)).map(rootFile);
  if (specTree.items.length === 0) return outside;
  const spec: SpecTreeItem = {
    ...rootFile(SPEC_PREFIX.slice(0, -1)),
    kind: "folder",
    children: specTree.items.map(underSpec),
  };
  return [...outside, spec];
}

/** 뿌리의 행 하나 — 레이아웃이 모르는 자리라 아이콘도 번호 묶음도 없다. */
function rootFile(path: string): SpecTreeItem {
  return { name: path, path, kind: "file", icon: null, group: null, children: [] };
}

function underSpec(item: SpecTreeItem): SpecTreeItem {
  return { ...item, path: `${SPEC_PREFIX}${item.path}`, children: item.children.map(underSpec) };
}

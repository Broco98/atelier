import type { SpecTree, SpecTreeItem, WorkView } from "./types";

// L2가 짓는 work 하나. **work 뷰를 타입 리터럴로 짓는 자리를 여기 하나로 모았다** — 필드가 하나
// 늘 때마다(판 02의 `specTree`) 테스트 여덟 곳이 제각각 빨개지고, 제각각 고치면 같은 work이 파일마다
// 다른 모양이 된다. 각 테스트는 자기가 재는 필드만 덮어쓴다.
//
// 테스트 파일이 아니다 — `*.test.ts`면 vitest가 이것을 테스트로 돌린다. 앱 코드는 이것을 부르지 않는다.

/** spec 문서가 하나도 없는 work의 트리 — 기본 문서도 없다. */
const EMPTY_SPEC_TREE: SpecTree = { layoutId: "atelier", fallback: null, defaultDoc: null, items: [] };

/**
 * 기본 work. 프로젝트도 워크트리도 spec 문서도 없는 Atelier work이다 — 무엇이 있어야 하는
 * 테스트는 그것을 덮어써서 스스로 말한다.
 */
export function workFixture(overrides: Partial<WorkView> = {}): WorkView {
  return {
    slug: "some-work",
    title: "어떤 작업",
    status: "active",
    branch: "feat/some-work",
    createdAt: "2026-08-16",
    projects: [],
    pinned: false,
    worktrees: [],
    specDir: "~/.atelier/works/some-work/spec",
    specFiles: [],
    specTree: EMPTY_SPEC_TREE,
    ...overrides,
  };
}

/**
 * spec 문서 목록과 그 트리를 **함께** 심는다. 화면은 기본 문서를 파일 목록에서 다시 고르지 않고
 * 트리의 것을 쓰므로(spec 레이아웃 결정 14), 목록만 심으면 아무 문서도 안 열린다.
 *
 * 트리는 엔진이 가른 것이 아니다 — 경로를 받은 순서대로 폴더에 넣었을 뿐이고 아이콘도 번호
 * 묶음도 없다. 기본 문서도 규칙으로 고르지 않고 **테스트가 준다**(주지 않으면 첫 문서다). 기본
 * 문서가 `overview.md`가 아닌 트리가 필요하면 둘째 인자로 그렇게 말한다.
 */
export function specDocs(
  files: string[],
  defaultDoc: string | null = files[0] ?? null,
): Pick<WorkView, "specFiles" | "specTree"> {
  const items: SpecTreeItem[] = [];
  for (const path of files) {
    const parts = path.split("/");
    let level = items;
    parts.forEach((name, at) => {
      const itemPath = parts.slice(0, at + 1).join("/");
      const kind = at === parts.length - 1 ? "file" : "folder";
      let item = level.find((one) => one.path === itemPath && one.kind === kind);
      if (!item) {
        item = { name, path: itemPath, kind, icon: null, group: null, children: [] };
        level.push(item);
      }
      level = item.children;
    });
  }
  return { specFiles: files, specTree: { ...EMPTY_SPEC_TREE, defaultDoc, items } };
}

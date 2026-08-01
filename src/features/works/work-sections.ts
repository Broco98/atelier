import type { WorkView } from "./types";

// 두 섹션의 펼침 여부. 접기는 사용자가 명시적으로 하는 것이라 영속 설정이다.
export interface SectionsOpen {
  works: boolean;
  drafts: boolean;
}

export interface WorkSections {
  // 진행 구역과 초안 구역. 둘 다 받은 순서 그대로다 — 이 함수는 순서를 다시 만들지 않는다.
  // 접혀 있어도 비우지 않는다: 헤더는 접혀도 그려야 하고 개수도 거기 나온다.
  main: WorkView[];
  drafts: WorkView[];
  // 화면에 실제로 그려지는 순서. 숫자 단축키가 세는 것도, 기본 선택이 가리켜야 하는 것도 이것이다.
  visible: WorkView[];
}

// 목록이 화면에 어떤 순서로 어느 구역에 놓이는지를 정하는 **유일한 지점**.
//
// 문턱을 낮추면 백로그가 쌓인다. 초안 구역이 그 대가를 격리한다 — 쌓인 아이디어가
// 진행 중인 일을 가리지 않게. 그 보장은 순서 하나로 선다: 진행 구역이 항상 위다.
//
// 값을 정하는 곳을 하나로 두는 이유는 불변조건 하나 때문이다:
//   (둘 다 펼친 상태에서)
//   목록이 실제로 보여주는 첫 항목 = 무선택 주소가 정규화되어 고르는 항목 (pickSlug)
// 기본 선택 어긋남(#58)이 정확히 이게 깨진 것이었다. work-sections.test.ts가 두 함수를
// 나란히 불러 검사한다.
export function splitWorkSections(
  works: ReadonlyArray<WorkView>,
  open: SectionsOpen,
): WorkSections {
  const main = works.filter((work) => work.status !== "draft");
  const drafts = works.filter((work) => work.status === "draft");
  const visible = [...(open.works ? main : []), ...(open.drafts ? drafts : [])];
  return { main, drafts, visible };
}

import type { WorkView } from "./types";

export interface WorkSections {
  // 진행 구역과 초안 구역. 둘 다 받은 순서 그대로다 — 이 함수는 순서를 다시 만들지 않는다.
  main: WorkView[];
  drafts: WorkView[];
  // 화면에 실제로 그려지는 순서. 숫자 단축키가 세는 것도, 기본 선택이 가리켜야 하는 것도 이것이다.
  visible: WorkView[];
}

// 목록이 화면에 어떤 순서로 어느 구역에 놓이는지를 정하는 **유일한 지점**.
//
// 문턱을 낮추면 백로그가 쌓인다. 초안 구역이 그 대가를 격리한다 — 쌓인 아이디어가
// 진행 중인 일을 가리지 않게.
//
// 값을 정하는 곳을 하나로 두는 이유는 불변조건 하나 때문이다:
//   목록이 실제로 보여주는 첫 항목 = 무선택 주소가 정규화되어 고르는 항목 (pickSlug)
// 기본 선택 어긋남(#58)이 정확히 이게 깨진 것이었다. work-sections.test.ts가 두 함수를
// 나란히 불러 검사한다.
export function splitWorkSections(
  works: ReadonlyArray<WorkView>,
  draftsOpen: boolean,
): WorkSections {
  const main = works.filter((work) => work.status !== "draft");
  const drafts = works.filter((work) => work.status === "draft");
  // 접힘은 진행 중인 작업이 있을 때만 의미가 있다. 전부 초안이면 접어봐야 목록이 비는데,
  // 정규화는 후보가 없으면 첫 항목으로 떨어지므로("초안뿐이면 빈 화면보다 낫다") 본문은
  // 이미 첫 초안을 열고 있다 — 그대로 접으면 열린 작업이 목록 어디에도 없게 된다.
  const visible = draftsOpen || main.length === 0 ? [...main, ...drafts] : main;
  return { main, drafts, visible };
}

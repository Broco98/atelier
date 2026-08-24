import type { WorkView } from "./types";

// 세 섹션의 펼침 여부. 접기는 사용자가 명시적으로 하는 것이라 영속 설정이다.
export interface SectionsOpen {
  pinned: boolean;
  works: boolean;
  drafts: boolean;
}

export interface WorkSections {
  // 고정 구역·진행 구역·초안 구역. 셋 다 받은 순서 그대로다 — 이 함수는 순서를 다시 만들지 않는다.
  // 접혀 있어도 비우지 않는다: 헤더는 접혀도 그려야 하고 개수도 거기 나온다.
  pinned: WorkView[];
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
// 고정된 것은 원래 구역에서 **빠진다**(결정 82) — 두 곳에 동시에 보이면 숫자 단축키가
// 같은 작업을 두 번 세고, 어느 쪽을 눌렀는지가 뜻을 갖게 된다.
//
// 값을 정하는 곳을 하나로 두는 이유는 불변조건 하나 때문이다:
//   (셋 다 펼친 상태에서)
//   목록이 실제로 보여주는 첫 항목 = 무선택 주소가 정규화되어 고르는 항목 (pickSlug)
// 기본 선택 어긋남(#58)이 정확히 이게 깨진 것이었다. work-sections.test.ts가 두 함수를
// 나란히 불러 검사한다. 고정이 그 등식을 두 번 건드리는데, 고치는 자리는 여기가 아니다 —
// 「초안은 건너뛴다」는 isDefaultSelectable이(결정 83), 「고정이 먼저」는 코어의
// list_works가 맡는다(결정 100). 여기서 다시 정렬하면 순서를 정하는 지점이 또 둘이 된다.
export function splitWorkSections(
  works: ReadonlyArray<WorkView>,
  open: SectionsOpen,
): WorkSections {
  const pinned = works.filter((work) => work.pinned);
  const main = works.filter((work) => !work.pinned && work.status !== "draft");
  const drafts = works.filter((work) => !work.pinned && work.status === "draft");
  const visible = [
    ...(open.pinned ? pinned : []),
    ...(open.works ? main : []),
    ...(open.drafts ? drafts : []),
  ];
  return { pinned, main, drafts, visible };
}

// 빈 `작업` 구획이 하는 말. 판정이 셋으로 갈리는 자리라 그림에서 꺼내 둔다 — 컴포넌트
// 안에 두면 이 저장소의 정적 마크업 seam에 아예 안 걸린다.
//
// 「작업은 Claude Code에서 시작돼요」는 **화면에 무언가 보일 때 거짓말**이다(결정 108):
// 고정 때문에 비었으면 바로 위에 작업이 버젓이 서 있다.
export function emptyMainNotice(sections: WorkSections): string {
  // `작업`이 고정 **때문에** 빈 것은 고정된 것 중에 초안 아닌 것이 있을 때다.
  // 고정된 것이 초안뿐이면 빈 이유는 고정이 아니라 진행 중인 작업이 없는 것이다.
  if (sections.pinned.some((work) => work.status !== "draft")) return "전부 고정돼 있어요.";
  if (sections.drafts.length > 0 || sections.pinned.length > 0)
    return "진행 중인 작업이 없어요.";
  return "작업은 Claude Code에서 시작돼요.";
}

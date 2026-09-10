import type { Mode } from "@/mode";
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

/** 고른 것이 없을 때 본문 한가운데가 하는 말 — 제목·설명·붙여 넣을 한 줄. */
interface EmptyScreen {
  title: string;
  body: string;
  code: string;
}

// 이 세계의 상주 목록이 **자기를 뭐라고 부르는가**. 머리 라벨, 빈 몸통의 세 갈래, 그리고
// 본문 한가운데의 빈 화면이 한 표에 함께 든다 — 갈라 두면 사이드바는 「Terminal에서 claude
// 에게 …」라고 하는데 본문은 「작업은 Claude Code에서 시작돼요」라고 적는 판이 나고, 그것은
// Room이 하나도 없는 순간에만 보인다. 두 자리가 **한 화면에 함께 서므로** 표도 하나다.
//
// **`@/mode`의 표가 아니라 여기 산다.** 그 표는 어디로 가고 어느 루트를 읽는가를 들고, 이
// 낱말들은 이 세계의 항목 목록이 화면에 적는 말이다 — 읽는 자리가 이 기능 폴더 안
// (`WorkSectionList`와 `WorksPage`)이라 목록의 판정이 사는 곳에 함께 둔다.
//
// `satisfies Record<Mode, …>`가 그물이다: 모드를 빠뜨리면 그 자리에서 L0가 빨개진다.
// Atelier 문구는 **한 글자도 안 바뀐 채** 옮겨 왔다(구획 셋은 결정 108, 화면 셋은 그 이전부터).
const COPY = {
  atelier: {
    label: "작업",
    page: "Works",
    item: "작업",
    allPinned: "전부 고정돼 있어요.",
    noneActive: "진행 중인 작업이 없어요.",
    // 앱에 만드는 화면이 없어서 **어디서 시작하는지**를 말한다(아래 `screen`과 같은 몫).
    empty: "작업은 Claude Code에서 시작돼요.",
    screen: {
      title: "아직 작업이 없어요",
      body: "작업은 Claude Code에서 시작돼요. 작업이 시작되면 스펙 문서와 진행 상황이 여기에 나타나요.",
      // 실제로 통하는 경로만 안내한다 — CLI에는 시작 명령이 없고, 에이전트가
      // `atelier_start_work`를 부른다. 그대로 붙여 넣는 한 줄이다.
      code: 'atelier로 "새 작업" 시작해줘',
    },
  },
  maison: {
    label: "Rooms",
    page: "Rooms",
    item: "Room",
    // 고정은 세계를 안 타는 말이라 같은 문장이다 — 「작업」도 「Room」도 안 부른다.
    allPinned: "전부 고정돼 있어요.",
    noneActive: "진행 중인 Room이 없어요.",
    // Room도 앱에서 못 만든다. 다만 시작하는 자리가 Atelier와 다르다 — Maison에는
    // `Projects`가 없어서(결정 17) 저장소를 여는 대신 nav의 `Terminal`에서 claude에게
    // 말한다. 그 한 줄이 이 세계에서 실제로 통하는 유일한 길이다.
    empty: 'Terminal에서 claude에게 "새 Room 만들어줘"',
    screen: {
      title: "아직 Room이 없어요",
      // 「작업」도 「Claude Code」도 안 부른다 — 이 세계에서 통하지 않는 지시다. Room은
      // Maison 셸의 claude가 MCP로만 만들고(decisions.md 「미결 · Room 만들기」), 그 셸을
      // 여는 자리가 nav의 `Terminal`이다.
      body: "Room은 Terminal에서 claude에게 부탁해서 만들어요. Room이 시작되면 스펙 문서와 진행 상황이 여기에 나타나요.",
      code: "새 Room 만들어줘",
    },
  },
} as const satisfies Record<
  Mode,
  {
    label: string;
    page: string;
    item: string;
    allPinned: string;
    noneActive: string;
    empty: string;
    screen: EmptyScreen;
  }
>;

// 상주 목록의 머리(US 17). Atelier `작업` · Maison `Rooms` — 같은 규격으로 다른 것을 본다.
// 대문자인 쪽은 nav 항목과 같은 층이라 그렇다(US 59). 결정 6은 여기가 아니라 nav 배열의 것이다.
export function listLabelOf(mode: Mode): string {
  return COPY[mode].label;
}

// 이 세계의 **항목 하나를 부르는 말**. 문장과 이름표가 쓰는 값이라 Atelier에서 한국어
// `작업`, Maison에서 `Room`이다 — 위 `page`(화면 이름)와 달리 두 세계가 같은 층이 아니다.
//
// **`Room 폴더`·`Room 메뉴`처럼 뒤에 붙여 쓴다.** 그 합성을 자리마다 리터럴로 적으면 낱말이
// 하나 바뀔 때 여덟 자리가 따로 늙는다 — 실제로 이 판이 사이드바·본문·아카이브·⋯ 메뉴의
// 어휘를 갈라 놓고도 정보 탭의 구획 머리, 작업 폴더 줄, ⌘K의 구획 머리, 그리고 이름표
// 여섯(`… 패널 접기`·`… 이름`·`… 메뉴`·`… 메타`)을 Atelier 말로 남겨 뒀다. Maison에서
// 그 화면들은 Room을 통째로 「작업」이라 불렀고, CONTEXT.md 「Room」 항목이 금지한 것이
// 정확히 그것이다.
export function itemNameOf(mode: Mode): string {
  return COPY[mode].item;
}

// 이 화면이 **머리에 이는 자기 이름**. 고른 항목이 없을 때만 보인다 — 하나라도 골라 있으면
// 그 자리는 탭 줄이다(`WorksPage`).
//
// **`label`과 다른 값이다.** 사이드바 머리는 구획 라벨이라 Atelier에서 한국어 `작업`인데
// (US 17), 이쪽은 `Archive`·`Projects`와 나란히 서는 **화면 이름**이라 두 세계 다 대문자
// 영어다(CONTEXT.md 「고르는 것의 라벨은 소문자 영어」의 대문자 층). 그래서 한 표에 두 칸이다 —
// 한 칸으로 접으면 둘 중 하나가 제 층을 잃는다.
//
// 이 자리가 리터럴 `"Works"`였다. Maison에서 Room을 안 골랐을 때(Room이 0개면 **늘** 그렇다)
// 본문 한가운데는 「아직 Room이 없어요」라고 하는데 그 바로 위 머리는 `Works`였다 — 한 화면이
// 두 세계의 말을 동시에 하는 것이고, CONTEXT.md 「Room」 항목이 금지한 그 섞임이다.
export function pageNameOf(mode: Mode): string {
  return COPY[mode].page;
}

// 빈 상주 목록이 하는 말. 판정이 셋으로 갈리는 자리라 그림에서 꺼내 둔다 — 컴포넌트
// 안에 두면 이 저장소의 정적 마크업 seam에 아예 안 걸린다.
//
// 「작업은 Claude Code에서 시작돼요」는 **화면에 무언가 보일 때 거짓말**이다(결정 108):
// 고정 때문에 비었으면 바로 위에 작업이 버젓이 서 있다.
//
// **세계마다 어휘가 다르다**(#183). 갈래를 판정하는 규칙은 하나이고 갈리는 것은 낱말뿐이라,
// 조건은 여기 한 벌로 남고 문장만 위 표에서 꺼내 온다.
export function emptyMainNotice(sections: WorkSections, mode: Mode): string {
  const copy = COPY[mode];
  // 목록이 고정 **때문에** 빈 것은 고정된 것 중에 초안 아닌 것이 있을 때다.
  // 고정된 것이 초안뿐이면 빈 이유는 고정이 아니라 진행 중인 것이 없는 것이다.
  if (sections.pinned.some((work) => work.status !== "draft")) return copy.allPinned;
  if (sections.drafts.length > 0 || sections.pinned.length > 0) return copy.noneActive;
  return copy.empty;
}

// 고른 항목이 없을 때 **본문 한가운데**가 하는 말(US 22). 사이드바의 빈 구획과 한 표에서
// 나온다 — 위 표 머리말이 그 이유다.
//
// 판정이 없어서 순수 함수 하나로 족한데도 그림 안에 리터럴로 두지 않는 것은, 그 자리가
// 이 저장소의 정적 마크업 seam에 걸리기는 해도 **두 세계를 나란히 재기가 그림에서 훨씬
// 비싸기 때문이다**(그 화면은 쿼리 캐시를 심어야 선다). 낱말의 계약은 여기서 글자까지 재고,
// 화면이 그것을 실제로 부르는지만 `WorksPage.test.tsx`가 본다.
export function emptyScreenCopy(mode: Mode): EmptyScreen {
  return COPY[mode].screen;
}

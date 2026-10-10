import type { WorkView } from "./types";

// 두 구획의 펼침 여부. 접기는 사용자가 명시적으로 하는 것이라 영속 설정이다.
export interface SectionsOpen {
  pinned: boolean;
  works: boolean;
}

export interface WorkSections {
  // 고정 구획·작업 구획. 둘 다 받은 순서 그대로다 — 이 함수는 순서를 다시 만들지 않는다.
  // 접혀 있어도 비우지 않는다: 헤더는 접혀도 그려야 하고 개수도 거기 나온다.
  pinned: WorkView[];
  main: WorkView[];
  // 화면에 실제로 그려지는 순서. 기본 선택이 가리켜야 하는 것이 이것이다.
  visible: WorkView[];
}

// 목록이 화면에 어떤 순서로 어느 구획에 놓이는지를 정하는 **유일한 지점**.
//
// **구획은 `고정`·`작업` 둘이다**(UI개선 결정 5). 초안은 따로 접힌 구역에 격리하지 않고 다른
// 항목들 사이에 서며, 상태 아이콘(점선 원)으로만 갈린다 — 쌓인 초안을 아래로 내리는 것은
// 사람이 순서로 하는 일이지 이 함수가 대신 정하는 일이 아니다.
//
// 고정된 것은 원래 구획에서 **빠진다**(결정 82) — 두 곳에 동시에 보이면 같은 작업이 두 줄로
// 서고, 어느 쪽을 눌렀는지가 뜻을 갖게 된다.
//
// 값을 정하는 곳을 하나로 두는 이유는 불변조건 하나 때문이다:
//   (둘 다 펼친 상태에서)
//   목록이 실제로 보여주는 첫 항목 = 무선택 주소가 정규화되어 고르는 항목 (pickSlug)
// 기본 선택 어긋남(#58)이 정확히 이게 깨진 것이었다. work-sections.test.ts가 두 함수를
// 나란히 불러 검사한다. 「고정이 먼저」는 여기가 아니라 코어의 list_works가 맡는다(결정 100) —
// 여기서 다시 정렬하면 순서를 정하는 지점이 또 둘이 된다. 그래서 이 함수는 **거르기만** 한다.
export function splitWorkSections(
  works: ReadonlyArray<WorkView>,
  open: SectionsOpen,
): WorkSections {
  const pinned = works.filter((work) => work.pinned);
  const main = works.filter((work) => !work.pinned);
  const visible = [...(open.pinned ? pinned : []), ...(open.works ? main : [])];
  return { pinned, main, visible };
}

/** 고른 것이 없을 때 본문 한가운데가 하는 말 — 제목·설명·붙여 넣을 한 줄. */
interface EmptyScreen {
  title: string;
  body: string;
  code: string;
}

// 상주 목록과 그 화면이 **자기를 뭐라고 부르는가**. 머리 라벨, 빈 몸통의 두 갈래, 그리고
// 본문 한가운데의 빈 화면이 한 표에 함께 든다 — 두 자리가 **한 화면에 함께 서므로** 표도 하나다.
// 갈라 두면 사이드바와 본문이 같은 빈 목록을 두고 다른 말을 하는 판이 난다.
//
// 그림 안에 리터럴로 두지 않는 것은 그 화면이 쿼리 캐시를 심어야 서서 **글자까지 재기가 그림에서 훨씬
// 비싸기 때문이다.** 낱말의 계약은 `work-sections.test.ts`가 글자까지 재고, 화면이 그것을 실제로 부르는지만
// `WorksPage.test.tsx`가 본다. 구획 문구는 결정 108, 화면 셋은 그 이전부터다.
export const WORKS_COPY = {
  // 상주 목록의 머리(US 17). 결정 6은 여기가 아니라 nav 배열의 것이다.
  label: "작업",
  // 이 화면이 **머리에 이는 자기 이름**. 고른 항목이 없을 때만 보인다 — 하나라도 골라 있으면
  // 그 자리는 탭 줄이다(`WorksPage`).
  //
  // **`label`과 다른 값이다.** 사이드바 머리는 구획 라벨이라 한국어 `작업`인데(US 17), 이쪽은
  // `Archive`·`Projects`와 나란히 서는 **화면 이름**이라 대문자 영어다(CONTEXT.md 「고르는 것의
  // 라벨은 소문자 영어」의 대문자 층). 한 칸으로 접으면 둘 중 하나가 제 층을 잃는다.
  page: "Works",
  allPinned: "전부 고정돼 있어요.",
  // 앱에 만드는 화면이 없어서 **어디서 시작하는지**를 말한다(아래 `screen`과 같은 몫).
  empty: "작업은 Claude Code에서 시작돼요.",
  // 고른 항목이 없을 때 **본문 한가운데**가 하는 말(US 22).
  screen: {
    title: "아직 작업이 없어요",
    body: "작업은 Claude Code에서 시작돼요. 작업이 시작되면 스펙 문서와 진행 상황이 여기에 나타나요.",
    // 실제로 통하는 경로만 안내한다 — CLI에는 시작 명령이 없고, 에이전트가
    // `atelier_start_work`를 부른다. 그대로 붙여 넣는 한 줄이다.
    code: 'atelier로 "새 작업" 시작해줘',
  } satisfies EmptyScreen,
} as const;

// 빈 상주 목록이 하는 말. 판정이 갈리는 자리라 그림에서 꺼내 둔다 — 컴포넌트
// 안에 두면 이 저장소의 정적 마크업 seam에 아예 안 걸린다.
//
// 「작업은 Claude Code에서 시작돼요」는 **화면에 무언가 보일 때 거짓말**이다(결정 108):
// 고정 때문에 비었으면 바로 위에 작업이 버젓이 서 있다.
//
// **갈래는 둘이다** — 「고정만 있다」·「아무것도 없다」. 초안이 `작업` 안에 서므로(UI개선 결정 5)
// 초안이 하나라도 있으면 이 구획은 비지 않고, 옛 「초안만 남았다」 갈래는 설 자리가 없다.
// 고정된 것이 초안뿐이어도 빈 이유는 고정이다: 그 초안이 바로 위 `고정`에 서 있다.
export function emptyMainNotice(sections: WorkSections): string {
  return sections.pinned.length > 0 ? WORKS_COPY.allPinned : WORKS_COPY.empty;
}

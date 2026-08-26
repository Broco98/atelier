import { describe, expect, it } from "vitest";
import { pickSlug } from "@/components/shell/shell-store";
import { isDefaultSelectable } from "./hooks";
import { emptyMainNotice, splitWorkSections } from "./work-sections";
import type { WorkView } from "./types";

// 목록 순서·구역 분리 seam. 순수 함수 하나가 대상이라 렌더도 DOM도 없이 기본 환경(node)에서 돈다.
// 관찰하는 것은 "어떤 배열과 접힘 상태를 주면 어느 구역에 무엇이 어떤 순서로 놓이는가"뿐이다.
//
// 여기서 관찰하지 않는 것 — 구역이 화면에 어떻게 그려지는지, 접기 아이콘의 등장 타이밍,
// 섹션 헤더의 생김새. 전부 렌더가 필요해 이 seam 밖이고, 깨지면 화면에서 즉시 드러난다.

// 이 seam은 목록에서 slug·status·pinned만 본다 — 나머지 필드는 관심사가 아니라 좁게 만든다.
// "draft:" 접두사를 붙인 slug는 초안이 되고, 그 앞의 "pin:"은 고정된 것이 된다.
// (router.test.ts의 같은 헬퍼와 규칙을 맞춘다)
const works = (...slugs: Array<string>) =>
  slugs.map((raw) => {
    const pinned = raw.startsWith("pin:");
    const rest = pinned ? raw.slice("pin:".length) : raw;
    const draft = rest.startsWith("draft:");
    return {
      slug: draft ? rest.slice("draft:".length) : rest,
      status: draft ? "draft" : "active",
      pinned,
    };
  }) as Array<WorkView>;

const slugs = (list: ReadonlyArray<WorkView>) => list.map((work) => work.slug);

// 세 섹션이 모두 펼쳐진 기본 상태
const ALL = { pinned: true, works: true, drafts: true };

describe("작업 목록의 순서와 구역", () => {
  it("진행 중인 작업이 초안보다 먼저 온다", () => {
    const { visible } = splitWorkSections(works("draft:초안", "진행중"), ALL);
    expect(slugs(visible)).toEqual(["진행중", "초안"]);
  });

  it("같은 구역 안의 순서는 받은 순서 그대로다 — 함수가 순서를 다시 만들지 않는다", () => {
    const { main, drafts } = splitWorkSections(works("c", "draft:z", "a", "draft:b"), ALL);
    expect(slugs(main)).toEqual(["c", "a"]);
    expect(slugs(drafts)).toEqual(["z", "b"]);
  });

  it("목록이 비면 두 구역 모두 비고 보이는 첫 항목이 없다", () => {
    const { main, drafts, visible } = splitWorkSections([], ALL);
    expect(main).toEqual([]);
    expect(drafts).toEqual([]);
    expect(visible[0]).toBeUndefined();
  });

  // 고정은 **옮기는** 것이지 표시하는 것이 아니다 (결정 82) — 두 곳에 동시에 보이면
  // 숫자 단축키가 같은 작업을 두 번 세고, 어느 쪽을 눌렀는지가 뜻을 갖게 된다.
  it("고정한 것은 원래 구역에서 빠진다 — 초안이어도 마찬가지다", () => {
    const list = works("pin:고정", "진행중", "pin:draft:고정초안", "draft:초안");
    const { pinned, main, drafts, visible } = splitWorkSections(list, ALL);
    expect(slugs(pinned)).toEqual(["고정", "고정초안"]);
    expect(slugs(main)).toEqual(["진행중"]);
    expect(slugs(drafts)).toEqual(["초안"]);
    // 고정 → 작업 → 초안. 구역 안 순서는 받은 순서 그대로다.
    expect(slugs(visible)).toEqual(["고정", "고정초안", "진행중", "초안"]);
  });
});

// 섹션마다 접힌다. 접힌 섹션의 항목은 화면에 없으므로 보이는 목록에서도 빠진다 —
// 숫자 단축키가 세는 것이 이 목록이라, 여기가 어긋나면 ⌘3이 세 번째로 보이는 것과 다른 작업을 연다.
describe("섹션 접힘", () => {
  const list = works("pin:고정", "진행중-a", "진행중-b", "draft:초안-a", "draft:초안-b");

  it("초안 섹션을 접으면 보이는 목록에 초안이 없다", () => {
    const { visible } = splitWorkSections(list, { pinned: true, works: true, drafts: false });
    expect(slugs(visible)).toEqual(["고정", "진행중-a", "진행중-b"]);
  });

  it("작업 섹션을 접으면 보이는 목록이 초안으로 시작한다", () => {
    const { visible } = splitWorkSections(list, { pinned: false, works: false, drafts: true });
    expect(slugs(visible)).toEqual(["초안-a", "초안-b"]);
  });

  // `고정`도 `초안`과 같은 규칙으로 접힌다 (결정 108)
  it("고정 섹션을 접으면 보이는 목록이 작업으로 시작한다", () => {
    const { pinned, visible } = splitWorkSections(list, {
      pinned: false,
      works: true,
      drafts: true,
    });
    expect(slugs(visible)).toEqual(["진행중-a", "진행중-b", "초안-a", "초안-b"]);
    // 접혀도 구역의 내용은 그대로다 — 헤더의 개수가 거기서 나온다
    expect(slugs(pinned)).toEqual(["고정"]);
  });

  it("셋 다 접으면 보이는 목록이 빈다 — 구역의 내용 자체는 그대로다", () => {
    const { main, drafts, visible } = splitWorkSections(list, {
      pinned: false,
      works: false,
      drafts: false,
    });
    expect(visible).toEqual([]);
    // 헤더는 접혀도 그려야 하고, 접힌 섹션의 개수도 헤더에 나온다
    expect(slugs(main)).toEqual(["진행중-a", "진행중-b"]);
    expect(slugs(drafts)).toEqual(["초안-a", "초안-b"]);
  });
});

// 빈 `작업` 구획이 무슨 말을 하는지도 판정이다 (결정 108). 컴포넌트 안에 두면 이 저장소의
// 정적 마크업 seam에 아예 안 걸리므로 여기로 꺼내 둔다.
describe("빈 작업 구획이 하는 말", () => {
  const notice = (...args: Array<string>) => emptyMainNotice(splitWorkSections(works(...args), ALL));

  it("고정 때문에 비었으면 그렇게 말한다 — 위에 작업이 버젓이 서 있다", () => {
    expect(notice("pin:고정")).toBe("전부 고정돼 있어요.");
    expect(notice("pin:고정", "draft:초안")).toBe("전부 고정돼 있어요.");
  });

  it("초안만 남았으면 진행 중인 것이 없다고 말한다", () => {
    expect(notice("draft:초안")).toBe("진행 중인 작업이 없어요.");
    // 고정된 것이 초안뿐이면 `작업`이 빈 이유는 고정이 아니다
    expect(notice("pin:draft:고정초안")).toBe("진행 중인 작업이 없어요.");
  });

  it("아무것도 없을 때만 어디서 시작하는지 말한다", () => {
    expect(notice()).toBe("작업은 Claude Code에서 시작돼요.");
  });
});

// 이 seam을 여는 이유가 이 불변조건 하나다:
//
//   (두 섹션이 모두 펼쳐진 상태에서)
//   목록이 실제로 보여주는 첫 항목 = 무선택 주소가 정규화되어 고르는 항목
//
// 기본 선택 어긋남(#58)이 정확히 이게 깨진 것이었고, 원인은 순서를 정하는 지점이 둘로
// 갈려 있었다는 것이다 — 정규화는 백엔드 원본 순서를 보는데 화면은 그 위에 정렬·필터를 얹었다.
// 두 규칙을 각각 흉내 내지 않고 **실제 함수 둘을 나란히 호출해** 비교한다. 한쪽만 고치면 여기서 갈린다.
//
// 접기는 사용자가 명시적으로 숨긴 것이라 이 등식의 예외다. 기본 상태에서 참인 한 재발은 잡힌다.
describe("보이는 첫 항목과 기본 선택은 같은 것을 가리킨다", () => {
  const firstVisible = (list: Array<WorkView>) =>
    splitWorkSections(list, ALL).visible[0]?.slug ?? null;
  const normalized = (list: Array<WorkView>) => pickSlug(null, list, isDefaultSelectable);

  it("초안이 섞여 있을 때", () => {
    const list = works("draft:초안", "진행중-a", "진행중-b");
    expect(firstVisible(list)).toBe(normalized(list));
    expect(firstVisible(list)).toBe("진행중-a");
  });

  // 정규화는 후보가 없으면 첫 항목으로 떨어진다("초안뿐이면 빈 화면보다 낫다", router.test.ts).
  // 초안이 대등한 섹션이라 이 경우에도 초안 목록이 그대로 화면에 있다 — 예외 처리가 필요 없다.
  it("진행 중인 작업이 하나도 없을 때", () => {
    const list = works("draft:초안-a", "draft:초안-b");
    expect(firstVisible(list)).toBe(normalized(list));
    expect(firstVisible(list)).toBe("초안-a");
  });

  it("목록이 비면 양쪽 다 고를 것이 없다", () => {
    expect(firstVisible([])).toBe(normalized([]));
    expect(firstVisible([])).toBeNull();
  });

  // 고정 구획이 맨 위로 오면서 **고정된 초안**이 이 등식을 깼다 — 정규화가 초안을
  // 건너뛰기 때문이다. 결정 83이 핀을 이기게 한다: 핀은 사람이 명시적으로 꽂은 것이고
  // "초안은 건너뛴다"는 아무도 안 고른 상태의 기본값이다.
  it("고정된 초안이 맨 위일 때", () => {
    const list = works("pin:draft:고정초안", "진행중");
    expect(firstVisible(list)).toBe(normalized(list));
    expect(firstVisible(list)).toBe("고정초안");
  });

  // 결정 83의 한 줄로는 부족했다: `[새-것(최신), 오래된-고정]`이면 보이는 첫 항목은
  // 고정 쪽인데 정규화는 첫 항목을 골라 갈린다. 고치는 자리가 **코어**여서(결정 100)
  // 이 목록은 이미 고정 먼저로 온다 — 아래 순서가 그 계약이고, 코어가 그것을 잃으면
  // atelier-core의 list_puts_pinned_first_even_when_it_is_older가 빨개진다.
  it("고정한 것이 createdAt에서 뒤일 때 — 코어가 먼저 준다", () => {
    const list = works("pin:오래된-고정", "새-것");
    expect(firstVisible(list)).toBe(normalized(list));
    expect(firstVisible(list)).toBe("오래된-고정");
  });
});

import { describe, expect, it } from "vitest";
import { pickSlug } from "@/components/shell/shell-store";
import { isDefaultSelectable } from "./hooks";
import { splitWorkSections } from "./work-sections";
import type { WorkView } from "./types";

// 목록 순서·구역 분리 seam. 순수 함수 하나가 대상이라 렌더도 DOM도 없이 기본 환경(node)에서 돈다.
// 관찰하는 것은 "어떤 배열과 접힘 상태를 주면 어느 구역에 무엇이 어떤 순서로 놓이는가"뿐이다.
//
// 여기서 관찰하지 않는 것 — 구역이 화면에 어떻게 그려지는지, 접힘 애니메이션, 행의 생김새.
// 전부 렌더가 필요해 이 seam 밖이고, 깨지면 화면에서 즉시 드러난다.

// 이 seam은 목록에서 slug와 status만 본다 — 나머지 필드는 관심사가 아니라 좁게 만든다.
// "draft:" 접두사를 붙인 slug는 초안이 된다. (router.test.ts의 같은 헬퍼와 규칙을 맞춘다)
const works = (...slugs: Array<string>) =>
  slugs.map((raw) => {
    const draft = raw.startsWith("draft:");
    return { slug: draft ? raw.slice("draft:".length) : raw, status: draft ? "draft" : "active" };
  }) as Array<WorkView>;

const slugs = (list: ReadonlyArray<WorkView>) => list.map((work) => work.slug);

describe("작업 목록의 순서와 구역", () => {
  it("진행 중인 작업이 초안보다 먼저 온다", () => {
    const { visible } = splitWorkSections(works("draft:초안", "진행중"), true);
    expect(slugs(visible)).toEqual(["진행중", "초안"]);
  });

  it("같은 구역 안의 순서는 받은 순서 그대로다 — 함수가 순서를 다시 만들지 않는다", () => {
    const { main, drafts } = splitWorkSections(works("c", "draft:z", "a", "draft:b"), true);
    expect(slugs(main)).toEqual(["c", "a"]);
    expect(slugs(drafts)).toEqual(["z", "b"]);
  });

  it("초안 구역이 접혀 있으면 보이는 첫 항목은 진행 구역의 첫 항목이다", () => {
    const { visible } = splitWorkSections(works("draft:초안", "진행중-a", "진행중-b"), false);
    expect(slugs(visible)).toEqual(["진행중-a", "진행중-b"]);
  });

  it("목록이 비면 두 구역 모두 비고 보이는 첫 항목이 없다", () => {
    const { main, drafts, visible } = splitWorkSections([], false);
    expect(main).toEqual([]);
    expect(drafts).toEqual([]);
    expect(visible[0]).toBeUndefined();
  });
});

// 이 seam을 여는 이유가 이 불변조건 하나다:
//
//   목록이 실제로 보여주는 첫 항목 = 무선택 주소가 정규화되어 고르는 항목
//
// 기본 선택 어긋남(#58)이 정확히 이게 깨진 것이었고, 원인은 순서를 정하는 지점이 둘로
// 갈려 있었다는 것이다 — 정규화는 백엔드 원본 순서를 보는데 화면은 그 위에 정렬·필터를 얹었다.
// 두 규칙을 각각 흉내 내지 않고 **실제 함수 둘을 나란히 호출해** 비교한다. 한쪽만 고치면 여기서 갈린다.
describe("보이는 첫 항목과 기본 선택은 같은 것을 가리킨다", () => {
  const firstVisible = (list: Array<WorkView>, draftsOpen: boolean) =>
    splitWorkSections(list, draftsOpen).visible[0]?.slug ?? null;
  const normalized = (list: Array<WorkView>) => pickSlug(null, list, isDefaultSelectable);

  it("초안이 섞여 있고 접혀 있을 때", () => {
    const list = works("draft:초안", "진행중-a", "진행중-b");
    expect(firstVisible(list, false)).toBe(normalized(list));
    expect(firstVisible(list, false)).toBe("진행중-a");
  });

  it("초안을 펼쳐도 마찬가지다 — 펼침이 기본 선택을 옮기지 않는다", () => {
    const list = works("draft:초안", "진행중-a");
    expect(firstVisible(list, true)).toBe(normalized(list));
  });

  // 정규화는 후보가 없으면 첫 항목으로 떨어진다("초안뿐이면 빈 화면보다 낫다", router.test.ts).
  // 그래서 이 경우 본문은 첫 초안을 열고 있다. 접혔다고 목록이 비면 열린 작업이 목록 어디에도
  // 없게 된다 — 접힘은 진행 중인 작업이 있을 때만 의미가 있다.
  it("진행 중인 작업이 하나도 없으면 접혀 있어도 여전히 일치한다", () => {
    const list = works("draft:초안-a", "draft:초안-b");
    expect(firstVisible(list, false)).toBe(normalized(list));
    expect(firstVisible(list, false)).toBe("초안-a");
  });

  it("목록이 비면 양쪽 다 고를 것이 없다", () => {
    expect(firstVisible([], false)).toBe(normalized([]));
    expect(firstVisible([], false)).toBeNull();
  });
});

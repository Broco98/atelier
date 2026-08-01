import { describe, expect, it } from "vitest";
import { pickSlug } from "@/components/shell/shell-store";
import { isDefaultSelectable } from "./hooks";
import { splitWorkSections } from "./work-sections";
import type { WorkView } from "./types";

// 목록 순서·구역 분리 seam. 순수 함수 하나가 대상이라 렌더도 DOM도 없이 기본 환경(node)에서 돈다.
// 관찰하는 것은 "어떤 배열과 접힘 상태를 주면 어느 구역에 무엇이 어떤 순서로 놓이는가"뿐이다.
//
// 여기서 관찰하지 않는 것 — 구역이 화면에 어떻게 그려지는지, 접기 아이콘의 등장 타이밍,
// 섹션 헤더의 생김새. 전부 렌더가 필요해 이 seam 밖이고, 깨지면 화면에서 즉시 드러난다.

// 이 seam은 목록에서 slug와 status만 본다 — 나머지 필드는 관심사가 아니라 좁게 만든다.
// "draft:" 접두사를 붙인 slug는 초안이 된다. (router.test.ts의 같은 헬퍼와 규칙을 맞춘다)
const works = (...slugs: Array<string>) =>
  slugs.map((raw) => {
    const draft = raw.startsWith("draft:");
    return { slug: draft ? raw.slice("draft:".length) : raw, status: draft ? "draft" : "active" };
  }) as Array<WorkView>;

const slugs = (list: ReadonlyArray<WorkView>) => list.map((work) => work.slug);

// 두 섹션이 모두 펼쳐진 기본 상태
const BOTH = { works: true, drafts: true };

describe("작업 목록의 순서와 구역", () => {
  it("진행 중인 작업이 초안보다 먼저 온다", () => {
    const { visible } = splitWorkSections(works("draft:초안", "진행중"), BOTH);
    expect(slugs(visible)).toEqual(["진행중", "초안"]);
  });

  it("같은 구역 안의 순서는 받은 순서 그대로다 — 함수가 순서를 다시 만들지 않는다", () => {
    const { main, drafts } = splitWorkSections(works("c", "draft:z", "a", "draft:b"), BOTH);
    expect(slugs(main)).toEqual(["c", "a"]);
    expect(slugs(drafts)).toEqual(["z", "b"]);
  });

  it("목록이 비면 두 구역 모두 비고 보이는 첫 항목이 없다", () => {
    const { main, drafts, visible } = splitWorkSections([], BOTH);
    expect(main).toEqual([]);
    expect(drafts).toEqual([]);
    expect(visible[0]).toBeUndefined();
  });
});

// 섹션마다 접힌다. 접힌 섹션의 항목은 화면에 없으므로 보이는 목록에서도 빠진다 —
// 숫자 단축키가 세는 것이 이 목록이라, 여기가 어긋나면 ⌘3이 세 번째로 보이는 것과 다른 작업을 연다.
describe("섹션 접힘", () => {
  const list = works("진행중-a", "진행중-b", "draft:초안-a", "draft:초안-b");

  it("초안 섹션을 접으면 보이는 목록에 초안이 없다", () => {
    const { visible } = splitWorkSections(list, { works: true, drafts: false });
    expect(slugs(visible)).toEqual(["진행중-a", "진행중-b"]);
  });

  it("작업 섹션을 접으면 보이는 목록이 초안으로 시작한다", () => {
    const { visible } = splitWorkSections(list, { works: false, drafts: true });
    expect(slugs(visible)).toEqual(["초안-a", "초안-b"]);
  });

  it("둘 다 접으면 보이는 목록이 빈다 — 구역의 내용 자체는 그대로다", () => {
    const { main, drafts, visible } = splitWorkSections(list, { works: false, drafts: false });
    expect(visible).toEqual([]);
    // 헤더는 접혀도 그려야 하고, 접힌 섹션의 개수도 헤더에 나온다
    expect(slugs(main)).toEqual(["진행중-a", "진행중-b"]);
    expect(slugs(drafts)).toEqual(["초안-a", "초안-b"]);
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
    splitWorkSections(list, BOTH).visible[0]?.slug ?? null;
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
});

import { describe, expect, it } from "vitest";
import { edgeScrollStep, gapLineY, movedWorks, orderChanged, rowGap } from "./row-drop";
import type { ListGeometry, RowGap } from "./row-drop";
import type { WorkView } from "./types";

// 작업 행을 끌어 놓을 **틈**(UI개선 스펙 §4 · S6). 기하는 구획 단위이고 좌표는 스크롤 **내용**
// 좌표다 — 0이 목록 내용의 맨 위다. 아래 수는 실물 규격을 흉내 낸 것이다: 머리 28px · 행 55px ·
// 행 사이 3px · 구획 머리 위 12px.
//
// 표는 「위에서 먼저 맞는 줄이 이긴다」(티켓 05)를 줄마다 한 번씩 딛는다. 틈을 사각형 **안**에서만
// 정하고 빈 곳을 비워 두면 행 간격 3px 위에서 선이 깜빡 사라진다 — 그 빈 곳도 표에 있다.

const BOX = { left: 0, right: 280, top: 100, bottom: 600 };

/** 두 구획 다 펼친 목록 — `고정` p1·p2, `작업` m1·m2. */
const OPEN: ListGeometry = {
  box: BOX,
  sections: [
    {
      pinned: true,
      head: { top: 12, bottom: 40 },
      rows: [
        { slug: "p1", top: 43, bottom: 98 },
        { slug: "p2", top: 101, bottom: 156 },
      ],
      slugs: ["p1", "p2"],
    },
    {
      pinned: false,
      head: { top: 168, bottom: 196 },
      rows: [
        { slug: "m1", top: 199, bottom: 254 },
        { slug: "m2", top: 257, bottom: 312 },
      ],
      slugs: ["m1", "m2"],
    },
  ],
};

/** `고정`이 접힌 목록 — 행은 안 보여도 slug는 그대로 든다(접힌 머리에 놓을 때의 `before`). */
const PINNED_SHUT: ListGeometry = {
  box: BOX,
  sections: [
    { pinned: true, head: { top: 12, bottom: 40 }, rows: [], slugs: ["p1", "p2"] },
    {
      pinned: false,
      head: { top: 52, bottom: 80 },
      rows: [
        { slug: "m1", top: 83, bottom: 138 },
        { slug: "m2", top: 141, bottom: 196 },
      ],
      slugs: ["m1", "m2"],
    },
  ],
};

/**
 * **`고정`이 0개인** 목록을 끄는 중 — 머리가 없는 구획에 빈 받침만 선다(티켓 06 · 스펙 S7). 결정 82가
 * 빈 `고정`의 머리를 걷었으므로 규칙 2(머리)도 규칙 5(바로 위 사각형)도 이 자리에 답하지 못한다 —
 * 받침 사각형(규칙 3)이 없으면 첫 고정을 끌어서 할 길이 없다.
 */
const NO_PINNED: ListGeometry = {
  box: BOX,
  sections: [
    { pinned: true, head: null, slot: { top: 12, bottom: 48 }, rows: [], slugs: [] },
    {
      pinned: false,
      head: { top: 60, bottom: 88 },
      rows: [
        { slug: "m1", top: 91, bottom: 146 },
        { slug: "m2", top: 149, bottom: 204 },
      ],
      slugs: ["m1", "m2"],
    },
  ],
};

/** **모두 고정인** 목록을 끄는 중 — `작업` 머리 아래, 빈 문구 자리에 받침이 선다. */
const ALL_PINNED: ListGeometry = {
  box: BOX,
  sections: [
    {
      pinned: true,
      head: { top: 12, bottom: 40 },
      rows: [
        { slug: "p1", top: 43, bottom: 98 },
        { slug: "p2", top: 101, bottom: 156 },
      ],
      slugs: ["p1", "p2"],
    },
    { pinned: false, head: { top: 168, bottom: 196 }, slot: { top: 199, bottom: 235 }, rows: [], slugs: [] },
  ],
};

/** 내용 좌표 `y`에 포인터를 둔다 — 스크롤 0이라 뷰포트 y는 상자 윗변만큼 더한 값이다. */
const at = (y: number, scrollTop = 0) => ({ x: 140, y: BOX.top + y - scrollTop, scrollTop });

describe("틈 표", () => {
  it.each<[string, ListGeometry, string, number, RowGap | null]>([
    ["행 중심선 위 → 그 행 앞", OPEN, "m2", 50, { pinned: true, before: "p1" }],
    ["행 중심선 아래 → 같은 구획 다음 행 앞", OPEN, "m2", 90, { pinned: true, before: "p2" }],
    ["구획 마지막 행의 아래 절반 → 그 구획 끝", OPEN, "m1", 150, { pinned: true, before: null }],
    ["마지막 행과 다음 머리 사이 빈 곳 → 앞 구획 끝", OPEN, "m1", 162, { pinned: true, before: null }],
    ["행 사이 간격 → 위 행의 「아래」", OPEN, "m2", 99, { pinned: true, before: "p2" }],
    ["둘째 머리 윗부분 → 그 구획 맨 위", OPEN, "p1", 170, { pinned: false, before: "m1" }],
    ["둘째 머리 아랫부분 → 그 구획 맨 위", OPEN, "p1", 194, { pinned: false, before: "m1" }],
    ["머리와 첫 행 사이 → 그 구획 맨 위", OPEN, "p1", 197, { pinned: false, before: "m1" }],
    ["첫 머리 → 그 구획 맨 위", OPEN, "m1", 20, { pinned: true, before: "p1" }],
    // 첫 머리 위 여백(`mt-3`)은 위에 사각형이 없어 규칙 5가 답하지 못한다 — 그 머리의 판정(규칙 2)을
    // 준다. 06이 규칙 3(빈 받침)을 이 근처에 더할 때 「표에 없는 동작」으로 오독하지 않게 줄로 둔다.
    ["첫 머리 위 여백 → 그 구획 맨 위", OPEN, "m1", 5, { pinned: true, before: "p1" }],
    // **`고정` 구획 안**의 순서 바꾸기 — 고정 여부는 그대로 `true`다(티켓 05 L3 기준 · 스토리 4).
    ["`고정` 안에서 앞 행 앞으로 → 고정 그대로", OPEN, "p2", 50, { pinned: true, before: "p1" }],
    ["`고정` 안에서 구획 끝으로 → 고정 그대로", OPEN, "p1", 150, { pinned: true, before: null }],
    ["접힌 구획 머리 → 그 구획 맨 위", PINNED_SHUT, "m2", 30, { pinned: true, before: "p1" }],
    ["접힌 구획 머리 아래 → 그 구획 맨 위", PINNED_SHUT, "m2", 46, { pinned: true, before: "p1" }],
    ["마지막 행 아래 → 마지막 구획 끝", OPEN, "p1", 450, { pinned: false, before: null }],
    ["자기 앞 → 없음", OPEN, "m1", 200, null],
    ["`고정` 안에서 자기 바로 뒤 행의 윗 절반 → 없음", OPEN, "p1", 110, null],
    ["자기 아래 절반 → 없음", OPEN, "m1", 250, null],
    ["자기 바로 뒤 행의 윗 절반 → 없음", OPEN, "m1", 260, null],
    ["자기 바로 위 행의 아래 절반 → 없음", OPEN, "m2", 240, null],
    ["자기 구획 머리(자기가 첫 행) → 없음", OPEN, "m1", 180, null],
    ["자기 구획 끝(자기가 마지막 행) → 없음", OPEN, "m2", 310, null],
    ["자기가 마지막 행인 구획의 아래 빈 곳 → 없음", OPEN, "m2", 450, null],
    ["다른 구획 끝은 자기가 마지막이어도 옮김이다", OPEN, "p2", 450, { pinned: false, before: null }],
    // ── 빈 받침(규칙 3 — 티켓 06). 첫 고정도 마지막 고정 해제도 같은 손짓이다(스토리 7·8).
    ["빈 `고정` 받침 → `고정` 끝", NO_PINNED, "m1", 30, { pinned: true, before: null }],
    ["빈 `고정` 받침 위 여백 → `고정` 끝", NO_PINNED, "m1", 5, { pinned: true, before: null }],
    ["빈 `고정` 받침과 다음 머리 사이 → `고정` 끝", NO_PINNED, "m2", 54, { pinned: true, before: null }],
    ["받침이 서도 다음 구획의 머리는 그 구획 맨 위", NO_PINNED, "m2", 70, { pinned: false, before: "m1" }],
    ["빈 비고정 받침 → `작업` 끝", ALL_PINNED, "p1", 210, { pinned: false, before: null }],
    ["빈 비고정 받침 아래 빈 곳 → `작업` 끝", ALL_PINNED, "p2", 400, { pinned: false, before: null }],
  ])("%s", (_name, geometry, dragged, y, expected) => {
    expect(rowGap(geometry, dragged, at(y))).toEqual(expected);
  });

  it.each([
    ["상자 위", { x: 140, y: BOX.top - 1, scrollTop: 0 }],
    ["상자 아래", { x: 140, y: BOX.bottom + 1, scrollTop: 0 }],
    ["상자 왼쪽", { x: BOX.left - 1, y: BOX.top + 50, scrollTop: 0 }],
    ["상자 오른쪽", { x: BOX.right + 1, y: BOX.top + 50, scrollTop: 0 }],
  ])("목록 밖(%s) → 없음", (_name, pointer) => {
    expect(rowGap(OPEN, "m2", pointer)).toBeNull();
  });

  // 기하는 끌기 시작 뒤 **한 번** 잰다. 그 뒤로 목록이 굴러도 포인터 y에 그 순간의 `scrollTop`만
  // 더하면 같은 사각형을 가리켜야 한다 — 안 더하면 자동 스크롤(06)이 도는 순간 선이 어긋난다.
  it.each([
    ["행 중심선 위", 50, { pinned: true, before: "p1" }],
    ["둘째 머리", 170, { pinned: false, before: "m1" }],
    ["구획 사이 빈 곳", 162, { pinned: true, before: null }],
  ])("스크롤 오프셋이 더해져도 같은 답 — %s", (_name, y, expected) => {
    expect(rowGap(OPEN, "m2", at(y, 0))).toEqual(expected);
    expect(rowGap(OPEN, "m2", at(y, 40))).toEqual(expected);
    // 굴러 올라가 상자 위로 사라진 내용은 가리킬 수 없다 — 오프셋은 그 내용이 상자 안에 남는 만큼만.
    expect(rowGap(OPEN, "m2", at(y, 48))).toEqual(expected);
  });
});

// 선은 틈 **사이**에 선다 — 행을 밀지 않는 절대 위치라 값 하나(내용 좌표 y)면 된다.
describe("틈 선의 자리", () => {
  it.each<[string, ListGeometry, RowGap, number]>([
    ["구획 첫 행 앞 → 머리와 그 행 사이", OPEN, { pinned: true, before: "p1" }, 41.5],
    ["행 앞 → 앞 행과 그 행 사이", OPEN, { pinned: true, before: "p2" }, 99.5],
    ["구획 끝 → 마지막 행 바로 아래", OPEN, { pinned: true, before: null }, 157.5],
    // 접힌 구획엔 행이 안 보여 간격을 잴 자리가 없다 — 머리 아랫변에 선다.
    ["접힌 구획 → 머리 아랫변", PINNED_SHUT, { pinned: true, before: "p1" }, 40],
  ])("%s", (_name, geometry, gap, y) => {
    expect(gapLineY(geometry, gap)).toBe(y);
  });

  // 받침에 놓일 때는 **받침 자신이 밝아지고** 선은 없다 — 빈 구획엔 선이 설 「사이」가 없고, 머리
  // 아랫변에 세우면 받침 윗변에 붙어 「받침 위의 틈」으로 읽힌다.
  it.each<[string, ListGeometry, RowGap]>([
    ["빈 `고정` 받침", NO_PINNED, { pinned: true, before: null }],
    ["빈 비고정 받침", ALL_PINNED, { pinned: false, before: null }],
  ])("받침 → 선 없음 — %s", (_name, geometry, gap) => {
    expect(gapLineY(geometry, gap)).toBeNull();
  });
});

// 놓는 순간 캐시에 낙관적으로 쓰는 목록(스펙 §5). 코어가 돌려줄 목록과 같은 모양이어야 응답이
// 와도 화면이 한 번 더 안 뛴다 — 규칙은 코어 `move_work`의 것을 그대로 옮긴다.
describe("낙관적으로 옮긴 목록", () => {
  const list = (...raws: string[]) =>
    raws.map((raw) => ({
      slug: raw.replace("pin:", ""),
      pinned: raw.startsWith("pin:"),
      status: "draft",
    })) as WorkView[];
  const shape = (works: WorkView[]) => works.map((work) => `${work.pinned ? "pin:" : ""}${work.slug}`);

  it("같은 구획 안에서 앞에 선다", () => {
    expect(shape(movedWorks(list("pin:a", "b", "c", "d"), "d", { pinned: false, before: "b" }))).toEqual(
      ["pin:a", "d", "b", "c"],
    );
  });

  it("다른 구획 끝으로 가면 고정 여부가 바뀌고 상태는 그대로다", () => {
    const moved = movedWorks(list("pin:a", "b", "c"), "c", { pinned: true, before: null });
    expect(shape(moved)).toEqual(["pin:a", "pin:c", "b"]);
    expect(moved.every((work) => work.status === "draft")).toBe(true);
  });

  it("고정을 풀어 `작업` 끝으로", () => {
    expect(shape(movedWorks(list("pin:a", "pin:b", "c"), "a", { pinned: false, before: null }))).toEqual(
      ["pin:b", "c", "a"],
    );
  });

  it("모르는 slug면 목록을 그대로 둔다", () => {
    const works = list("a", "b");
    expect(movedWorks(works, "zz", { pinned: false, before: "a" })).toBe(works);
  });
});

// **끄는 도중 목록이 바뀌면 끌기를 거둘까**(티켓 06 · 스펙 S8). 재어 둔 기하가 틀어지는 것은 행의
// 순서나 구획이 바뀔 때뿐이다 — 제목·상태는 행 높이를 안 바꾼다(두 줄 55px로 못박혀 있다). 에이전트가
// spec을 고치면 `works:changed`가 오고 그것은 흔하다: 그때마다 끌기가 끊기면 손이 논다.
describe("끄는 도중 받은 목록이 끌기를 거두는가", () => {
  const view = (slug: string, pinned = false, rest: Partial<WorkView> = {}) =>
    ({ slug, pinned, title: slug, status: "active", ...rest }) as WorkView;
  const before = [view("a", true), view("b"), view("c")];

  it.each<[string, WorkView[], boolean]>([
    ["같은 목록(새 참조) → 유지", [view("a", true), view("b"), view("c")], false],
    ["제목·상태만 바뀜 → 유지", [view("a", true, { title: "새 제목" }), view("b", false, { status: "review" }), view("c")], false],
    ["순서가 바뀜 → 거둔다", [view("a", true), view("c"), view("b")], true],
    ["고정이 바뀜 → 거둔다", [view("a", true), view("b", true), view("c")], true],
    ["하나 더해짐 → 거둔다", [view("a", true), view("b"), view("c"), view("d")], true],
    ["하나 빠짐 → 거둔다", [view("a", true), view("b")], true],
    ["같은 수에 다른 slug → 거둔다", [view("a", true), view("b"), view("z")], true],
  ])("%s", (_name, after, changed) => {
    expect(orderChanged(before, after)).toBe(changed);
  });
});

// **가장자리 자동 스크롤**(티켓 06 · 스토리 13). 한 프레임에 굴릴 양이다 — 양수면 아래로. 좌표는 뷰포트
// 좌표다(포인터가 상자의 어느 가장자리에 붙었는가를 묻는 것이라 내용 좌표가 뜻이 없다).
describe("가장자리 자동 스크롤의 한 걸음", () => {
  const box = { left: 0, right: 280, top: 100, bottom: 600 };

  it("가운데에서는 안 구른다", () => {
    expect(edgeScrollStep(box, { x: 140, y: 350 })).toBe(0);
  });

  it("아래 가장자리에 닿으면 아래로, 위 가장자리에 닿으면 위로", () => {
    expect(edgeScrollStep(box, { x: 140, y: 595 })).toBeGreaterThan(0);
    expect(edgeScrollStep(box, { x: 140, y: 105 })).toBeLessThan(0);
  });

  it("가장자리에 깊이 붙을수록 빠르다", () => {
    const shallow = edgeScrollStep(box, { x: 140, y: 580 });
    const deep = edgeScrollStep(box, { x: 140, y: 598 });
    expect(shallow).toBeGreaterThan(0);
    expect(deep).toBeGreaterThan(shallow);
  });

  // 목록 밖은 놓을 곳이 없는 자리(틈 규칙 1)다 — 거기서 목록이 구르면 본문으로 끌고 나간 손이 사이드바를 흔든다.
  it.each([
    ["상자 아래", { x: 140, y: 601 }],
    ["상자 위", { x: 140, y: 99 }],
    ["상자 옆(가장자리 높이)", { x: 281, y: 595 }],
  ])("목록 밖(%s)에서는 안 구른다", (_name, point) => {
    expect(edgeScrollStep(box, point)).toBe(0);
  });
});

import { describe, expect, it } from "vitest";
import { pickSlug } from "@/components/shell/shell-store";
import { ALL_MODES } from "@/mode";
import {
  emptyMainNotice,
  emptyScreenCopy,
  listLabelOf,
  pageNameOf,
  splitWorkSections,
} from "./work-sections";
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

// 두 구획이 모두 펼쳐진 기본 상태
const ALL = { pinned: true, works: true };

describe("작업 목록의 순서와 구획", () => {
  // UI개선 결정 5. 초안은 따로 선 구역이 아니라 다른 작업들 사이에 선다 — 갈리는 것은 상태 아이콘뿐이다.
  it("초안은 따로 빠지지 않고 받은 자리 그대로 `작업`에 선다", () => {
    const { main, visible } = splitWorkSections(works("draft:초안", "진행중"), ALL);
    expect(slugs(main)).toEqual(["초안", "진행중"]);
    expect(slugs(visible)).toEqual(["초안", "진행중"]);
  });

  it("같은 구획 안의 순서는 받은 순서 그대로다 — 함수가 순서를 다시 만들지 않는다", () => {
    const { main } = splitWorkSections(works("c", "draft:z", "a", "draft:b"), ALL);
    expect(slugs(main)).toEqual(["c", "z", "a", "b"]);
  });

  it("목록이 비면 두 구획 모두 비고 보이는 첫 항목이 없다", () => {
    const { pinned, main, visible } = splitWorkSections([], ALL);
    expect(pinned).toEqual([]);
    expect(main).toEqual([]);
    expect(visible[0]).toBeUndefined();
  });

  // 고정은 **옮기는** 것이지 표시하는 것이 아니다 (결정 82) — 두 곳에 동시에 보이면
  // 같은 작업이 두 줄로 서고, 어느 쪽을 눌렀는지가 뜻을 갖게 된다.
  it("고정한 것은 `작업`에서 빠진다 — 초안이어도 마찬가지다", () => {
    const list = works("pin:고정", "진행중", "pin:draft:고정초안", "draft:초안");
    const { pinned, main, visible } = splitWorkSections(list, ALL);
    expect(slugs(pinned)).toEqual(["고정", "고정초안"]);
    expect(slugs(main)).toEqual(["진행중", "초안"]);
    // 고정 → 작업. 구획 안 순서는 받은 순서 그대로다.
    expect(slugs(visible)).toEqual(["고정", "고정초안", "진행중", "초안"]);
  });
});

// 구획마다 접힌다. 접힌 구획의 항목은 화면에 없으므로 보이는 목록에서도 빠진다.
describe("구획 접힘", () => {
  const list = works("pin:고정", "진행중-a", "draft:초안-a", "진행중-b");

  it("작업 구획을 접으면 보이는 목록이 고정뿐이다", () => {
    const { visible } = splitWorkSections(list, { pinned: true, works: false });
    expect(slugs(visible)).toEqual(["고정"]);
  });

  // `고정`도 `작업`과 같은 규칙으로 접힌다 (결정 108)
  it("고정 구획을 접으면 보이는 목록이 작업으로 시작한다", () => {
    const { pinned, visible } = splitWorkSections(list, { pinned: false, works: true });
    expect(slugs(visible)).toEqual(["진행중-a", "초안-a", "진행중-b"]);
    // 접혀도 구획의 내용은 그대로다 — 헤더의 개수가 거기서 나온다
    expect(slugs(pinned)).toEqual(["고정"]);
  });

  it("둘 다 접으면 보이는 목록이 빈다 — 구획의 내용 자체는 그대로다", () => {
    const { main, visible } = splitWorkSections(list, { pinned: false, works: false });
    expect(visible).toEqual([]);
    // 헤더는 접혀도 그려야 하고, 접힌 구획의 개수도 헤더에 나온다
    expect(slugs(main)).toEqual(["진행중-a", "초안-a", "진행중-b"]);
  });
});

// 빈 `작업` 구획이 무슨 말을 하는지도 판정이다 (결정 108). 컴포넌트 안에 두면 이 저장소의
// 정적 마크업 seam에 아예 안 걸리므로 여기로 꺼내 둔다.
//
// **갈래는 둘이다**(UI개선 결정 5). 초안이 `작업` 안에 서면서 「초안만 남았다」는 갈래가 사라졌다 —
// 초안이 하나라도 있으면 구획은 빈 것이 아니다.
describe("빈 작업 구획이 하는 말", () => {
  const notice = (...args: Array<string>) =>
    emptyMainNotice(splitWorkSections(works(...args), ALL), "atelier");

  it("고정 때문에 비었으면 그렇게 말한다 — 위에 작업이 버젓이 서 있다", () => {
    expect(notice("pin:고정")).toBe("전부 고정돼 있어요.");
    // 고정된 것이 초안뿐이어도 빈 이유는 고정이다 — 그 초안이 바로 위 `고정`에 서 있다
    expect(notice("pin:draft:고정초안")).toBe("전부 고정돼 있어요.");
  });

  it("아무것도 없을 때만 어디서 시작하는지 말한다", () => {
    expect(notice()).toBe("작업은 Claude Code에서 시작돼요.");
  });

  // `작업`이 비는 모양(아무것도 없음·고정만·고정된 초안만)을 두 세계에서 다 돌려 **나온 말을
  // 글자로** 댄다. 초안 갈래(「진행 중인 … 없어요」)가 되살아나 고정된 초안에 셋째 문장을 주면
  // 여기서 갈린다. 초안이 고정 밖에 있는 모양은 `작업`이 안 비므로 이 판정에 안 닿는다(위 둘째 describe).
  it("나올 수 있는 말은 「고정만 있다」·「아무것도 없다」 둘뿐이다", () => {
    const expected = {
      atelier: ["작업은 Claude Code에서 시작돼요.", "전부 고정돼 있어요."],
      maison: ['Terminal에서 claude에게 "새 Room 만들어줘"', "전부 고정돼 있어요."],
    };
    const shapes = [[], ["pin:고정"], ["pin:draft:고정초안"]];
    for (const mode of ALL_MODES) {
      const said = shapes.map((shape) => {
        const sections = splitWorkSections(works(...shape), ALL);
        expect(sections.main, `${mode} ${shape.join(",")}`).toEqual([]);
        return emptyMainNotice(sections, mode);
      });
      expect([...new Set(said)], mode).toEqual(expected[mode]);
    }
  });
});

// 같은 목록이 세계마다 **다른 이름**으로 자기를 부른다(#183, US 17). 판정 규칙은 하나이고
// 갈리는 것은 낱말뿐이라, 여기서 보는 것은 「갈래마다 그 세계의 말이 나오는가」다.
describe("상주 목록이 세계마다 자기 어휘로 말한다", () => {
  const notice = (mode: (typeof ALL_MODES)[number], ...args: Array<string>) =>
    emptyMainNotice(splitWorkSections(works(...args), ALL), mode);

  it("머리는 Atelier `작업` · Maison `Rooms`다", () => {
    expect(listLabelOf("atelier")).toBe("작업");
    expect(listLabelOf("maison")).toBe("Rooms");
  });

  // 앱에 Room을 만드는 화면이 없으니 **어디서 시작하는지**를 말한다. Atelier는 저장소를 여는
  // Claude Code이고 Maison에는 그 자리가 없어서(결정 17: 프로젝트가 없다) nav의 `Terminal`이다.
  it("Room이 하나도 없으면 Terminal에서 만들라고 한다", () => {
    expect(notice("maison")).toBe('Terminal에서 claude에게 "새 Room 만들어줘"');
  });

  it("Atelier 문구 둘은 한 글자도 안 바뀐다", () => {
    expect([notice("atelier"), notice("atelier", "pin:고정")]).toEqual([
      "작업은 Claude Code에서 시작돼요.",
      "전부 고정돼 있어요.",
    ]);
  });

  // **한쪽으로 눕히는 변형이 여기서 걸린다.** 두 세계가 한 표를 읽어도 위 검사들은 전부
  // 초록일 수 있다 — Atelier 문구가 정본이라 Maison이 그것을 그대로 뱉으면 「Atelier는
  // 그대로다」도, 「Maison에 Room 문구가 있다」도(갈래가 다르니) 따로따로는 통과한다.
  // 대상을 이름으로 부르는 두 갈래가 실제로 갈리는지를 함께 재야 그물이 닫힌다.
  it("대상을 부르는 갈래는 두 세계가 다른 말을 쓴다", () => {
    expect(notice("maison")).not.toBe(notice("atelier"));
    expect(listLabelOf("maison")).not.toBe(listLabelOf("atelier"));
  });

  // 고정은 세계를 안 타는 말이다 — 「작업」도 「Room」도 안 부르므로 굳이 갈라 두면 같은
  // 문장이 두 벌이 된다. 그 하나가 **일부러 같다**는 것을 남긴다.
  it("고정 갈래만 두 세계가 같은 문장이다", () => {
    expect(notice("maison", "pin:고정")).toBe(notice("atelier", "pin:고정"));
  });
});

// 사이드바가 아니라 **본문 한가운데**가 하는 말(US 22). 목록의 빈 구획과 한 표에서 나오는데,
// 이 자리가 오래 안 갈려 있었다 — 사이드바만 Room 어휘로 옮기면 Room이 0개인 화면에서
// 목록은 「Terminal에서 claude에게 …」인데 본문은 「작업은 Claude Code에서 시작돼요」라고
// 적고, 그 지시는 이 세계에서 실제로 통하지 않는다(Room은 MCP로만 만들어진다).
describe("고른 것이 없는 본문이 세계마다 자기 어휘로 말한다", () => {
  it("Atelier 세 조각은 한 글자도 안 바뀐다", () => {
    expect(emptyScreenCopy("atelier")).toEqual({
      title: "아직 작업이 없어요",
      body: "작업은 Claude Code에서 시작돼요. 작업이 시작되면 스펙 문서와 진행 상황이 여기에 나타나요.",
      code: 'atelier로 "새 작업" 시작해줘',
    });
  });

  it("Maison은 Terminal의 claude에게 부탁하라고 한다", () => {
    expect(emptyScreenCopy("maison")).toEqual({
      title: "아직 Room이 없어요",
      body: "Room은 Terminal에서 claude에게 부탁해서 만들어요. Room이 시작되면 스펙 문서와 진행 상황이 여기에 나타나요.",
      code: "새 Room 만들어줘",
    });
  });

  // **Maison에 Atelier의 어휘가 한 조각도 안 남는다.** 위 두 검사는 세 칸을 통째로 재지만
  // 표를 손볼 때 한 칸만 Atelier 문장을 되붙이는 사고는 그 자리에서만 빨개지고 이유가 안
  // 보인다 — 여기서 보는 것은 「이 세계에서 통하지 않는 말」이라는 성질 쪽이다.
  it.each(["작업", "Claude Code", "atelier로"])("Maison 본문에 `%s`가 없다", (word) => {
    const { title, body, code } = emptyScreenCopy("maison");
    expect(`${title}\n${body}\n${code}`).not.toContain(word);
  });
});

// **머리에 이는 화면 이름도 세계를 탄다.** 이 갈래는 고른 항목이 없을 때만 서는데, Room이
// 0개인 Maison에서는 그것이 **늘** 서는 상태다 — 그 자리가 리터럴 `"Works"`였던 동안, 본문
// 한가운데가 「아직 Room이 없어요」라고 말하는 바로 그 화면의 머리가 `Works`였다.
describe("화면이 머리에 이는 자기 이름", () => {
  it("두 세계가 각자 자기 이름을 든다", () => {
    expect(pageNameOf("atelier")).toBe("Works");
    expect(pageNameOf("maison")).toBe("Rooms");
  });

  // **`label`과 갈린 값이라는 것을 함께 잰다.** 한 칸으로 접으면 Atelier 머리가 한국어
  // `작업`으로 눕어 `Archive`·`Projects`와 다른 층이 되고, 그때 이 검사만 빨개진다.
  it("사이드바 구획 라벨과 같은 값이 아니다", () => {
    expect(pageNameOf("atelier")).not.toBe(listLabelOf("atelier"));
    // Maison은 두 자리가 같은 낱말이다 — 우연이 아니라 그 세계에서 구획 머리와 화면 이름이
    // 같은 층(대문자 영어)이라서다. 그 동치도 일부러 못박는다.
    expect(pageNameOf("maison")).toBe(listLabelOf("maison"));
  });
});

// 이 seam을 여는 이유가 이 불변조건 하나다:
//
//   (두 구획이 모두 펼쳐진 상태에서)
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
  const normalized = (list: Array<WorkView>) => pickSlug(null, list);

  // UI개선 결정 6. 한때 정규화가 초안을 건너뛰었다 — 초안이 접힌 구역에 살아서 거기로 떨어지면
  // 강조가 안 보였기 때문이다. 구역이 사라지면서 그 건너뛰기가 도리어 이 등식을 깬다:
  // 맨 위에 선 초안을 두고 둘째 줄이 열린다.
  it("초안이 맨 위일 때 — 그 초안을 고른다", () => {
    const list = works("draft:초안", "진행중-a", "진행중-b");
    expect(firstVisible(list)).toBe(normalized(list));
    expect(firstVisible(list)).toBe("초안");
  });

  it("진행 중인 작업이 하나도 없을 때", () => {
    const list = works("draft:초안-a", "draft:초안-b");
    expect(firstVisible(list)).toBe(normalized(list));
    expect(firstVisible(list)).toBe("초안-a");
  });

  it("목록이 비면 양쪽 다 고를 것이 없다", () => {
    expect(firstVisible([])).toBe(normalized([]));
    expect(firstVisible([])).toBeNull();
  });

  it("고정된 초안이 맨 위일 때", () => {
    const list = works("pin:draft:고정초안", "진행중");
    expect(firstVisible(list)).toBe(normalized(list));
    expect(firstVisible(list)).toBe("고정초안");
  });

  // `[새-것(최신), 오래된-고정]`이면 보이는 첫 항목은 고정 쪽인데 정규화는 첫 항목을 골라
  // 갈린다. 고치는 자리가 **코어**여서(결정 100) 이 목록은 이미 고정 먼저로 온다 — 아래
  // 순서가 그 계약이고, 코어가 그것을 잃으면 atelier-core의 목록 검사가 빨개진다.
  it("고정한 것이 createdAt에서 뒤일 때 — 코어가 먼저 준다", () => {
    const list = works("pin:오래된-고정", "새-것");
    expect(firstVisible(list)).toBe(normalized(list));
    expect(firstVisible(list)).toBe("오래된-고정");
  });
});

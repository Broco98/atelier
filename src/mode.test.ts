import { describe, expect, it } from "vitest";
import { navItems } from "@/components/shell/nav-items";
import { SETTINGS_ITEMS } from "@/features/settings/pages";
import {
  ALL_MODES,
  destinationsOf,
  hasProjects,
  modeFrom,
  modeOf,
  navItemsOf,
  navTargetOf,
  placeModeOf,
  refPrefixesOf,
  routesOf,
} from "./mode";

// 모드는 `"atelier"` 하나다(ui-refresh 결정 3) — 축을 걷는 동안 함수의 모양만 남았다. 이 파일은 그 모양이
// 한 값으로 맞게 답하는지를 본다. 순수 함수라 DOM도 라우터도 없이 전수할 수 있고, 여기서 못 잡는 것
// (정규화·히스토리)만 `router.test.ts`가 든다.

describe("주소가 모드를 말한다", () => {
  it.each(["/", "/works", "/works/spec-search", "/terminal", "/settings"])("%s는 Atelier다", (pathname) => {
    expect(modeOf(pathname)).toBe("atelier");
  });

  // 설정에는 모드가 안 실린다 — 설정이 지니는 모드는 마지막 모드 값이다(「앱으로 돌아가기」가 그리로 간다).
  it("설정 주소는 모드를 안 싣는다", () => {
    const settings = destinationsOf("atelier").find((place) => place.key === "settings");
    expect(settings?.to).toBe("/settings");
    expect(placeModeOf(settings?.to ?? "")).toBeNull();
  });
});

// 「어디에 있었다고 적어 둘 것인가」는 `modeOf`로 물으면 안 된다 — 그 함수의 기본값은
// 판정이 아니라 **모르는 주소를 눕히는 자리**라, 적는 쪽에서는 거짓말이 된다.
describe("적어 둘 모드를 묻는다", () => {
  it.each(["/", "/settings"])("%s는 모드 밖이라 적지 않는다", (pathname) => {
    expect(placeModeOf(pathname)).toBeNull();
  });

  // 설정 아래 화면(항목 페이지, UI개선 결정 22)도 모드 밖이다 — 접두사로 보지 않으면 항목 하나가
  // 조용히 마지막 자리를 덮어쓰고, 「앱으로 돌아가기」가 떠나온 자리를 잃는다.
  it("설정 아래 화면도 모드 밖이다", () => {
    expect(placeModeOf("/settings/일반")).toBeNull();
    for (const item of SETTINGS_ITEMS) expect(placeModeOf(item.to), item.to).toBeNull();
  });

  it.each(["/works", "/works/생활-모드", "/projects", "/terminal", "/processes", "/archive"])(
    "%s는 Atelier로 적는다",
    (pathname) => {
      expect(placeModeOf(pathname)).toBe("atelier");
    },
  );

  // 표의 여섯 화면은 전부 적히는 자리여야 한다 — 하나가 모드 밖으로 떨어지면 그 화면에
  // 머무는 동안 마지막 주소가 낡은 채 굳는다.
  it("표의 주소는 모두 자기 모드로 적힌다", () => {
    for (const mode of ALL_MODES) {
      for (const to of Object.values(routesOf(mode))) {
        expect(placeModeOf(to)).toBe(mode);
      }
    }
  });
});

describe("모드별 표", () => {
  it("모드는 하나다 — ui-refresh 결정 3", () => {
    expect(ALL_MODES).toEqual(["atelier"]);
  });

  // 밖에서 온 글자(저장소에 남은 마지막 모드, 편집기 주소의 id, 백엔드가 준 레이아웃 id)는 표의 키로
  // **검증해** 읽는다 — 캐스트로 두면 옛 값이나 손으로 고친 글자가 표에 없는 키로 파생을 찾는다.
  it.each(ALL_MODES)("%s는 그 모드로 읽힌다", (mode) => {
    expect(modeFrom(mode)).toBe(mode);
  });

  // 지운 모드의 이름도 모르는 글자다 — 저장소의 `last-mode`나 백엔드의 레이아웃 줄에 남아 올 수 있다.
  it.each(["maison", "Atelier", "", "atelierx", null])("%j는 모드가 아니다", (text) => {
    expect(modeFrom(text)).toBeNull();
  });

  // 표와 `modeOf`가 서로를 확인한다.
  it("표의 주소가 스스로 자기 모드로 읽힌다", () => {
    for (const mode of ALL_MODES) {
      for (const to of Object.values(routesOf(mode))) {
        expect(modeOf(to)).toBe(mode);
      }
    }
  });

  // `workSlugOf`(`@/lib/path-prefix`)가 기대는 불변식이다 — 항목 주소는 목록 주소 아래 한 칸. 이것이 깨지면 slug
  // 해석기가 조용히 `null`만 돌려준다(주소는 멀쩡한데 사이드바 강조가 안 선다).
  it("항목 주소는 목록 주소 아래 한 칸이다", () => {
    for (const mode of ALL_MODES) {
      const routes = routesOf(mode);
      expect(routes.item).toBe(`${routes.list}/$slug`);
      expect(routes.archiveItem).toBe(`${routes.archive}/$slug`);
    }
  });
});

describe("모드별 nav", () => {
  // 프로세스 스펙 S43: `Terminal` 다음, `Archive` 앞. 셸과 가까운 곳에 두고 차가운 보관물은 끝에 둔다.
  it.each(ALL_MODES)("%s nav에서 Processes는 Terminal 다음, Archive 앞이다", (mode) => {
    const keys = navItemsOf(mode).map((item) => item.key);
    const at = keys.indexOf("processes");
    expect(at, "Processes가 없다").toBeGreaterThan(0);
    expect(keys[at - 1]).toBe("terminal");
    expect(keys[at + 1]).toBe("archive");
  });

  // Atelier 벌의 정본은 계속 `nav-items.ts`다(그 파일의 주석이 「왜 Works가 없는가」를
  // 든다). 그래서 여기서는 **어긋나지 않는지**만 본다 — 저쪽에서 `to`를 고치면 라우트 표와
  // 갈라지고, 그 어긋남은 nav는 멀쩡한데 정규화만 딴 데로 가는 모양으로 나온다.
  it("Atelier nav는 nav-items.ts 그대로이고 라우트 표와 안 어긋난다", () => {
    expect(navItemsOf("atelier")).toBe(navItems);
    const routes = routesOf("atelier");
    expect(navItemsOf("atelier").find((item) => item.key === "terminal")?.to).toBe(routes.terminal);
    expect(navItemsOf("atelier").find((item) => item.key === "processes")?.to).toBe(routes.processes);
    expect(navItemsOf("atelier").find((item) => item.key === "archive")?.to).toBe(routes.archive);
  });

  // 사이드바가 그리는 항목은 전부 이 배열의 것이다(#183) — 그리는 자리가 실제로 `navItemsOf`를
  // 도는지는 `Sidebar.test.tsx`가 본다.
  it.each(ALL_MODES)("%s에서 사이드바가 그리는 항목은 전부 갈 곳이 있다", (mode) => {
    for (const item of navItemsOf(mode)) {
      expect(navTargetOf(mode, item.key), item.key).toBeTruthy();
    }
  });

  it.each(ALL_MODES)("%s에 있는 항목은 그 주소로 간다", (mode) => {
    for (const item of navItemsOf(mode)) {
      expect(navTargetOf(mode, item.key)).toBe(item.to);
    }
  });
});

describe("모드별 팔레트 목적지", () => {
  // 팔레트는 nav 줄에 **설정 한 줄을 얹은 것**이다(결정 51).
  it.each(ALL_MODES)("%s의 목적지는 nav 뒤에 설정 한 줄이다", (mode) => {
    expect(destinationsOf(mode).map(({ key, label, to }) => ({ key, label, to }))).toEqual([
      ...navItemsOf(mode).map(({ key, label, to }) => ({ key, label, to })),
      { key: "settings", label: "Settings", to: "/settings" },
    ]);
  });

  // 한때 여기에 **두 표를 잇는 다리**가 있었다 — 팔레트가 계속 `destinations.ts`의 Atelier
  // 전용 배열을 읽던 동안, 그 배열과 이 표가 갈리는 것을 막던 줄이다. #185가 팔레트를 이
  // 표로 옮기면서 저쪽 배열이 없어졌고, 그때부터 그 줄은 **자기 자신을 재는 검사**가 됐다
  // (양쪽이 같은 표에서 나오므로 무엇을 바꿔도 함께 움직인다). 그래서 걷었다.
  //
  // 그 다리가 지키던 결정 51은 `features/search/destinations.test.ts`가 든다 — 「설정은 nav 줄에
  // 없고 팔레트에는 있다」의 양쪽을 함께 못 박는 그 검사다.
});

describe("모드별 참조 접두사", () => {
  // MCP 지침이 읽는 뿌리와 같아야 한다(`instructions.rs`의 `the_instructions_read_the_roots_the_app_writes`).
  it("Atelier는 works · archive 아래다", () => {
    expect(refPrefixesOf("atelier")).toEqual({
      work: "~/.atelier/works/",
      archive: "~/.atelier/archive/",
    });
  });

  // 생성기 넷이 이 표를 실제로 읽는지는 여기서 안 잰다 — `refs.ts`가 표에서 앞머리를
  // 꺼내 쓰게 된 뒤로(#186), 표에서 뽑아 조립한 기대값은 구현을 베껴 적은 것이라 앞머리가
  // 통째로 뒤바뀌어도 초록으로 남는다. 완성된 참조는 `features/works/refs.test.ts`가
  // **글자 그대로** 잰다.
});

// **이 모드에 프로젝트가 있는가**(결정 17). 값 자체는 한 줄이면 끝나지만, 이 함수가 생긴
// 이유는 값이 아니라 **물음에 이름이 없었다는 것**이다 — 같은 판정이 화면 여섯과 훅 하나에
// 모드 이름을 리터럴로 맞대는 같은 모양으로 흩어져 있었다.
describe("모드가 프로젝트를 갖는가", () => {
  it("Atelier는 갖는다", () => {
    expect(hasProjects("atelier")).toBe(true);
  });

  // **nav와 같은 답을 해야 한다.** 두 사실이 갈리면 nav에 `Projects`가 없는데 화면은 프로젝트
  // 구획을 그리거나, 그 반대가 된다 — 표에서 두 칸을 따로 뽑아 맞대는 것이 그물이 된다.
  it.each(ALL_MODES)("%s: nav의 `Projects` 유무와 같은 답이다", (mode) => {
    const inNav = navItemsOf(mode).some((item) => item.label === "Projects");
    expect(hasProjects(mode)).toBe(inNav);
  });
});

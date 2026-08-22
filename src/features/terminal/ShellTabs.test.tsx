import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ShellTabs from "./ShellTabs";
import {
  markExited,
  markFailed,
  MAX_SHELLS,
  NO_SHELLS,
  openShell,
  TOP_TERMINAL,
  workShellOrigin,
} from "./shell-registry";
import type { ShellOrigin, ShellsState } from "./shell-registry";
import type { WorkView } from "@/features/works/types";

// 탭 줄은 **이 저장소에 선례가 없는 모양**이라(role="tab" 0건) 지킬 것을 스스로 들고 있어야
// 한다. 여기서 보는 것은 셋이다.
//
// 1. 형제 버튼 — SpecTree가 이미 푼 문제와 같다. 중첩 button은 HTML에서 허용되지 않고,
//    span role="button"으로 흉내내면 Tab으로 도달할 수 없다. 화면으로는 안 잡힌다.
// 2. hover 규칙이 한 요소에 두 벌 얹히지 않는 것 — index.css의 toggle-on·quiet-hover 주석이
//    "정렬 순서가 승자를 정하게 된다"고 경고하는 그것이다. state-scale.test.ts는 이것을
//    지켜주지 않는다: 그 파일의 검사는 hover:bg-accent 금지와 손으로 다시 쓴 조용한 hover
//    금지 **둘뿐**이다.
// 3. 상한에서 잠긴 `+`가 **이유를 실제로 읽히게** 두는 것 — 이 저장소의 잠근 버튼 관용구
//    (disabled + pointer-events-none + title)는 hover 자체를 막아 그 title이 뜨지 않는다.
//    티켓이 그 관용구를 복사하지 말라고 못박은 자리다.
//
// **이 줄은 이제 최상위 터미널(`/terminal`)의 것뿐이다**(결정 42·44). Work 화면에서는
// 걷어냈고 셸 고르기가 오른쪽 패널의 `shell` 탭으로 갔다(ShellList). 그래서 아래
// `render`의 기본값이 「타이틀바를 겸하는 줄」이다 — 겸하지 않는 줄이라는 것이 이제
// 없다(맨 아래 「패널이 있는 화면에는 서지 않는다」가 그것을 못박는다).

function opened(
  count: number,
  seed: ShellOrigin = TOP_TERMINAL,
  from: ShellsState = NO_SHELLS,
): ShellsState {
  let state = from;
  for (let n = 0; n < count; n += 1) {
    const next = openShell(state, seed);
    if (!next) throw new Error(`셸 ${count}개를 띄우려 했는데 ${n}개에서 거부됐다`);
    state = next.state;
  }
  return state;
}

function render(
  state: ShellsState,
  {
    owner = null,
    projects = [],
    // 기본값이 「겸한다」인 것은 이 줄이 사는 화면이 그것뿐이어서다. `titlebar: undefined`를
    // 일부러 넘기는 검사는 맨 아래 하나뿐이고, 그 검사가 보는 것은 **아무것도 안 그린다**이다.
    titlebar = { inset: false },
  }: {
    owner?: string | null;
    projects?: string[];
    titlebar?: { inset: boolean };
  } = {},
): string {
  return renderToStaticMarkup(
    <ShellTabs
      state={state}
      owner={owner}
      projects={projects}
      onSelect={() => {}}
      onClose={() => {}}
      onOpen={() => {}}
      titlebar={titlebar}
    />,
  );
}

const classesOf = (markup: string) => [...markup.matchAll(/class="([^"]*)"/g)].map((m) => m[1]);
const plusOf = (markup: string) => markup.match(/<button[^>]*aria-label="셸 열기"[^>]*>/)![0];

describe("셸 탭 줄의 칸", () => {
  it("이름 버튼과 닫기 버튼이 형제다", () => {
    const markup = render(opened(2));
    expect(markup.match(/aria-label="[^"]*닫기"/g)).toHaveLength(2);
    expect(markup).not.toMatch(/<button(?:(?!<\/button>)[\s\S])*<button/);
  });

  it("켜진 칸과 꺼진 칸이 서로 다른 배경을 갖는다", () => {
    const classes = classesOf(render(opened(3)));
    expect(classes.filter((one) => one.includes("toggle-on"))).toHaveLength(1);
    expect(classes.filter((one) => one.includes("hover:bg-state-1"))).toHaveLength(2);
  });

  it("한 요소에 hover 규칙이 두 벌 얹히지 않는다", () => {
    const classes = classesOf(render(opened(3)));
    // toggle-on은 자기 hover를 품는다. 꺼진 가지의 hover가 같은 요소에 함께 오면
    // 어느 쪽이 이길지를 유틸리티 정렬 순서가 정한다.
    expect(classes.filter((one) => /toggle-on/.test(one) && /hover:/.test(one))).toEqual([]);
  });

  // 최근 커밋 c0978b1이 spec 트리에서 없앤 것과 같은 함정이다. 배경을 가진 바깥 상자가
  // padding·gap을 가지면 그 자리는 **배경은 덮이는데 눌러도 아무 일이 없다.**
  // spec 트리는 오른쪽 4px을 남겼지만(hover에만 뜨는 복사 버튼을 띄우는 값) 여기 `×`는
  // 늘 보이므로 예외가 없다 — 덮인 자리가 전부 버튼이다.
  it("배경을 가진 바깥 상자가 여백을 하나도 갖지 않는다", () => {
    const boxes = classesOf(render(opened(2))).filter(
      (one) => one.includes("toggle-on") || one.includes("hover:bg-state-1"),
    );
    expect(boxes).toHaveLength(2);
    for (const box of boxes) expect(box).not.toMatch(/\b(gap-|p[xylrtb]?-)/);
  });
});

describe("죽은 칸과 못 뜬 칸", () => {
  it("종료 코드가 칸에 꼬리표로 붙는다", () => {
    const state = opened(2);
    const markup = render(markExited(state, state.shells[0].id, { exitCode: 42, signal: null }));
    expect(markup).toMatch(/>42</);
  });

  it("못 뜬 칸도 이름이 비어 있지 않다", () => {
    const state = opened(1);
    const reason = "$SHELL을 실행할 수 없습니다: /nonexistent";
    const markup = render(markFailed(state, state.shells[0].id, reason));
    expect(markup).toContain(reason);
    expect(markup).not.toMatch(/<span[^>]*>\s*<\/span>/);
  });
});

describe("상한에 닿은 `+`", () => {
  it("상한 아래에서는 잠기지 않는다", () => {
    expect(plusOf(render(opened(MAX_SHELLS - 1)))).not.toMatch(/aria-disabled/);
  });

  it("상한에서 잠기지만 hover는 살아 있다", () => {
    const plus = plusOf(render(opened(MAX_SHELLS)));
    expect(plus).toMatch(/aria-disabled="true"/);
    // 이 둘 중 하나라도 들어오면 hover 이벤트가 죽어 아래 title이 화면에 뜨지 않는다.
    // `\b`로 쓰면 안 된다 — `aria-disabled`의 하이픈 뒤에도 단어 경계가 서서
    // 우리가 일부러 붙인 그 속성에 스스로 걸린다. 속성의 시작을 공백으로 본다.
    expect(plus).not.toMatch(/\sdisabled(=|\s|>)/);
    expect(plus).not.toMatch(/pointer-events-none/);
  });

  it("잠긴 이유가 상한·현재 수·앱 전체 기준을 함께 말한다", () => {
    const title = plusOf(render(opened(MAX_SHELLS))).match(/title="([^"]*)"/)![1];
    expect(title).toMatch(new RegExp(`${MAX_SHELLS}개까지`));
    expect(title).toMatch(new RegExp(`지금 ${MAX_SHELLS}개`));
    expect(title).toContain("다른 터미널");
  });

  it("칸이 하나도 없어도 `+`는 남는다", () => {
    const markup = render(NO_SHELLS);
    expect(plusOf(markup)).toBeTruthy();
    expect(markup).not.toMatch(/닫기/);
  });
});

// 판 03. 줄 하나가 화면 하나를 그리는데, 상한만은 앱 전체가 센다(결정 30) — 두 규칙이
// 한 컴포넌트 안에 함께 있어서 한쪽으로 미끄러지기 쉽다.
describe("줄은 자기 화면 것만 그린다", () => {
  it("다른 Work의 셸은 이 줄에 없다", () => {
    let state = opened(2, { owner: "가", project: null, cwd: null });
    state = opened(3, { owner: "나", project: null, cwd: null }, state);
    expect(render(state, { owner: "가" }).match(/aria-label="[^"]*닫기"/g)).toHaveLength(2);
    expect(render(state, { owner: "나" }).match(/aria-label="[^"]*닫기"/g)).toHaveLength(3);
  });

  it("이 줄에서 켜진 칸은 이 화면의 것이다", () => {
    let state = opened(2, { owner: "가", project: null, cwd: null });
    state = opened(1, { owner: "나", project: null, cwd: null }, state);
    // 마지막으로 띄운 것은 나의 셸이다. 그래도 가의 줄에는 가의 켜진 칸이 있어야 한다.
    const classes = classesOf(render(state, { owner: "가" }));
    expect(classes.filter((one) => one.includes("toggle-on"))).toHaveLength(1);
  });

  // 화면이 세면 Work마다 8개가 된다. `+`가 잠기는 판정은 **이 줄의 길이와 무관하다.**
  it("이 줄이 비어 있어도 앱 전체가 상한이면 `+`가 잠긴다", () => {
    const state = opened(MAX_SHELLS, { owner: "남", project: null, cwd: null });
    const markup = render(state, { owner: "나" });
    expect(markup).not.toMatch(/닫기/);
    expect(plusOf(markup)).toMatch(/aria-disabled="true"/);
  });

  it("잠긴 이유가 이 줄이 아니라 앱 전체 수를 말한다", () => {
    const state = opened(MAX_SHELLS, { owner: "남", project: null, cwd: null });
    const title = plusOf(render(state, { owner: "나" })).match(/title="([^"]*)"/)![1];
    expect(title).toMatch(new RegExp(`지금 ${MAX_SHELLS}개`));
  });
});

// 결정 24. 프로젝트가 여럿이면 아무 데나 고를 수 없다 — 틀린 워크트리에서 claude가 돈다.
describe("프로젝트가 여럿인 Work의 `+`", () => {
  it("프로젝트가 여럿이면 `+`가 곧바로 열지 않고 물어본다", () => {
    const plus = plusOf(render(NO_SHELLS, { owner: "가", projects: ["atelier", "cli"] }));
    expect(plus).toMatch(/aria-haspopup="menu"/);
    expect(plus).toMatch(/aria-expanded="false"/);
  });

  it("프로젝트가 하나면 묻지 않는다", () => {
    const plus = plusOf(render(NO_SHELLS, { owner: "가", projects: ["atelier"] }));
    expect(plus).not.toMatch(/aria-haspopup/);
  });

  it("최상위 터미널도 묻지 않는다", () => {
    expect(plusOf(render(NO_SHELLS))).not.toMatch(/aria-haspopup/);
  });

  // 이름의 가운데 갈래(결정 31). 어느 칸이 어느 워크트리인지가 줄에서 읽혀야 한다.
  it("프로젝트로 연 칸은 그 이름을 단다", () => {
    const state = opened(1, { owner: "가", project: "cli", cwd: null });
    expect(render(state, { owner: "가", projects: ["atelier", "cli"] })).toContain(">cli<");
  });
});

// `+`가 묻는 조건과 cwd가 갈리는 조건은 **한 규칙**인데(결정 24) 자리가 둘이다 —
// 여기 `projects.length > 1`과 순수 모듈의 `workShellOrigin` 갈래. 둘이 갈리면 화면이
// 안 묻고 지나간 뒤 셸이 안 뜨거나(묻어야 했는데), 물어 놓고 답이 무의미해진다.
// 렌더로는 한쪽만 보이므로 여기서 둘을 맞대어 둔다.
describe("`+`가 묻는 조건은 cwd가 갈리는 조건과 같다", () => {
  const work = (projects: string[]): WorkView => ({
    slug: "w",
    title: "w",
    status: "active",
    branch: "feat/w",
    createdAt: "2026-08-17",
    projects,
    worktrees: projects.map((project) => ({
      project,
      path: `~/.atelier/works/w/trees/${project}`,
      exists: true,
      dirty: false,
    })),
    specDir: "~/.atelier/works/w/spec",
    specFiles: [],
  });

  for (const projects of [[], ["atelier"], ["atelier", "ghost"], ["a", "b", "c"]]) {
    it(`프로젝트 ${projects.length}개`, () => {
      // 순수 모듈: 프로젝트를 안 정하고 물었을 때 자리를 못 정하면 = 물어야 한다.
      const 물어야 = workShellOrigin(work(projects), null) === null;
      // 화면: 메뉴를 여는 `+`인가.
      const 묻는다 = render(NO_SHELLS, { owner: "w", projects }).includes('aria-haspopup="menu"');
      expect(묻는다).toBe(물어야);
    });
  }
});

// 최상위 터미널에서는 이 줄이 창 맨 위에 선다. 그때 딸려와야 하는 셋은 화면으로만 보이고
// (창이 안 끌린다 / 신호등이 탭을 가린다 / 층 높이가 안 맞는다) 하나같이 "그냥 좀 이상한데"
// 로 나타나 원인을 못 찾는다. 마크업에 못박는다.
describe("탭 줄이 타이틀바를 겸할 때", () => {
  it("창을 끌 수 있다 — 이 줄이 창 맨 위라 없으면 창이 안 움직인다", () => {
    expect(render(NO_SHELLS)).toContain("data-tauri-drag-region");
  });

  it("44px 층이다 — 화면 머리행이 없는 자리를 이 줄이 대신 이고 있다", () => {
    expect(render(NO_SHELLS)).toContain("h-(--titlebar-height)");
  });

  // 사이드바가 접히면 이 줄이 창 왼쪽 끝에 붙는다. 그 자리가 신호등이다.
  it("사이드바가 접히면 신호등을 피한다", () => {
    expect(render(NO_SHELLS, { titlebar: { inset: true } })).toContain("pl-(--titlebar-inset)");
    expect(render(NO_SHELLS, { titlebar: { inset: false } })).not.toContain("(--titlebar-inset)");
  });

  // 여백이 사이드바 폭과 다른 곡선으로 움직이면 최종 자리를 지나쳤다 되돌아온다
  // (index.css의 --panel-ease 주석. PageHeader가 같은 이유로 같은 값을 쓴다).
  it("여백이 사이드바와 같은 곡선으로 움직인다", () => {
    expect(render(NO_SHELLS, { titlebar: { inset: true } })).toContain("ease-panel");
  });
});

// 결정 42·44. **이 줄이 서는 조건과 이 줄이 타이틀바를 겸하는 조건은 같은 하나다** —
// 겸하는 화면은 패널도 머리행도 없는 최상위 터미널뿐이고, 패널이 있는 화면은 셸을 패널의
// `shell` 탭에서 고른다. 이 검사가 없으면 Work 화면 본문에 탭 줄이 되살아나도 아무도
// 못 잡는다: 되살아난 줄은 **화면에서 멀쩡해 보이고**, 같은 것이 두 자리에 선 것만이
// 문제라 어느 쪽이 틀렸는지가 안 드러난다.
describe("패널이 있는 화면에는 이 줄이 서지 않는다", () => {
  // 위 `render`를 쓰지 않는다 — 그 헬퍼의 기본값이 바로 「겸한다」라, `titlebar: undefined`를
  // 넘겨도 기본값이 도로 채운다(기본 매개변수는 undefined에 걸린다). 여기서 보려는 것이
  // 그 부재 자체이므로 컴포넌트를 직접 세운다.
  const plain = (state: ShellsState) =>
    renderToStaticMarkup(
      <ShellTabs
        state={state}
        owner="가"
        projects={[]}
        onSelect={() => {}}
        onClose={() => {}}
        onOpen={() => {}}
      />,
    );

  it("타이틀바를 겸하지 않으면 아무것도 그리지 않는다", () => {
    expect(plain(opened(2, { owner: "가", project: null, cwd: null }))).toBe("");
  });

  it("셸이 하나도 없어도 마찬가지다 — `+`까지 함께 사라진다", () => {
    // `+`만 남기고 칸을 지우는 절충이 없다는 뜻이다. 새 셸을 여는 자리도 패널로 갔다.
    expect(plain(NO_SHELLS)).toBe("");
  });
});

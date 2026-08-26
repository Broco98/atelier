import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ShellList from "./ShellList";
import {
  markExited,
  markFailed,
  MAX_SHELLS,
  NO_SHELLS,
  openShell,
  setShellName,
  setTitle,
} from "./shell-registry";
import type { ShellOrigin, ShellsState } from "./shell-registry";

// 패널 `shell` 탭의 세로 목록(결정 42). 가로 탭 줄에서 옮겨 오며 **한 행이 두 줄이 됐고**
// (결정 45) 이름이 `프로젝트 · 타이틀`로 바뀌었다(결정 46). 여기서 보는 것은 그 두 줄이
// 실제로 무엇을 적는가와, 가로 줄에서 물려받은 규칙 셋이 안 깨졌는가다.
//
// 두 줄을 **행 안에서** 보는 것이 중요하다. 마크업 전체에서 문자열만 찾으면 프로젝트가
// 사라진 이름과 살아 있는 이름을 구분하지 못한다 — 앞 판이 실물에서 그렇게 잃었다.

const WORK = "가";

const origin = (project: string | null, cwd: string | null): ShellOrigin => ({
  owner: WORK,
  project,
  cwd,
});

function opened(
  count: number,
  seed: ShellOrigin = origin(null, "~/.atelier/works/가/trees/atelier"),
  from: ShellsState = NO_SHELLS,
): { state: ShellsState; ids: number[] } {
  let state = from;
  const ids: number[] = [];
  for (let n = 0; n < count; n += 1) {
    const next = openShell(state, seed);
    if (!next) throw new Error(`셸 ${count}개를 띄우려 했는데 ${n}개에서 거부됐다`);
    state = next.state;
    ids.push(next.id);
  }
  return { state, ids };
}

function render(
  state: ShellsState,
  {
    owner = WORK,
    projects = [],
    showing = true,
  }: { owner?: string | null; projects?: string[]; showing?: boolean } = {},
): string {
  return renderToStaticMarkup(
    <ShellList
      state={state}
      owner={owner}
      projects={projects}
      showing={showing}
      onSelect={() => {}}
      onClose={() => {}}
      onOpen={() => {}}
    />,
  );
}

const classesOf = (markup: string) => [...markup.matchAll(/class="([^"]*)"/g)].map((m) => m[1]);
const plusOf = (markup: string) => markup.match(/<button[^>]*aria-label="셸 열기"[^>]*>/)![0];
// 이름 버튼 하나를 통째로 잘라낸다 — 두 줄이 **같은 버튼 안**에 있어야 한 행으로 읽힌다.
// 마크업 전체에서 문자열만 찾으면 「어딘가 적혀 있다」와 「이 행에 적혀 있다」가 같아진다.
// 세로 flex인 버튼은 이름 버튼뿐이라 `flex-col`이 표식이다.
const rowsOf = (state: ShellsState) =>
  [...render(state).matchAll(/<button type="button" class="[^"]*flex-col[^"]*">(.*?)<\/button>/g)].map(
    (m) => m[1],
  );

// 배경(선택·hover)을 가진 **바깥 상자**들. `+`는 div가 아니라 button이라 안 걸린다.
const rowBoxesOf = (markup: string) =>
  [...markup.matchAll(/<div class="([^"]*)"/g)]
    .map((m) => m[1])
    .filter((one) => /selected-row|hover:bg-state-1/.test(one));

describe("행은 두 줄이다", () => {
  it("첫 줄이 이름이고 둘째 줄이 지금 상태다", () => {
    const { state, ids } = opened(1);
    const rows = rowsOf(setShellName(state, ids[0], "zsh"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("zsh");
    // 도는 셸의 둘째 줄은 **어디서 떴는가**다(결정 45). 같은 버튼 안이어야 한 행이다.
    expect(rows[0]).toContain("~/.atelier/works/가/trees/atelier");
  });

  it("프로젝트가 있으면 타이틀과 **함께** 적는다 — 타이틀이 와도 안 사라진다", () => {
    // 결정 46이 닫은 자리다. 실물에서 로그인 zsh가 뜨자마자 OSC 타이틀을 쏴 이름이
    // `gimhyoyeon@gimhy…`가 되고 어느 워크트리의 셸인지가 사라졌다. 세로 목록은 폭이 있어
    // 둘을 함께 적는다 — 여기서 프로젝트가 빠지면 그 사고가 그대로 돌아온다.
    const { state, ids } = opened(1, origin("cli", "~/.atelier/works/가/trees/cli"));
    const rows = rowsOf(setTitle(state, ids[0], "gimhyoyeon@gimhyoyeon"));
    expect(rows[0]).toContain("cli · gimhyoyeon@gimhyoyeon");
  });

  it("프로젝트가 없으면 이름 하나다 — 앞에 구분점이 남지 않는다", () => {
    const { state, ids } = opened(1);
    expect(rowsOf(setTitle(state, ids[0], "claude"))[0]).not.toContain("·");
  });

  it("끝난 셸의 둘째 줄은 어떻게 끝났는지다", () => {
    const { state, ids } = opened(2);
    const rows = rowsOf(markExited(state, ids[0], { exitCode: 42, signal: null }));
    expect(rows[0]).toContain("종료 코드 42");
    // cwd가 그 자리를 밀어낸 것이 아니라 **자리를 넘겨준** 것이다 — 둘이 함께 서면
    // 두 줄 규격이 세 줄이 된다.
    expect(rows[0]).not.toContain("trees/atelier");
  });

  it("못 뜬 셸은 그 이유를 둘째 줄에 적는다", () => {
    const { state, ids } = opened(1);
    const reason = "$SHELL을 실행할 수 없습니다: /nonexistent";
    expect(rowsOf(markFailed(state, ids[0], reason))[0]).toContain(reason);
  });

  it("pid를 적지 않는다 — 화면까지 오는 길이 없다", () => {
    // 결정 45가 명시적으로 뺐다. 백엔드가 주는 것은 `PtySpawned { id, shellName }`뿐이라
    // 여기 숫자를 적으려면 그것은 **레지스트리의 발급 번호**이고, 그 번호는 사람에게
    // 아무 뜻이 없다(PTY id도 아니다).
    const { state, ids } = opened(1);
    expect(rowsOf(setShellName(state, ids[0], "zsh"))[0]).not.toMatch(/\bpid\b/i);
  });
});

describe("행 하나의 규격", () => {
  it("이름 버튼과 닫기 버튼이 형제다", () => {
    // spec 트리가 이미 푼 문제와 같다. 중첩 button은 HTML에서 허용되지 않고,
    // span role="button"으로 흉내내면 Tab으로 도달할 수 없다.
    const markup = render(opened(2).state);
    expect(markup.match(/aria-label="[^"]*닫기"/g)).toHaveLength(2);
    expect(markup).not.toMatch(/<button(?:(?!<\/button>)[\s\S])*<button/);
  });

  it("켜진 행과 꺼진 행이 서로 다른 배경을 갖는다", () => {
    const classes = classesOf(render(opened(3).state));
    // 같은 패널 안 spec 트리와 **같은 어휘**다 — 행 선택은 selected-row, 비선택 hover는 1이다.
    expect(classes.filter((one) => one.includes("selected-row"))).toHaveLength(1);
    // `+` 행도 꺼진 행과 같은 hover를 갖는다 — 셋 + 하나.
    expect(classes.filter((one) => one.includes("hover:bg-state-1"))).toHaveLength(3);
  });

  it("본문이 이 화면이 아니면 켜진 행이 하나도 없다", () => {
    // 결정 101. 사이드바에서는 **남의 work의 가지도 펼쳐 둘 수 있다** — 그 가지의 활성
    // 칸까지 강조하면 「지금 보고 있는 것」이 한 화면에 둘이 된다. `activeIdOf`는 그 work의
    // 기억이지 지금 화면이 아니라, 둘을 가르는 자리가 `showing` 하나다.
    const classes = classesOf(render(opened(3).state, { showing: false }));
    expect(classes.filter((one) => one.includes("selected-row"))).toEqual([]);
    // 셋 다 꺼진 행이 됐으니 `+` 행까지 넷이 같은 hover를 쓴다.
    expect(classes.filter((one) => one.includes("hover:bg-state-1"))).toHaveLength(4);
  });

  it("한 요소에 hover 규칙이 두 벌 얹히지 않는다", () => {
    // selected-row는 자기 hover를 품는다. 꺼진 가지의 hover가 같은 요소에 함께 오면
    // 어느 쪽이 이길지를 유틸리티 정렬 순서가 정한다(index.css의 경고).
    const classes = classesOf(render(opened(3).state));
    expect(classes.filter((one) => /selected-row/.test(one) && /hover:/.test(one))).toEqual([]);
  });

  it("배경을 가진 바깥 상자가 가로 여백을 pr-1 말고는 갖지 않는다", () => {
    // 바깥이 가진 padding은 두 버튼 어디에도 속하지 않아 **배경은 덮이는데 눌러도 아무
    // 일이 없는** 죽은 자리가 된다(커밋 c0978b1이 spec 트리에서 없앤 것). pr-1만 남는 것은
    // 그것이 `×`를 행 가장자리에서 띄우는 값이라 어느 버튼에도 넣을 수 없어서다.
    const boxes = rowBoxesOf(render(opened(2).state));
    expect(boxes).toHaveLength(2);
    for (const box of boxes) {
      for (const pad of box.split(/\s+/).filter((one) => /^p[xylrtb]?-/.test(one))) {
        expect(pad, box).toBe("pr-1");
      }
    }
  });
});

describe("셸이 하나도 없는 화면", () => {
  // 정상 종료한 셸이 목록에서 스스로 빠지므로(결정 48) 이 화면이 실재한다 — 마지막 칸이
  // `exit`으로 사라진 자리에서는 새 셸이 저절로 뜨지 않는다(`×`에서 물려받은 성질).
  it("빈 상태와 새 셸 행이 함께 보인다", () => {
    const markup = render(NO_SHELLS);
    expect(markup).toContain("아직 셸이 없어요");
    // 「없다」만 말하고 끝나면 여기서 할 수 있는 일이 없다 — 만드는 자리가 같이 있어야 한다.
    expect(markup).toContain("새 셸");
    expect(markup).not.toMatch(/닫기/);
  });

  it("셸이 있으면 빈 상태를 말하지 않는다", () => {
    expect(render(opened(1).state)).not.toContain("아직 셸이 없어요");
  });
});

describe("상한에 닿은 `+` 행", () => {
  // 결정 47. `+`가 행이 되면서 잠긴 이유를 hover 뒤에 숨길 필요가 없어졌다 — 그 자리에
  // 문장을 그냥 쓴다. 이 검사가 보는 것은 **보이는 글자**이지 title이 아니다.
  const capped = () => opened(MAX_SHELLS).state;

  it("상한 아래에서는 잠기지 않고 「새 셸」이라고 적는다", () => {
    const markup = render(opened(MAX_SHELLS - 1).state);
    expect(plusOf(markup)).not.toMatch(/aria-disabled/);
    expect(markup).toContain("새 셸");
  });

  it("상한에서는 이유가 글자로 보인다 — title에 숨지 않는다", () => {
    const markup = render(capped());
    expect(markup).toContain(`셸은 ${MAX_SHELLS}개까지예요 — 지금 ${MAX_SHELLS}개`);
    // 그 문장이 hover 뒤로 되돌아가면 여기서 걸린다. `+` 행에는 title이 없다.
    expect(plusOf(markup)).not.toMatch(/title=/);
    expect(markup).not.toContain("새 셸");
  });

  it("상한에서 잠기지만 이 저장소의 잠금 관용구를 쓰지 않는다", () => {
    // disabled + pointer-events-none은 이 행을 「누를 수 없는 것」으로 접어 문장까지
    // 함께 흐리게 만든다. 읽혀야 하는 것이 그 문장이므로 aria-disabled + 클릭 무시다.
    const plus = plusOf(render(capped()));
    expect(plus).toMatch(/aria-disabled="true"/);
    // `\b`로 쓰면 안 된다 — `aria-disabled`의 하이픈 뒤에도 단어 경계가 서서 우리가
    // 일부러 붙인 그 속성에 스스로 걸린다. 속성의 시작을 공백으로 본다.
    expect(plus).not.toMatch(/\sdisabled(=|\s|>)/);
    expect(plus).not.toMatch(/pointer-events-none/);
  });
});

// 목록 하나가 화면 하나를 그리는데, 상한만은 앱 전체가 센다(결정 30) — 두 규칙이 한
// 컴포넌트 안에 함께 있어서 한쪽으로 미끄러지기 쉽다.
describe("목록은 자기 Work 것만 그린다", () => {
  it("다른 Work의 셸은 이 목록에 없다", () => {
    const 가 = opened(2);
    const 나 = opened(3, { owner: "나", project: null, cwd: "~/x" }, 가.state);
    expect(render(나.state, { owner: "가" }).match(/aria-label="[^"]*닫기"/g)).toHaveLength(2);
    expect(render(나.state, { owner: "나" }).match(/aria-label="[^"]*닫기"/g)).toHaveLength(3);
  });

  it("이 목록이 비어 있어도 앱 전체가 상한이면 `+`가 잠긴다", () => {
    // 화면이 세면 Work마다 8개가 된다. 잠기는 판정은 이 목록의 길이와 무관하다.
    const state = opened(MAX_SHELLS, { owner: "남", project: null, cwd: "~/x" }).state;
    const markup = render(state, { owner: "나" });
    expect(markup).toContain("아직 셸이 없어요");
    expect(plusOf(markup)).toMatch(/aria-disabled="true"/);
    // 그리고 이유가 **앱 전체 수**를 말한다 — 이 목록의 0개가 아니다.
    expect(markup).toContain(`지금 ${MAX_SHELLS}개`);
  });
});

// 결정 24. 프로젝트가 여럿이면 아무 데나 고를 수 없다 — 틀린 워크트리에서 claude가 돈다.
describe("프로젝트가 여럿인 Work의 `+`", () => {
  it("여럿이면 곧바로 열지 않고 물어본다", () => {
    const plus = plusOf(render(NO_SHELLS, { projects: ["atelier", "cli"] }));
    expect(plus).toMatch(/aria-haspopup="menu"/);
    expect(plus).toMatch(/aria-expanded="false"/);
  });

  it("하나면 묻지 않는다", () => {
    expect(plusOf(render(NO_SHELLS, { projects: ["atelier"] }))).not.toMatch(/aria-haspopup/);
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { agentMarkOf } from "@/components/ui/agent-mark";
import ShellTabs from "./ShellTabs";
import {
  markExited,
  markFailed,
  MAX_SHELLS,
  NO_SHELLS,
  openShell,
  setRunning,
  setShellName,
  setTitle,
  shellEndLabels,
} from "./shell-registry";
import type { ShellOrigin, ShellsState } from "./shell-registry";

// work 화면의 머리행 — **탭 줄이다**(결정 7). `[spec][셸…][+]`가 서고 오른쪽 끝에 조작이
// 고정된다(결정 10). 셸을 고르는 자리가 사이드바에서 화면 안으로 돌아온 것이라, 여기서
// 보는 것은 「무엇이 어느 순서로 서고 각 칸이 무엇을 적는가」다.
//
// **칸 안에서 본다.** 마크업 전체에서 `toContain`으로 판정하면 「어딘가 적혀 있다」와
// 「이 칸에 적혀 있다」가 같아져서, 이름이 사라진 칸과 살아 있는 칸이 구분되지 않는다 —
// ShellList.test.tsx 머리말이 앞 판에서 실물로 잃은 것으로 적어 둔 사고다.
//
// **이 줄은 지워졌던 그 컴포넌트가 아니다.** 옛것은 「탭 줄이 타이틀바를 겸하는가」를
// prop으로 갈랐는데(그 화면이 `/terminal` 하나였다) 이제는 **늘 겸한다** — 그래서 창 드래그
// 영역·신호등 회피·트랜지션 곡선이 조건이 아니라 이 줄의 성질이다(아래 「타이틀바 몫」).

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

const SPEC = { on: false, onSelect: () => {} };

function render(
  state: ShellsState,
  {
    owner = WORK as string | null,
    projects = [] as string[],
    spec = SPEC as { on: boolean; onSelect: () => void } | null,
    showing = true,
    inset = false,
    actions = undefined as React.ReactNode,
  } = {},
): string {
  return renderToStaticMarkup(
    <ShellTabs
      state={state}
      owner={owner}
      projects={projects}
      spec={spec}
      showing={showing}
      inset={inset}
      actions={actions}
      onSelect={() => {}}
      onClose={() => {}}
      onOpen={() => {}}
    />,
  );
}

/**
 * 칸 하나씩 잘라낸다. 경계는 **표식이지 모양이 아니다** — 클래스로 집으면 규격을 손보는
 * 날 검사가 조용히 샌다(`data-shell-row`·`data-column`과 같은 이유).
 *
 * **정규식으로 블록을 잘라내지 않는다.** 이 저장소는 그 fail-open으로 데었다(앞쪽
 * `[\s\S]*?`가 남의 코드에서 출발해 초록이 됐다). 표식 문자열로 `split`하면 조각의 경계가
 * 곧 다음 표식이라 파서가 샐 자리가 없고, 표식이 사라지면 조각이 0개가 되어 반드시 빨개진다.
 */
const cellsOf = (markup: string) =>
  markup
    .split('data-tab="')
    .slice(1)
    .map((chunk) => ({ kind: chunk.slice(0, chunk.indexOf('"')), markup: chunk }));

const kindsOf = (markup: string) => cellsOf(markup).map((cell) => cell.kind);
const shellCellsOf = (markup: string) =>
  cellsOf(markup)
    .filter((cell) => cell.kind === "shell")
    .map((cell) => cell.markup);
const plusOf = (markup: string) => markup.match(/<button[^>]*aria-label="셸 열기"[^>]*>/)![0];
const headerTagOf = (markup: string) => markup.match(/<header[^>]*>/)![0];

describe("줄에 서는 것과 그 순서", () => {
  it("맨 앞이 `spec`이고 그 뒤로 셸, 마지막이 `+`다", () => {
    // 결정 7. **새 순서를 발명하는 것이 아니다** — ⌘1~9가 이미 이 순서를 센다(work 화면은
    // ⌘1이 spec, ⌘2~9가 셸). 화면에 보이는 순서와 키가 고르는 것이 어긋나면 이 판이 한 일이 없다.
    expect(kindsOf(render(opened(3).state))).toEqual(["spec", "shell", "shell", "shell", "new"]);
  });

  it("셸 순서가 `shellsOf` 순서 그대로다", () => {
    // ⌘2가 첫 칸, ⌘3이 둘째 칸이다 — `shellForNav(shells, …, nav, 2)`가 세는 것이 이
    // 목록이라, 화면이 다른 순서로 그리면 ⌘몇이 어느 칸인지가 화면과 갈린다.
    const { state, ids } = opened(3);
    const named = ids.reduce((acc, id, at) => setTitle(acc, id, `셸${at + 1}`), state);
    const cells = shellCellsOf(render(named));
    expect(cells).toHaveLength(3);
    expect(cells[0]).toContain("셸1");
    expect(cells[1]).toContain("셸2");
    expect(cells[2]).toContain("셸3");
  });

  it("`spec`에는 닫는 버튼이 없고 셸 칸에는 있다", () => {
    // 결정 7·13. 고정 탭이라 `×`가 없고, 그래서 ⌘W도 거기서는 아무 일을 안 한다.
    const cells = cellsOf(render(opened(2).state));
    expect(cells[0].kind).toBe("spec");
    expect(cells[0].markup).not.toContain("닫기");
    for (const cell of shellCellsOf(render(opened(2).state))) {
      expect(cell).toMatch(/aria-label="[^"]*닫기"/);
    }
  });

  it("이 화면의 셸만 그린다 — 남의 work 것은 안 선다", () => {
    const 가 = opened(2);
    const 나 = opened(3, { owner: "나", project: null, cwd: "~/x" }, 가.state);
    expect(shellCellsOf(render(나.state, { owner: "가" }))).toHaveLength(2);
    expect(shellCellsOf(render(나.state, { owner: "나" }))).toHaveLength(3);
  });

  it("셸이 0개여도 `spec`과 `+`는 선다", () => {
    // 마지막 칸을 `×`로 닫은 화면이 실재한다(판 02) — 그때도 문서로 돌아갈 자리와 새 셸을
    // 여는 자리가 남아야 한다.
    expect(kindsOf(render(NO_SHELLS))).toEqual(["spec", "new"]);
  });

  it("`spec`이 없는 화면에서는 셸부터 선다", () => {
    // 결정 8. `/terminal`에는 문서가 없어 ⌘1부터가 셸이다 — **화면마다 갈리는 것은 맨 앞
    // 한 칸뿐**이라는 성질을 이 줄이 그대로 진다.
    expect(kindsOf(render(opened(2).state, { spec: null }))).toEqual(["shell", "shell", "new"]);
  });
});

describe("칸이 적는 것", () => {
  it("이름은 `shellRowName` 그대로다 — 타이틀이 와도 프로젝트가 안 사라진다", () => {
    // 결정 18·104. 셋 중 하나를 **골라서** 적던 `shellLabel`이 실물 사고를 냈다(로그인
    // zsh가 뜨자마자 OSC 타이틀을 쏴 이름이 `gimhyoyeon@gimhy…`가 되고 어느 워크트리의
    // 셸인지가 사라졌다). 되살아나면 여기서 걸린다.
    const { state, ids } = opened(1, origin("cli", "~/.atelier/works/가/trees/cli"));
    const cells = shellCellsOf(render(setTitle(state, ids[0], "gimhyoyeon@gimhyoyeon")));
    expect(cells[0]).toContain("cli · gimhyoyeon@gimhyoyeon");
  });

  it("프로젝트가 하나뿐인 work의 칸에는 프로젝트가 안 붙는다", () => {
    // 결정 18. 가르는 자리는 `workShellOrigin`이다 — 워크트리가 하나 이하면 `project`가
    // 비고, 그래서 대부분의 칸은 타이틀만 적는다.
    const { state, ids } = opened(1);
    expect(shellCellsOf(render(setTitle(state, ids[0], "claude")))[0]).not.toContain("·");
  });

  it("cwd를 적지 않는다 — 칸에 들어갈 폭이 없다", () => {
    // 세로 목록의 둘째 줄(결정 45)이 하던 일이다. 한 줄짜리 칸에 끌고 오면 이름이 그만큼 밀린다.
    const { state, ids } = opened(1);
    expect(shellCellsOf(render(setShellName(state, ids[0], "zsh")))[0]).not.toContain(
      "trees/atelier",
    );
  });

  it("죽은 칸에 꼬리표가 뜬다", () => {
    // 결정 17. `실패`·`신호`·종료 코드 — **어느 칸이** 죽었는지를 누르지 않고 가르는 값이다.
    const { state, ids } = opened(3);
    const dead = markFailed(markExited(state, ids[0], { exitCode: 42, signal: null }), ids[1], "x");
    const cells = shellCellsOf(render(dead));
    expect(cells[0]).toContain("42");
    expect(cells[1]).toContain("실패");
    // 도는 칸에는 꼬리표가 없다 — 있으면 「죽었다」가 줄 전체로 번진다.
    expect(cells[2]).not.toContain("실패");
  });

  it("죽은 이유 문장은 칸에 안 적고 hover에도 안 숨긴다", () => {
    // 결정 17. 이유는 그 칸을 **켰을 때** 종료 줄이 말한다(결정 22 그대로). hover tooltip으로
    // 띄우는 안은 기각됐다 — 결정 45가 상한 문구를 `title`에서 꺼내 그 자리에 문장으로 쓴 것과
    // 정면으로 어긋난다. 옛 가로 탭 줄이 `title={end?.notice ?? label}`로 하던 그 자리다.
    const { state, ids } = opened(1);
    const dead = markFailed(state, ids[0], "$SHELL을 실행할 수 없습니다: /nonexistent");
    const notice = shellEndLabels(dead.shells[0])!.notice;
    expect(notice).toContain("/nonexistent");
    expect(shellCellsOf(render(dead))[0]).not.toContain(notice);
  });
});

describe("칸이 무엇이 도는지 말한다", () => {
  /**
   * 로고를 **표에서 꺼내 온 그림 그대로** 찾는다(결정 15). 검사가 자기 사본을 들면 표가
   * 바뀌는 날 둘이 갈리고, 그때 이 검사는 옛 그림을 지키느라 초록으로 남는다.
   *
   * 그림만 떼어 오는 것은 탭 칸이 크기 class를 얹어 그리기 때문이다 — svg 태그째로는 안 같다.
   * 못 찾으면 던진다: 표가 비면 조각이 0개가 되어 반드시 빨개진다(`cellsOf`와 같은 근거).
   */
  const glyphOf = (name: string) => {
    const mark = agentMarkOf(name);
    if (!mark) throw new Error(`${name}에 마크가 없다`);
    return renderToStaticMarkup(<mark.Glyph />).match(/ d="([^"]+)"/)![1];
  };

  it("claude가 도는 칸에 로고와 스피너가 뜨고, 끝나면 사라진다", () => {
    const { state, ids } = opened(1);
    const 도는중 = shellCellsOf(render(setRunning(state, ids[0], "claude")))[0];
    expect(도는중).toContain(glyphOf("claude"));
    expect(도는중).toContain("animate-spin");

    // 프롬프트로 돌아오면 `running`이 null이다 — 표시도 함께 걷힌다.
    const 끝난뒤 = shellCellsOf(render(setRunning(state, ids[0], null)))[0];
    expect(끝난뒤).not.toContain(glyphOf("claude"));
    expect(끝난뒤).not.toContain("animate-spin");
  });

  it("codex가 도는 칸과 claude가 도는 칸이 로고로 갈린다", () => {
    // **칸 안에서 본다.** 마크업 전체로 판정하면 로고 둘이 한 칸에 몰려 있어도 초록이라,
    // 「어느 칸에서 뭐가 도나」라는 이 판의 물음을 그대로 못 보고 지나간다.
    const { state, ids } = opened(2);
    const 지금 = setRunning(setRunning(state, ids[0], "claude"), ids[1], "codex");
    const cells = shellCellsOf(render(지금));
    expect(cells[0]).toContain(glyphOf("claude"));
    expect(cells[0]).not.toContain(glyphOf("codex"));
    expect(cells[1]).toContain(glyphOf("codex"));
    expect(cells[1]).not.toContain(glyphOf("claude"));
  });

  it("모르는 것이 도는 칸에는 로고가 없다 — 그래도 도는 표시는 남는다", () => {
    // 결정 4·15. 물음표를 띄우면 줄이 시끄러워진다(셸에서 도는 것의 대부분이 그 자리에 온다).
    // 다만 **그 칸이 일하는 중**이라는 사실은 아는 에이전트가 아니어도 참이라, 스피너는
    // 로고와 무관하게 돈다 — 로고에 매달면 `cargo`가 도는 칸이 노는 칸과 똑같아 보인다.
    const { state, ids } = opened(1);
    const cell = shellCellsOf(render(setRunning(state, ids[0], "cargo")))[0];
    expect(cell).not.toContain(glyphOf("claude"));
    expect(cell).not.toContain(glyphOf("codex"));
    expect(cell).toContain("animate-spin");
    expect(cell).toContain('aria-label="명령 실행 중"');
  });

  it("죽은 칸에는 아무것도 안 돈다", () => {
    // 판정은 `runningOn` 하나다(결정 4). `shell.running`을 직접 읽으면 마지막 값이 굳어
    // claude 로고가 죽은 칸에 영영 남는다 — 그 함수 주석이 든 이유 그대로다.
    const { state, ids } = opened(1);
    const 도는중 = setRunning(state, ids[0], "claude");
    // 종료 코드가 0이면 칸 자체가 목록에서 빠진다(`markExited`) — 남는 칸을 봐야 하므로
    // 「이유가 있는 끝」을 쓴다.
    const 죽은뒤 = markExited(도는중, ids[0], { exitCode: 42, signal: null });
    const cell = shellCellsOf(render(죽은뒤))[0];
    expect(cell).not.toContain(glyphOf("claude"));
    expect(cell).not.toContain("animate-spin");
  });

  it("칸이 로고에 색을 덧칠하지 않는다", () => {
    // 결정 15. 색을 정하는 자리는 `agent-mark` 하나이고(거기 소스에 색 리터럴이 0개다),
    // 여기서 `text-…`를 얹으면 그 결정이 **읽는 자리에서** 깨진다 — 한쪽 테마에서 대비
    // 바닥이 무너지는 길이 그것 하나 남아 있다. 로고 svg 태그만 잘라 본다(lucide의 것은
    // viewBox가 `0 0 24 24`라 안 걸린다). 로고가 없으면 여기서 던져 빨개진다.
    const { state, ids } = opened(1);
    const cell = shellCellsOf(render(setRunning(state, ids[0], "claude")))[0];
    const glyph = cell.match(/<svg viewBox="0 0 16 16"[^>]*>/)![0];
    expect(glyph).toContain('fill="currentColor"');
    expect(glyph).not.toMatch(/text-/);
  });

  it("로고가 스크린리더에도 말하고, 이름 버튼의 이름은 그대로다", () => {
    // 로고 svg는 `aria-hidden`이라(agent-mark 계약) 혼자서는 아무 말도 안 간다 — 로고만
    // 얹으면 그 칸이 도는지가 **눈으로만** 보인다.
    // 닫기 버튼이 이름 버튼의 이름을 딛고 있어(`${name} 닫기`) 그 이름을 밀어내도 안 된다.
    const { state, ids } = opened(1);
    const named = setTitle(state, ids[0], "zsh");
    const cell = shellCellsOf(render(setRunning(named, ids[0], "claude")))[0];
    expect(cell).toContain('aria-label="claude 실행 중"');
    expect(cell).toContain('aria-label="zsh 닫기"');
    expect(cell).toContain(">zsh<");
    // 이름 **앞자리**다(`gap-1.5`가 비워 둔 그 자리) — 접근성 이름이 「무엇이 도나」 →
    // 「어느 셸인가」 순서로 조립되고, 좁아질 때 줄어드는 것이 뒤쪽 이름 하나로 남는다.
    expect(cell.indexOf('aria-label="claude 실행 중"')).toBeLessThan(cell.indexOf(">zsh<"));
  });
});

// 셸은 프롬프트마다 OSC 타이틀을 쏘고 `claude`는 도는 동안 계속 갈아 끼운다(adr-04).
//
// **이 seam에는 리렌더가 없다** — 정적 마크업이라 「몇 번 그렸나」를 셀 자리가 없다. 대신
// 그 아래 깔린 성질을 잰다: 한 칸의 그림이 **그 칸의 셸에만** 달렸는가, 그리고 안 바뀐 칸이
// 같은 객체로 남는가. 둘이 함께 서면 「다른 칸은 다시 그릴 것이 없다」가 된다.
//
// **못 보는 것**: React가 실제로 다시 그리는 횟수. 그것은 구독하는 쪽의 몫이고
// (`WorksPage`의 `sameBranch`), 이 줄은 상태와 콜백만 받는다.
describe("한 칸이 흔들려도 다른 칸은 그대로다", () => {
  it("한 칸의 타이틀만 갈리면 그 칸만 갈린다", () => {
    const { state, ids } = opened(3);
    const before = shellCellsOf(render(state));
    const after = shellCellsOf(render(setTitle(state, ids[0], "gimhyoyeon@gimhyoyeon")));
    // 바뀐 칸은 바뀐다 — 이것이 없으면 아래 둘은 「아무것도 안 그렸다」로도 통과한다.
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[2]).toBe(before[2]);
  });

  it("한 칸에서 명령이 시작돼도 다른 칸은 안 갈린다", () => {
    // 여기서 걸리는 것이 **줄 단위 판정**이다 — 로고를 `runningKindsOf`처럼 줄 전체에서
    // 뽑으면 한 칸이 claude를 켜는 순간 세 칸이 전부 갈린다. 결정 4가 사이드바(종류만)와
    // 탭 줄(칸마다)을 가른 지점이 정확히 여기다.
    const { state, ids } = opened(3);
    const before = shellCellsOf(render(state));
    const after = shellCellsOf(render(setRunning(state, ids[0], "claude")));
    expect(after[0]).not.toBe(before[0]);
    expect(after[1]).toBe(before[1]);
    expect(after[2]).toBe(before[2]);
  });

  it("안 바뀐 칸은 같은 객체로 남는다", () => {
    // `patch`의 계약이다. 이 줄이 칸을 **셸 객체 하나에서** 그리는 한 이 성질이 곧
    // 리렌더가 멈추는 자리다 — 초마다 오는 값이라 여기서 새 객체를 만들면 줄이 초마다
    // 통째로 다시 그려진다(`setRunning` 주석).
    const { state, ids } = opened(3);
    const next = setRunning(state, ids[0], "claude");
    expect(next.shells[0]).not.toBe(state.shells[0]);
    expect(next.shells[1]).toBe(state.shells[1]);
    expect(next.shells[2]).toBe(state.shells[2]);
  });
});

describe("켜짐을 말하는 법", () => {
  it("`aria-pressed`와 `toggle-on`으로 말한다 — `role=\"tab\"`을 쓰지 않는다", () => {
    // 분할이면 **켜진 탭이 둘**이다(결정 12) — tablist에서 `aria-selected`가 둘이면 잘못된
    // ARIA다. 이 저장소는 켜짐을 이미 `aria-pressed`+`toggle-on`으로 말하고 있어서(분할
    // 토글·소스 토글), 새 어휘를 들이지 않는 쪽이 화면 전체와 한 말을 쓴다.
    const markup = render(opened(2).state);
    expect(markup).not.toMatch(/role="tab/);
    expect(markup).not.toMatch(/aria-selected/);
    expect(markup).toMatch(/aria-pressed/);
  });

  it("본문이 셸이면 켜진 칸이 그 셸 하나다", () => {
    const markup = render(opened(3).state);
    const cells = cellsOf(markup);
    expect(cells.filter((cell) => cell.markup.includes('aria-pressed="true"'))).toHaveLength(1);
    expect(cells.filter((cell) => cell.markup.includes("toggle-on"))).toHaveLength(1);
  });

  it("본문이 문서면 켜진 칸이 `spec` 하나다", () => {
    // `activeIdOf`는 그 work의 **기억**이지 지금 화면이 아니다(ShellList의 `showing`과 같은
    // 계약) — 문서를 읽는 중에 셸 칸까지 켜져 있으면 「지금 보고 있는 것」이 한 화면에 둘이 된다.
    const cells = cellsOf(render(opened(3).state, { spec: { on: true, onSelect: () => {} }, showing: false }));
    const on = cells.filter((cell) => cell.markup.includes('aria-pressed="true"'));
    expect(on).toHaveLength(1);
    expect(on[0].kind).toBe("spec");
  });

  it("분할이면 켜진 칸이 둘이다", () => {
    // 결정 12. 이 상태가 실재하는 것이 `role="tab"`을 안 쓰는 근거다.
    const cells = cellsOf(render(opened(3).state, { spec: { on: true, onSelect: () => {} } }));
    expect(cells.filter((cell) => cell.markup.includes('aria-pressed="true"'))).toHaveLength(2);
  });

  it("한 요소에 hover 규칙이 두 벌 얹히지 않는다", () => {
    // toggle-on은 자기 hover를 품는다. 꺼진 칸의 hover가 같은 요소에 함께 오면 어느 쪽이
    // 이길지를 유틸리티 정렬 순서가 정한다(index.css의 경고).
    const classes = [...render(opened(3).state).matchAll(/class="([^"]*)"/g)].map((m) => m[1]);
    expect(classes.filter((one) => /toggle-on/.test(one) && /hover:/.test(one))).toEqual([]);
  });
});

describe("칸 하나의 규격", () => {
  it("이름 버튼과 닫기 버튼이 형제다", () => {
    // 중첩 button은 HTML에서 허용되지 않고, span role="button"으로 흉내내면 Tab으로
    // 도달할 수 없다(SpecTree.test.tsx·ShellList.test.tsx가 같은 것을 지킨다).
    const markup = render(opened(2).state);
    expect(markup).not.toMatch(/<button(?:(?!<\/button>)[\s\S])*<button/);
  });
});

describe("타이틀바 몫", () => {
  it("창을 끌 수 있다", () => {
    // 이 줄이 창 맨 위다 — 없으면 **창을 못 끈다**. 안쪽 버튼들은 이 속성이 없어 그대로 눌린다.
    expect(headerTagOf(render(opened(2).state))).toContain("data-tauri-drag-region");
  });

  it("빈 자리도 끄는 자리다", () => {
    // 탭과 조작 사이의 남는 자리가 이 줄에서 가장 넓다. 거기가 안 끌리면 「창이 가끔만
    // 끌린다」가 되는데, 화면으로는 어느 자리가 죽었는지가 안 보인다.
    const gap = render(opened(1).state).split('data-tab="new"')[1];
    expect(gap).toContain("data-tauri-drag-region");
  });

  it("사이드바가 접히면 왼쪽 여백이 신호등을 피한다", () => {
    expect(headerTagOf(render(NO_SHELLS, { inset: true }))).toContain("pl-(--titlebar-inset)");
    expect(headerTagOf(render(NO_SHELLS, { inset: false }))).toContain("pl-4");
  });

  it("여백이 사이드바 폭과 같은 곡선으로 따라온다", () => {
    // `ease-panel`이 아니면 최종 자리를 지나쳤다 되돌아온다 — 브레드크럼의 화면상 위치가
    // 앞 패널들의 폭과 이 패딩의 합이라서다(index.css의 `--panel-ease` 주석).
    const tag = headerTagOf(render(NO_SHELLS));
    expect(tag).toContain("ease-panel");
    expect(tag).toContain("transition-[padding]");
    // 층 높이도 물려받는다 — 이 줄이 그 44px 자리다.
    expect(tag).toContain("h-(--titlebar-height)");
  });
});

describe("오른쪽 끝 조작", () => {
  it("탭이 늘어도 조작이 오른쪽 끝에 남는다", () => {
    // 결정 10. 탭은 왼쪽부터 차므로 개수가 변해도 조작 위치가 안 움직인다 — 마크업에서는
    // 「조작이 늘 마지막이다」로 나타난다.
    for (const count of [0, 1, MAX_SHELLS]) {
      const markup = render(opened(count).state, { actions: <button type="button">조작</button> });
      const cells = cellsOf(markup);
      const last = cells[cells.length - 1];
      expect(last.kind, `셸 ${count}개`).toBe("new");
      expect(last.markup, `셸 ${count}개`).toContain("조작");
    }
  });
});

describe("`+`", () => {
  it("프로젝트가 여럿이면 곧바로 열지 않고 물어본다", () => {
    // 결정 24. 아무 데나 열면 틀린 워크트리에서 claude가 돈다.
    const plus = plusOf(render(NO_SHELLS, { projects: ["atelier", "cli"] }));
    expect(plus).toMatch(/aria-haspopup="menu"/);
    expect(plus).toMatch(/aria-expanded="false"/);
  });

  it("하나면 묻지 않는다", () => {
    expect(plusOf(render(NO_SHELLS, { projects: ["atelier"] }))).not.toMatch(/aria-haspopup/);
  });

  it("앱 전체가 상한이면 이 화면이 비어 있어도 잠긴다", () => {
    // 결정 30. 화면이 세면 Work마다 8개가 된다 — 잠기는 판정은 이 줄의 길이와 무관하다.
    const state = opened(MAX_SHELLS, { owner: "남", project: null, cwd: "~/x" }).state;
    const plus = plusOf(render(state, { owner: "나" }));
    expect(plus).toMatch(/aria-disabled="true"/);
    // 이유는 hover 뒤에 있다 — **칸 하나에 문장을 넣을 폭이 없어서다**(결정 47이 세로
    // 목록에서 문장을 꺼낸 것과 같은 근거가 반대 방향을 가리킨다). work 화면에서는 ⌘T가
    // 거절당할 때 토스트가 같은 문장을 보이는 글자로 말한다.
    expect(plus).toContain(`${MAX_SHELLS}개까지`);
  });

  it("상한 아래에서는 안 잠긴다", () => {
    expect(plusOf(render(opened(MAX_SHELLS - 1).state))).not.toMatch(/aria-disabled/);
  });
});

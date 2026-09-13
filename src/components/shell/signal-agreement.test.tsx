import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import ShellTabs from "@/features/terminal/ShellTabs";
import {
  bandRows,
  signalsOf,
  topSignalView,
} from "@/features/terminal/shell-attention";
import type { Attention } from "@/features/terminal/shell-attention";
import {
  NO_SHELLS,
  openShell,
  ownerOf,
  setAttention,
  shellsOf,
} from "@/features/terminal/shell-registry";
import type { ShellsState } from "@/features/terminal/shell-registry";
import { WorkSectionList } from "@/features/works/WorkSectionList";
import { splitWorkSections } from "@/features/works/work-sections";
import type { WorkView } from "@/features/works/types";
import { AttentionBand } from "./attention-band";
import { SIGNAL_LABEL, SignalLine } from "./shell-signal";

// **세 자리가 한 사실을 말한다**(스토리 79). 사이드바 행(#203) · 「확인할 것」 띠(#204) ·
// 셸 탭(#205)은 어휘가 셋이다 — 점 · 줄 · 채움. 결정 6이 그것을 허락했다(「표면이 다르면
// 문법이 달라도 된다」). 그런데 **색과 말은 하나여야 한다**: 같은 셸이 사이드바에서 앰버인데
// 탭에서 초록이면 사람은 둘 중 무엇을 믿을지 알 수 없고, 그 어긋남은 세 파일 어디를 봐도
// 안 보인다.
//
// **그물이 여기 따로 서는 이유가 그것이다.** 각 자리의 검사는 자기 마크업만 보므로
// (`SidebarWorkList.test.tsx` · `attention-band.test.tsx` · `ShellTabs.test.tsx`) 세 자리가
// 갈리는 순간을 아무도 안 본다. 이 파일은 **상태 하나**에서 셋을 그려 견준다 — 값을 고르는
// 길도 셋이 다르므로(`signalsByOwner` · `bandRows` · `signalOf`) 그 길이 갈리는 것까지
// 함께 잡힌다.

const WORK: WorkView = {
  slug: "가",
  title: "결제 정산",
  status: "active",
  pinned: false,
  projects: ["atelier"],
} as WorkView;

const 말한다 = (kind: "waiting" | "done"): Attention => ({
  kind,
  message: "커밋할까요?",
  since: 1000,
  seen: false,
  source: "hook",
  agent: "claude",
});

/**
 * 이 work의 소유자 키. **모드를 여기서만 적는다** — 이 파일이 재는 것은 세 자리의 합의라
 * 세계는 배경이다.
 */
const 소유 = ownerOf("atelier", WORK.slug);

/** 그 상태의 셸 하나를 가진 목록. 세 자리가 **같은 이 상태**에서 출발한다. */
function 셸하나(kind: "waiting" | "done"): ShellsState {
  const opened = openShell(NO_SHELLS, { mode: "atelier", owner: 소유, project: "atelier", cwd: "~/x" });
  if (!opened) throw new Error("셸을 못 띄웠다");
  return setAttention(opened.state, opened.id, 말한다(kind));
}

/**
 * 마크업이 쓴 **상태색의 가족**. `class` 속성 안의 낱말만 본다 — 마크업 전체에서 글자를 찾으면
 * work 제목이나 셸 이름에 든 `wait`·`done`이 색으로 세어진다.
 *
 * 이름을 미리 열거하지 않는 것이 요점이다: `bg-wait-soft`든 `ring-done-soft`든 앞으로 생길
 * 무엇이든 토큰 이름에 그 낱말이 있으면 여기 잡힌다. 열거해 두면 새 유틸리티가 조용히 샌다.
 */
function 색가족(markup: string): Set<string> {
  const out = new Set<string>();
  for (const [, value] of markup.matchAll(/class="([^"]*)"/g)) {
    for (const token of value.split(/\s+/)) {
      if (token.includes("wait")) out.add("wait");
      if (token.includes("done")) out.add("done");
    }
  }
  return out;
}

/** 이 마크업이 접근성 이름으로 말한 상태들. */
function 말가족(markup: string): Set<string> {
  const out = new Set<string>();
  for (const [kind, label] of Object.entries(SIGNAL_LABEL)) {
    if (markup.includes(`— ${label}`)) out.add(kind);
  }
  return out;
}

function 행(state: ShellsState): string {
  const signals = signalsOf(state, "atelier");
  return renderToStaticMarkup(
    <WorkSectionList
      sections={splitWorkSections([WORK], { pinned: true, works: true })}
      mode="atelier"
      open={{ pinned: true, works: true }}
      selectedSlug={null}
      shellCounts={{ [WORK.slug]: 1 }}
      signals={signals}
      onToggleSection={() => {}}
      onOpen={() => {}}
      onHover={() => {}}
      onLeave={() => {}}
      onTogglePin={() => {}}
      draggedSlug={null}
      lineY={null}
      litEmptySlot={null}
      onArmDrag={() => {}}
      renderSubrow={(work) => {
        // 사이드바가 실제로 그리는 그대로다(`Sidebar.tsx`) — 값을 고르는 길이 행마다 따로다.
        const view = topSignalView(shellsOf(state, ownerOf("atelier", work.slug)));
        return view === null ? null : <SignalLine {...view} now={view.since} />;
      }}
    />,
  );
}

function 띠(state: ShellsState): string {
  return renderToStaticMarkup(
    <AttentionBand
      items={bandRows(state, "atelier").map((row) => ({ ...row, title: WORK.title }))}
      now={1000}
      expanded={false}
      onToggle={() => {}}
      onOpen={() => {}}
    />,
  );
}

/**
 * **켜짐을 인자로 받는다.** 탭 물들임의 주 경로는 「다른 셸을 보는 동안 부르는 칸」 —
 * 즉 **안 켜진** 칸이고, 켜진 칸은 회색이 물러나고 테두리가 서는 유일한 자리라(결정 6)
 * 색을 다시 고르기 가장 쉬운 자리다. 한쪽만 그리면 나머지 한쪽이 이 그물 밖에 남는다.
 *
 * `showing`이 거짓이면 그 화면의 셸 칸이 하나도 안 켜진다(`ShellTabs`의 그 prop) —
 * 본문이 문서인 화면이 그 모양이고, 부르는 칸을 탭 줄에서 **찾는** 화면이 바로 그것이다.
 */
function 탭(state: ShellsState, { 켜짐 }: { 켜짐: boolean }): string {
  return renderToStaticMarkup(
    <ShellTabs
      state={state}
      owner={소유}
      projects={["atelier"]}
      defaultCwd={null}
      spec={{ on: !켜짐, onSelect: () => {} }}
      showing={켜짐}
      onSelect={() => {}}
      onClose={() => {}}
      onOpen={() => {}}
      onDragTab={() => {}}
      slot={null}
      onSlot={() => {}}
      onDropSlot={() => {}}
    />,
  );
}

describe("행·띠·탭이 같은 셸에 같은 것을 말한다", () => {
  it.each(["waiting", "done"] as const)("%s — 세 자리가 같은 색 가족을 쓴다", (kind) => {
    const state = 셸하나(kind);
    // 탭이 둘인 것은 켜짐이 색을 다시 고를 수 있는 유일한 갈래이기 때문이다(`탭` 머리말).
    const 셋 = {
      행: 행(state),
      띠: 띠(state),
      "탭(안 켜진 칸)": 탭(state, { 켜짐: false }),
      "탭(켜진 칸)": 탭(state, { 켜짐: true }),
    };

    for (const [자리, markup] of Object.entries(셋)) {
      // **정확히 그 가족 하나다.** 「그 색이 있다」만 보면 둘 다 쓰는 그림이 통과한다.
      expect([...색가족(markup)].sort(), `${자리} — 색`).toEqual([
        kind === "waiting" ? "wait" : "done",
      ]);
      expect([...말가족(markup)], `${자리} — 말`).toEqual([kind]);
    }
  });

  // 「봤다」로 지워진 완료는 **세 자리 모두에서** 사라진다 — 한 자리만 남으면 그 자리는
  // 없는 사실을 말한다.
  it("본 완료는 세 자리 어디에도 안 남는다", () => {
    const opened = openShell(NO_SHELLS, { mode: "atelier", owner: 소유, project: "atelier", cwd: "~/x" });
    if (!opened) throw new Error("셸을 못 띄웠다");
    const state = setAttention(opened.state, opened.id, { ...말한다("done"), seen: true });
    for (const [자리, markup] of Object.entries({
      행: 행(state),
      띠: 띠(state),
      "탭(안 켜진 칸)": 탭(state, { 켜짐: false }),
      "탭(켜진 칸)": 탭(state, { 켜짐: true }),
    })) {
      expect([...색가족(markup)], `${자리} — 색`).toEqual([]);
      expect([...말가족(markup)], `${자리} — 말`).toEqual([]);
    }
  });
});

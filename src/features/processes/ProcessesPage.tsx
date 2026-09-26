import { Fragment } from "react";
import { useQueries } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import PageHeader from "@/components/shell/PageHeader";
import { SignalLane } from "@/components/shell/shell-signal";
import useGoToShell from "@/components/shell/useGoToShell";
import { agentMarkOf } from "@/components/ui/agent-mark";
import { modeOfOwner, shellRowName, slugOfOwner } from "@/features/terminal/shell-registry";
import { requestCloseShell, terminalStore } from "@/features/terminal/terminal-store";
import { worksQuery } from "@/features/works/hooks";
import { cn } from "@/lib/utils";
import { ALL_MODES, worldNameOf, type Mode } from "@/mode";
import { useProcessSnapshot } from "./hooks";
import { formatCpu, formatMemory, formatPorts } from "./metrics";
import {
  CURRENT_WORLD,
  HELPER_LABEL,
  descendantLabel,
  descendantRowLabel,
  groupRowLabel,
  groupTotals,
  helperLabel,
  shellCount,
  shellRowLabel,
  shellStateOf,
  shellTotals,
  shellTree,
  stateText,
  worldRowLabel,
  type ListedItem,
  type ShellNode,
} from "./shell-tree";
import type { ProcessMetrics } from "./types";

/**
 * `Processes` 화면(프로세스 결정 8 · 9 · 10). 아틀리에가 띄운 셸과 그 셸에서 뜬 프로세스를 **앱 전체**로 보인다 — 두 세계의
 * 주소(`/processes` · `/maison/processes`)가 이 화면 하나를 연다. 「지금 무엇이 내 컴퓨터를 먹나」에 답하는 화면이라 세계로
 * 나누면 절반이 안 보인다.
 *
 * **세계를 받는 것은 차례 때문이다**(티켓 27) — 지금 세계가 맨 위에 선다. 무엇을 보이는지는 세계와 상관없다.
 *
 * 셸 묶음은 세계 → work → 셸 → 자손으로 선다(`shellTree`). 행마다 숫자(메모리 · CPU · 포트 — 티켓 28)가 서고, 셸 행과 work 행은 그
 * 트리의 합이다. 요약 카드는 30, 나머지 묶음(고아 · 다른 인스턴스 · 예외 · 주인 잃은 셸 · 화면 밖 셸 · 정리 기록)은 31 · 32가 붙인다.
 *
 * 스냅샷은 이 화면이 떠 있는 동안만 2초마다 온다(`useProcessSnapshot`) — 화면이 내려가면 묻기도 멎는다.
 */
function ProcessesPage({ mode, sidebarOpen }: { mode: Mode; sidebarOpen: boolean }) {
  const { data: snapshot, dataUpdatedAt } = useProcessSnapshot();
  // 스토어의 셸 전부 — 두 세계의 것이 한 벌이다(owner가 세계를 싣는다). 상태 칸이 셸 상태를 읽으므로 좁히지 않는다.
  const shells = useStore(terminalStore, (state) => state.shells);
  const lists = useWorldLists(
    ALL_MODES.filter((one) => shells.some((shell) => modeOfOwner(shell.owner) === one && slugOfOwner(shell.owner) !== null)),
  );
  const goToShell = useGoToShell();

  const tree = snapshot ? shellTree({ current: mode, shells, lists, snapshot }) : [];
  // **경과의 지금은 스냅샷이 도착한 때다**(`dataUpdatedAt`). 박자(2초)마다 새 값이라 경과가 그만큼씩 늙는다 — 따로 시계를 켜지
  // 않는다. 박자가 멎으면(창이 가려짐) 경과도 멎는데, 그동안은 아무도 안 본다.
  const now = dataUpdatedAt;

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <main className="flex min-w-0 flex-1 flex-col">
        <PageHeader root="Processes" inset={!sidebarOpen} />
        <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-10 scroll-quiet">
          {/* **제목은 머리가 보여 주고, 제목 역할은 이 줄이 진다** — `PageHeader`는 제목 역할이 없는 글자라(설정 화면과 같은
              사정) 이것마저 없으면 화면에 제목이 하나도 없다. */}
          <h2 className="sr-only">Processes</h2>
          {/* 풀에 앉은 셸 — 두 세계의 것이 함께다. 첫 답이 오기 전에는 세지 않는다: 「0개」라고 말하면 모르는 것을 없다고 한다. */}
          {snapshot && <p className="text-[13px] text-muted-foreground">{shellCount(snapshot.pool.length)}</p>}
          {tree.length > 0 && (
            // **트리 역할이다**(S58) — 스크린리더가 행마다 깊이를 읽는다. 줄은 평평하게 서고 깊이는 `aria-level`이 말한다(중첩
            // `group` 대신). 줄마다 접근성 이름이 한 문장이라 안의 글자 조각을 이어 읽지 않는다.
            <div role="tree" aria-label="셸" className="mt-4 flex flex-col gap-0.5">
              {tree.map((world) => (
                <Fragment key={world.mode}>
                  <TreeRow level={1} label={worldRowLabel(world)} className="mt-3 first:mt-0">
                    <span className="text-[12.5px] font-semibold">{worldNameOf(world.mode)}</span>
                    {world.current && <span className="text-[12px] text-tertiary">{CURRENT_WORLD}</span>}
                  </TreeRow>
                  {world.groups.map((group) => (
                    <Fragment key={group.owner}>
                      {/* work 행 — 이름, 셸 수, 그 work 셸들의 트리 합(메모리 · CPU). 포트는 없고 동작도 없다(S53): 여러 셸을
                          한 번에 닫는 길은 [조용한 셸 모두 닫기](32)다. */}
                      <TreeRow level={2} label={groupRowLabel(group)}>
                        <span className="min-w-0 truncate text-[13px] font-medium">{group.name}</span>
                        <span className="shrink-0 text-[12px] text-tertiary">{shellCount(group.shells.length)}</span>
                        <span className="flex-1" />
                        <Figures metrics={groupTotals(group)} ports={false} />
                        <Actions />
                      </TreeRow>
                      {group.shells.map((node) => (
                        <ShellRows
                          key={node.shell.id}
                          node={node}
                          now={now}
                          // [이동] — 띠의 줄 · ⌘J와 같은 길이다(`useGoToShell`): 셸 주인의 세계로 화면을 옮기고, 켜고, 포커스를
                          // 데려온다(티켓 16). 주인 잃은 셸은 그 길이 화면 이동 전에 가른다.
                          onGo={() => goToShell({ id: node.shell.id, owner: node.shell.owner })}
                          // [닫기] — 셸 탭의 ×와 같은 길이다(결정 92). 명령이나 자손이 있으면 확인 창이 묻는다. 까닭은 「셸 닫기」다.
                          onClose={() => void requestCloseShell(node.shell.id)}
                        />
                      ))}
                    </Fragment>
                  ))}
                </Fragment>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

/**
 * 셸이 선 세계의 목록 — work 행의 이름과 차례(사이드바 순서)가 여기서 온다. 사이드바가 이미 보는 지금 세계의 것은 캐시에 있다.
 * 저쪽 세계의 것은 **그 세계에 work의 셸이 있을 때만** 묻는다 — 목록 조회는 워크트리마다 `git status`라 셸 없는 세계를 화면을 열
 * 때마다 읽을 까닭이 없다. 최상위 터미널의 셸만 있는 세계도 안 묻는다(이름이 nav의 `Terminal`이다).
 */
function useWorldLists(worlds: ReadonlyArray<Mode>): Partial<Record<Mode, ReadonlyArray<ListedItem>>> {
  const results = useQueries({
    queries: ALL_MODES.map((one) => ({ ...worksQuery(one), enabled: worlds.includes(one) })),
  });
  const lists: Partial<Record<Mode, ReadonlyArray<ListedItem>>> = {};
  ALL_MODES.forEach((one, at) => {
    const data = results[at]?.data;
    if (data) lists[one] = data;
  });
  return lists;
}

/**
 * 트리의 한 줄. 들여쓰기가 깊이를 눈으로 말하고 `aria-level`이 귀로 말한다. 접근성 이름은 줄마다 지은 한 문장이다 — 안의 글자
 * 조각(이름 · 상태 · 버튼)을 이어 읽으면 「zsh 조용함 2h 이동 닫기」가 된다.
 */
function TreeRow({
  level,
  label,
  className,
  children,
  ...rest
}: { level: number; label: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="treeitem"
      aria-level={level}
      aria-label={label}
      className={cn("flex h-8 min-w-0 items-center gap-2 rounded-[8px] pr-1", className)}
      style={{ paddingLeft: `${(level - 1) * 18}px` }}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * 행의 숫자 칸 — 메모리 · CPU · 포트(프로세스 결정 10 · 티켓 28). 글자는 표기 함수의 결과 그대로다(`formatMemory` · `formatCpu` ·
 * `formatPorts` — nav 메타와 다른 묶음도 같은 함수를 읽는다). 칸마다 너비가 정해져 있어 들여쓰기가 달라도 세로로 맞는다. work 행은
 * 포트 칸이 없다(S53) — 자리만 비워 둔다.
 */
function Figures({ metrics, ports = true }: { metrics: ProcessMetrics; ports?: boolean }) {
  const listed = formatPorts(metrics.ports);
  return (
    <>
      <span data-cell="memory" className="w-16 shrink-0 text-right text-[12.5px] tabular-nums text-muted-foreground">
        {formatMemory(metrics.memory)}
      </span>
      <span data-cell="cpu" className="w-11 shrink-0 text-right text-[12.5px] tabular-nums text-muted-foreground">
        {formatCpu(metrics.cpu)}
      </span>
      {ports ? (
        <span
          data-cell="ports"
          title={listed || undefined}
          className="w-28 shrink-0 truncate pl-2 text-[12.5px] tabular-nums text-muted-foreground"
        >
          {listed}
        </span>
      ) : (
        <span aria-hidden className="w-28 shrink-0" />
      )}
    </>
  );
}

/** 행 끝의 동작 자리 — 줄마다 같은 너비라 숫자 칸이 동작이 없는 줄(work · 자손)에서도 셸 행과 같은 자리에 선다. */
function Actions({ children }: { children?: React.ReactNode }) {
  return <span className="flex w-[92px] shrink-0 justify-end">{children}</span>;
}

/**
 * 셸 하나의 줄들 — 셸 행, 셸 도우미의 옅은 줄, 사람이 띄운 자손의 트리. 셸 행의 깊이는 3이다(세계 → work → 셸). 셸 행의 숫자는 그
 * 셸의 트리 합이다(셸 프로세스 · 도우미 · 자손 — `shellTotals`).
 */
function ShellRows({
  node,
  now,
  onGo,
  onClose,
}: {
  node: ShellNode;
  now: number;
  onGo: () => void;
  onClose: () => void;
}) {
  const state = shellStateOf(node);
  const mark = state.kind === "command" ? agentMarkOf(state.command) : null;
  return (
    <>
      <TreeRow
        level={3}
        label={shellRowLabel(node, now)}
        data-shell-key={node.pool.shellKey}
        className="hover:bg-state-1"
      >
        <span className="min-w-0 truncate text-[13px]">{shellRowName(node.shell)}</span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[12.5px] text-muted-foreground">
          {/* 셸 상태가 있으면 사이드바 · 띠와 같은 글리프가 선다 — 같은 셸에 같은 색이다(스토리 79). */}
          {state.kind === "signal" && <SignalLane kind={state.signal} />}
          {mark && (
            // 마크는 「누구」다 — 이름은 접근성으로만 한 번 더 읽힌다(`SignalLine`과 같은 규칙).
            <span role="img" aria-label={mark.label} className="flex shrink-0 items-center">
              <mark.Glyph className="size-3" />
            </span>
          )}
          <span className="min-w-0 truncate">{stateText(state, now)}</span>
        </span>
        <Figures metrics={shellTotals(node)} />
        <Actions>
          <button
            type="button"
            onClick={onGo}
            className="h-6 shrink-0 rounded-[8px] px-2 text-[12.5px] font-medium text-muted-foreground transition-colors quiet-hover"
          >
            이동
          </button>
          <button
            type="button"
            onClick={onClose}
            className="h-6 shrink-0 rounded-[8px] px-2 text-[12.5px] font-medium text-muted-foreground transition-colors quiet-hover"
          >
            닫기
          </button>
        </Actions>
      </TreeRow>
      {node.helpers.length > 0 && (
        // **셸 도우미는 옅은 줄 하나로 따로 선다**(P1) — 사람이 띄운 것과 한 무게로 섞이면 「이 셸에서 띄운 프로세스」로 읽힌다.
        // 닫으면 함께 끝나지만 확인 창의 수에도 조용함 판정에도 안 든다(CONTEXT 「셸 도우미」).
        <TreeRow level={4} label={helperLabel(node.helpers)} data-helper="" className="text-[12.5px] text-tertiary">
          <span className="shrink-0">{HELPER_LABEL}</span>
          <span className="min-w-0 truncate">{node.helpers.map(descendantLabel).join(" · ")}</span>
        </TreeRow>
      )}
      {node.descendants.map(({ row, depth }) => (
        // 자손 행 — 부른 이름. **명령줄은 툴팁이다**(수집이 `KERN_PROCARGS2`의 argv 전체에서 읽은 것, 티켓 11). 자르지 않는다: 이
        // 맥의 같은 사용자가 `ps`로 보는 것과 같은 글자이고, 디스크에 남기는 정리 기록만 앞 200자로 자른다(S12).
        <TreeRow
          key={`${row.id.pid}@${row.id.startedUs}`}
          level={3 + depth}
          label={descendantRowLabel(row)}
          title={row.command ?? undefined}
          className="text-[12.5px] text-muted-foreground"
        >
          <span className="min-w-0 flex-1 truncate">{descendantLabel(row)}</span>
          <Figures metrics={row.metrics} />
          <Actions />
        </TreeRow>
      ))}
    </>
  );
}

export default ProcessesPage;

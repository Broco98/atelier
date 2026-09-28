import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import PageHeader from "@/components/shell/PageHeader";
import { SignalLane } from "@/components/shell/shell-signal";
import useGoToShell from "@/components/shell/useGoToShell";
import { agentMarkOf } from "@/components/ui/agent-mark";
import { Button } from "@/components/ui/button";
import { modeOfOwner, shellRowName, slugOfOwner, type Shell } from "@/features/terminal/shell-registry";
import {
  closeOffscreenShell,
  closeOwnerless,
  closeQuietShells,
  requestCloseShell,
  terminalStore,
} from "@/features/terminal/terminal-store";
import { worksQuery } from "@/features/works/hooks";
import { ALL_MODES, modeNameOf, type Mode } from "@/mode";
import { askThenEnd } from "./actions";
import CleanupLogSection from "./CleanupLogSection";
import { useProcessSnapshot } from "./hooks";
import { openProcessesScreen, useSeeWhileLooking } from "./looked";
import { lookSourceOf, lookablesOf, ownerlessShellKeys } from "./needs-look";
import { endAsk } from "./process-groups";
import { exceptionName, identityKey, processLabel, processRowLabel, subtreeAt } from "./process-tree";
import StraySections from "./StraySections";
import SummaryCard from "./SummaryCard";
import { Actions, Figures, RowButton, RowMenu, Section, TreeRow } from "./tree-rows";
import {
  CURRENT_WORLD,
  HELPER_LABEL,
  groupRowLabel,
  groupTotals,
  helperLabel,
  OFFSCREEN_NAME,
  offscreenRowLabel,
  offscreenShells,
  offscreenStateOf,
  ownerlessGroupRowLabel,
  ownerlessGroups,
  poolKey,
  shellCount,
  shellRowLabel,
  shellStateOf,
  shellTotals,
  shellTree,
  stateText,
  worldRowLabel,
  type ListedItem,
  type PoolBeat,
  type ShellNode,
  type ShellProcesses,
  type ShellState,
} from "./shell-tree";
import type { PoolShell } from "./types";

/**
 * `Processes` 화면(프로세스 결정 8 · 9 · 10). 아틀리에가 띄운 셸과 그 셸에서 뜬 프로세스를 **앱 전체**로 보인다 — 두 세계의
 * 주소(`/processes` · `/maison/processes`)가 이 화면 하나를 연다. 「지금 무엇이 내 컴퓨터를 먹나」에 답하는 화면이라 세계로
 * 나누면 절반이 안 보인다.
 *
 * **세계를 받는 것은 차례 때문이다**(티켓 27) — 지금 세계가 맨 위에 선다. 무엇을 보이는지는 세계와 상관없다.
 *
 * 셸 묶음은 세계 → work → 셸 → 자손으로 선다(`shellTree`). 행마다 숫자(메모리 · CPU · 포트 — 티켓 28)가 서고, 셸 행과 work 행은 그
 * 트리의 합이다. 맨 위에 요약 카드(티켓 30)가 서고, 셸 묶음 밑에 주인 잃은 셸 · 화면 밖 셸(티켓 32), 확정 고아 · 출처 불명 · 다른
 * 인스턴스 · 예외(티켓 31 — `StraySections`), 정리 기록(티켓 32 — `CleanupLogSection`)이 차례로 선다. 자손 행에는 [끝내기]와 행
 * 메뉴(「예외로 두기」)가 선다. 머리에는 [조용한 셸 모두 닫기](티켓 32)가 선다.
 *
 * 스냅샷은 이 화면이 떠 있는 동안만 2초마다 온다(`useProcessSnapshot`) — 화면이 내려가면 묻기도 멎는다.
 */
function ProcessesPage({ mode, sidebarOpen }: { mode: Mode; sidebarOpen: boolean }) {
  const { data: snapshot, dataUpdatedAt } = useProcessSnapshot();
  // **이 화면이 서 있는 동안이 「화면이 열려 있다」다**(티켓 29) — nav 메타의 `●`가 창 포커스와 함께 이것으로 「봤다」를 가른다.
  useEffect(() => openProcessesScreen(), []);
  // 스토어의 셸 전부 — 두 세계의 것이 한 벌이다(owner가 세계를 싣는다). 상태 칸이 셸 상태를 읽으므로 좁히지 않는다.
  const shells = useStore(terminalStore, (state) => state.shells);
  const lists = useWorldLists(
    ALL_MODES.filter((one) => shells.some((shell) => modeOfOwner(shell.owner) === one && slugOfOwner(shell.owner) !== null)),
  );
  const goToShell = useGoToShell();
  // **보는 동안 이 화면이 보인 손볼 것도 본 것이다**(티켓 29 · S41 — `useSeeWhileLooking`). nav 메타의 요약은 최대 20초 늦다 — 그것으로만
  // 앉히면 이 스냅샷(2초)에 먼저 선 출처 불명 · 정리 기록이 떠난 뒤 늦은 요약에 실려 `●`를 켠다. 이름은 요약과 같은 이름이다.
  const shown = useMemo(
    () => (snapshot ? lookablesOf(ownerlessShellKeys(shells), lookSourceOf(snapshot)) : NOTHING_SHOWN),
    [shells, snapshot],
  );
  useSeeWhileLooking(shown);

  const previous = usePreviousBeat(snapshot?.pool, shells, dataUpdatedAt);
  const [closedOffscreen, markOffscreenClosed] = useClosedOffscreen(snapshot?.pool);

  const tree = snapshot ? shellTree({ current: mode, shells, lists, snapshot }) : [];
  const ownerless = snapshot ? ownerlessGroups({ current: mode, shells, snapshot }) : [];
  const offscreen = snapshot ? offscreenShells({ shells, snapshot, previous, closed: closedOffscreen }) : [];
  // **경과의 지금은 스냅샷이 도착한 때다**(`dataUpdatedAt`). 박자(2초)마다 새 값이라 경과가 그만큼씩 늙는다 — 따로 시계를 켜지
  // 않는다. 박자가 멎으면(창이 가려짐) 경과도 멎는데, 그동안은 아무도 안 본다.
  const now = dataUpdatedAt;

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <main className="flex min-w-0 flex-1 flex-col">
        <PageHeader
          root="Processes"
          inset={!sidebarOpen}
          actions={
            // [조용한 셸 모두 닫기](티켓 32 · 프로세스 스펙 S44) — 두 세계의 셸 중 명령도 사람이 띄운 자손도 없는 셸을 한 번 묻고 닫는다.
            // 무엇을 닫는지는 누른 순간 배치 물음 한 번이 정한다(`closeQuietShells`) — 화면의 「조용함」 칸(2초 전 표본)이 아니다.
            // 모양은 쪽 동작의 버튼(`Button` ghost · sm — 설정의 「다시 읽기」와 같은 가족)이다.
            <Button variant="ghost" size="sm" onClick={() => void closeQuietShells()}>
              조용한 셸 모두 닫기
            </Button>
          }
        />
        <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-10 scroll-quiet">
          {/* **제목은 머리가 보여 주고, 제목 역할은 이 줄이 진다** — `PageHeader`는 제목 역할이 없는 글자라(설정 화면과 같은
              사정) 이것마저 없으면 화면에 제목이 하나도 없다. */}
          <h2 className="sr-only">Processes</h2>
          {/* 요약 카드(티켓 30) — 합계 · 추이 · CPU · 수들 · 앱 본체. 셸 수(풀의 셸, 두 세계의 것이 함께)도 여기 선다. */}
          <SummaryCard snapshot={snapshot} />
          {tree.length > 0 && (
            // **트리 역할이다**(S58) — 스크린리더가 행마다 깊이를 읽는다. 줄은 평평하게 서고 깊이는 `aria-level`이 말한다(중첩
            // `group` 대신). 줄마다 접근성 이름이 한 문장이라 안의 글자 조각을 이어 읽지 않는다.
            <div role="tree" aria-label="셸" className="mt-4 flex flex-col gap-0.5">
              {tree.map((world) => (
                <Fragment key={world.mode}>
                  <TreeRow level={1} label={worldRowLabel(world)} className="mt-3 first:mt-0">
                    <span className="text-[12.5px] font-semibold">{modeNameOf(world.mode)}</span>
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
                        <StoreShellRows
                          key={node.shell.id}
                          node={node}
                          level={3}
                          now={now}
                          // [이동] — 띠의 줄 · ⌘J와 같은 길이다(`useGoToShell`): 셸 주인의 세계로 화면을 옮기고, 켜고, 포커스를
                          // 데려온다(티켓 16).
                          onGo={() => goToShell({ id: node.shell.id, owner: node.shell.owner })}
                        />
                      ))}
                    </Fragment>
                  ))}
                </Fragment>
              ))}
            </div>
          )}
          {ownerless.length > 0 && (
            // **주인 잃은 셸**(프로세스 결정 4 · 티켓 12 · 32) — MCP로 아카이브 · 삭제된 work의, 도는 것이 남은 셸. 두 세계의 것이 work마다
            // 선다. [모두 닫기]는 토스트의 그것과 같은 함수다(`closeOwnerless`) — 두 세계를 넘기고 한 번 묻는다. [이동]은 없다: 그 work은
            // 목록에 없어 갈 화면이 없다.
            <Section
              title="주인 잃은 셸"
              note={shellCount(ownerless.reduce((sum, group) => sum + group.shells.length, 0))}
              action={<RowButton onClick={() => void closeOwnerless(ALL_MODES)}>모두 닫기</RowButton>}
            >
              <div role="tree" aria-label="주인 잃은 셸" className="flex flex-col gap-0.5">
                {ownerless.map((group) => (
                  <Fragment key={group.owner}>
                    <TreeRow level={1} label={ownerlessGroupRowLabel(group)}>
                      <span className="min-w-0 truncate text-[13px] font-medium">{group.name}</span>
                      <span className="shrink-0 text-[12px] text-tertiary">{modeNameOf(modeOfOwner(group.owner))}</span>
                      <span className="shrink-0 text-[12px] text-tertiary">{shellCount(group.shells.length)}</span>
                      <span className="flex-1" />
                      <Figures metrics={groupTotals(group)} ports={false} />
                      <Actions />
                    </TreeRow>
                    {group.shells.map((node) => (
                      <StoreShellRows key={node.shell.id} node={node} level={2} now={now} />
                    ))}
                  </Fragment>
                ))}
              </div>
            </Section>
          )}
          {offscreen.length > 0 && (
            // **화면 밖 셸**(프로세스 스펙 S42 · 티켓 32) — 풀에는 있는데 화면이 모르는 셸. 새로고침 중에 끝난 spawn이 남길 수 있다
            // (추정). 스토어의 칸이 없어 이름도 주인도 모른다 — 「셸」로 서고 자손은 셸 키로 잇는다. [닫기]는 셸 탭의 ×와 같은 규칙으로 묻는다
            // (`closeOffscreenShell`). 닫은 줄은 곧바로 빠진다(`useClosedOffscreen`). `●`를 안 켠다.
            <Section title="화면 밖 셸" note={shellCount(offscreen.length)}>
              <div role="tree" aria-label="화면 밖 셸" className="flex flex-col gap-0.5">
                {offscreen.map((node) => (
                  <ShellRows
                    key={poolKey(node.pool)}
                    node={node}
                    level={1}
                    name={OFFSCREEN_NAME}
                    state={offscreenStateOf(node)}
                    label={offscreenRowLabel(node, now)}
                    now={now}
                    onClose={() =>
                      void closeOffscreenShell(node.pool.ptyId).then((closed) => closed && markOffscreenClosed(node.pool))
                    }
                  />
                ))}
              </div>
            </Section>
          )}
          {/* 고아 · 다른 인스턴스 · 예외(티켓 31) — 셸이 없어도 선다(앱을 막 켰는데 지난 실행이 남긴 것). */}
          {snapshot && <StraySections snapshot={snapshot} />}
          {/* 정리 기록(티켓 32) — 맨 끝이다. 스냅샷이 올 때마다 한 번 묻는다. */}
          {snapshot && <CleanupLogSection snapshotAt={dataUpdatedAt} />}
        </div>
      </main>
    </div>
  );
}

/** 스냅샷 전의 「보인 손볼 것」 — 늘 같은 배열이라 보는 동안의 이펙트가 렌더마다 다시 돌지 않는다. */
const NOTHING_SHOWN: ReadonlyArray<string> = [];

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
 * 바로 앞 박자 — 화면 밖 셸은 **두 박자 연달아 스토어가 모른** 셸만 센다(`offscreenShells`). 스냅샷이 도착한 때(`dataUpdatedAt`)로
 * 박자를 가른다: react-query는 같은 내용이면 같은 참조를 돌려주므로(구조 공유) 데이터로 가르면 박자를 놓친다. 새 박자를 본 렌더에서
 * 앞 장을 밀어 둔다(렌더 중 상태 갱신 — React가 곧바로 다시 그린다).
 *
 * **박자마다 그 박자를 처음 그린 렌더의 스토어를 함께 적는다.** 그 뒤로 스토어가 바뀌어도(이 화면의 [닫기]) 고쳐 적지 않는다 — 고쳐
 * 적으면 방금 닫은 셸이 「앞 박자에도 스토어가 몰랐다」가 되어, 풀에서 빠지는 다음 박자 전에 화면 밖 셸로 선다.
 */
function usePreviousBeat(
  pool: ReadonlyArray<PoolShell> | undefined,
  shells: ReadonlyArray<Shell>,
  at: number,
): PoolBeat | undefined {
  const [seen, setSeen] = useState<{ at: number; current?: PoolBeat; previous?: PoolBeat }>({ at: 0 });
  if (pool !== undefined && seen.at !== at) {
    setSeen({ at, current: { pool, shells }, previous: seen.current });
    return seen.current;
  }
  return seen.previous;
}

/**
 * **이 화면의 [닫기]로 닫은 화면 밖 셸**(`poolKey`) — 풀에서 빠질 때까지 화면 밖 셸에서 가린다(`offscreenShells`의 `closed`). 스토어의
 * 셸은 닫으면 스토어가 칸을 곧바로 빼 다음 스냅샷 전에도 안 서는데(`usePreviousBeat`), 화면 밖 셸은 스토어에 칸이 없어 이 화면이 든다.
 * 스냅샷은 다음 박자(2초)까지 앞 장이라 풀에 그 셸이 남아 있다.
 *
 * 풀에서 빠진 셸은 잊는다 — 새 스냅샷을 본 렌더에서 고친다(렌더 중 상태 갱신 — `usePreviousBeat`와 같은 수법). 닫기가 풀에서 못 뺀
 * 셸(닫기 IPC가 거절됐다)은 풀에 남는 동안 가려진다 — 스토어의 셸이 닫기 뒤 탭 줄에서 빠지는 것과 같다.
 */
function useClosedOffscreen(pool: ReadonlyArray<PoolShell> | undefined): [ReadonlySet<string>, (shell: PoolShell) => void] {
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  if (pool !== undefined && closed.size > 0) {
    const pooled = new Set(pool.map(poolKey));
    if ([...closed].some((key) => !pooled.has(key))) setClosed(new Set([...closed].filter((key) => pooled.has(key))));
  }
  const markClosed = useCallback((shell: PoolShell) => setClosed((was) => new Set(was).add(poolKey(shell))), []);
  return [closed, markClosed];
}

/**
 * 스토어의 셸 하나의 줄들 — 이름은 탭 줄의 것(`shellRowName`), 상태는 셸 상태부터(`shellStateOf`)다. [닫기]는 셸 탭의 ×와 같은
 * 길이다. 명령이 돌 때만 묻던 ux-papercuts 결정 92를 프로세스 결정 3이 이렇게 고쳤다: 명령이나 자손이 있으면 확인 창이 묻는다.
 * 까닭은 「셸 닫기」다. [이동]은 부르는 쪽이 주면 선다.
 */
function StoreShellRows({ node, level, now, onGo }: { node: ShellNode; level: number; now: number; onGo?: () => void }) {
  return (
    <ShellRows
      node={node}
      level={level}
      name={shellRowName(node.shell)}
      state={shellStateOf(node)}
      label={shellRowLabel(node, now)}
      now={now}
      onGo={onGo}
      onClose={() => void requestCloseShell(node.shell.id)}
    />
  );
}

/**
 * 셸 하나의 줄들 — 셸 행, 셸 도우미의 옅은 줄, 사람이 띄운 자손의 트리. 셸 행의 깊이는 부르는 쪽이 준다(세계 트리는 3 — 세계 → work
 * → 셸, 주인 잃은 셸은 2, 화면 밖 셸은 1). 셸 행의 숫자는 그 셸의 트리 합이다(셸 프로세스 · 도우미 · 자손 — `shellTotals`). 스토어의
 * 셸과 화면 밖 셸(스토어의 칸이 없다)이 같은 줄로 선다 — 이름 · 상태 · 접근성 이름만 부르는 쪽이 짓는다.
 */
function ShellRows({
  node,
  level,
  name,
  state,
  label,
  now,
  onGo,
  onClose,
}: {
  node: ShellProcesses;
  level: number;
  name: string;
  state: ShellState;
  label: string;
  now: number;
  onGo?: () => void;
  onClose: () => void;
}) {
  const mark = state.kind === "command" ? agentMarkOf(state.command) : null;
  return (
    <>
      <TreeRow level={level} label={label} data-shell-key={node.pool.shellKey} className="hover:bg-state-1">
        <span className="min-w-0 truncate text-[13px]">{name}</span>
        <span className="flex min-w-0 flex-1 items-center gap-1.5 text-[12.5px] text-muted-foreground">
          {/* 셸 상태가 있으면 사이드바 · 띠와 같은 글리프가 선다 — 같은 셸에 같은 색이다(terminal-activity-signal 스토리 79). */}
          {state.kind === "signal" && <SignalLane kind={state.signal} />}
          {mark && (
            // 마크는 「누구」다 — 이름은 접근성으로만 한 번 더 읽힌다(`SignalMeta`와 같은 규칙).
            <span role="img" aria-label={mark.label} className="flex shrink-0 items-center">
              <mark.Glyph className="size-3" />
            </span>
          )}
          <span className="min-w-0 truncate">{stateText(state, now)}</span>
        </span>
        <Figures metrics={shellTotals(node)} />
        <Actions>
          {onGo && <RowButton onClick={onGo}>이동</RowButton>}
          <RowButton onClick={onClose}>닫기</RowButton>
        </Actions>
      </TreeRow>
      {node.helpers.length > 0 && (
        // **셸 도우미는 옅은 줄 하나로 따로 선다**(P1) — 사람이 띄운 것과 한 무게로 섞이면 「이 셸에서 띄운 프로세스」로 읽힌다.
        // 닫으면 함께 끝나지만 확인 창의 수에도 조용함 판정에도 안 든다(CONTEXT 「셸 도우미」).
        <TreeRow level={level + 1} label={helperLabel(node.helpers)} data-helper="" className="text-[12.5px] text-tertiary">
          <span className="shrink-0">{HELPER_LABEL}</span>
          <span className="min-w-0 truncate">{node.helpers.map(processLabel).join(" · ")}</span>
        </TreeRow>
      )}
      {node.descendants.map(({ row, depth }, at) => (
        // 자손 행 — 부른 이름. **명령줄은 이름 글자의 툴팁이다**(수집이 `KERN_PROCARGS2`의 argv 전체에서 읽은 것, 티켓 11). 자르지
        // 않는다: 이 맥의 같은 사용자가 `ps`로 보는 것과 같은 글자이고, 디스크에 남기는 정리 기록만 앞 200자로 자른다(S12). 줄 전체가
        // 아니라 이름 칸에 거는 것은 줄 안의 ⋯가 앱 툴팁(「프로세스 메뉴」)을 들어서다 — 줄에 걸면 ⋯에 올린 포인터에 두 툴팁이 겹친다.
        //
        // [끝내기](기본값 [끝내기] · 티켓 31) — 앱 확인 창을 거친 뒤 그 프로세스와 그 PID 트리를 끝낸다. 넘기는 신원은 **누른 순간 화면에
        // 보인 표본의 것**이다(이 줄을 그린 스냅샷) — 창이 떠 있는 동안 박자가 새 스냅샷을 가져와도 바뀌지 않는다. 그사이 pid가
        // 재사용됐으면 끝내기가 신호 직전 신원 확인으로 거른다(S4).
        <TreeRow
          key={identityKey(row.id)}
          level={level + depth}
          label={processRowLabel(row)}
          className="text-[12.5px] text-muted-foreground"
        >
          <span title={row.command ?? undefined} className="min-w-0 flex-1 truncate">
            {processLabel(row)}
          </span>
          <Figures metrics={row.metrics} />
          <Actions>
            <RowButton
              onClick={() => {
                const targets = subtreeAt(node.descendants, at);
                void askThenEnd(endAsk(processLabel(row), targets.length), targets);
              }}
            >
              끝내기
            </RowButton>
            <RowMenu name={exceptionName(row)} />
          </Actions>
        </TreeRow>
      ))}
    </>
  );
}

export default ProcessesPage;

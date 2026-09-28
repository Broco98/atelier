import { itemNameOf } from "@/features/works/work-sections";
import { ALL_MODES } from "@/mode";
import type { Mode } from "@/mode";
import { modeOfOwner, slugOfOwner } from "./shell-registry";
import type { ShellOwner, ShellsState } from "./shell-registry";

/**
 * **주인 확인**(프로세스 결정 4 · 프로세스 스펙 S13 · 티켓 12). 순수 함수들이다.
 *
 * claude에게 MCP로 work을 아카이브 · 삭제하라고 시키면 그 일은 다른 프로세스(MCP 서버)가 한다 — 앱은 `works:changed` 뒤의
 * **목록 재조회**로만 안다. 새 목록이 앉으면 그 세계의 셸 owner 중 slug가 목록에서 사라진 것을 찾고(`vanishedOwners`),
 * 그 셸들이 조용한지는 배치 물음 한 번으로 본다(`closesWithoutAsking` · 터미널 스토어의 `settleOwners`). 조용한 셸과 끝난 칸 ·
 * 못 뜬 칸은 닫히고 나머지는 「주인 잃은 셸」로 남아 토스트로 알린다.
 *
 * **모르면 판단하지 않는다**(fail-closed). 조회가 실패했거나 결과가 아직 없는 것을 「목록이 비었다」로 읽으면 그 세계의
 * 셸이 전부 주인을 잃는다.
 *
 * 이 모듈은 시간을 모른다 — 터미널 폴더에서 시간을 아는 파일은 셋뿐이다(`shell-attention.test.ts`의 소스 스캔).
 */

/**
 * 목록 쿼리의 결과에서 이 판정이 보는 것. react-query의 쿼리 상태(`QueryState`)가 그대로 들어온다 — 모양으로만 받는
 * 것은 이 모듈이 쿼리 라이브러리를 몰라도 되게 해서다.
 */
export interface ListResult {
  status: "pending" | "error" | "success";
  data?: ReadonlyArray<{ slug: string }>;
}

/** 제외 창(UI 아카이브 · 삭제가 도는 동안의 owner). 터미널 스토어가 센다(`holdOwner`). */
export interface HeldOwners {
  has(owner: ShellOwner): boolean;
}

/**
 * 그 세계의 목록에서 **slug가 사라진** 셸 owner들. 한 owner는 한 번만 나온다.
 *
 * - **성공한 결과만 본다.** 실패 · 로딩 · 결과 없음은 빈 답이다 — 실패한 재조회는 옛 목록을 든 채 `error`가 되는데, 그
 *   목록을 믿어도 안 되고 「비었다」로 읽어도 안 된다.
 * - **그 세계의 셸만 본다**(결정 10) — 두 세계에 같은 slug가 설 수 있다.
 * - **최상위 터미널의 셸은 안 나온다** — 어느 work의 것도 아니다(`slugOfOwner`가 `null`).
 * - **제외 창의 owner는 뺀다.** UI 아카이브 · 삭제는 성공한 뒤 제 손으로 닫으므로(`closeShellsOf`) 그동안 앉은 재조회가
 *   사람이 이미 확인한 셸을 주인 잃은 셸로 세우면 안 된다.
 * - **이미 주인 잃은 셸은 다시 안 본다.** 다시 보면 claude가 대답을 마치고 조용해진 순간 저절로 닫히는데, 그것이 프로세스 결정 4가
 *   기각한 「끝날 때까지 기다렸다 자동으로 닫기」다.
 */
export function vanishedOwners(
  state: ShellsState,
  mode: Mode,
  result: ListResult | undefined,
  held: HeldOwners,
): ShellOwner[] {
  if (result?.status !== "success" || result.data === undefined) return [];
  const listed = new Set(result.data.map((item) => item.slug));
  const gone: ShellOwner[] = [];
  for (const shell of state.shells) {
    if (shell.ownerless || modeOfOwner(shell.owner) !== mode) continue;
    const slug = slugOfOwner(shell.owner);
    if (slug === null || listed.has(slug) || held.has(shell.owner) || gone.includes(shell.owner)) continue;
    gone.push(shell.owner);
  }
  return gone;
}

/**
 * 같은 무효화에서 **함께 다시 읽을 저쪽 세계**(프로세스 스펙 S13). 그 세계를 owner로 가진 셸이 하나라도 있는 세계다 —
 * 최상위 터미널의 셸도 든다(스펙의 문장 그대로다. 판 02가 이벤트 한 번의 조회 수를 기대값으로 쓴다).
 *
 * 목록 쿼리는 관찰자가 있는 것만 다시 부르고, 앱 루트가 관찰하는 것은 지금 세계 하나다. 그래서 저쪽 세계는 따로 불러야
 * 새로 앉는다 — 셸이 없으면 부를 까닭이 없다. 이벤트 한 번에 목록 조회는 저쪽 세계에 셸이 없으면 1번, 있으면 2번이다.
 */
export function worldsToReread(state: ShellsState, current: Mode): Mode[] {
  return ALL_MODES.filter(
    (mode) => mode !== current && state.shells.some((shell) => modeOfOwner(shell.owner) === mode),
  );
}

/**
 * 그 칸이 주인 잃은 셸이면 **그 세계**, 아니면 `null`. 띠가 이것으로 화면 이동 전에 갈린다(프로세스 스펙 S14) — 없는
 * work으로 가지 않고 `Processes`로 간다(티켓 32 — 판 01~03에서는 그 세계의 토스트를 다시 띄웠다). 끝난 칸도 표시가 남아
 * 있으면 주인 잃은 셸이다.
 */
export function ownerlessWorldOf(state: ShellsState, id: number): Mode | null {
  const shell = state.shells.find((one) => one.id === id);
  return shell?.ownerless ? modeOfOwner(shell.owner) : null;
}

/**
 * 주인 잃은 셸 토스트의 문장(프로세스 결정 4 · 프로세스 스펙 S45). **세는 말은 그 세계의 것이다** — 지금 선 화면이 아니라
 * 아카이브된 것의 세계다. 낱말은 `itemNameOf`에서 온다: Atelier는 화면의 말 「작업」, Maison은 「Room」이다.
 * N은 **도는** 주인 잃은 셸이다(`liveOwnerlessOf`).
 */
export function ownerlessNotice(mode: Mode, count: number): string {
  return `아카이브된 ${itemNameOf(mode)}의 셸 ${count}개에 아직 도는 것이 있어요`;
}

/**
 * 주인 잃은 셸 토스트의 id — **세계마다 하나다.** 동작 토스트는 누르거나 닫을 때까지 남으므로, 같은 알림이 다시 오면
 * (주인 잃은 셸이 늘었다 · 띠에서 다시 불렀다) 새로 쌓이지 않고 그 자리를 고친다. 세계마다 따로인 것은 [모두 닫기]가 그
 * 세계의 셸만 닫기 때문이다.
 */
export function ownerlessToastId(mode: Mode): string {
  return `ownerless:${mode}`;
}

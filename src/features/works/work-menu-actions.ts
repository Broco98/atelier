import { useIsMutating, useQueryClient } from "@tanstack/react-query";
import { copyText } from "@/components/shell/copy-text";
import { openInFinder } from "@/components/shell/open-in-finder";
import { askDanger, showProblem } from "@/components/ui/confirm-store";
import { closingShellsNotice, ownerOf, runningShellsOf } from "@/features/terminal/shell-registry";
import { closeShellsOf, holdOwner, spawnedCountOf, terminalStore } from "@/features/terminal/terminal-store";
import { worksApi } from "./api";
import { WORK_LIFECYCLE_KEY, useArchiveWork, useRemoveWork, useSetWorkPinned, useSetWorkStatus } from "./hooks";
import type { WorkMenuActions, WorkMenuFlows } from "./WorkMenuItems";
import { ARCHIVE_CONFIRM_BODY, REMOVE_CONFIRM_BODY } from "./work-menu-copy";
import type { WorkView } from "./types";

// **work 메뉴가 부르는 흐름 — 한 자리다**(codex-ds 스펙 §6 · §9). 메뉴는 넷에서 선다 — 머리 줄의 ⋯(`WorksPage`의 `WorkMenu`)와
// 우클릭 대상 셋(사이드바 행 · 알림 띠 줄 · 머리 줄 이름 — `WorkContextMenu`). 무엇을 어떤 차례로 보이는지는 메뉴 정의
// (`WorkMenuItems`)가 들고, 여기는 그 항목이 부르는 동작을 잇는다: Finder 열기 · 복사 · 상태 · 고정, 그리고 아카이브 · 삭제의
// 흐름(아래 `run`). 이름 바꾸기는 메뉴를 다는 자리가 넘긴다 — 이름을 그 자리에서 고치는 입력칸이 서는 곳(머리 줄 이름 · 사이드바
// 행)과, 메뉴가 닫힐 때 포커스를 그 입력칸에 남기는 일(구현 노트 Q7)이 그쪽 몫이라서다.
//
// **흐름은 이 파일에 둔다** — 아카이브 · 삭제의 차례가 계약이라 검사가 이 파일의 소스 순서로 지킨다(`WorksPage.test.tsx`). 셸을
// 거두는 길(`@/features/terminal`)이 여기 들어오므로, 훅을 안 부르는 사이드바 행 파일에는 이것이 들지 못하고 목록이 받은 값(`flows`)을
// 행의 메뉴에 건넨다(`SidebarWorkList.test.tsx`의 지킴).
//
// 아카이브 · 삭제는 되돌릴 수 없어서 확인 창을 거치고, 거절 사유(커밋 안 된 변경 등)는 코어가 파일 단위로 말해주므로 그대로
// 보여준다. 성공 뒤에 선택을 옮기지 않는다 — 목록 무효화로 이 작업이 사라지면 -works-view.tsx의 정규화(`exists`가 false가 되는
// 경로)가 주소까지 함께 옮긴다. 여기서 또 옮기면 같은 일을 두 곳이 하게 되고, 그쪽이 "사라진 작업" 일반을 이미 담당한다.

/**
 * Finder에서 연다(codex-ds 스펙 S6) — `project`가 `null`이면 그 work의 spec 폴더, 프로젝트 이름이면 그 worktree다. work 메뉴의
 * Finder ▸와 작업 패널 머리의 「spec 폴더 열기」가 부른다. 못 열었을 때의 말은 Archive · 프로젝트의 Finder 열기와 한 자리다
 * (`openInFinder`).
 */
export function openWorkFolder(slug: string, project: string | null): void {
  openInFinder(() => worksApi.openFolder(slug, project));
}

/**
 * work 메뉴의 흐름 한 벌을 짓는다. 메뉴를 다는 자리가 부르고, 펼 때마다 대상 work로 동작을 꺼낸다(`actionsFor`) — **대상은 고른 work가
 * 아닐 수 있다**(codex-ds 결정 7 — 사이드바 행 · 띠 줄은 그 줄의 work다).
 *
 * **바쁨은 앱 하나다.** 아카이브 · 삭제가 하나라도 돌면(`WORK_LIFECYCLE_KEY`) 모든 work 메뉴가 열리지 않는다 — 메뉴가 자리마다 따로
 * 서도 뮤테이션은 캐시 하나에 있어서, 한 자리에서 연 아카이빙을 다른 자리의 메뉴도 안다. 그 조작이 작업 화면이 보여 주는 work의
 * 것이면 무엇이 도는지를 그 화면의 막(`WorksPage`의 `LifecycleOverlay`)이 말하고 ⋯가 `aria-busy`다 — 다른 work의 것이면 메뉴가
 * 꺼져 있을 뿐이다.
 */
export function useWorkMenuFlows(): WorkMenuFlows {
  const queryClient = useQueryClient();
  const archive = useArchiveWork();
  const remove = useRemoveWork();
  const setStatus = useSetWorkStatus();
  const setPinned = useSetWorkPinned();
  const busy = useIsMutating({ mutationKey: WORK_LIFECYCLE_KEY }) > 0;

  const actionsFor = (work: WorkView, rename: () => void): WorkMenuActions => {
    // 진행 중에는 다시 부르지 않는다. 두 번째 호출은 이미 옮겨진 작업을 찾지 못해 실패하는데,
    // 성공한 아카이빙 위에 "아카이빙하지 못했습니다" 창이 뜨는 것이 그 결과다. **부르는 순간에 캐시에 묻는다** — 렌더 때의 `busy`는
    // 확인 창이 떠 있는 동안 다른 자리에서 시작된 조작을 모른다.
    //
    // 메뉴는 항목을 누르면 스스로 닫힌다 — 여기서 닫을 것이 없다.
    const run = async (verb: string, detail: string, call: () => Promise<unknown>) => {
      if (queryClient.isMutating({ mutationKey: WORK_LIFECYCLE_KEY }) > 0) return;
      // 이 Work의 **살아 있는** 셸. 확인 대화가 그 수를 말한다(결정 26). 고르는 규칙은
      // `shellsOf` 하나라 다른 Work의 셸과 최상위 터미널의 셸은 안 걸린다. 묻는 순간의 값이다 — 창이 말하는 수가 그때의 수다.
      //
      // 끝난 칸과 못 뜬 칸은 세지 않는다 — 그 칸들은 남아 있지만 죽일 프로세스가 없어서,
      // 함께 세면 "셸 2개가 닫혀요"라고 해놓고 실제로는 하나만 끝난다. **거두는 것은 그래도
      // 전부다**(아래): Work가 사라지는데 그 Work를 가리키는 칸만 남으면 닫을 길이 없다.
      const liveShells = runningShellsOf(terminalStore.state, ownerOf(work.slug));
      // 셸은 이 Work의 워크트리에서 도는 프로세스라 폴더가 정리되면 함께 끝난다. 누르기 전에
      // 그 사실을 말한다 — 용어는 「셸」이다("터미널"은 화면을 가리키는 말이라 여기서 쓰면
      // 다른 것을 센 것처럼 읽힌다). 0개면 그 줄을 쓰지 않는다.
      //
      // 그 셸들에서 띄운 프로세스(dev 서버 등)도 함께 끝난다(프로세스 결정 3) — 그 수를 **창을 띄우기 전에** 물어
      // 셸 줄 뒤에 붙인다(프로세스 스펙 S18). 못 얻으면 붙이지 않고 창은 그대로 뜬다.
      const spawned = liveShells > 0 ? await spawnedCountOf(ownerOf(work.slug)) : null;
      const shellLine = closingShellsNotice(liveShells, spawned);
      const notice = shellLine ? `${detail}\n${shellLine}` : detail;
      // **앱의 창이다**(OS 시트가 아니다) — 창 하나만 남의 글꼴·남의 모서리로 뜨면 그것이
      // 앱 밖의 일처럼 읽힌다. 창이 닫히면 포커스는 메뉴를 연 자리로 간다 — 창을 연 항목이 사라졌으면 그 앞에 포커스가 있던
      // 자리로 가는 부품의 기본값이고(Base UI의 포커스 기록), 메뉴는 닫히며 제 대상에 포커스를 돌려 두었다.
      if (!(await askDanger(`'${work.title}' ${verb}`, notice, verb))) return;
      // **제외 창을 연다**(티켓 12 · 프로세스 스펙 S13). 앱 루트는 목록이 새로 앉을 때마다 slug가 사라진 work의 셸을
      // 「주인 잃은 셸」로 세운다(MCP로 아카이브된 work을 알아채는 길이 그것뿐이다). 이 길은 성공한 뒤 제 손으로
      // 닫으므로 그동안 이 owner를 감지에서 뺀다 — 삭제는 재조회가 앉은 뒤에야 돌아오고 아카이브는 안 기다려서,
      // 재조회가 회수 앞뒤 어디에나 올 수 있다. 닫는 자리는 회수 뒤와, 실패하면 그 자리다.
      const release = holdOwner(ownerOf(work.slug));
      try {
        await call();
      } catch (e) {
        release();
        await showProblem(`${verb}하지 못했습니다: ${e}`);
        return;
      }
      // **성공한 뒤에** 거둔다(결정 26). 순서가 계약이다 — dirty 판정은 확인 대화가 아니라
      // 그 뒤 코어에서 나므로, 먼저 죽이면 거부당했을 때 **Work는 남고 돌던 claude만
      // 사라진다.** 터미널에서 claude를 돌리는 것 자체가 워크트리를 dirty로 만든다.
      // (in-app-terminal 결정 26이 「알려진 대가」로 남긴 MCP 길은 프로세스 결정 4가 이렇게 고쳤다 — 위 제외 창의 감지가 그 길이다.)
      closeShellsOf(ownerOf(work.slug));
      release();
    };

    // 낱말의 계약은 `work-menu-copy.ts`가 들고 여기서는 꺼내 쓰기만 한다. `askDanger`는 OS가 아니라
    // 앱의 창이지만 여기서는 프로미스 뒤에 있어, 이 저장소의 정적 마크업 seam에 문장이 아예 안 걸린다.
    return {
      // Finder 열기는 작업 패널 머리의 spec 폴더 열기와 한 벌이다(`openWorkFolder`).
      openFolder: (project) => openWorkFolder(work.slug, project),
      rename,
      copy: copyText,
      setStatus: (status) => setStatus.mutate({ slug: work.slug, status }),
      setPinned: (pinned) => setPinned.mutate({ slug: work.slug, pinned }),
      archive: () => run("아카이빙", ARCHIVE_CONFIRM_BODY, () => archive.mutateAsync(work.slug)),
      remove: () => run("삭제", REMOVE_CONFIRM_BODY, () => remove.mutateAsync(work.slug)),
    };
  };

  return { busy, actionsFor };
}

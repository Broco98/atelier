import PageHeader from "@/components/shell/PageHeader";
import { useProcessSnapshot } from "./hooks";

/**
 * `Processes` 화면(프로세스 결정 8 · 9 · 10). 아틀리에가 띄운 셸과 그 셸에서 뜬 프로세스를 **앱 전체**로 보인다 — 두 세계의
 * 주소(`/processes` · `/maison/processes`)가 이 화면 하나를 연다. 「지금 무엇이 내 컴퓨터를 먹나」에 답하는 화면이라 세계로
 * 나누면 절반이 안 보인다.
 *
 * **이 판의 뼈대다**(티켓 26): 제목과 앱에 떠 있는 셸 수만 선다. 셸 묶음(세계 → work → 셸 → 자손)과 [이동] · [닫기]는 27, 숫자는
 * 28, 요약 카드는 30, 나머지 묶음은 31 · 32가 붙인다. 지금 세계를 맨 위에 세우는 것은 27의 일이라 세계를 아직 안 받는다.
 *
 * 스냅샷은 이 화면이 떠 있는 동안만 2초마다 온다(`useProcessSnapshot`) — 화면이 내려가면 묻기도 멎는다.
 */
function ProcessesPage({ sidebarOpen }: { sidebarOpen: boolean }) {
  const { data: snapshot } = useProcessSnapshot();

  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <main className="flex min-w-0 flex-1 flex-col">
        <PageHeader root="Processes" inset={!sidebarOpen} />
        <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-10 scroll-quiet">
          {/* **제목은 머리가 보여 주고, 제목 역할은 이 줄이 진다** — `PageHeader`는 제목 역할이 없는 글자라(설정 화면과 같은
              사정) 이것마저 없으면 화면에 제목이 하나도 없다. */}
          <h2 className="sr-only">Processes</h2>
          {/* 풀에 앉은 셸 — 두 세계의 것이 함께다. 첫 답이 오기 전에는 세지 않는다: 「0개」라고 말하면 모르는 것을 없다고 한다. */}
          {snapshot && (
            <p className="text-[13px] text-muted-foreground">셸 {snapshot.pool.length}개</p>
          )}
        </div>
      </main>
    </div>
  );
}

export default ProcessesPage;

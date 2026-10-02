import { SquareTerminal } from "lucide-react";

/**
 * **셸 메타** — 그 소유자의 셸 수를 `⌨ N` 한 무리로 적는다(결정 3 · ui-refresh 결정 13).
 *
 * **불변조건: 숫자를 다 더하면 그 소유자의 셸 수다.** 한때 셸 수와 로고가 따로 서서 셸
 * 하나에서 claude가 돌면 `⌨1 ✳1`이라 적었는데, 그 두 `1`은 **같은 셸**이었다. 그 뒤로는
 * 마크 무리와 「그 밖의 셸」 무리로 갈라 셌다. 사이드바에서 에이전트 마크가 빠지면서(ui-refresh
 * 결정 13) 무리가 하나가 됐고, 불변조건은 그 무리의 수가 곧 셸 수라는 것으로 저절로 선다.
 * 무엇이 도는지는 호버 카드와 셸 탭이 말한다.
 *
 * **`components/shell`에 사는 이유는 쓰는 자리가 둘이어서다**(결정 13) — nav `Terminal`과
 * work 행의 오른쪽 끝(`sidebar-active-band` 결정 14로 한 줄 행이 돌아오면서 다시 그 자리다).
 * 이 저장소의 규칙은 「쓰는 자리가 하나면 그 파일로, 둘이면 공용으로」이고, 세는 규칙과
 * 색이 여기 하나에 있어야 그 둘이 앞으로도 안 갈린다. 규격(글꼴·간격·오른쪽 여백)은 index.css의
 * `row-meta` 하나다 — work 행에서 같은 칸에 번갈아 서는 신호의 경과(`shell-signal.tsx`의
 * `SignalMeta`)가 같은 정의를 부른다. 오른쪽 여백(`pr-[5px]`)은 두 자리 다 구획 헤더의 개수와
 * 같은 x에 오른쪽 끝을 세우는 값이다.
 *
 * **터미널 feature를 import하지 않는다.** props만 받는 순수 컴포넌트라 이 저장소의 유일한
 * 컴포넌트 seam인 정적 마크업에 산다(shell-meta.test.tsx) — 스토어를 물면 `@xterm/*`와 그
 * CSS가 딸려 와 그 seam이 서지 못한다. 값을 고르는 자리는 `Sidebar.tsx`에 따로 있다.
 */
export function ShellMeta({
  shellCount,
}: {
  /** 그 소유자의 **모든 셸** 수. 무리의 수가 이 값이다. */
  shellCount: number;
}) {
  // 셸이 0개면 아무것도 안 선다 — 「없음」은 숫자로 말하지 않는다(결정 13). nav `Terminal`이
  // 최상위 셸 없이 설 때 기대는 규칙이 이것이다. work 행은 여기 안 기댄다: 셸이 0개면 오른쪽
  // 메타의 **칸 자체**가 없어야 해서(칸이 제목과 떼는 여백을 든다) 같은 조건을 한 번 더 쓴다
  // (`WorkSectionList.tsx`) — **문턱을 고치면 두 자리다.**
  if (shellCount <= 0) return null;

  return (
    // **바깥의 `text-tertiary`는 아무 글자도 안 칠한다 — 그래도 남긴다.** 무리가 한 단 올린 색을
    // 들므로(아래) 이 값은 덮이기만 하는데, 덮이는 그 순간이 곧 이 자리의 그물이다: 무리가 자기
    // 색을 잃으면 글자가 곧장 tertiary로 떨어져 work 행 오른쪽 메타의 대비 검사(L3)가 빨개진다.
    // 지우면 그때 색이 부모의 것(행 글자색 — `sidebar-foreground` · 고른 행 `foreground`)으로 조용히
    // 대체돼 **그 검사가 아무것도 못 잡는다.**
    //
    // 규격(가로 한 줄 · 글자 · 간격 · 오른쪽 여백)은 `row-meta` 하나다 — 신호 갈래(`SignalMeta`)가
    // 같은 칸에 번갈아 서며 같은 정의를 부른다(index.css).
    <span className="row-meta text-tertiary">
      {/* 「셸이 열려 있다」 — ⌘W로 닫을 셸을 찾던 길이 그 자리에 그대로 남는다. 글리프는 셸 탭이
          이름을 숨기는 폭에서 세우는 것과 같다(결정 20·4) — 두 자리가 같은 규칙을 쓰는 것이 「통일성」이다.

          **색은 바깥보다 한 단 올린다.** 바깥의 tertiary를 물려받으면 사이드바 배경에서 ≈3.0이고,
          이 무리가 **가장 자주 서는** 메타라(셸은 열려 있는데 부르지도 돌지도 않는다) work 행 메타가
          통째로 3.0으로 서던 자리다 — 두 줄 행을 연 판이 시작된 말이 「이 한 줄이 가독성이 안
          좋다」였다. 그 대비를 L3가 계산해 잰다.

          **이름을 달지 않는다.** 표시 전용이고(결정 5 — 무리 하나가 셸 여럿을 접어 누르면 어느 셸로
          갈지 정해지지 않는다), `title`도 안 단다: work 행에 머물면 호버 카드가 떠서 OS 툴팁이 그
          위로 겹친다(핀 버튼과 같은 이유). */}
      <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
        <SquareTerminal className="size-3 shrink-0" strokeWidth={1.8} />
        <span className="tabular-nums">{shellCount}</span>
      </span>
    </span>
  );
}

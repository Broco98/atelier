import { SquareTerminal } from "lucide-react";
import { agentMarkOf, type AgentMark } from "@/components/ui/agent-mark";

/**
 * 행 오른쪽 끝의 **셸 메타** — 「무리」의 나열이다(결정 3). 무리 하나 = 글리프 + **그 무리의
 * 셸 수**이고, 글리프는 「우리가 아는 한 그 셸이 지금 무엇인지」를 말한다.
 *
 * **불변조건: 숫자를 다 더하면 그 소유자의 셸 수다.** 한때 셸 수와 로고가 따로 서서 셸
 * 하나에서 claude가 돌면 `⌨1 ✳1`이라 적었는데, 그 두 `1`은 **같은 셸**이었다 — 앞의 수는
 * 모든 셸을 세고 로고는 같은 셸들을 훑어 돌았다. 겹쳐 있다는 것을 화면은 아무 데서도 말하지
 * 않았다.
 *
 * **`⌨` 무리는 「빈 셸」이 아니라 「그 밖의 셸」이다** — 그 수는 `shellCount − 로고가 붙은
 * 셸 수`이지 `shellCount − running.length`가 **아니다**. `agentMarkOf`는 모르는 이름에
 * `null`을 주므로(그 머리말: 셸에서 도는 것의 **대부분**이 그 자리에 온다), 뒤쪽으로 재면
 * `vim`·`node`·`cargo`를 띄운 셸이 로고도 못 받고 어느 무리에도 안 세어져 **목록에서 통째로
 * 사라지고** 위 불변조건까지 깨진다. 규칙은 그대로다 — **모르면 그냥 터미널이다.**
 *
 * **무리 순서는 마크가 붙은 것 먼저, 그 밖의 셸이 마지막이다**(결정 8). 이 메타는 오른쪽
 * 정렬이라 **오른쪽 끝에 서는 무리가 고정점**이다 — claude가 시작되면 새 무리가 왼쪽으로
 * 끼어들고 `⌨`는 제자리에 있다. 반대로 하면 이미 서 있던 숫자가 옆으로 미끄러진다.
 *
 * **`components/shell`에 사는 이유는 쓰는 자리가 둘이어서다**(결정 13) — work 행과 nav
 * `Terminal`. 이 저장소의 규칙은 「쓰는 자리가 하나면 그 파일로, 둘이면 공용으로」이고,
 * 규격(글꼴·간격·색·오른쪽 여백)이 여기 하나에 있어야 그 둘이 앞으로도 안 갈린다.
 *
 * **터미널 feature를 import하지 않는다.** props만 받는 순수 컴포넌트라 이 저장소의 유일한
 * 컴포넌트 seam인 정적 마크업에 산다(shell-meta.test.tsx) — 스토어를 물면 `@xterm/*`와 그
 * CSS가 딸려 와 그 seam이 서지 못한다. 값을 고르는 자리는 `Sidebar.tsx`에 따로 있다.
 */
export function ShellMeta({
  shellCount,
  running,
}: {
  /** 그 소유자의 **모든 셸** 수. 무리들의 수를 다 더하면 이 값이다. */
  shellCount: number;
  /**
   * 그 소유자의 셸에서 **도는 것들**. 칸 순서 그대로이고 중복이 남아 있다 — 접는 일이
   * 여기라는 분담은 `runningAgentsOf` 머리말이 든다(얕은 비교가 먹는 문자열 배열).
   */
  running: ReadonlyArray<string>;
}) {
  // 셸이 0개면 아무것도 안 선다 — 「없음」은 숫자로 말하지 않는다(결정 13). nav `Terminal`이
  // 최상위 셸 없이 설 때 기대는 규칙이 이것이다. work 행은 여기 안 기댄다: 바깥 상자가
  // 표식(`data-shells`)과 격자 칸을 들어야 해서 같은 조건을 한 번 더 쓴다
  // (`SidebarWorkList.tsx`) — **문턱을 고치면 두 자리다.**
  if (shellCount <= 0) return null;

  // 종류로 접는다. `Map`이 넣은 순서를 지키므로 무리 자리가 초마다 재배열되지 않는다.
  // **마크 표에 있는 것만 무리가 된다** — 모르는 이름은 아래 「그 밖의 셸」로 흘러간다.
  const marks = new Map<string, { mark: AgentMark; count: number }>();
  for (const one of running) {
    const mark = agentMarkOf(one);
    if (mark === null) continue;
    const group = marks.get(one);
    if (group) group.count += 1;
    else marks.set(one, { mark, count: 1 });
  }
  let marked = 0;
  for (const group of marks.values()) marked += group.count;
  // 바닥을 둔다 — 셸 수와 도는 것은 **서로 다른 셀렉터**가 주는 값이라 한 프레임 어긋날 수
  // 있고, 그때 음수가 새면 이 자리에 `-1`이 적힌다.
  const others = Math.max(0, shellCount - marked);

  return (
    <span className="flex shrink-0 items-center gap-1.5 pr-[5px] text-[11.5px] text-tertiary">
      {[...marks].map(([kind, { mark, count }]) => (
        // 이름은 **눈이 아니라 접근성으로만** 읽는다 — 좁은 사이드바에서 이름까지 적으면
        // 무리가 둘일 때 이 자리가 제목보다 길어진다. `title`은 안 단다: work 행에 머물면
        // 호버 카드가 떠서 OS 툴팁이 그 위로 겹친다(핀 버튼과 같은 이유).
        //
        // **바깥 색을 그대로 따르지 않는다.** 로고는 `currentColor`로 칠하는데(결정 15) 그
        // 결정이 든 근거가 「대비 바닥 4.5를 저절로 넘는다」이고, 이 자리의 tertiary는
        // 사이드바 배경에서 그 아래다(#8e8e97 대 #f7f7f9 ≈ 3.0, 다크 ≈ 3.9). 수는 부차적이라
        // 그 색이 맞지만 로고는 **이 자리가 있는 이유**다(결정 2) — 한 단 올린다.
        <span
          key={kind}
          role="img"
          // 수까지 함께 읽힌다 — 눈에 보이는 것과 같은 말이어야 한다.
          aria-label={`${mark.label} ${count}개`}
          className="flex shrink-0 items-center gap-1 text-muted-foreground"
        >
          <mark.Glyph className="size-3" />
          <span className="tabular-nums">{count}</span>
        </span>
      ))}
      {/* 「셸은 열려 있는데 우리가 아는 것은 안 돈다」 — 이 목록의 기본값이고, ⌘W로 닫을
          셸을 찾던 길이 그 자리에 그대로 남는다. 글리프는 셸 탭이 이름을 숨기는 폭에서
          세우는 것과 같다(결정 20·4) — 두 자리가 같은 규칙을 쓰는 것이 「통일성」이다. */}
      {others > 0 && (
        <span className="flex shrink-0 items-center gap-1">
          <SquareTerminal className="size-3 shrink-0" strokeWidth={1.8} />
          <span className="tabular-nums">{others}</span>
        </span>
      )}
    </span>
  );
}

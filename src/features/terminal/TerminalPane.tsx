import { useEffect, useRef } from "react";
import { useStore } from "@tanstack/react-store";
import { SquareTerminal } from "lucide-react";
import {
  activeIdOf,
  activeShellOf,
  atCap,
  shellCapNotice,
  shellEndLabels,
  shellsOf,
  TOP_TERMINAL,
  workShellOrigin,
} from "./shell-registry";
import type { ShellOrigin } from "./shell-registry";
import { terminalLook } from "./terminal-defaults";
import { terminalSettingsStore } from "./terminal-settings";
import { terminalThemeFor } from "./terminal-theme";
import { attachShell, detachShell, ensureShell, terminalStore } from "./terminal-store";
import type { WorkView } from "@/features/works/types";

/**
 * 터미널 본문 — 셸이 들어앉는 자리. **머리행은 여기 없다**: 두 화면이 각자 이고 있다.
 * 두 화면 다 같은 줄이다 — Work의 터미널도 `/terminal`도 `ShellTabs`가 머리행이다
 * (결정 7·8). 한때 최상위만 `PageHeader`였는데 #142가 그것도 이 줄로 옮겼다.
 *
 * 이 컴포넌트가 소유하는 것은 **자리 하나뿐이다.** 셸도 xterm도 terminal-store가 들고 있어
 * 이 화면이 사라져도 그대로 산다(결정 20·21). 여기서 하는 일은 활성 칸의 집을 자리에 들이고
 * 갈아탈 때·나갈 때 도로 빼는 것이다.
 *
 * **`work` 하나가 나머지를 전부 정한다** — 소유자·cwd·프로젝트 목록이 거기서 나온다.
 * `null`이면 최상위 터미널이다.
 */
function TerminalPane({ work }: { work: WorkView | null }) {
  const hostRef = useRef<HTMLDivElement>(null);
  // 좁히지 않고 통째로 읽는다 — 아래 목록이 앱 전체 상한을 세야 해서 어차피 전부 필요하다(결정 30).
  // **셀렉터를 빼면 컴파일이 안 된다** — 이 버전의 `useStore`는 인자 둘을 요구한다(TS2554).
  // 그러니 이 항등 셀렉터는 지울 수 있는 중간자가 아니다.
  // 새 상태를 **바뀔 때만** 만드는 것은 레지스트리가 지킨다(patch가 무변화에 같은 객체를
  // 돌려준다). 그래서 이 셀렉터는 프롬프트마다 오는 같은 타이틀에 다시 그리지 않는다.
  const state = useStore(terminalStore, (whole) => whole);
  const owner = work?.slug ?? null;
  const activeId = activeIdOf(state, owner);

  // **화면에 들어올 때만** 「없으면 하나 띄운다」다. 마지막 칸을 `×`로 닫은 자리에서는
  // 뜨지 않는다 — 닫자마자 새 셸이 뜨면 `×`가 무의미해진다.
  //
  // 의존성이 `owner` 하나인 것은 의도다. `work`는 목록이 갱신될 때마다 새 객체로 오는데
  // (dirty·exists를 다시 재서 온다) 그때마다 이 이펙트가 돌면 `×`로 비운 화면에 셸이
  // 저절로 돌아온다. 여기서 읽는 것은 그 순간의 `work`이고, 소유자가 그대로면 cwd도 그대로다.
  useEffect(() => {
    const origin = originOf(work);
    if (origin) ensureShell(origin);
  }, [owner]);

  // 갈아탈 때도 이 이펙트가 돈다: 먼저 이전 칸의 집을 빼고, 그 다음 새 칸의 집을 들인다.
  // 뺀다고 죽지 않는다는 것이 판 01이 만든 성질이다.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || activeId === null) return;
    attachShell(host, activeId);
    return () => detachShell(activeId);
  }, [activeId]);

  const shells = shellsOf(state, owner);
  // 상한은 **이 화면**의 것이다(결정 23) — 셸이 0개인 이 화면이 상한에 닿는 일은 없다.
  // 그래도 판정을 남겨 두는 것은 아래 안내가 그 갈래를 여전히 쓰기 때문이다(0개 화면에서
  // 상한 문구가 서는 일이 없다는 것 자체가 결정 23이 바꾼 것이다).
  const full = atCap(state, owner);
  const active = activeShellOf(state, owner);
  const notice = active ? (shellEndLabels(active)?.notice ?? null) : null;

  // 셸의 배경색. **색을 여기서 고르지 않는다** — xterm 테마의 정본은 `terminal-theme.ts`이고
  // (그 파일 머리말), 셸이 실제로 그리는 값과 어긋나면 아래 잉여 띠가 도로 보인다.
  // 설정을 구독하는 것은 밝게·어둡게를 바꾸면 이 칠도 따라와야 해서다(결정 52가 이미 떠 있는
  // 셸을 따라오게 하는 것과 같은 몫).
  const shellBackground = useStore(
    terminalSettingsStore,
    (settings) => terminalThemeFor(terminalLook(settings).theme).background,
  );

  return (
    // 상자는 여백을 갖지 않는다 — 아래 셸의 집이 결정 94를 그대로 지켜야 한다.
    // `relative`는 셸이 0개일 때 덮는 안내와 죽은 셸의 안내를 이 영역 안에 세우기 위한
    // 것이다. **위에 형제가 없다**(결정 1) — 종료 줄이 흐름에서 빠지면서 프래그먼트도
    // 함께 걷혔고, 이 상자가 머리행 바로 아래에서 시작한다.
    <div className="relative flex min-h-0 min-w-0 flex-1">
      {/* 셸이 들어앉는 자리. **여백이 0인 것이 결정 94다** — 셸 화면에서 여백은 빈 배경이라
          창이 좁을수록 손해가 크고, 그만큼 `cols`가 줄어든다. spec 본문의 거터(`px-12`)는
          읽는 글이라 그대로 둔다.

          표식은 검사가 이 상자를 **정체성으로** 집기 위한 것이다 — 한때 「마크업의 마지막
          빈 div」라는 자리로 집었는데, 이 컴포넌트에 무엇 하나만 더 그려지면 그 판정이
          결정 94와 무관하게 깨진다. 아래 안내가 정확히 그 「무엇 하나」다.

          **칠하는 이유가 결정 1의 아래쪽 절반이다.** FitAddon이 `rows`를 내림으로 재서
          (`floor(높이 / 셀높이)`) 셸 화면 아래에 한 셀보다 작은 잉여가 남는다 — 실측 16px
          (자리 676px, 셀 20px, 33행 = 660px). 그 자리는 xterm이 안 그리므로 앱 배경이 비쳐
          띠가 된다. 창 높이가 바뀌면 잉여도 0~19px에서 함께 바뀌므로 「16px」을 값으로 어디에도
          적어 두지 않는다. 셀 높이를 억지로 늘려 잉여를 없애는 안은 글꼴을 흔들어서 안 쓴다.
          **셸이 있을 때만 칠한다** — 0개인 화면까지 칠하면 결정 102의 안내가 커다란 어두운
          판 위에 서고, 그 화면에는 덮을 잉여도 없다. */}
      <div
        ref={hostRef}
        data-shell-host=""
        className="min-h-0 min-w-0 flex-1"
        style={activeId === null ? undefined : { backgroundColor: shellBackground }}
      />
      {/* 죽은 셸의 한 문장(결정 22·45). **흐름에 끼지 않고 셸 위에 겹쳐 뜬다**(결정 1).
          흐름에 끼면 — 조건부로든 `h-5`로 자리를 늘 잡아 두든 — 이 20px이 그대로 셸 위쪽
          띠가 된다: 조건부는 뜨는 순간 컨테이너가 낮아져 ResizeObserver가 셸을 한두 행
          줄이고, 고정 높이는 안내가 없는 평소에도 빈 띠로 남는다. 겹쳐 두면 둘 다 없다.

          **자리는 그대로 맨 위 20px이다** — 사람이 이 문장을 찾던 자리가 거기다. 대가는
          죽은 셸 화면의 첫 행이 가려지는 것이고, 그 행은 스크롤로 되찾을 수 있다.

          바탕을 앱 배경으로 두는 것은 지금 모습을 그대로 두려는 것이다: 이 줄은 예전에도
          앱 배경 위의 `text-muted-foreground`였다. 바탕 없이 셸 위에 얹으면 `#55555e`가
          다크 셸 바탕 `#1e1e1e` 위 2.4:1로 묻힌다.

          `pointer-events-none` — 겹친 만큼 xterm이 포인터를 잃으면 안 된다. */}
      {notice !== null && (
        <div
          data-shell-notice=""
          className="pointer-events-none absolute inset-x-0 top-0 h-5 bg-background text-[12px] text-muted-foreground"
        >
          {notice}
        </div>
      )}
      {/* **셸이 0개인 화면이 실재한다**(결정 102). 정상 종료한 셸이 목록에서 스스로 빠지고
          (결정 48), 마지막 칸을 `×`로 닫은 자리에서는 새 셸이 저절로 뜨지 않는다.

          **여기 여는 자리가 있었고, 걷었다**(결정 19). 결정 102가 `+ 새 셸` 행이 든 목록을
          이 자리에 세운 근거는 「탭 줄이 걷힌 뒤로 본문에서 셸을 여는 길이 여기뿐이다」
          하나였는데, 판 03이 그 줄을 되살리며 근거가 사라졌다 — 남겨 두면 한 화면에 같은
          일을 하는 버튼이 둘이 되고, 그것을 이 저장소는 두지 않는다(결정 89가 `</>`를
          패널이 열렸을 때 열 머리에서 뺀 것과 같은 규칙).

          **그렇다고 빈 채로 두지 않는다.** 여는 법이 화면 밖(머리행)에 있으므로 아무 말도
          없는 빈 판은 「아직 없다」가 아니라 **고장**으로 읽힌다. 그래서 남는 것은 조작이
          아니라 **비었다는 표시와 여는 법** — Works의 「아직 작업이 없어요」와 같은 관용구다.

          **잠긴 이유는 여기서도 문장이다**(결정 45·47). 상한은 앱 전체라(결정 30) 이 화면의
          셸이 0개인데도 닿아 있을 수 있고, 그때 탭 줄의 `+`는 잠긴 채 이유를 hover `title`
          뒤에 숨긴다. 문장은 `shellCapNotice`가 짓는다 — ⌘T 거절 토스트·잠긴 `+`와 **같은
          문장**이어야 한쪽만 늙지 않는다.

          **덮개인 것은 그대로다**(`absolute inset-0`) — 흐름에 끼면 셸의 집 상자가 이 판의
          유무에 따라 달라지고, 셸이 뜨는 순간 xterm이 다시 흐른다(위 안내 줄과 같은 이유). */}
      {shells.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center p-10">
          <div className="flex max-w-[420px] flex-col items-center gap-[7px] text-center">
            {/* 글리프는 nav `Terminal`과 **같은 것**이다 — 이 빈 화면이 무엇의 빈 화면인지를
                한 번에 잡게 한다. 상자 규격은 Works의 빈 화면 그대로다. */}
            <div className="mb-2.5 flex size-[46px] items-center justify-center rounded-[16px] border bg-inset text-tertiary">
              <SquareTerminal className="size-5" strokeWidth={1.6} />
            </div>
            <span className="text-[16.5px] font-semibold tracking-[-0.01em]">아직 셸이 없어요</span>
            <span className="text-[14px] leading-[1.65] text-tertiary">
              {full
                ? `${shellCapNotice(state, owner)}. 이 화면의 셸을 하나 닫으면 새로 열 수 있어요.`
                : "위 탭 줄의 + 로 새 셸을 열어요."}
            </span>
            {/* 키는 **잠겼을 때 안 적는다** — 눌러도 안 되는 길을 알려 주는 것이 된다.
                `<code>` 규격은 Works의 빈 화면이 안내 문구를 싣는 자리와 같다. */}
            {!full && (
              <code className="mt-3 rounded-[10px] border bg-inset px-3 py-2 font-mono text-[12.5px] text-muted-foreground">
                ⌘T
              </code>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Work가 없으면 최상위 터미널이다 — 그 자리는 백엔드의 데이터 루트다(결정 25).
 *
 * **프로젝트를 안 받는다.** 한때 받았다 — 이 본문이 셸을 여는 자리를 갖고 있어서
 * 「어느 워크트리에」를 물어야 했다(결정 24). 결정 19가 그 자리를 탭 줄로 보내면서
 * 여기 남은 부름은 「없으면 하나 띄운다」 하나가 됐고, 그것은 늘 안 고른 자리에서 뜬다.
 */
function originOf(work: WorkView | null): ShellOrigin | null {
  return work ? workShellOrigin(work, null) : TOP_TERMINAL;
}

export default TerminalPane;

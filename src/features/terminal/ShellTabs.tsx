import { memo, useEffect, useMemo, useRef, useState } from "react";
import { File, LoaderCircle, Plus, SquareTerminal, X } from "lucide-react";
import { agentMarkOf } from "@/components/ui/agent-mark";
import { cn } from "@/lib/utils";
import ShellPicker from "./ShellPicker";
import {
  activeIdOf,
  atCap,
  runningOn,
  shellCapNotice,
  shellEndLabels,
  shellRowName,
  shellsOf,
} from "./shell-registry";
import type { Shell, ShellsState } from "./shell-registry";

/**
 * 탭 줄 맨 앞에 고정으로 서는 문서 칸(결정 7·8).
 *
 * `on`은 **본문이 문서인가**이지 마지막으로 누른 칸이 아니다 — 분할이면 이것과 `showing`이
 * 함께 참이고, 그때 켜진 칸이 둘이다(결정 12).
 */
export interface SpecTab {
  on: boolean;
  onSelect: () => void;
}

interface ShellTabsProps {
  /**
   * **앱 전체 상태다 — 이 줄의 것만 걸러서 받지 않는다.** 좁혀 받으면 `owner`가 뜻을
   * 잃는다: 이 줄은 그 값으로 그릴 칸도 고르고 **켜진 칸도** 찾는데(`activeIdOf`),
   * 그것들은 소유자별 표를 앱 전체 상태에서 읽는다. 상한은 이제 화면마다이고
   * (결정 23) `atCap`이 `owner`를 함께 받아 이 화면만 센다.
   */
  state: ShellsState;
  /** 이 줄이 그리는 화면. 최상위 터미널은 `null`이다. */
  owner: string | null;
  /** 이 Work의 프로젝트들. 둘 이상이면 `+`가 어디에 띄울지 물어본다(결정 24). */
  projects: string[];
  /**
   * 맨 앞에 고정으로 서는 `spec` 칸 — **`null`이면 셸부터 선다**(결정 8).
   *
   * **화면마다 갈리는 것이 이 한 칸뿐이다.** `shellForNav`가 `firstKey`로 같은 비대칭을
   * 이미 들고 있다: work 화면은 ⌘1이 spec이라 셸이 2부터고, `/terminal`은 문서가 없어
   * 1부터다. 여기서 갈래를 하나 더 만들지 않고 그 모양을 그대로 받는다.
   *
   * `on`은 **본문이 문서인가**이지 마지막으로 누른 칸이 아니다 — 분할이면 이것과 아래
   * `showing`이 함께 참이고, 그때 켜진 칸이 둘이다(결정 12).
   */
  spec: SpecTab | null;
  /**
   * **본문이 이 화면의 셸을 보여주는가.** 켜진 칸 표시를 그때만 준다.
   *
   * `activeIdOf`는 그 화면의 **기억**이지 지금 본문이 아니다 — 문서를 읽는 중에도 값이
   * 남아 있어서, 그것만 보고 칸을 켜면 「지금 보고 있는 것」이 한 화면에 둘이 된다.
   * 사이드바 셸 목록이 걷히기 전까지 같은 이름의 prop이 같은 것을 갈랐다.
   */
  showing: boolean;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
  onOpen: (project: string | null) => void;
  /**
   * 이 줄의 칸을 본문 위로 끌 수 있다면(결정 12) — 떨구면 화면이 좌우로 갈린다.
   *
   * 맨 앞 문서 칸은 `null`, 셸 칸은 그 셸의 id다. **갈래를 새로 만들지 않는다** —
   * `DragSource`가 `shellId`로 이미 그 둘을 가르고 있고(「`kind`가 `shell`일 때만 있다」)
   * 여기서 그 타입을 이름으로 부를 수 없을 뿐이다.
   *
   * **없으면 안 끌린다.** 떨굴 자리인 분할은 work 화면의 것이라 `/terminal`은 이 콜백을
   * 주지 않는다.
   *
   * **드래그 모듈을 여기서 import하지 않는다.** 이 파일이 `features/works`를 **값으로**
   * import하는 순간 `terminal → works` 방향이 값 차원에서 처음 생겨(지금까지는
   * `import type`뿐이었다) 반대 방향과 맞물린다. 만드는 것은 양쪽을 이미 아는
   * 화면(WorksPage)이 한다 — 걷히기 전 사이드바 셸 목록도 같은 이유로 같은 우회를 썼다.
   */
  onDragTab?: (shellId: number | null, from: { clientX: number; clientY: number }) => void;
  /**
   * 오른쪽 끝에 **고정되는** 조작(결정 10). 탭은 왼쪽부터 차므로 탭 개수가 변해도 이것들의
   * 자리가 안 움직인다.
   *
   * 무엇이 오는지는 화면이 정한다 — work 화면은 상태 배지·ⓘ·⋯·분할·패널 열기이고,
   * 그중 셋은 이 모듈이 알 수 없는 `features/works`의 것이다.
   */
  actions?: React.ReactNode;
  /** 사이드바가 접혀 이 줄이 창 왼쪽 끝에 붙을 때 — 신호등을 피한다. */
  inset?: boolean;
}

// 화면 머리행의 **가로 탭 줄**(결정 7·8·10). `[spec][셸…][+]`가 왼쪽부터 차고 오른쪽 끝에
// 조작이 고정된다. 셸을 고르는 자리가 사이드바 가지에서 화면 안으로 되돌아온 것이다(adr-03).
//
// **새 순서를 발명하지 않는다.** ⌘1~9가 이미 이 순서를 세고 있어서(work 화면은 ⌘1이 spec,
// ⌘2~9가 셸 — `shell-registry.ts`의 `shellForNav`) 이 줄이 하는 일은 키보드가 이미 아는
// 순서를 눈에 보이게 하는 것뿐이다. 화면에 보이는 순서와 ⌘1~9가 고르는 것이 어긋나면
// 이 줄이 한 일이 없다.
//
// **이 줄은 늘 타이틀바를 겸한다.** 한때 같은 이름의 컴포넌트가 있었고 그것은 겸하는지를
// `titlebar` prop으로 갈랐는데(그 화면이 `/terminal` 하나였다), 이제 두 화면 다 머리행이
// 이 줄이다 — 그래서 44px 층 높이·창 드래그 영역·신호등 회피 여백이 조건이 아니라 성질이다.
// 여백의 곡선이 `ease-panel`인 것은 사이드바 폭 트랜지션과 같아야 하기 때문이다(PageHeader와
// 같은 근거 — index.css의 `--panel-ease`).
//
// **셸도 xterm도 여기 없다** — 상태와 콜백만 받는 그림이라 DOM 없는 기본 환경에서
// renderToStaticMarkup으로 그대로 검사된다(ShellTabs.test.tsx). terminal-store를 import하면
// 그 성질이 사라진다: `@xterm/*`와 그 CSS가 따라 들어온다. 구독은 화면(WorksPage)이 한다 —
// 사이드바 목록도 같은 계약을 지고 있고(`SidebarWorkList.test.tsx`가 리터럴로 센다), 걷힌
// 셸 목록·가지도 그랬다.
function ShellTabs({
  state,
  owner,
  projects,
  spec,
  showing,
  onSelect,
  onClose,
  onOpen,
  onDragTab,
  actions,
  inset = false,
}: ShellTabsProps) {
  // 상한은 **앱 전체**, 그리는 것은 **이 화면**이다. 두 값이 같은 상태에서 다른 범위로
  // 나오는 것이 결정 30의 전부다.
  const full = atCap(state, owner);
  const shells = shellsOf(state, owner);
  const activeId = activeIdOf(state, owner);

  // 칸에 내려보내는 콜백을 **회차를 넘어 같은 것으로** 만든다(#140). `ShellTab`이 `memo`라
  // 여기서 회차마다 새 화살표를 주면 그 경계가 아무것도 안 막는다 — 부르는 쪽(WorksPage)이
  // `onSelect`·`onDragTab`을 인라인 화살표로 주는데, 그 자리를 고치는 대신 이 줄이 계약을
  // 진다: 콜백이 안정적이어야 한다는 것은 **이 컴포넌트의 성질**이지 부르는 쪽이 기억해야
  // 할 규칙이 아니고, 규칙으로 두면 다음에 인라인 화살표 하나가 조용히 되돌린다.
  //
  // 최신 값을 ref로 읽는다. 이 셋은 **이벤트에서만** 불리므로(클릭·포인터다운) 그리는
  // 중에 읽히지 않고, 따라서 지난 회차의 클로저가 남지 않는다.
  const latest = useRef({ onSelect, onClose, onDragTab });
  latest.current = { onSelect, onClose, onDragTab };
  const tabHandlers = useMemo(
    () => ({
      onSelect: (id: number) => latest.current.onSelect(id),
      onClose: (id: number) => latest.current.onClose(id),
      onDragTab: (id: number, from: { clientX: number; clientY: number }) =>
        latest.current.onDragTab?.(id, from),
    }),
    [],
  );

  // 프로젝트가 여럿인 Work에서만 `+`가 묻는다. 앵커가 그 버튼이라 여기 산다.
  const asks = projects.length > 1;
  const plusRef = useRef<HTMLButtonElement>(null);
  const [picking, setPicking] = useState(false);

  // 줄이 넘치면 **켜진 칸이 화면 밖에 있을 수 있다**(결정 20). ⌘1~9는 안 보이는 칸도
  // 고르므로(`shellForNav`는 폭을 모른다) 고른 칸이 안 보이면 「눌렀는데 아무 일도 없다」로
  // 읽힌다. 넘치지 않는 폭에서는 아무 일도 안 하는 호출이다.
  //
  // 켜진 칸을 **속성 하나를 새로 만들지 않고** 집는다 — 이름 버튼의 `aria-pressed`가 이미
  // 그것을 말하고, 이 상자 안에서 참인 것은 하나뿐이다(분할일 때 함께 켜지는 `spec`은
  // 이 상자 밖에 산다).
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    stripRef.current
      ?.querySelector<HTMLElement>('button[aria-pressed="true"]')
      ?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeId, showing]);

  return (
    <header
      // 이 줄이 창 맨 위다 — 없으면 **창을 못 끈다**. 안쪽 버튼들은 이 속성이 없으므로
      // 그대로 눌린다(PageHeader가 브레드크럼에 쓰는 방식과 같다).
      data-tauri-drag-region
      className={cn(
        // 아래 경계선이 없다 — 화면이 선으로 잘리지 않고 본문으로 이어진다(PageHeader와 같다).
        "flex h-(--titlebar-height) shrink-0 items-center gap-1 pr-4 transition-[padding] duration-[220ms] ease-panel",
        // **왼쪽 여백은 두 경우가 같은 값을 쓴다**(결정 24 · index.css의 `--tab-lead`).
        // 접혔으면 셸 컨트롤에서, 펼쳤으면 사이드바 경계선에서 재는 것뿐이고 거리는 하나다 —
        // 갈라 두면 ⌘B로 접었다 펴는 동안 첫 칸이 두 리듬으로 움직인다.
        inset ? "pl-(--titlebar-inset-tabs)" : "pl-(--tab-lead)",
      )}
    >
      {/* 맨 앞 고정 칸. **`×`가 없다**(결정 7) — 문서로 돌아가는 자리가 셸 개수와 무관하게
          고정된다. ⌘W가 여기서 아무 일도 안 하는 것(결정 13)이 같은 말이다.

          닫는 버튼이 없어 칸이 버튼 하나로 끝나므로 켜짐 표시(`toggle-on`)와 그것을 말하는
          속성(`aria-pressed`)이 **같은 요소**에 붙는다. 아래 셸 칸은 형제 버튼 둘이라
          그럴 수 없다 — 그쪽 주석이 이유를 든다.

          글리프는 한때 사이드바에 있던 `spec` 줄이 쓰던 `File` 그대로다 — 판 04가 그 줄을
          걷어(결정 6) 지금은 이 칸이 문서를 고르는 유일한 자리다. 라벨이 소문자 영어인 것은
          CONTEXT.md다 — 「무엇을 볼까」를 고르는 것들의 한 가족(`spec`·`info`)이다. */}
      {spec && (
        <button
          type="button"
          data-tab="spec"
          aria-pressed={spec.on}
          onClick={spec.onSelect}
          // 본문 위로 끌면 그 절반에 문서가 선다(결정 12) — 사이드바의 `spec` 잎이 하던
          // 몫이 이 칸으로 왔다. **누르는 것과 끄는 것이 한 버튼에 산다**: 5px 문턱이
          // 둘을 가르므로(`armDrag`) 문턱 안쪽의 눌림은 그냥 클릭이다.
          onPointerDown={onDragTab && ((event) => onDragTab(null, event))}
          className={cn(
            // **이 칸은 안 줄어든다**(결정 20). 고정 탭이라 이름이 `spec` 넉 자로 고정이고,
            // 줄일 것이 애초에 없다 — 그런데 `shrink`가 살아 있으면 넘칠 때 flex가 **폭에
            // 비례해서** 깎아, 좁은 칸(66px)과 셸 칸(180px)이 나란히 6할씩 잃는다. 그러면
            // 이 칸이 글리프도 못 담는 27px가 되면서 정작 셸 칸은 73px로 멀쩡하다.
            // 줄어드는 것을 셸 칸 여덟으로 몰아 두는 것이 「균등」이 성립하는 조건이다.
            //
            // **꺼져도 상자가 있다**(결정 25). 셸 칸은 꺼지면 글자만 남는데 이 칸은 눌린 자리에
            // 앉아 있어, 「늘 거기 있는 것」이 그 차이로 읽힌다 — 옆의 세로선이 「묶음이 다르다」를
            // 말하고 이 상자가 「종류가 다르다」를 말한다.
            //
            // 여백이 7·9px인 것은 **테두리 1px을 물린 값**이다(8·10에서 각 1px). 안 물리면 이
            // 칸만 2px 넓어져 라벨이 셸 칸의 첫 글자와 어긋난다.
            //
            // hover가 `bg-state-1`이 아니라 `quiet-hover`인 것은 **바탕이 생겼기 때문이다** —
            // state-1(3%)은 inset보다 옅어서 hover에 칸이 오히려 밝아진다. quiet-hover는 한 단계
            // 진해지고(state-2) 글자색까지 함께 가며, 그 유틸리티의 계약대로 **꺼진 가지 안에만**
            // 있다(index.css의 경고 — toggle-on과 겹치면 hover 규칙이 두 벌이 된다).
            "flex h-7 min-w-0 shrink-0 items-center gap-1.5 rounded-[8px] border pl-[7px] pr-[9px] text-[12.5px] transition-colors",
            spec.on
              // 켜지면 **테두리를 지운다.** inset과 toggle-on의 농도 차가 작아 그것만으로는
              // 「지금 문서를 보고 있나」가 흐려진다 — 두 상태가 농도뿐 아니라 테두리의
              // 있고 없음으로도 갈린다. 켜짐을 말하는 어휘는 그대로 하나다
              // (`aria-pressed` + `toggle-on`).
              ? "toggle-on border-transparent font-medium"
              : "bg-inset text-muted-foreground quiet-hover",
          )}
        >
          <File className="size-3.5 shrink-0" strokeWidth={1.8} />
          <span className="min-w-0 truncate">spec</span>
        </button>
      )}

      {/* `spec`와 셸 칸 **사이**의 세로선(결정 25). 말하는 것은 「묶음이 다르다」 하나다 —
          왼쪽은 고정된 한 칸이고 오른쪽은 스크롤하는 상자다. 종류가 다르다는 말은 위 칸의
          바탕이 따로 한다.

          **`spec`가 있을 때만 선다.** `/terminal`에는 그 칸이 없어(결정 8) 가를 것이 없는데,
          조건 없이 두면 그 화면에서 줄 맨 앞에 이유 없는 선 하나가 남는다.

          창을 끄는 자리를 뺏지 않는다 — 이 줄은 타이틀바를 겸하므로(머리말) 속성이 없는
          자식은 그만큼 죽은 자리가 된다. 아래 `min-w-4 flex-1` 여백과 같은 이유다. */}
      {spec && (
        <span
          aria-hidden
          data-tauri-drag-region
          data-tab-rule
          // 좌우 2px이다 — 줄의 gap 4px과 합쳐 8px씩 벌어진다. 더 벌리면 **900px 창에서 줄이
          // 넘친다**(결정 20의 산술이 이 선까지 센다: mx-1이면 1px 모자랐다, 실측).
          className="mx-0.5 h-[18px] w-px shrink-0 bg-border-strong"
        />
      )}

      {/* 셸 칸만 **가로로 스크롤한다**(결정 20). `spec`·`+`·조작은 이 상자 밖이라 자리가
          고정이고, 줄이 넘치는 몫은 이 상자 하나가 받는다 — 형제가 모두 `shrink-0`이고
          여기에만 `min-w-0`이 있어서다. 그래서 **머리행 자체는 넘치지 않는다**: 조작이
          창 밖으로 밀려나던 것이 그것 때문이었다.

          칸은 그 전에 먼저 균등하게 줄어든다(결정 11). 스크롤은 여덟 칸이 다 최소 폭에
          닿은 **뒤**의 마지막 수단이고, 거기서 더 줄일 것이 없는 이유는 산술이다 —
          여덟 칸이 최소 폭이어도 `44×8 + gap 28 = 380`이고, 그 옆에 자리가 고정된 것들
          (`spec` · 세로선 · `+` · 끄는 여백 · 조작 · 줄 사이 gap · 좌우 패딩)이 이어 선다.
          그런데 창이 더 작아질 수 없는 900px에서 이 줄이 받는 폭은 **290px뿐이다**
          (사이드바 280과 작업 패널 330을 뺀 나머지 — **줄의 폭은 창 폭이 아니다**). 둘을 각자의
          최소로 좁혀도 400px이라, 어떤 최소 폭을 골라도 여덟 칸은 안 들어간다.

          **합을 여기 숫자로 안 적는다.** 이 자리에 손으로 더한 수가 세 번 적혔고 세 번 다
          틀렸다(569 → 657 → 685 — 항을 빠뜨리거나 더했다 다시 뺐다). 그 합은
          `e2e/terminal-tabs.spec.ts`가 세 폭에서 실제로 재고 `spill ≤ 0`으로 든다 —
          지금 900px에서 여유가 3.5px이라, 이 줄에 고정된 것을 늘리면 그만큼만 남는다.

          **스크롤 막대를 숨긴다.** 이 저장소의 `scroll-quiet`은 11px 막대를 세우는데,
          44px 타이틀바에서는 그만큼 칸이 눌린다. 닿는 길은 트랙패드 가로 스크롤과
          ⌘1~9다(위 이펙트가 켜진 칸을 끌어온다). */}
      <div
        ref={stripRef}
        // 표식이 `data-tab`이 아니라 `data-tab-strip`인 것은 검사가 `data-tab="`로 칸을
        // 잘라내기 때문이다 — 같은 이름을 쓰면 상자가 칸 하나로 세어진다.
        data-tab-strip
        className="flex w-max min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {shells.map((shell) => (
          <ShellTab
            key={shell.id}
            shell={shell}
            active={showing && shell.id === activeId}
            onSelect={tabHandlers.onSelect}
            onClose={tabHandlers.onClose}
            // 없으면 안 끌린다(위 prop 주석) — 그 갈래를 여기서 유지한다. 값은 둘 다
            // 회차를 넘어 같으므로 `memo`의 얕은 비교가 이 자리에서 안 어긋난다.
            onDragTab={onDragTab && tabHandlers.onDragTab}
          />
        ))}
      </div>

      {/* 잠긴 이유가 `title`(hover) 뒤에 있다. 결정 47이 세로 목록에서 그 문장을 꺼내 보이는
          글자로 쓴 것과 **같은 근거가 반대 방향을 가리킨다** — 그때의 이유는 「`+`가 행이
          되면서 글자를 넣을 폭이 생겼다」였고, 칸 하나에는 그 폭이 없다.

          work 화면에서는 그것이 유일한 통로도 아니다: ⌘T가 거절당하면 스토어가 낸 같은
          문장을 화면이 토스트로 말한다(결정 47).

          이 저장소의 잠근 버튼 관용구(disabled + pointer-events-none)를 쓰지 않는다 —
          pointer-events-none은 hover 자체를 막아 **그 title이 안 뜬다**(ShellControls.tsx의
          주석이 이미 적어 둔 함정이다). aria-disabled + 클릭 무시다. */}
      <button
        ref={plusRef}
        type="button"
        data-tab="new"
        aria-label="셸 열기"
        aria-disabled={full || undefined}
        // 프로젝트를 묻는 `+`는 여는 버튼이 아니라 메뉴를 여는 버튼이다 — 눌렀는데 셸이
        // 안 뜨는 것이 정상인 유일한 경우라, 그 사실이 속성에 드러나야 한다.
        aria-haspopup={asks ? "menu" : undefined}
        aria-expanded={asks ? picking : undefined}
        title={full ? shellCapNotice(state, owner) : "셸 열기"}
        onClick={() => {
          if (full) return;
          if (asks) setPicking((open) => !open);
          else onOpen(null);
        }}
        className={cn(
          // 탭들에 **바짝 붙는다**. 줄의 gap 4px에 이 버튼의 좌우 여백 5px이 더해져 마지막
          // 칸의 `×`와 15px이 벌어지는데, 그 거리가 이 버튼을 탭의 꼬리가 아니라 따로 선
          // 조작으로 읽히게 한다(크롬의 `+`는 마지막 탭에 붙어 있다). 0으로 붙이지 않는
          // 것은 상자가 스크롤 중일 때 잘린 칸과 맞닿아 보이기 때문이다.
          "-ml-0.5 shrink-0 text-tertiary",
          full ? "icon-button opacity-40" : "icon-button-quiet",
        )}
      >
        <Plus className="size-3.5" strokeWidth={1.8} />
      </button>

      {/* 탭과 조작 사이의 남는 자리. **이 줄에서 가장 넓은 끄는 자리다** — 속성이 빠지면
          「창이 가끔만 끌린다」가 되는데 화면으로는 어느 자리가 죽었는지가 안 보인다.
          `min-w-4`는 칸이 꽉 찼을 때도 `+`와 조작이 맞붙지 않게 남기는 값이다. */}
      <span data-tauri-drag-region className="min-w-4 flex-1" />

      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}

      {picking && (
        <ShellPicker
          anchorRef={plusRef}
          projects={projects}
          onPick={(project) => {
            setPicking(false);
            if (project) onOpen(project);
          }}
        />
      )}
    </header>
  );
}

interface ShellTabProps {
  shell: Shell;
  /** 본문이 지금 이 셸을 보여주는가. 켜진 칸 표시가 그때만 선다. */
  active: boolean;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
  onDragTab?: (id: number, from: { clientX: number; clientY: number }) => void;
}

// 칸 하나. **`memo`인 것이 이 파일의 계약 하나다**(#140).
//
// 셸은 프롬프트마다 OSC 타이틀을 쏘고 `claude`는 도는 동안 계속 갈아 끼운다(adr-04).
// 그때마다 갈리는 것은 **그 셸 객체 하나**이고(`patch`가 안 바뀐 셸에는 같은 객체를 준다),
// 화면의 구독은 `sameBranch`가 이미 남의 work을 걸러 낸다. 남은 마지막 한 겹이 여기다 —
// 이 경계가 없으면 한 칸의 타이틀 한 번에 여덟 칸의 그림이 전부 다시 돈다.
//
// **비교는 기본 얕은 비교다.** 직접 쓴 비교 함수는 콜백을 빼고 보게 되는데, 그러면 칸이
// 예전 회차의 클로저를 쥔 채 남는다. 대신 부르는 쪽이 회차마다 새 화살표를 줘도 되도록
// `ShellTabs`가 콜백을 한 번만 만들어 내려보낸다(`tabHandlers`).
const ShellTab = memo(function ShellTab({
  shell,
  active,
  onSelect,
  onClose,
  onDragTab,
}: ShellTabProps) {
  // 결정 18. 이름을 정하는 자리는 앱에서 이 함수 하나다 — 프로젝트가 여럿인 work에서만
  // 앞에 프로젝트가 붙으므로 대부분의 칸은 타이틀만 적는다. 셋 중 하나를 **골라서**
  // 적던 `shellLabel`은 되살리지 않는다: 타이틀이 오는 순간 어느 워크트리의 셸인지가
  // 사라지는 실물 사고를 냈고 사용처가 0이 되어 지워졌다(결정 104).
  const name = shellRowName(shell);
  const end = shellEndLabels(shell);
  // 결정 4 — **탭 줄은 칸마다**다. 사이드바가 종류만 말하는 것(`runningKindsOf`)과
  // 갈리는 자리이고, 여기서 줄 단위로 뽑으면 한 칸이 claude를 켜는 순간 모든 칸이
  // 갈린다. 판정도 표도 새로 짓지 않는다: 「끝난 칸은 아무것도 안 돈다」는 `runningOn`
  // 하나가 알고(`shell.running`을 직접 읽으면 죽은 칸에 로고가 굳는다), 이름→그림은
  // `agentMarkOf` 하나가 안다 — 사이드바 행과 갈리면 같은 상태가 두 말을 한다.
  const running = runningOn(shell);
  const mark = agentMarkOf(running);

  return (
    // 배경(켜짐·hover)은 이 바깥 상자가 갖는다. **가로 여백을 하나도 갖지 않는다** —
    // 바깥이 가진 padding은 두 버튼 어디에도 속하지 않아 배경은 덮이는데 눌러도 아무
    // 일이 없는 죽은 자리가 된다(커밋 c0978b1이 spec 트리에서 없앤 것).
    //
    // hover는 **꺼진 가지 안에만** 둔다. toggle-on이 자기 hover를 품으므로 함께 얹으면
    // 규칙이 두 벌이 되어 승자를 유틸리티 정렬 순서가 정한다(index.css의 경고).
    // 꺼진 칸이 `quiet-hover`(2)가 아니라 1인 것은 2가 **행이 선택된** 농도라서다 —
    // 꺼진 칸을 2로 밝히면 「선택됨」으로 읽힌다.
    //
    // **폭을 이름이 정하지 않는다**(결정 20). 칸마다 같은 폭을 주고 넘칠 때도 그 값에서
    // 깎이게 둔다 — flex가 넘친 폭을 기준 폭에 비례해 나누므로, 기준이 같으면 여덟 칸이
    // **같은 만큼** 줄어든다. 내용 폭으로 두면 도는 칸만 로고·스피너(30px)만큼 넓어지고,
    // 그보다 나쁜 것은 셸이 프롬프트마다 쏘는 OSC 타이틀에 칸 폭이 매달린다는 것이다 —
    // claude가 도는 동안 줄 전체가 계속 들썩인다.
    //
    // **`basis-[180px]`이 아니라 `w-[180px]`이다** — 이 칸이 `@container`라서다(실측).
    // `container-type: inline-size`는 「폭을 속으로 정하지 않는다」는 격리라, 이 칸의
    // 내재 폭이 0으로 계산되고 `min-w`만 남는다. 스크롤 상자가 그 내재 폭을 더해 제
    // 폭을 잡으므로, 기준을 `flex-basis`로만 주면 상자가 `44×칸수`로 잡혀 **칸이 늘
    // 최소 폭에 붙는다**(한 칸일 때도 44px였다). `width`로 주면 폭이 정해진 값이라
    // 격리와 무관하게 서고, flex는 그것을 기준으로 깎는다.
    //
    // 폭의 세 수는 한 뺄셈에서 나온다: 이름 버튼 좌우 여백 14 + 로고·스피너 30 + 닫기 24.
    // `min-w-[44px]`가 **아이콘만 남은 칸**(14+30)이고, 아래 두 문턱이 거기에 닫기와
    // 이름을 얹은 폭이다. **여기가 바닥이고 그 아래는 스크롤이다**(결정 20) — 한때
    // 이 자리에 「여덟 칸이 최소 폭이어도 900px 창에 여유가 남는다」고 적혀 있었는데,
    // 그것은 창 폭을 잰 것이었다. 이 줄이 받는 폭은 창에서 사이드바와 작업 패널을
    // 뺀 나머지다(위 스크롤 상자 주석의 산술).
    //
    // `@container`가 **칸마다 자기 폭을 재게** 한다. 줄(header)을 재면 안 되는 것은 한
    // 칸의 폭이 줄 폭이 아니라 `줄 폭 ÷ 칸 수`이고 칸 수를 CSS가 모르기 때문이다.
    // `container-type: inline-size`가 내용으로 폭을 정하는 길을 막지만 여기서는 손해가
    // 아니다 — 이 칸의 폭은 이미 flex가 정한다.
    <div
      data-tab="shell"
      className={cn(
        "@container flex h-7 w-[180px] min-w-[44px] shrink items-center rounded-[8px] text-[12.5px] transition-colors",
        active ? "toggle-on font-medium" : "text-muted-foreground hover:bg-state-1",
      )}
    >
      {/* 켜짐을 `aria-pressed`로 말한다 — **`role="tab"`/`aria-selected`를 쓰지 않는다.**
          분할 중에는 켜진 칸이 둘인데(결정 12) tablist에서 selected가 둘이면 잘못된
          ARIA다. 그리고 이 저장소는 켜짐을 이미 `aria-pressed`+`toggle-on`으로 말하고
          있어(분할 토글·소스 토글) 새 어휘를 들이면 화면 안에서 말이 두 벌이 된다.

          이름 버튼이 자기 오른쪽 여백까지 품는다. h-full은 칸 높이 전체가 눌리게 한다 —
          items-center는 자식을 내용 높이로 줄인다.

          gap-1.5가 로고·스피너와 이름 사이를 벌린다(결정 4). */}
      <button
        type="button"
        aria-pressed={active}
        onClick={() => onSelect(shell.id)}
        // 끄는 자리가 **이름 버튼**이다(결정 12) — 형제인 `×`가 끌리면 닫으려다
        // 분할이 켜진다. 걷히기 전 사이드바 셸 행도 같은 자리에 같은 모양으로 걸었다.
        onPointerDown={onDragTab && ((event) => onDragTab(shell.id, event))}
        // 이름이 숨은 폭에서는 글리프를 **가운데로** 보낸다 — 왼쪽에 붙여 두면 오른쪽
        // 절반이 빈 칸으로 보여 「비었다」와 「아이콘만 남았다」가 같아진다.
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-2 pr-1.5 text-left @max-[88px]:justify-center"
      >
        {/* 이름 **앞**에 서고 `shrink-0`이다 — 줄어드는 것은 옆의 이름(`truncate`)
            뿐이라, 균등 축소가 오는 뒤 티켓에서 「로고와 스피너는 끝까지 남는다」
            (결정 11)를 지킬 자리가 여기 이미 잡혀 있다.

            **로고와 스피너를 나란히 세운다** — 겹치는 안은 기각했다: 로고 없이 도는
            칸(모르는 명령)에 빈 고리만 남고, 14px 실루엣 위의 고리는 이 줄의 아이콘
            규격(size-3.5)을 넘긴다.

            **바깥 조건이 `mark`가 아니라 `running`이다.** 아는 에이전트가 아니어도
            「그 칸이 일하는 중」은 참이고, 그 사실이 이 판이 답하려는 물음이다 —
            로고에 매달면 `cargo`가 도는 칸이 노는 칸과 똑같아 보인다. 모르는 것에
            물음표를 세우지 않는 것(결정 4)은 그대로다: 그때는 스피너만 돈다.

            색을 안 준다. 로고는 `currentColor`라야 다크·라이트 둘 다 살고(결정 15)
            스피너도 같은 색이라야 둘이 한 덩어리로 읽힌다 — 켜진 칸에서는 toggle-on
            글자색을 그대로 받는다(죽은 칸의 꼬리표가 자기 색을 박는 것과 반대 방향
            이고, 그쪽은 「꺼진 것」을 말해야 해서 그렇다).

            글리프 svg가 `aria-hidden`이라(agent-mark의 계약) 이름을 따로 안 달면 도는
            칸이 **눈에만** 보인다. 이 저장소는 아이콘에 이름을 `aria-label`로 다는데
            그 자리가 늘 버튼이었고 여기는 버튼 **안**이라 `role="img"`을 함께 준다 —
            역할 없는 span의 `aria-label`은 읽히는 것이 보장되지 않는다.
            이름 버튼의 접근성 이름은 이름 **앞에** 이 한 마디가 붙는 것으로 끝난다
            (닫기 버튼은 `shellRowName`을 따로 딛으므로 그대로다). */}
        {running !== null && (
          <span
            role="img"
            aria-label={mark ? `${mark.label} 실행 중` : "명령 실행 중"}
            className="flex shrink-0 items-center gap-1"
          >
            {mark && <mark.Glyph className="size-3.5" />}
            <LoaderCircle className="size-3 animate-spin" strokeWidth={1.8} />
          </span>
        )}
        {/* **빈 칸을 만들지 않는다**(결정 20). 이름이 숨는 폭에서 로고가 없는 칸에는
            아무 글리프도 안 남아 칸이 텅 빈다 — 크롬에서 그 일이 없는 것은 파비콘이
            늘 있어서다. 그 폭에서만 서는 대체 글리프를 두어 자리를 채운다: 평소 폭에서는
            `hidden`이라 판 03이 세운 줄의 모습이 안 바뀐다.

            **로고가 돌거나 꼬리표가 있으면 안 선다** — 그 자리를 이미 먹고 있어서다.
            글리프가 사이드바 둘째 줄이 셸 수 옆에 쓰는 것과 같은 `SquareTerminal`인 것은
            결정 4와 같은 규칙이다: 같은 것을 두 자리에서 다른 모양으로 그리면 한쪽이
            다른 종류의 것으로 읽힌다. */}
        {running === null && !end && (
          <SquareTerminal
            className="hidden size-3.5 shrink-0 @max-[88px]:block"
            strokeWidth={1.8}
          />
        )}
        {/* 좁아지면 **먼저 말줄임으로 줄고**(`truncate`), 이름 몇 글자도 못 세우는 폭에서
            자리를 비운다(결정 11). `hidden`이 아니라 `sr-only`인 것은 이름 버튼의
            접근성 이름이 이 글자 하나라서다 — `display:none`으로 지우면 좁은 창에서 그
            칸이 스크린리더에 「버튼」으로만 불린다. 자리는 안 먹고 이름은 남긴다. */}
        <span className="min-w-0 truncate @max-[88px]:sr-only">{name}</span>
        {/* 죽은 칸을 **누르지 않고** 알아보는 자리다(결정 17). 왜 죽었는지 한 문장은
            그 칸을 켰을 때 종료 줄이 말한다(결정 22 그대로) — 여기 `title`로 띄우는
            안은 기각됐다. 결정 45가 상한 문구를 `title`에서 꺼내 그 자리에 문장으로
            쓴 것과 정면으로 어긋난다.
            직접 선언한 색이라 켜진 칸의 toggle-on 글자색에 안 덮인다. */}
        {end && <span className="shrink-0 text-tertiary">{end.mark}</span>}
      </button>
      {/* 이름 버튼의 **형제**다. 중첩 button은 HTML에서 허용되지 않고, span
          role="button"으로 흉내내면 Tab으로 도달할 수 없다(SpecTree.test.tsx가 같은
          것을 지킨다). 셸을 죽이는 길은 여전히 확인을 거치는 하나다(결정 22·92) —
          부르는 쪽이 `requestCloseShell`을 준다. */}
      <button
        type="button"
        aria-label={`${name} 닫기`}
        title="셸 닫기"
        onClick={() => onClose(shell.id)}
        className={cn(
          "icon-button-quiet shrink-0 text-tertiary",
          // 크롬이 하는 그대로다(결정 20) — 좁아지면 **켜진 칸에만** 닫기가 남는다.
          // 여덟 칸에 24px씩 늘 세우면 스크롤이 그만큼 일찍 시작된다.
          // 켜진 칸도 68px(=14+30+24) 아래에서는 함께 접는다: 거기부터는 로고·스피너와
          // 닫기가 한 칸에 못 서고, 둘 중 남는 쪽은 로고다(결정 11). 그 폭에서 닫는
          // 길은 ⌘W다(결정 13) — 새로 만드는 길이 아니라 이미 있는 길이다.
          active ? "@max-[68px]:hidden" : "@max-[88px]:hidden",
        )}
      >
        <X className="size-3" strokeWidth={1.8} />
      </button>
    </div>
  );
});

export default ShellTabs;

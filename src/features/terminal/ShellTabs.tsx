import { useRef, useState } from "react";
import { File, LoaderCircle, Plus, X } from "lucide-react";
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
import type { ShellsState } from "./shell-registry";

interface ShellTabsProps {
  /**
   * **앱 전체 상태다 — 이 줄의 것만 걸러서 받지 않는다.** 걸러 받으면 `atCap`이 이 줄의
   * 길이를 세게 되고, 상한 8이 화면마다 8이 된다(결정 30). 그리는 것만 `owner`로 좁힌다.
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
  spec: { on: boolean; onSelect: () => void } | null;
  /**
   * **본문이 이 화면의 셸을 보여주는가.** 켜진 칸 표시를 그때만 준다.
   *
   * `activeIdOf`는 그 화면의 **기억**이지 지금 본문이 아니다 — 문서를 읽는 중에도 값이
   * 남아 있어서, 그것만 보고 칸을 켜면 「지금 보고 있는 것」이 한 화면에 둘이 된다.
   * `ShellList`의 같은 이름 prop이 같은 것을 가른다.
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
   * 주지 않는다 — `ShellList.onDragRow`와 같은 계약이다.
   *
   * **드래그 모듈을 여기서 import하지 않는다.** 이 파일이 `features/works`를 **값으로**
   * import하는 순간 `terminal → works` 방향이 값 차원에서 처음 생겨(지금까지는
   * `import type`뿐이었다) 반대 방향과 맞물린다 — `ShellBranch.onDragRow`가 같은 함정을
   * 적어 뒀다. 만드는 것은 양쪽을 이미 아는 화면(WorksPage)이 한다.
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
// `ShellList`·`ShellBranch`가 이미 같은 계약을 지고 있다.
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
  const full = atCap(state);
  const shells = shellsOf(state, owner);
  const activeId = activeIdOf(state, owner);

  // 프로젝트가 여럿인 Work에서만 `+`가 묻는다. 앵커가 그 버튼이라 여기 산다.
  const asks = projects.length > 1;
  const plusRef = useRef<HTMLButtonElement>(null);
  const [picking, setPicking] = useState(false);

  return (
    <header
      // 이 줄이 창 맨 위다 — 없으면 **창을 못 끈다**. 안쪽 버튼들은 이 속성이 없으므로
      // 그대로 눌린다(PageHeader가 브레드크럼에 쓰는 방식과 같다).
      data-tauri-drag-region
      className={cn(
        // 아래 경계선이 없다 — 화면이 선으로 잘리지 않고 본문으로 이어진다(PageHeader와 같다).
        "flex h-(--titlebar-height) shrink-0 items-center gap-1 pr-4 transition-[padding] duration-[220ms] ease-panel",
        inset ? "pl-(--titlebar-inset)" : "pl-4",
      )}
    >
      {/* 맨 앞 고정 칸. **`×`가 없다**(결정 7) — 문서로 돌아가는 자리가 셸 개수와 무관하게
          고정된다. ⌘W가 여기서 아무 일도 안 하는 것(결정 13)이 같은 말이다.

          닫는 버튼이 없어 칸이 버튼 하나로 끝나므로 켜짐 표시(`toggle-on`)와 그것을 말하는
          속성(`aria-pressed`)이 **같은 요소**에 붙는다. 아래 셸 칸은 형제 버튼 둘이라
          그럴 수 없다 — 그쪽 주석이 이유를 든다.

          글리프는 사이드바의 `spec` 잎과 같은 `File`이다. 같은 것을 두 자리에서 다른 모양으로
          그리면 한쪽이 다른 종류의 것으로 읽힌다. 라벨이 소문자 영어인 것은 CONTEXT.md다 —
          「무엇을 볼까」를 고르는 것들의 한 가족(`spec`·`terminal`·`info`)이다. */}
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
            "flex h-7 min-w-0 items-center gap-1.5 rounded-[8px] pl-2 pr-2.5 text-[12.5px] transition-colors",
            spec.on ? "toggle-on font-medium" : "text-muted-foreground hover:bg-state-1",
          )}
        >
          <File className="size-3.5 shrink-0" strokeWidth={1.8} />
          <span className="min-w-0 truncate">spec</span>
        </button>
      )}

      {shells.map((shell) => {
        const active = showing && shell.id === activeId;
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
          // `shrink`와 `min-w-0`이 함께 있어야 이름이 말줄임으로 줄고 줄을 넘기지 않는다.
          // 균등 축소의 나머지(좁으면 아이콘만 남기기 — 결정 11)는 뒤 티켓이 이 자리에 얹는다.
          <div
            key={shell.id}
            data-tab="shell"
            className={cn(
              "flex h-7 min-w-0 max-w-[180px] shrink items-center rounded-[8px] text-[12.5px] transition-colors",
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
              // 분할이 켜진다. `ShellList`의 셸 행이 같은 자리에 같은 모양으로 걸어 뒀다.
              onPointerDown={onDragTab && ((event) => onDragTab(shell.id, event))}
              className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-2 pr-1.5 text-left"
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
              <span className="min-w-0 truncate">{name}</span>
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
              className="icon-button-quiet shrink-0 text-tertiary"
            >
              <X className="size-3" strokeWidth={1.8} />
            </button>
          </div>
        );
      })}

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
        title={full ? shellCapNotice(state) : "셸 열기"}
        onClick={() => {
          if (full) return;
          if (asks) setPicking((open) => !open);
          else onOpen(null);
        }}
        className={cn("shrink-0 text-tertiary", full ? "icon-button opacity-40" : "icon-button-quiet")}
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

export default ShellTabs;

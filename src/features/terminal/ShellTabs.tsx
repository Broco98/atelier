import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PopoverPortal } from "@/components/ui/popover-portal";
import { activeIdOf, atCap, MAX_SHELLS, shellEndLabels, shellLabel, shellsOf } from "./shell-registry";
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
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
  onOpen: (project: string | null) => void;
  /**
   * **이 줄이 창의 타이틀바를 겸하는가.** 최상위 터미널(`/terminal`)이 그렇다 — 거기서는
   * 브레드크럼에 적을 것이 화면 이름 하나뿐이라, 그 자리를 탭 줄이 대신 쓴다.
   *
   * 겸할 때 따라오는 것 셋이 전부 그 사실에서 나온다: 44px 층 높이, 창을 끌 수 있는 영역
   * (`data-tauri-drag-region` — 이 줄이 창 맨 위라 없으면 창을 못 끈다), 그리고 사이드바가
   * 접혔을 때 신호등을 피하는 왼쪽 여백. 여백은 사이드바 폭 트랜지션과 **같은 곡선**이라야
   * 한다(PageHeader와 같은 이유 — index.css의 `--panel-ease`).
   *
   * `undefined`면 보통 줄이다. Work의 터미널 탭이 그쪽인데, 그 화면은 머리행을 이미 이고 있다.
   */
  titlebar?: { inset: boolean };
}

// 셸 탭 줄. **셸도 xterm도 여기 없다** — 상태와 콜백만 받는 그림이라 DOM 없는 기본 환경에서
// renderToStaticMarkup으로 그대로 검사된다(ShellTabs.test.tsx). terminal-store를 import하면
// 그 성질이 사라진다: `@xterm/*`와 그 CSS가 따라 들어온다.
//
// 모양은 새로 들이지 않는다. 칸 하나는 spec 트리의 파일 행(SpecTree.tsx)이 이미 푼 것과
// 같은 문제라 그 구조를 그대로 따르고, 색은 index.css의 상태 농도 4단만 읽는다.
function ShellTabs({ state, owner, projects, onSelect, onClose, onOpen, titlebar }: ShellTabsProps) {
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
    <div
      // 타이틀바를 겸할 때만 창 드래그 영역이다. 안쪽 버튼들은 이 속성이 없으므로 그대로
      // 눌린다 — PageHeader가 브레드크럼에 쓰는 방식과 같다.
      data-tauri-drag-region={titlebar ? true : undefined}
      className={cn(
        "flex shrink-0 items-center gap-1",
        titlebar
          ? [
              "h-(--titlebar-height) pr-4 transition-[padding] duration-[220ms] ease-panel",
              titlebar.inset ? "pl-(--titlebar-inset)" : "pl-4",
            ]
          : "h-8 px-4",
      )}
    >
      {shells.map((shell) => {
        const active = shell.id === activeId;
        const label = shellLabel(shell);
        const end = shellEndLabels(shell);

        return (
          // 배경(켜짐·hover)은 이 바깥 상자가 갖는다. **가로 여백을 하나도 갖지 않는다** —
          // 바깥이 가진 padding·gap은 두 버튼 어디에도 속하지 않아 배경은 덮이는데 눌러도
          // 아무 일이 없는 죽은 자리가 된다(커밋 c0978b1이 spec 트리에서 없앤 것).
          // spec 트리는 오른쪽 4px을 남겼는데, 그건 복사 버튼이 hover에만 뜨는 자리라
          // 가장자리에서 띄워야 했기 때문이다. 여기 `×`는 늘 보이므로 그 4px도 필요 없다 —
          // 아이콘이 24px 버튼 안에서 이미 6px 물러나 있다.
          //
          // hover는 **꺼진 가지 안에만** 둔다. toggle-on이 자기 hover를 품으므로 함께 얹으면
          // 규칙이 두 벌이 되어 승자를 유틸리티 정렬 순서가 정한다(index.css의 경고).
          //
          // 꺼진 칸 hover가 `quiet-hover`(2)가 아니라 `hover:bg-state-1`인 것은 티켓이
          // 못박은 배정이고, 근거는 index.css의 부등식이다: 2는 **행이 선택된** 농도라
          // 꺼진 칸을 2로 밝히면 "선택됨"으로 읽힌다. 탭 줄은 행 목록이고 켜짐만 토글이다.
          <div
            key={shell.id}
            className={cn(
              // flex-1(basis 0) + min-w-0이라 칸이 여덟이어도 폭을 나눠 갖고 이름이 잘린다 —
              // 늘어나서 줄을 넘기지 않는다. max-w는 반대쪽, 칸 하나가 줄 전체를 먹는 것을 막는다.
              "flex h-7 min-w-0 max-w-[180px] flex-1 items-center rounded-[8px]",
              "text-[12.5px] transition-colors",
              active ? "toggle-on font-medium" : "text-muted-foreground hover:bg-state-1",
            )}
          >
            {/* 이름 버튼이 자기 오른쪽 여백까지 품는다. h-full은 칸 높이 전체가 눌리게 한다 —
                items-center는 자식을 내용 높이로 줄인다. */}
            <button
              type="button"
              onClick={() => onSelect(shell.id)}
              title={end?.notice ?? label}
              className="flex h-full min-w-0 flex-1 items-center gap-1.5 pl-2 pr-1.5 text-left"
            >
              <span className="min-w-0 truncate">{label}</span>
              {/* 죽은 칸을 **누르지 않고** 알아보는 자리다. 한 문장은 활성 칸 아래 줄이 맡는다.
                  직접 선언한 색이라 켜진 칸의 toggle-on 글자색에 덮이지 않는다. */}
              {end && <span className="shrink-0 text-tertiary">{end.mark}</span>}
            </button>
            {/* 이름 버튼의 **형제**다. 중첩 button은 HTML에서 허용되지 않고, span role="button"
                으로 흉내내면 Tab으로 도달할 수 없다(SpecTree.test.tsx가 같은 것을 지킨다). */}
            <button
              type="button"
              aria-label={`${label} 닫기`}
              title="셸 닫기"
              onClick={() => onClose(shell.id)}
              className="icon-button-quiet text-tertiary"
            >
              <X className="size-3" strokeWidth={1.8} />
            </button>
          </div>
        );
      })}

      {/* 잠긴 `+`에 이 저장소의 관용구(disabled + disabled:pointer-events-none + title)를
          쓰지 않는다. pointer-events-none은 hover 자체를 막아 **그 title이 뜨지 않는다**
          (ShellControls.tsx:14의 주석이 이미 적어 둔 함정이다). 이유가 읽혀야 하는 것이
          요구사항이라, 잠그되 hover는 살린다 — aria-disabled + 클릭 무시다.
          hover 배경만 뺀다: 눌리지 않는 버튼이 눌릴 것처럼 밝아지지는 않게. */}
      <button
        ref={plusRef}
        type="button"
        aria-label="셸 열기"
        aria-disabled={full || undefined}
        // 프로젝트를 묻는 `+`는 여는 버튼이 아니라 메뉴를 여는 버튼이다 — 눌렀는데 셸이
        // 안 뜨는 것이 정상인 유일한 경우라, 그 사실이 속성에 드러나야 한다.
        aria-haspopup={asks ? "menu" : undefined}
        aria-expanded={asks ? picking : undefined}
        title={
          full
            ? `셸은 ${MAX_SHELLS}개까지예요 — 지금 ${state.shells.length}개고, 다른 터미널의 셸도 함께 셉니다`
            : asks
              ? "셸 열기 — 프로젝트를 고릅니다"
              : "셸 열기"
        }
        onClick={() => {
          if (full) return;
          if (asks) setPicking((open) => !open);
          else onOpen(null);
        }}
        className={cn("shrink-0 text-tertiary", full ? "icon-button opacity-40" : "icon-button-quiet")}
      >
        <Plus className="size-3.5" strokeWidth={1.8} />
      </button>

      {picking && (
        <PopoverPortal
          anchorRef={plusRef}
          // 왼쪽 맞춤이다 — `+`가 줄 왼쪽 끝에 있어서 오른쪽 맞춤이면 메뉴가 사이드바 위로
          // 뻗는다(실물에서 확인했다).
          align="left"
          width={190}
          onClose={() => setPicking(false)}
          className="flex flex-col gap-px p-[5px]"
        >
          {projects.map((project) => (
            <button
              key={project}
              type="button"
              onClick={() => {
                setPicking(false);
                onOpen(project);
              }}
              className="flex h-8 w-full items-center rounded-[9px] px-[9px] text-left transition-colors hover:bg-state-2"
            >
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{project}</span>
            </button>
          ))}
        </PopoverPortal>
      )}
    </div>
  );
}

export default ShellTabs;

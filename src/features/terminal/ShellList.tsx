import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import ShellPicker from "./ShellPicker";
import {
  activeIdOf,
  atCap,
  shellCapNotice,
  shellRowName,
  shellRowStatus,
  shellsOf,
} from "./shell-registry";
import type { ShellsState } from "./shell-registry";

interface ShellListProps {
  /**
   * **앱 전체 상태다 — 이 목록의 것만 걸러서 받지 않는다.** 걸러 받으면 `atCap`이 이
   * 목록의 길이를 세게 되고, 상한 8이 화면마다 8이 된다(결정 30). 그리는 것만 `owner`로
   * 좁힌다. 이 목록이 서는 자리가 둘이어도(사이드바 가지·셸 0개인 본문) 그 계약은 하나다.
   */
  state: ShellsState;
  /** 이 목록이 그리는 화면. 최상위 터미널은 `null`이다 — nav `Terminal`의 가지가 그 자리다. */
  owner: string | null;
  /** 이 Work의 프로젝트들. 둘 이상이면 `+`가 어디에 띄울지 물어본다(결정 24). */
  projects: string[];
  /**
   * **본문이 지금 이 화면을 보여주는가.** 켜진 행 표시를 그때만 준다.
   *
   * 사이드바에서는 **남의 work의 가지도 펼쳐 둘 수 있다**(결정 101). 그 가지의 활성 칸까지
   * 강조하면 「지금 보고 있는 것」이 한 화면에 둘이 되어, 어느 셸이 본문에 서 있는지가
   * 사라진다. `activeIdOf`는 그 work의 기억이지 지금 화면이 아니다 — 둘을 여기서 가른다.
   */
  showing: boolean;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
  onOpen: (project: string | null) => void;
  /**
   * 이 행을 본문 위로 끌 수 있다면(결정 86·90). 없으면 안 끌린다 — 셸이 0개인 **본문**에
   * 서는 이 목록에는 끌어다 놓을 자리가 없다.
   *
   * **드래그 모듈을 여기서 import하지 않는다.** 이 목록은 상태와 콜백만 받는 그림이라야
   * DOM 없는 기본 환경에서 그대로 검사된다(위 머리말).
   */
  onDragRow?: (id: number, from: { clientX: number; clientY: number }) => void;
}

// 셸을 고르는 세로 목록. **한 행이 두 줄이다**(결정 45): 첫 줄은 `프로젝트 · 타이틀`(결정 46),
// 둘째 줄은 지금 상태 — 도는 셸은 어디서 떴는지, 끝난 셸은 어떻게 끝났는지.
//
// **서는 자리가 둘이다**(결정 71·102) — 사이드바 가지의 속과, 셸이 0개인 터미널 본문.
// 한때는 작업 패널의 `shell` 탭이었고 그 전에는 가로 탭 줄이었다. 옮겨 다니는 동안 여기
// 남은 것은 **행의 모양뿐이다**: 스크롤·여백·들여쓰기는 자리마다 달라 부르는 쪽이 만든다.
//
// **셸도 xterm도 여기 없다** — 상태와 콜백만 받는 그림이라 DOM 없는 기본 환경에서
// renderToStaticMarkup으로 그대로 검사된다(ShellList.test.tsx). terminal-store를 import하면
// 그 성질이 사라진다: `@xterm/*`와 그 CSS가 따라 들어온다. 구독은 화면(WorksPage)이 한다.
//
// 모양은 새로 들이지 않는다. 행 하나는 spec 트리가 이미 푼 것과 같은 문제라
// (SpecTree.tsx의 파일 행) 그 구조를 그대로 따른다 — 배경을 가진 바깥 상자 + 형제 버튼 둘,
// 선택은 `selected-row`, 비선택 hover는 `hover:bg-state-1`. 한 컬럼에 세로로 붙어 서는
// 목록들이 다른 어휘를 쓰면 한쪽이 다른 종류의 것으로 읽힌다.
function ShellList({
  state,
  owner,
  projects,
  showing,
  onSelect,
  onClose,
  onOpen,
  onDragRow,
}: ShellListProps) {
  // 상한은 **앱 전체**, 그리는 것은 **이 화면**이다. 두 값이 같은 상태에서 다른 범위로
  // 나오는 것이 결정 30의 전부다.
  const full = atCap(state);
  const shells = shellsOf(state, owner);
  const activeId = activeIdOf(state, owner);

  // 프로젝트가 여럿인 Work에서만 `+`가 묻는다. 앵커가 그 행이라 여기 산다.
  const asks = projects.length > 1;
  const plusRef = useRef<HTMLButtonElement>(null);
  const [picking, setPicking] = useState(false);

  return (
    // **상자를 갖지 않는다 — 행만 낸다.** 이 목록이 서는 자리가 둘이 되면서(패널의 세로
    // 목록과 사이드바의 가지) 스크롤·여백·들여쓰기가 자리마다 다른 값이 됐다. 그 셋을
    // 여기서 정하면 부르는 쪽마다 다시 뒤집어야 하므로, **자리는 부르는 쪽이 만들고
    // 여기서는 행의 모양만** 정한다.
    <>
      {/* 셸 0개인 화면이 실재한다 — 정상 종료한 셸이 목록에서 스스로 빠지기 때문이다
          (결정 48). 마지막 칸이 `exit`으로 사라진 자리에서는 새 셸이 저절로 뜨지 않으므로
          (`×`에서 물려받은 성질) 여기가 그때 보이는 전부다. 문구는 이 패널의 다른 빈 상태
          (「아직 spec 파일이 없어요」)와 같은 어투다 — 아래 `+` 행이 「여기서 만든다」를 잇는다. */}
      {shells.length === 0 && (
        <span className="px-2 py-1.5 text-[12.5px] text-tertiary">아직 셸이 없어요</span>
      )}

      {shells.map((shell) => {
        const active = showing && shell.id === activeId;
        const name = shellRowName(shell);

        return (
          // 배경(선택·hover)은 이 바깥 상자가 갖는다. **가로 여백을 하나도 갖지 않는다** —
          // 바깥이 가진 padding은 두 버튼 어디에도 속하지 않아 배경은 덮이는데 눌러도 아무
          // 일이 없는 죽은 자리가 된다(커밋 c0978b1이 spec 트리에서 없앤 것). 남는 것은
          // 오른쪽 끝 pr-1뿐이고, 그건 `×`를 행 가장자리에서 띄우는 값이라 어느 버튼에도
          // 넣을 수 없다 — spec 트리의 파일 행과 같은 자리다.
          //
          // hover는 **꺼진 가지 안에만** 둔다. selected-row가 자기 hover를 품으므로 함께
          // 얹으면 규칙이 두 벌이 되어 승자를 유틸리티 정렬 순서가 정한다(index.css의 경고).
          <div
            key={shell.id}
            className={cn(
              "flex items-center rounded-[8px] pr-1 transition-colors",
              active ? "selected-row font-medium" : "text-muted-foreground hover:bg-state-1",
            )}
          >
            {/* 행을 누르면 그 셸이 켜지고 **본문이 terminal로 넘어간다**(결정 50) — 저쪽
                두 가지를 이 버튼이 함께 부르는 것이 아니라, 무엇을 할지는 화면이 정하고
                여기는 「이 행이 눌렸다」만 말한다. 트리에서 문서를 누르면 본문이 spec으로
                돌아가는 것과 같은 규칙이다.

                두 줄이라 items-center가 아니라 세로 flex다. 세로 여백을 이 버튼이 품는 것은
                바깥 상자가 여백을 갖지 않기 위해서다(위 주석). */}
            <button
              type="button"
              // 표식은 검사가 **끄는 자리**를 정체성으로 집기 위한 것이다(결정 90) —
              // 이름으로 집으면 셸이 쏘는 OSC 타이틀에 따라 갈리고, 형제인 `×`와도 헷갈린다.
              data-shell-row=""
              onClick={() => onSelect(shell.id)}
              onPointerDown={onDragRow && ((event) => onDragRow(shell.id, event))}
              className="flex min-w-0 flex-1 flex-col gap-px py-1.5 pl-2 pr-1.5 text-left"
            >
              <span className="w-full truncate text-[12.5px]">{name}</span>
              {/* 둘째 줄. 색을 직접 선언하므로 켜진 행의 selected-row 글자색에 안 덮인다 —
                  이 줄은 이름보다 한 단 뒤로 물러나 있어야 두 줄이 한 행으로 읽힌다. */}
              <span className="w-full truncate text-[11.5px] font-normal text-tertiary">
                {shellRowStatus(shell)}
              </span>
            </button>
            {/* 이름 버튼의 **형제**다. 중첩 button은 HTML에서 허용되지 않고, span role="button"
                으로 흉내내면 Tab으로 도달할 수 없다(SpecTree.test.tsx가 같은 것을 지킨다).
                셸을 죽이는 길은 여전히 이 `×` 하나다(결정 22) — 가로 탭 줄이 걷히면서
                그 길이 이리로 통째로 옮겨 왔다. */}
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

      {/* `+`가 **행**이 되면서 잠긴 이유를 `title`(hover) 뒤에 숨길 필요가 없어졌다 —
          그 자리에 문장을 그냥 쓴다(결정 47). 가로 탭 줄이 hover에 숨겼던 것은 칸 하나에
          글자를 넣을 폭이 없어서였다.

          그래도 이 저장소의 잠근 버튼 관용구(disabled + pointer-events-none)를 쓰지 않는다:
          문장이 보이는 이상 잠금은 클릭만 막으면 되고, disabled는 이 행을 접근성 트리에서
          「누를 수 없는 것」으로 접어 문장까지 함께 흐리게 만든다. aria-disabled + 클릭 무시다. */}
      <button
        ref={plusRef}
        type="button"
        aria-label="셸 열기"
        aria-disabled={full || undefined}
        // 프로젝트를 묻는 `+`는 여는 버튼이 아니라 메뉴를 여는 버튼이다 — 눌렀는데 셸이
        // 안 뜨는 것이 정상인 유일한 경우라, 그 사실이 속성에 드러나야 한다.
        aria-haspopup={asks ? "menu" : undefined}
        aria-expanded={asks ? picking : undefined}
        onClick={() => {
          if (full) return;
          if (asks) setPicking((open) => !open);
          else onOpen(null);
        }}
        className={cn(
          "flex h-7 items-center gap-1.5 rounded-[8px] pl-2 pr-1.5 text-left text-[12.5px] transition-colors",
          full ? "text-tertiary" : "text-muted-foreground hover:bg-state-1",
        )}
      >
        <Plus className="size-3 shrink-0" strokeWidth={1.8} />
        <span className="min-w-0 truncate">{full ? shellCapNotice(state) : "새 셸"}</span>
      </button>

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
    </>
  );
}

export default ShellList;

import { createContext, useContext, useEffect, useId, useRef, useState } from "react";
import { ChevronRight, Ellipsis } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SMALL_GLYPH_STROKE } from "@/components/ui/icon-stroke";
import { Spinner } from "@/components/ui/spinner";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { endProcesses, keepAsException } from "./actions";
import { activityMonitorTip } from "./breakdown";
import { endText, type EndState } from "./endings";
import { shownSnapshot } from "./endings-store";
import type { RowFold, SectionFold } from "./folds";
import { formatCpu, formatMemory, formatPorts } from "./metrics";
import type { Ask } from "./process-groups";
import { identityKey } from "./process-tree";
import type { ProcessIdentity, ProcessMetrics, ProcessSnapshot } from "./types";

// **`Processes`의 줄 조각** — 셸 묶음(티켓 27), 고아 · 다른 인스턴스 · 예외 묶음(티켓 31), 주인 잃은 셸 · 화면 밖 셸 · 정리 기록
// 묶음(티켓 32)이 같은 줄 · 같은 숫자 칸 · 같은 동작 자리를 쓴다. 묶음마다 따로 그리면 칸의 너비가 갈려 숫자가 세로로 안 맞는다.
//
// **열 너비를 드는 자리가 여기 하나다**(`COLUMNS`) — 열 머리와 모든 줄이 같은 격자를 쓴다(DS `.at-pr`). 줄은 묶음의 면 없이 카드
// 위에 바로 서고(DS `ProcessTree` — 표), 줄마다 안쪽 좌우 12와 아래 0.5px 선이 같아 깊이와 구획이 달라도 숫자 열이 세로로 맞는다.

/**
 * 이름 · CPU · 메모리 · 포트 · 동작, 칸 사이 12(시안 Processes `--pr-cols` — restart 03-11). CPU 칸은 막대와 수라 가장 넓다. 한때 DS `.at-pr`의
 * 메모리 · CPU 차례였다. **좁은 창**(900 이하 — 시안 `@media (max-width: 900px)`, restart 03-12c)에서는 96 · 64 · 0 · 72다 — 포트 칸이 0이라
 * 포트 글자가 안 보인다(칸이 넘침을 자른다).
 */
const COLUMNS =
  "grid grid-cols-[minmax(0,1fr)_156px_72px_104px_84px] gap-x-3 narrow:grid-cols-[minmax(0,1fr)_96px_64px_0_72px]";

/**
 * 줄 아래 선 — 0.5px `border`(DS `.at-pr-row`의 아래 선). 테두리가 아니라 줄 안쪽 바닥에 칠한 면이다 — 0.5px 테두리는 엔진마다 굵기가
 * 갈린다(`SpecViewer`의 가름선과 같은 손버릇). 줄 · 정리 기록의 사건이 같은 선을 쓴다.
 */
export const ROW_RULE =
  "relative after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-[0.5px] after:bg-border";

/**
 * 열 머리(시안 Processes `.pr-th` — restart 03-11) — 줄과 같은 격자 위의 이름 · CPU · 메모리 · 포트다(32 · 안쪽 좌우 12 · 12 `fg-tertiary`, 아래
 * 1px `rule` 선). 숫자 열은 오른쪽 맞춤이다. CPU 열의 이름이 눈금을 말하고(「맥 전체 기준」), 포인터를 올리면 그 눈금을 풀어 말한다.
 * 접근성 트리에서 감춘다 — 줄마다 접근성 이름이 이미 숫자를 읽는다.
 */
export function ColumnHead() {
  return (
    <div
      aria-hidden
      className={cn(
        COLUMNS,
        "relative h-8 items-center px-3 text-xs text-fg-tertiary",
        "after:pointer-events-none after:absolute after:inset-x-0 after:bottom-0 after:h-px after:bg-rule",
      )}
    >
      <span>이름</span>
      <span className="text-right" title="맥 전체를 100으로 잰 값이에요. 코어 1개를 다 쓰면 10%예요.">
        CPU · 맥 전체 기준
      </span>
      <span className="text-right">메모리</span>
      {/* 좁은 창에서는 포트 칸이 0이라 그 이름도 감춘다 — 보드는 0 칸에 「포/트」가 한 글자씩 꺾여 선다(그리기 결함으로 읽었다 — restart 03-12c). */}
      <span className="narrow:invisible">포트</span>
      <span />
    </div>
  );
}

/**
 * 접는 셰브론 — 12px이고(DS `.ic-chevron-*` `s12`) 펼치면 300ms `ease-enter`로 90° 돈다(시안 Processes `.pr-sec .ra-chev` · `.pr-fold .ra-chev` ·
 * ProcessSheet 「펼침 · 접기」의 `duration-relaxed` — restart 03-12c, 한때 160ms `ease-panel`). DS 미리보기는 두 글리프(오른쪽 ·
 * 아래)를 바꿔 끼우고, 앱은 한 글리프를 돌린다. 동작 줄이기면 돌지 않고 바뀐다(`index.css`의 줄임 규칙이 `data-fold-chevron`의
 * 전이를 끈다). 구획 머리 · 줄 · 정리 기록의 사건 줄이 같은 것을 쓴다.
 *
 * 전이 목록에 transform이 아니라 rotate를 적는다 — Tailwind v4의 `rotate-*`는 독립 rotate 속성이다(`SpecTree`의 같은 주석).
 */
export function FoldChevron({ open }: { open: boolean }) {
  return (
    <ChevronRight
      aria-hidden
      data-fold-chevron=""
      className={cn("size-3 shrink-0 transition-[rotate] duration-relaxed ease-enter", open && "rotate-90")}
      strokeWidth={SMALL_GLYPH_STROKE}
    />
  );
}

/** 셰브론 자리(18px) — 자식이 없는 줄은 이 자리를 비워 둔다(열이 맞게). */
function FoldSlot() {
  return <span aria-hidden className="w-4.5 shrink-0" />;
}

/** 구획 머리의 수 — 이름씨 없이 「N개」다(시안 Processes `.pr-sec .n`). 무엇을 세는지는 제목이 말한다(채팅 · 셸 · 프로세스). */
export function countNote(count: number): string {
  return `${count}개`;
}

/**
 * 구획 하나 — 머리 줄(셰브론 · 제목 · 수 · 그 구획의 합 · 동작)과 그 몸(묶음). **영역의 이름이 제목이다**(`aria-labelledby`가 제목 글자를
 * 가리킨다) — 스크린리더가 구획 사이를 건너뛰고, 검사가 구획을 이름으로 찾는다. 수(`note`)는 제목 밖에 둔다: 이름에 들면 박자마다 영역의
 * 이름이 바뀐다. 수는 이름씨 없이 「N개」다(`countNote` — 시안 Processes `.pr-sec .n`, restart 03-11), 기록은 「N건」이고, 아틀리에 밖(다른
 * 앱)은 수가 없다. 동작([정리] · [모두 닫기] · 「보기 전용」)은 늘 보인다 — 접혀 있어도 누른다.
 *
 * **머리 줄은 표의 한 줄이다**(시안 Processes `.pr-sec` — restart 03-11) — 줄과 같은 격자에 서고, 그 구획의 CPU · 메모리 합(`sum`)이 줄의 숫자
 * 열에 선다(막대는 없다). 34 · 위 6 · 13 · 500, 수는 400 `fg-tertiary`, 아래 0.5px 선이다. 셰브론은 제목과 같은 잉크다(시안 `.pr-sec .ra-chev` —
 * restart 03-12c, 한때 `fg-tertiary` — 줄의 셰브론은 그대로 옅다). 손볼 것이 있는 구획(`warn`)은 셰브론 · 제목이 기다림의
 * 잉크다. 앞 아이콘은 없다(시안). 한때 DS `.at-sechead`(36 · 아이콘 · 합 없음)였다.
 *
 * **구획이 접힌다**(ui-refresh 결정 28). 여닫음은 앱의 여닫이 부품이 든다(`Collapsible`). 트리거는 `<h3>` 안의 버튼(셰브론 · 제목)이라
 * `aria-expanded`를 스스로 달고, 수 · 합 · 동작은 버튼 밖이다. 누르는 자리는 머리 줄 전체로 넓힌다(버튼의 `::after`가 줄을 덮고 동작 칸이 그
 * 위에 선다). 몸은 180ms로 접히는 변형(`fold`)이고 닫히면 내려간다 — 접힌 동안은 부품 규칙대로 `inert`다. 처음 상태와 기억은 화면이
 * 든다(`SectionFold`).
 */
export function Section({
  warn = false,
  title,
  note,
  sum,
  action,
  fold,
  children,
}: {
  /** 손볼 것이 있는 구획 — 제목이 기다림의 잉크다. */
  warn?: boolean;
  title: string;
  /** 머리의 수 — 「N개」(`countNote`) · 「N건」. 없으면 안 선다(다른 앱). */
  note?: string;
  /** 그 구획의 합 — 줄의 숫자 열에 선다. 없으면(정리 기록) 비운다. */
  sum?: ProcessMetrics;
  action?: React.ReactNode;
  fold: SectionFold;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <Collapsible
      open={fold.open}
      onOpenChange={fold.onOpenChange}
      render={<section aria-labelledby={id} />}
      className="flex flex-col"
    >
      <div data-section-head="" className={cn(COLUMNS, ROW_RULE, "mt-1.5 h-8.5 items-center px-3 text-chat-meta font-medium")}>
        <span className="flex min-w-0 items-center gap-1.5">
          <h3 className="flex min-w-0 shrink-0">
            <CollapsibleTrigger
              className={cn(
                "flex min-w-0 items-center gap-1.5 rounded-md text-left focus-ring after:absolute after:inset-0",
                warn && "text-warning",
              )}
            >
              <span className="grid w-4.5 shrink-0 place-items-center">
                <FoldChevron open={fold.open} />
              </span>
              <span id={id} className="truncate">
                {title}
              </span>
            </CollapsibleTrigger>
          </h3>
          {note && <span className="min-w-0 truncate font-normal text-fg-tertiary">{note}</span>}
        </span>
        {sum ? (
          <Figures metrics={sum} ports={false} bar={false} tip={false} />
        ) : (
          <>
            <span />
            <span />
            <span />
          </>
        )}
        {/* 머리 줄을 덮은 트리거의 누르는 자리 위에 선다(`relative` — 같은 쌓임에서 뒤에 그려진다). */}
        <span className="relative flex min-w-0 items-center justify-end gap-0.5 font-normal">{action}</span>
      </div>
      <CollapsibleContent variant="fold">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/**
 * 줄의 종류 — 시안 Processes의 줄은 모두 32 · 13이다(`.pr-row` — restart 03-11). 묶는 줄(작업 · 셸 · 채팅 · 실행)은 이름이 500이고(부르는
 * 자리가 이름 글자에 단다 — 시안 `.pr-row.node .t`), 셸 도우미는 12 `fg-tertiary`의 옅은 줄이다(P1). 한때 DS `ProcessTree`처럼 높이 ·
 * 글자로 깊이를 거들었다(40 · 32 · 30 · 28).
 */
export type RowKind = "work" | "shell" | "process" | "helper";

const KIND: Record<RowKind, string> = {
  work: "h-8 text-chat-meta",
  shell: "h-8 text-chat-meta",
  process: "h-8 text-chat-meta",
  helper: "h-8 text-xs text-fg-tertiary",
};

/**
 * 트리의 한 줄. 들여쓰기가 깊이를 눈으로 말하고 `aria-level`이 귀로 말한다. 접근성 이름은 줄마다 지은 한 문장이다 — 안의 글자
 * 조각(이름 · 상태 · 버튼)을 이어 읽으면 「zsh 조용함 2h 이동 닫기」가 된다.
 *
 * 줄은 안쪽 좌우 12에 아래 0.5px 선(`ROW_RULE`)이고, 포인터가 오르면 행 hover `fill-soft`다(DS `ProcessTree` — 상태 농도의 행 단).
 * 들여쓰기는 깊이마다 18px **안내선** 한 칸이다 — 위 줄의 셰브론 자리 가운데에서 내려오는 1px 선이라 어느 줄 밑인지가 읽힌다. 이름
 * 앞의 18px은 셰브론 자리다. 그 뒤가 이름 칸의 내용(`children` — 글리프 · 이름 · 수 · 상태 — 사이 6)이다. 숫자 칸과 동작 칸은 열의
 * 격자에 선다(`COLUMNS`).
 *
 * **자식이 있는 줄은 접힌다**(ui-refresh 결정 28, `fold`). 그 자리에 셰브론 버튼이 서고(Tab으로 닿는다 — 이름은 「<줄 이름> 접기」 ·
 * 「<줄 이름> 펼치기」), 줄이 `aria-expanded`를 단다. 줄의 접근성 이름(한 문장)은 그대로다. 밑의 줄을 그리지 않는 것은 부르는 쪽이다
 * — 줄은 평평한 채다(S58, 중첩 `group`이 없다). 자식이 없는 줄은 같은 18px을 비운다.
 *
 * **프로세스 줄의 동작([끝내기] · ⋯)은 손이 닿을 때만 보인다**(ui-refresh 「같은 날 더 정한 것」) — 줄에 포인터가 있거나 키보드
 * 포커스가 줄 안에 있거나 그 줄의 메뉴(⋯ · 우클릭)가 열려 있을 때다. 불투명도만 150ms로 바꾼다(시안 `.pr-act .at-btn`): 자리는 늘 차지해 숫자 칸이 흔들리지 않고,
 * 숨은 동안에도 접근성 트리에 남는다. 셸 줄의 [이동] · [닫기]는 늘 보인다.
 *
 * **행 메뉴가 있는 줄**(`menu` — 그 이름)은 동작 칸 끝에 ⋯(`RowMenu`)이 서고, 같은 이름이 줄의 표식(`data-row-menu`)이 된다 — 화면의
 * 대상 메뉴(`TargetMenu`)가 그 표식으로 이 줄의 우클릭 · ⇧F10을 같은 목록(`ProcessRowMenuItems`)으로 편다(codex-ds 티켓 30). 그 메뉴가
 * 열린 동안 줄이 대상 테두리를 입는다(`focus-ring`의 `[data-menu-target]` — 줄은 포커스를 받지 않아 키보드 링은 서지 않는다).
 *
 * 자손 줄의 명령줄 전체는 **이름 글자의** `title`이다(줄이 아니다 — 줄 안의 ⋯가 앱 툴팁을 들어 줄에 걸면 둘이 겹친다). 앱
 * 툴팁(`Hint`)이 아닌 것은 `sidebar-active-band` S29의 「버튼이 아닌 자리」와 같은 까닭이다: 툴팁 트리거로 세우면 누를 것 없는 글자에
 * 포커스와 역할이 새로 생긴다(spec 레이아웃 편집기의 잘린 경로가 같은 선택을 했다).
 *
 * **끝내기를 누른 줄은 그 상태가 동작 칸에 늘 선다**(`end` — restart 03-10 · 시안 ProcessSheet 「끝내기」). 「끝내는 중」(돌기)이거나 결과
 * (끝남 · 강제로 끝냄 · 못 끝냄 · 이미 없음)다. 그동안 동작([끝내기])은 안 선다. 끝남 · 강제로 끝냄 · 이미 없음은 그 프로세스가 없다는
 * 말이라 줄이 옅어지고(`data-ended` — 시안의 45%) 행 메뉴도 안 선다. 못 끝냄은 기다림의 잉크다. 줄의 접근성 이름 끝에 그 글이 붙는다.
 *
 * **끝낼 수 있는 줄(`ending`)은 [끝내기]를 누르면 줄 밑에 묻는 줄이 펴진다**(restart 03-11 · 시안 ProcessSheet 「끝내기」 · Processes `.pr-ask`) —
 * 무엇을 끝내는지와 끝내기가 하는 일, [취소] [끝내기]. 넘기는 신원은 누른 순간 화면에 보인 표본의 것이다(`shownSnapshot` — 묻는 동안 박자가 새
 * 표본을 가져와도 그대로다). 묻는 줄은 표에 하나다(`EndAskContext`). 한때 앱 확인 창(`askDanger`)이었다.
 */
export function TreeRow({
  level,
  label,
  kind,
  metrics,
  ports = true,
  outside = false,
  flat = false,
  fold,
  actions,
  ending,
  menu,
  end,
  className,
  children,
  ...rest
}: {
  level: number;
  label: string;
  kind: RowKind;
  /** 숫자 칸. 없으면(셸 도우미 줄) 칸만 비운다. */
  metrics?: ProcessMetrics;
  /** 포트 칸 — 작업 줄과 다른 인스턴스의 머리 줄은 없다(S53). 자리만 비워 둔다. */
  ports?: boolean;
  /** 아틀리에 밖의 줄(다른 앱 · 시스템 · 못 읽음) — CPU 막대가 옅은 잉크다(시안 `data-out`). */
  outside?: boolean;
  /** 숫자 차례 보기의 줄 — 접는 자리(18)를 안 비워 이름이 표의 왼쪽 끝에 선다(시안 Processes CPU 순 · 메모리 순). */
  flat?: boolean;
  /** 자식이 있는 줄의 여닫음. 없으면 접을 것이 없는 줄이다. */
  fold?: RowFold;
  actions?: React.ReactNode;
  /** [끝내기]가 서는 줄 — 묻는 말과 넘길 신원(그 줄과 그 밑). */
  ending?: { ask: Ask; targets: ProcessIdentity[] };
  /** 행 메뉴가 서는 줄이면 「예외로 두기」가 더할 이름(`exceptionName`). 없으면 ⋯도 우클릭 메뉴도 없다. */
  menu?: string;
  /** 끝내기를 누른 줄의 상태(`endings.ts`). 없으면 누르지 않은 줄이다. */
  end?: EndState;
} & React.HTMLAttributes<HTMLDivElement>) {
  const ended = end === "ended" || end === "forced" || end === "gone";
  const rowMenu = ended ? undefined : menu;
  const asks = useContext(EndAskContext);
  const trigger = useRef<HTMLButtonElement>(null);
  const askKey = ending && ending.targets.length > 0 ? identityKey(ending.targets[0]) : null;
  const asking = askKey !== null && asks.open?.key === askKey;
  return (
    <>
      <div
        role="treeitem"
        aria-level={level}
        aria-label={end === undefined ? label : `${label}, ${endText(end)}`}
        aria-expanded={fold?.open}
        data-row-menu={rowMenu}
        data-end={end}
        data-ended={ended || undefined}
        className={cn(
          "group/row",
          COLUMNS,
          ROW_RULE,
          // 면은 150ms, 끝난 줄의 옅어짐은 300ms로 옮겨 간다(시안 `.pr-row`의 전이 — restart 03-12c).
          "items-center px-3 hover:bg-fill-soft [transition:background-color_var(--duration-basic)_var(--ease-default),opacity_var(--duration-relaxed)_var(--ease-default)]",
          KIND[kind],
          rowMenu !== undefined && "focus-ring",
          ended && "opacity-45",
          className,
        )}
        {...rest}
      >
        <span className="flex min-w-0 items-center gap-1.5 self-stretch">
          {Array.from({ length: level - 1 }, (_, at) => (
            <Guide key={at} />
          ))}
          {fold ? <FoldButton fold={fold} /> : !flat && <FoldSlot />}
          {children}
        </span>
        {metrics ? (
          <Figures metrics={metrics} ports={ports} outside={outside} />
        ) : (
          <>
            <span />
            <span />
            <span />
          </>
        )}
        {/* 끝내기 상태의 글은 오른쪽 끝에 늘 선다 — 결과마다 같은 자리다. 손이 닿을 때만 보이는 동작은 그 앞이다. */}
        <span className="flex items-center justify-end gap-1.5">
          <span
            className={cn(
              "flex items-center gap-0.5 transition-opacity duration-basic ease-default empty:hidden",
              kind === "process" &&
                !asking &&
                "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 group-data-menu-target/row:opacity-100 has-[[aria-expanded=true]]:opacity-100",
            )}
          >
            {end === undefined && actions}
            {end === undefined && ending && askKey !== null && (
              // 시안 `.pr-act .at-btn` — `xs secondary`다(줄 끝의 다른 글자 버튼은 조용한 글자 버튼이다).
              <Button ref={trigger} variant="secondary" size="xs" onClick={() => asks.start(askKey, shownSnapshot())}>
                끝내기
              </Button>
            )}
            {rowMenu !== undefined && <RowMenu name={rowMenu} />}
          </span>
          {end !== undefined && <EndMarkText state={end} />}
        </span>
      </div>
      {asking && ending && end === undefined && (
        <EndAskRow
          ask={ending.ask}
          onCancel={() => {
            asks.close();
            trigger.current?.focus();
          }}
          onConfirm={() => {
            const shown = asks.open?.shown;
            asks.close();
            void endProcesses(ending.targets, shown);
          }}
        />
      )}
    </>
  );
}

/** 표에 펴진 묻는 줄 — 그 줄의 열쇠(첫 신원)와 [끝내기]를 누른 순간의 표본. */
export interface OpenAsk {
  key: string;
  shown: ProcessSnapshot | undefined;
}

/**
 * **표의 묻는 줄 — 하나다**(restart 03-11). 화면이 든다(`ProcessesPage`) — 다른 줄의 [끝내기]를 누르면 앞 묻는 줄은 접힌다. 화면 밖(검사)에서는
 * 아무것도 안 펴진다.
 */
export const EndAskContext = createContext<{
  open: OpenAsk | null;
  start: (key: string, shown: ProcessSnapshot | undefined) => void;
  close: () => void;
}>({ open: null, start: () => {}, close: () => {} });

/**
 * **묻는 줄**(시안 ProcessSheet 「끝내기」 · Processes `.pr-ask`) — 줄 밑에 `fill-soft` 면으로 펴진다(위아래 8 · 좌우 12, 사이 8). 무엇을
 * 끝내는지(13 / 19 — 시안 `.pr-root`의 줄 높이)와 끝내기가 하는 일(12 `fg-tertiary`), [취소](xs secondary) [끝내기](xs 주 버튼). 서면 [취소]에 포커스가 간다 — 되돌릴 수 없는
 * 일을 묻는 자리라 Enter 한 번에 끝나지 않는다. Esc도 취소다. 들어올 때 줄 바뀜으로 선다(`row-in` — 시안 `ra-in`).
 */
function EndAskRow({ ask, onCancel, onConfirm }: { ask: Ask; onCancel: () => void; onConfirm: () => void }) {
  const cancel = useRef<HTMLButtonElement>(null);
  const body = useId();
  useEffect(() => cancel.current?.focus(), []);
  return (
    <div
      role="alertdialog"
      aria-label={ask.title}
      aria-describedby={body}
      data-end-ask=""
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        onCancel();
      }}
      className={cn("row-in flex items-center gap-2 bg-fill-soft px-3 py-2 text-chat-meta leading-4.75", ROW_RULE)}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span>{ask.title}</span>
        <span id={body} className="text-xs text-fg-tertiary">
          {ask.body}
        </span>
      </span>
      <Button ref={cancel} variant="secondary" size="xs" onClick={onCancel}>
        취소
      </Button>
      <Button variant="default" size="xs" onClick={onConfirm}>
        {ask.confirm}
      </Button>
    </div>
  );
}

/**
 * **끝내기 상태의 글** — 동작 칸 오른쪽 끝에 늘 선다(시안 ProcessSheet 「끝내기」 — 12 `fg-tertiary`). 끝내는 중은 앞에 도는 표시(12)가
 * 서고 보드의 「회전」 박자(0.9초 — `spin-thread`, 시안의 `ra-spin`)로 돈다. 못 끝냄은 기다림의 잉크다. 도는 표시는 글이 같은 상태를 말하니
 * 감춘다.
 */
function EndMarkText({ state }: { state: EndState }) {
  return (
    <span
      data-end-mark=""
      className={cn(
        "flex shrink-0 items-center gap-1.5 text-xs whitespace-nowrap spin-thread",
        state === "survived" ? "text-warning" : "text-fg-tertiary",
        // 결과는 줄 바뀜으로 들어온다(시안 Processes `.pr-act`의 「끝남」 `ra-in` — restart 03-12c). 끝내는 중은 곧바로 선다.
        state !== "ending" && "row-in",
      )}
    >
      {state === "ending" && <Spinner aria-hidden className="size-3" />}
      {endText(state)}
    </span>
  );
}

/**
 * 줄의 셰브론 버튼 — 셰브론 자리(18px)를 채운다. hover는 줄 끝 글자 버튼과 같은 버튼 단(`quiet-hover` — `fill-hover`)이라 줄의
 * hover(`fill-soft`) 위에서 갈려 보인다. 이름이 지금 할 일(접기 · 펼치기)을 말하므로 버튼에는 `aria-expanded`를 안 단다 — 펼침은 줄이
 * 말한다.
 */
function FoldButton({ fold }: { fold: RowFold }) {
  return (
    <button
      type="button"
      tabIndex={0}
      aria-label={`${fold.name} ${fold.open ? "접기" : "펼치기"}`}
      onClick={fold.onToggle}
      className="grid size-4.5 shrink-0 place-items-center rounded-md text-fg-tertiary transition-colors quiet-hover focus-ring"
    >
      <FoldChevron open={fold.open} />
    </button>
  );
}

/**
 * 안내선 한 칸 — 18px 자리의 가운데에 1px 선. 칸 뒤의 틈(6)을 덜어 깊이마다 18px씩 들어간다. 선이라 면 알파(`fill-*`)가
 * 아니라 선 토큰을 읽는다 — 짙은 선 `border-heavy`(검정 12%)다. 프로토타입의 선은 검정 10%이고, Codex 선 둘(`border` 8% ·
 * `border-heavy` 12%) 가운데 이 선이 전부터 그리던 12%를 잇는 쪽이다.
 */
function Guide() {
  return (
    <span
      aria-hidden
      className="relative -mr-1.5 w-4.5 shrink-0 self-stretch before:absolute before:inset-y-0 before:left-2 before:w-px before:bg-border-heavy"
    />
  );
}

/**
 * **줄의 숫자를 읽는 눈금**(restart 03-6 · 03-11) — 이 맥의 코어 수와 그 장의 합계 CPU. 코어 수로 CPU 칸의 활성 상태 보기 눈금(맥 전체 눈금 ×
 * 코어 수 — 스토리 125)을 띄우고, 합계 CPU로 줄의 막대 폭(그 줄의 CPU ÷ 합계 — 시안 Processes `.pr-bar`)을 짓는다. 화면이 스냅샷으로 건다.
 * 모르면(첫 스냅샷 전 · 첫 표본 · macOS 밖) `null`이고 눈금이 안 뜨고 막대가 빈다. 줄마다 넘기지 않는 것은 줄을 세우는 자리가 여럿이라서다.
 */
export const FiguresContext = createContext<{ cores: number | null; total: number | null }>({ cores: null, total: null });

/**
 * **멈춘 숫자는 옅다**(restart 03-9 · 시안 `.pr-root[data-stale="true"] .pr-num, .pr-mem` — 50%). 화면의 구르는 몸이 멈춤이면 `data-stale`을 단다
 * (`ProcessesPage` · `group/sample`). 줄의 메모리 · CPU 칸과 카드의 큰 수가 이것을 입는다 — 포트 · 이름은 그대로다. 옅어짐은 300ms로 옮겨
 * 간다(시안 `.pr-num` · `.pr-mem` · `.pr-big`의 전이 — restart 03-12c).
 */
export const STALE_FIGURE = "transition-opacity duration-relaxed ease-default group-data-stale/sample:opacity-50";

/**
 * 줄의 숫자 칸 — CPU · 메모리 · 포트(프로세스 결정 10 · 티켓 28 · 시안 Processes — restart 03-11). 글자는 표기 함수의 결과 그대로다
 * (`formatCpu` · `formatMemory` · `formatPorts` — nav 메타와 다른 묶음도 같은 함수를 읽는다). 숫자 열은 오른쪽 맞춤이고 `fg-secondary`다
 * (시안 `.pr-num` · `.pr-mem`). 합계 줄은 본문 글자다(`strong`).
 *
 * **CPU 칸은 막대와 수다**(시안 `.pr-cell`) — 막대는 그 줄의 CPU가 그 장 합계 CPU의 얼마인지(`FiguresContext`)이고, 홈은 `fill-soft` · 채움은
 * `accent-solid`, 아틀리에 밖의 줄(`outside`)은 `fg-tertiary`다. 폭만 400ms `ease-panel`로 옮겨 간다(`duration-bar` — 시안 ProcessSheet
 * 「보기와 움직임」 · 동작 줄이기면 곧바로). 수는 44 폭이라 막대가 세로로 맞는다. 구획 머리와 합계 줄은 막대가 없다(`bar`).
 *
 * 포트는 고정폭 12 `fg-tertiary` 글자다(시안 Processes `.pr-port` — restart 03-11) — 「:5173 · :24678」(`formatPorts`). 넘치면 말줄임이고
 * 잘린 목록의 전체는 칸의 `title`이 보인다(툴팁 `Hint`가 아닌 것은 `sidebar-active-band` S29의 「버튼이 아닌 자리」와 같은 까닭이다: 툴팁
 * 트리거로 세우면 누를 것 없는 글자에 포커스와 역할이 새로 생긴다). 한때 포트마다 DS의 포트 칩(`.at-port` — 20 · `fill-soft`)이었다.
 */
function Figures({
  metrics,
  ports,
  outside = false,
  bar = true,
  tip = true,
  strong = false,
}: {
  metrics: ProcessMetrics;
  ports: boolean;
  outside?: boolean;
  bar?: boolean;
  /** CPU 칸에 활성 상태 보기 눈금을 띄우나 — 구획 머리와 표의 끝 줄(시스템 · 못 읽음 · 합계)은 안 띄운다(시안 Processes). */
  tip?: boolean;
  strong?: boolean;
}) {
  const listed = formatPorts(metrics.ports);
  const { cores, total } = useContext(FiguresContext);
  const share =
    metrics.cpu === null || total === null || total <= 0 ? 0 : Math.min(100, Math.max(0, (metrics.cpu / total) * 100));
  const ink = strong ? "text-fg" : "text-fg-secondary";
  return (
    <>
      {/* **포인터를 올리면 활성 상태 보기 눈금이 뜬다**(restart 03-6 · 스토리 125). 줄이 아니라 CPU 칸에 건다 — 줄 안의 ⋯가 앱 툴팁을
          들어 줄에 걸면 둘이 겹치고, 이름 글자에는 명령줄 툴팁이 이미 있다. */}
      <span
        data-cell="cpu"
        title={tip && cores !== null ? activityMonitorTip(metrics.cpu, cores) : undefined}
        className="flex min-w-0 items-center justify-end gap-2 whitespace-nowrap"
      >
        {bar && (
          <span aria-hidden className="h-1 min-w-0 flex-1 overflow-hidden rounded-2xs bg-fill-soft">
            <span
              data-cpu-bar=""
              className={cn(
                "block h-full rounded-2xs transition-[width] duration-bar ease-panel",
                outside ? "bg-fg-tertiary" : "bg-accent-solid",
              )}
              style={{ width: `${share}%` }}
            />
          </span>
        )}
        <span className={cn("w-11 shrink-0 text-right tabular-nums", ink, STALE_FIGURE)}>{formatCpu(metrics.cpu)}</span>
      </span>
      <span data-cell="memory" className={cn("text-right whitespace-nowrap tabular-nums", ink, STALE_FIGURE)}>
        {formatMemory(metrics.memory)}
      </span>
      {ports ? (
        <span data-cell="ports" title={listed || undefined} className="min-w-0 truncate font-mono text-xs font-normal text-fg-tertiary">
          {listed}
        </span>
      ) : (
        <span aria-hidden />
      )}
    </>
  );
}

/**
 * **표의 끝 줄** — 시스템 · 못 읽음과 합계(restart 03-6 · 시안 Processes). 트리의 줄이 아니다 — 접히지도 끝내지도 않고, 깊이가 없다.
 * 열은 줄과 같은 격자라 숫자가 세로로 맞는다. 이름 뒤에 그 줄이 무엇인지 말하는 글(`note`)이 옅게 선다(줄과 같은 13 — 시안 `.pr-row .d` · `.pr-sum .d`). 시스템 · 못 읽음은 줄과 같은 32 줄이고
 * CPU 막대가 아틀리에 밖의 옅은 잉크다(시안 `.pr-row[data-out]`). 합계 줄은 위에 1px `rule` 선 · 위 6 · 36 · 500이고 숫자가 본문 글자다(시안
 * `.pr-sum`) — 위의 줄을 더한 값이다. 포트 칸은 없다. CPU 칸에 활성 상태 보기 눈금을 띄우지 않는다.
 */
export function LedgerRow({
  kind,
  name,
  note,
  noteTip,
  metrics,
  flat = false,
}: {
  kind: "system" | "total";
  name: string;
  note: string;
  /** 말의 툴팁 — 시스템 · 못 읽음 줄이 못 읽은 것의 까닭을 든다(restart 03-9). `title`이다(`Figures`의 포트 칸과 같은 까닭). */
  noteTip?: string;
  metrics: ProcessMetrics;
  /** 숫자 차례 보기 — 시스템 · 못 읽음 줄이 그 보기의 줄처럼 접는 자리를 안 비운다(`TreeRow`의 `flat`). */
  flat?: boolean;
}) {
  const total = kind === "total";
  return (
    <div
      role="group"
      aria-label={`${name}, ${note}`}
      data-ledger={kind}
      className={cn(
        COLUMNS,
        "items-center px-3",
        total
          ? "relative mt-1.5 h-9 text-chat-meta font-medium before:pointer-events-none before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-rule"
          : cn(ROW_RULE, KIND.process),
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5 self-stretch">
        {!total && !flat && <FoldSlot />}
        <span className="shrink-0">{name}</span>
        <span title={noteTip} className="min-w-0 truncate font-normal text-fg-tertiary">
          {note}
        </span>
      </span>
      <Figures metrics={metrics} ports={false} outside bar={!total} tip={false} strong={total} />
      <span />
    </div>
  );
}

/** 프로세스 결정 10 그림의 「보기 전용」 — 구획 머리의 동작 자리에 선다. 버튼이 아니다. 다른 인스턴스 · 예외 · 다른 앱이 쓴다. */
export function ViewOnly() {
  return <span className="shrink-0 px-2 text-xs text-fg-tertiary">보기 전용</span>;
}

/**
 * 줄 끝의 글자 버튼 — [이동] · [닫기] · [끝내기]가 같은 모양이다. **앱 버튼 부품의 조용한 글자 버튼이다**(`Button` ghost · xs — 26px ·
 * `rounded-md` · `text-xs`, DS `.at-btn.xs.ghost` — `sidebar-active-band` 결정 1 · 2). hover는 버튼 단(`fill-hover`)이라 줄의
 * hover(`fill-soft`) 위에서 갈려 보인다.
 */
export function RowButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <Button variant="ghost" size="xs" onClick={onClick}>
      {children}
    </Button>
  );
}

/**
 * 구획 머리의 글자 버튼 — [정리] · [모두 닫기]. DS 미리보기의 구획 머리가 이 자리를 `.at-btn.xs.outline`으로 그린다 — 줄 끝 버튼과
 * 같은 26 단에 안쪽 1px `border-heavy` 링이고, hover는 `fill-soft`다(`Button` outline).
 */
export function SectionButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <Button variant="outline" size="xs" onClick={onClick}>
      {children}
    </Button>
  );
}

/**
 * **행 메뉴의 정의 — 한 자리다** — 「예외로 두기」 하나(프로세스 스펙 S7 · 티켓 31). 누르면 그 이름이 설정의 예외 목록에 더해진다
 * (`keepAsException`). 줄 끝의 ⋯(`RowMenu`)과 줄의 우클릭 · ⇧F10(`ProcessesPage`의 `TargetMenu`, codex-ds 스펙 §9 · 결정 6)이 같은
 * 이것을 편다. 항목은 메뉴 부품이라 ⋯(`DropdownMenu`)과 우클릭(`ContextMenu`) 어느 카드 안에서도 그대로 선다(`context-menu.tsx`
 * 머리말).
 */
export function ProcessRowMenuItems({ name }: { name: string }) {
  return (
    <DropdownMenuItem onClick={() => void keepAsException(name)}>
      <span className="min-w-0 flex-1 truncate">예외로 두기</span>
    </DropdownMenuItem>
  );
}

/**
 * **행 메뉴의 ⋯** — 목록은 `ProcessRowMenuItems`다. 셸 자손과 고아 행에 선다(`TreeRow`의 `menu`) — 다른 인스턴스와 예외 행은 보기
 * 전용이라 안 선다.
 *
 * **메뉴 부품(`DropdownMenu`)이 다 한다** — 작업 ⋯ · 셸 열기 `+`와 같은 부품이다. 첫 항목은 키보드로 열 때만 켜진다(Base UI의
 * 기본 — 마우스로 열면 팝업 자신이 포커스를 받는다. 셸 열기 `+`는 앱이 따로 켜 주지만(sidebar-active-band S10) 이 메뉴는 작업 ⋯처럼
 * 부품의 기본대로 둔다). Esc · 바깥 누르기는 닫기만 하고 포커스를 여는 버튼으로 돌려준다. 버튼은 이름이 없는 아이콘 버튼이라 툴팁 글자가 곧 이름이다(`Hint`, sidebar-active-band S28 — 작업
 * ⋯와 같다). 이 버튼을 감싸는 것에는 `title`을 걸지 않는다 — 브라우저 툴팁이 이 툴팁과 겹친다(명령줄은 이름 글자에 — `TreeRow`). 모양과 크기(24px — 작은 단)는 아이콘 버튼 규격(`icon-button` · `icon-button-xs`)이 든다. 켜짐이 있는 아이콘 버튼이라 hover는 꺼진
 * 가지 안에만 둔다 — 줄 끝 글자 버튼(`RowButton`)과 같은 버튼 단(`quiet-hover`)이다(줄의 hover 위에서 갈려 보이게). 항목의 모양 · 폭 · 굵기는
 * 부품의 기본값이다(DS `.at-mi` — 400) — 작업 ⋯ 메뉴와 같이 여기서 덧칠하지 않는다.
 */
function RowMenu({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Hint
        text="프로세스 메뉴"
        announce="name"
        render={
          <DropdownMenuTrigger
            className={cn(
              "icon-button icon-button-xs transition-colors focus-ring",
              open ? "toggle-on" : "text-fg-secondary quiet-hover",
            )}
          />
        }
      >
        <Ellipsis aria-hidden className="size-3.5" />
      </Hint>
      {/* 줄의 오른쪽 끝에 선 버튼이라 오른쪽 맞춤이다 — 왼쪽 맞춤이면 메뉴가 창 밖으로 뻗는다. */}
      <DropdownMenuContent align="end">
        <ProcessRowMenuItems name={name} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

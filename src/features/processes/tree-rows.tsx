import { Fragment, useId, useState } from "react";
import { ChevronRight, Ellipsis, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { SMALL_GLYPH_STROKE } from "@/components/ui/icon-stroke";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { keepAsException } from "./actions";
import type { RowFold, SectionFold } from "./folds";
import { PORT_SEPARATOR, formatCpu, formatMemory, formatPort, formatPorts } from "./metrics";
import type { ProcessMetrics } from "./types";

// **`Processes`의 줄 조각** — 셸 묶음(티켓 27), 고아 · 다른 인스턴스 · 예외 묶음(티켓 31), 주인 잃은 셸 · 화면 밖 셸 · 정리 기록
// 묶음(티켓 32)이 같은 줄 · 같은 숫자 칸 · 같은 동작 자리를 쓴다. 묶음마다 따로 그리면 칸의 너비가 갈려 숫자가 세로로 안 맞는다.
//
// **열 너비를 드는 자리가 여기 하나다**(`COLUMNS`) — 열 머리와 모든 줄이 같은 격자를 쓴다(DS `--pr-cols`, ui-refresh 판 06). 줄은
// 옅은 면 묶음(`BLOCK`, ui-refresh 결정 16) 안에 서고, 묶음의 안쪽 여백이 어디서나 같아 깊이와 묶음이 달라도 숫자 열이 세로로 맞는다.

/** 이름 · 메모리 · CPU · 포트 · 동작(DS `.at-pr` 의 `--pr-cols`). */
const COLUMNS = "grid grid-cols-[minmax(0,1fr)_136px_72px_152px_124px]";

/**
 * 옅은 면 묶음(ui-refresh 결정 16, DS `.at-pr-block`) — 테두리 없이 면과 큰 반경으로 묶고 줄 사이 선이 없다. 작업은 하나마다 한
 * 묶음이고, 다른 구획은 구획의 줄이 한 묶음이다.
 */
export const BLOCK = "flex flex-col rounded-2xl bg-surface-under p-1";

/**
 * 열 머리(판 06 문구 표 R5) — 줄과 같은 격자 위의 이름 · 메모리 · CPU · 포트다. 숫자 열은 오른쪽 맞춤이다. 접근성 트리에서 감춘다 —
 * 줄마다 접근성 이름이 이미 숫자를 읽는다. 「이름」은 작업 줄의 이름과 같은 x에 선다(묶음 안쪽 4 + 줄 6 + 셰브론 자리 18 + 6 +
 * 글리프 14 + 6).
 */
export function ColumnHead() {
  return (
    <div aria-hidden className={cn(COLUMNS, "mt-5 h-8 items-center px-1 text-xs text-fg-secondary")}>
      <span className="pl-12.5">이름</span>
      <span className="pr-2 text-right">메모리</span>
      <span className="pr-2 text-right">CPU</span>
      <span className="pl-5">포트</span>
      <span />
    </div>
  );
}

/**
 * 접는 셰브론 — 12px이고 펼치면 90° 돈다(DS `.at-pr-chev` — 160ms, 패널과 같은 곡선). 동작 줄이기면 돌지 않고 바뀐다(`index.css`의
 * 줄임 규칙이 `data-fold-chevron`의 전이를 끈다). 구획 머리 · 줄 · 정리 기록의 사건 줄이 같은 것을 쓴다.
 *
 * 전이 목록에 transform이 아니라 rotate를 적는다 — Tailwind v4의 `rotate-*`는 독립 rotate 속성이다(`SpecTree`의 같은 주석).
 */
export function FoldChevron({ open }: { open: boolean }) {
  return (
    <ChevronRight
      aria-hidden
      data-fold-chevron=""
      className={cn("size-3 shrink-0 transition-[rotate] duration-160 ease-panel", open && "rotate-90")}
      strokeWidth={SMALL_GLYPH_STROKE}
    />
  );
}

/** 셰브론 자리(18px) — 자식이 없는 줄은 이 자리를 비워 둔다(열이 맞게). */
function FoldSlot() {
  return <span aria-hidden className="w-4.5 shrink-0" />;
}

/**
 * 구획 하나 — 머리 줄(셰브론 · 아이콘 · 제목 · 수 · 동작)과 그 몸(묶음). **영역의 이름이 제목이다**(`aria-labelledby`가 제목 글자를
 * 가리킨다) — 스크린리더가 구획 사이를 건너뛰고, 검사가 구획을 이름으로 찾는다. 수(`note`)는 제목 밖에 둔다: 이름에 들면 박자마다 영역의
 * 이름이 바뀐다. 무엇을 세는지는 구획마다 다르다(프로세스 · 셸 · 기록) — 그래서 글자로 받는다. 동작([정리] · [모두 닫기] · 「보기
 * 전용」)은 늘 보인다 — 접혀 있어도 누른다.
 *
 * **구획이 접힌다**(ui-refresh 결정 28). 여닫음은 앱의 여닫이 부품이 든다(`Collapsible` — 정리 기록의 사건 줄 · Archive 목록과 같은
 * 부품). 트리거는 `<h3>` 안의 버튼(셰브론 · 아이콘 · 제목)이라 `aria-expanded`를 스스로 달고, 수와 동작은 버튼 밖이다 — 버튼 안의 버튼은
 * 없고, 이름에 수가 안 든다. 누르는 자리는 머리 줄 전체로 넓힌다(버튼의 `::after`가 줄을 덮고 동작 칸이 그 위에 선다 — 프로토타입의
 * `<summary>`가 줄 전체다). 몸은 180ms로 접히는 변형(`fold`)이고 닫히면 내려간다 — 접힌 동안은 부품 규칙대로 `inert`다. 처음 상태와
 * 기억은 화면이 든다(`SectionFold`).
 */
export function Section({
  icon: Icon,
  warn = false,
  title,
  note,
  action,
  fold,
  children,
}: {
  icon: LucideIcon;
  /** 손볼 것이 있는 구획(확정 고아) — 아이콘이 기다림의 잉크다. */
  warn?: boolean;
  title: string;
  note: string;
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
      className="mt-2 flex flex-col"
    >
      <div className="relative flex h-8 min-w-0 items-center gap-1.5 rounded-lg pr-1 pl-1.5 hover:bg-fill-soft">
        <h3 className="flex min-w-0 shrink-0">
          <CollapsibleTrigger className="flex min-w-0 items-center gap-1.5 text-left text-chat-meta font-semibold after:absolute after:inset-0 after:rounded-lg">
            <span className="grid w-4.5 shrink-0 place-items-center text-fg-tertiary">
              <FoldChevron open={fold.open} />
            </span>
            <Icon aria-hidden className={cn("size-3.5 shrink-0", warn ? "text-warning" : "text-fg-tertiary")} />
            <span id={id} className="truncate">
              {title}
            </span>
          </CollapsibleTrigger>
        </h3>
        <span className="ml-0.5 min-w-0 truncate text-xs text-fg-secondary">{note}</span>
        {/* 머리 줄을 덮은 트리거의 누르는 자리 위에 선다(`relative` — 같은 쌓임에서 뒤에 그려진다). */}
        <span className="relative ml-auto flex shrink-0 items-center gap-0.5">{action}</span>
      </div>
      <CollapsibleContent variant="fold">
        {/* 머리와 몸 사이 4px도 접힌다 — 패널 밖에 두면 접힌 머리 밑에 틈이 남는다. */}
        <div className="pt-1">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * 줄의 종류 — 높이와 글자의 무게가 깊이를 거든다(ui-refresh 「같은 날 더 정한 것」): 작업(44 · 14 · 500, 숫자도 본문 색 500) → 셸(32)
 * → 프로세스(30, 흐림) → 셸 도우미(28, 더 흐림). 고아 · 예외 · 다른 인스턴스의 줄은 프로세스 줄이고, 다른 인스턴스의 머리 줄은 셸 줄이다.
 */
export type RowKind = "work" | "shell" | "process" | "helper";

const KIND: Record<RowKind, string> = {
  work: "h-11 text-sm font-medium",
  shell: "h-8 text-chat-meta",
  process: "h-7.5 text-chat-meta text-fg-secondary",
  helper: "h-7 text-xs text-fg-tertiary",
};

/**
 * 트리의 한 줄. 들여쓰기가 깊이를 눈으로 말하고 `aria-level`이 귀로 말한다. 접근성 이름은 줄마다 지은 한 문장이다 — 안의 글자
 * 조각(이름 · 상태 · 버튼)을 이어 읽으면 「zsh 조용함 2h 이동 닫기」가 된다.
 *
 * 들여쓰기는 깊이마다 18px **안내선** 한 칸이다 — 위 줄의 셰브론 자리 가운데에서 내려오는 1px 선이라 어느 줄 밑인지가 읽힌다. 이름
 * 앞의 18px은 셰브론 자리다. 그 뒤가 이름 칸의 내용(`children` — 글리프 · 이름 · 수 · 상태)이다. 숫자 칸과 동작 칸은 열의 격자에
 * 선다(`COLUMNS`).
 *
 * **자식이 있는 줄은 접힌다**(ui-refresh 결정 28, `fold`). 그 자리에 셰브론 버튼이 서고(Tab으로 닿는다 — 이름은 「<줄 이름> 접기」 ·
 * 「<줄 이름> 펼치기」), 줄이 `aria-expanded`를 단다. 줄의 접근성 이름(한 문장)은 그대로다. 밑의 줄을 그리지 않는 것은 부르는 쪽이다
 * — 줄은 평평한 채다(S58, 중첩 `group`이 없다). 자식이 없는 줄은 같은 18px을 비운다.
 *
 * **프로세스 줄의 동작([끝내기] · ⋯)은 손이 닿을 때만 보인다**(ui-refresh 「같은 날 더 정한 것」) — 줄에 포인터가 있거나 키보드
 * 포커스가 줄 안에 있거나 그 줄의 메뉴가 열려 있을 때다. 불투명도만 바꾼다: 자리는 늘 차지해 숫자 칸이 흔들리지 않고, 숨은 동안에도
 * 접근성 트리에 남는다. 셸 줄의 [이동] · [닫기]는 늘 보인다.
 *
 * 자손 줄의 명령줄 전체는 **이름 글자의** `title`이다(줄이 아니다 — 줄 안의 ⋯가 앱 툴팁을 들어 줄에 걸면 둘이 겹친다). 앱
 * 툴팁(`Hint`)이 아닌 것은 `sidebar-active-band` S29의 「버튼이 아닌 자리」와 같은 까닭이다: 툴팁 트리거로 세우면 누를 것 없는 글자에
 * 포커스와 역할이 새로 생긴다(spec 레이아웃 편집기의 잘린 경로가 같은 선택을 했다).
 */
export function TreeRow({
  level,
  label,
  kind,
  metrics,
  ports = true,
  share = null,
  fold,
  actions,
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
  /** 메모리 칸 앞 막대의 몫(0–100, `memoryShare`) — 작업 줄만 싣는다. 없으면 막대를 안 그린다. */
  share?: number | null;
  /** 자식이 있는 줄의 여닫음. 없으면 접을 것이 없는 줄이다. */
  fold?: RowFold;
  actions?: React.ReactNode;
} & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="treeitem"
      aria-level={level}
      aria-label={label}
      aria-expanded={fold?.open}
      className={cn("group/row", COLUMNS, "items-center rounded-lg hover:bg-fill-hover", KIND[kind], className)}
      {...rest}
    >
      <span className="flex min-w-0 items-center gap-1.5 self-stretch pl-1.5">
        {Array.from({ length: level - 1 }, (_, at) => (
          <Guide key={at} />
        ))}
        {fold ? <FoldButton fold={fold} /> : <FoldSlot />}
        {children}
      </span>
      {metrics ? (
        <Figures metrics={metrics} ports={ports} share={share} quiet={kind !== "work"} />
      ) : (
        <>
          <span />
          <span />
          <span />
        </>
      )}
      <span
        className={cn(
          "flex items-center justify-end gap-0.5 pr-0.5",
          kind === "process" &&
            "opacity-0 group-hover/row:opacity-100 group-focus-within/row:opacity-100 has-[[aria-expanded=true]]:opacity-100",
        )}
      >
        {actions}
      </span>
    </div>
  );
}

/**
 * 줄의 셰브론 버튼 — 셰브론 자리(18px)를 채운다. hover는 줄 끝 글자 버튼과 같은 한 단 짙은 겹이다(`RowButton` — 줄의 hover 위에서
 * 갈려 보이게). 이름이 지금 할 일(접기 · 펼치기)을 말하므로 버튼에는 `aria-expanded`를 안 단다 — 펼침은 줄이 말한다.
 */
function FoldButton({ fold }: { fold: RowFold }) {
  return (
    <button
      type="button"
      aria-label={`${fold.name} ${fold.open ? "접기" : "펼치기"}`}
      onClick={fold.onToggle}
      className="grid size-4.5 shrink-0 place-items-center rounded-md text-fg-tertiary transition-colors hover:bg-fill-active hover:text-fg"
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
 * 줄의 숫자 칸 — 메모리 · CPU · 포트(프로세스 결정 10 · 티켓 28). 글자는 표기 함수의 결과 그대로다(`formatMemory` · `formatCpu` ·
 * `formatPorts` — nav 메타와 다른 묶음도 같은 함수를 읽는다). 숫자 열은 오른쪽 맞춤이다.
 *
 * 포트는 포트마다 칩이다 — DS의 포트 칩(`.at-pr-port` — 20px · 흰 면 · 테두리 · 고정폭)이고, 꼬리표(`tag` — DS `Tag`의 22px 옅은 알약)와
 * 다른 부품이라 여기서 적는다. 칩 사이에 보이지 않는 구분 글자를 둬 칸의 글자가 `formatPorts`의 결과와 같다 — 잘린 목록의 전체는 칸의
 * `title`이 보인다(툴팁 `Hint`가 아닌 것은 `sidebar-active-band` S29의 「버튼이 아닌 자리」와 같은 까닭이다: 툴팁 트리거로 세우면 누를
 * 것 없는 글자에 포커스와 역할이 새로 생긴다).
 */
function Figures({
  metrics,
  ports,
  share,
  quiet,
}: {
  metrics: ProcessMetrics;
  ports: boolean;
  share: number | null;
  quiet: boolean;
}) {
  const listed = formatPorts(metrics.ports);
  const tone = quiet && "text-fg-secondary";
  return (
    <>
      <span className={cn("flex items-center justify-end gap-2.5 pr-2 whitespace-nowrap", tone)}>
        {share !== null && <MemoryBar share={share} />}
        <span data-cell="memory" className="tabular-nums">
          {formatMemory(metrics.memory)}
        </span>
      </span>
      <span data-cell="cpu" className={cn("pr-2 text-right whitespace-nowrap tabular-nums", tone)}>
        {formatCpu(metrics.cpu)}
      </span>
      {ports ? (
        <span data-cell="ports" title={listed || undefined} className="flex min-w-0 items-center gap-1 overflow-hidden pl-5">
          {metrics.ports.map((port, at) => (
            <Fragment key={port}>
              {at > 0 && <span className="sr-only">{PORT_SEPARATOR}</span>}
              <span className="inline-flex h-5 shrink-0 items-center rounded-md bg-surface px-1.5 font-mono text-xs font-normal text-fg inset-ring inset-ring-border">
                {formatPort(port)}
              </span>
            </Fragment>
          ))}
        </span>
      ) : (
        <span aria-hidden />
      )}
    </>
  );
}

/**
 * 작업 줄 메모리 칸 앞의 막대 — 그 작업의 트리 합이 요약 합계의 얼마인지(DS `.at-pr-bar`). 눈의 것이라 감춘다 — 수는 칸의 글자가
 * 말한다.
 */
function MemoryBar({ share }: { share: number }) {
  return (
    <span aria-hidden className="h-1 w-12 shrink-0 overflow-hidden rounded-full bg-fill-active">
      <span className="block h-full rounded-full bg-(--accent)" style={{ width: `${share}%` }} />
    </span>
  );
}

/**
 * 작업 줄 막대의 몫 — 그 작업 트리 합 ÷ 요약 합계를 0–100으로 자른다(합계는 10초 요약, 트리 합은 2초 스냅샷이라 잠깐 100을 넘을 수
 * 있다). 둘 중 하나라도 못 읽었으면 없다 — 막대를 안 그린다.
 */
export function memoryShare(part: number | null, whole: number | null | undefined): number | null {
  if (part === null || whole === null || whole === undefined || whole <= 0) return null;
  return Math.min(100, Math.max(0, (part / whole) * 100));
}

/**
 * 줄 끝의 글자 버튼 — [이동] · [닫기] · [끝내기] · [정리] · [모두 닫기]가 같은 모양이다. **앱 버튼 부품의 조용한 글자 버튼이다**
 * (`Button` ghost · xs — 24px · `rounded-md` · `text-xs`, `sidebar-active-band` 결정 1 · 2). hover는 한 단 짙은 상태 겹(`fill-active`)이다 —
 * 줄의 hover(`fill-hover`) 위에서 버튼이 갈려 보여야 한다.
 */
export function RowButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <Button variant="ghost" size="xs" onClick={onClick} className="hover:bg-fill-active">
      {children}
    </Button>
  );
}

/**
 * **행 메뉴** — 「예외로 두기」 하나(프로세스 스펙 S7 · 티켓 31). 누르면 그 이름이 설정의 예외 목록에 더해진다(`keepAsException`).
 * 셸 자손과 고아 행에 선다 — 다른 인스턴스와 예외 행은 보기 전용이라 안 선다.
 *
 * **메뉴 부품(`DropdownMenu`)이 다 한다** — 작업 ⋯ · 셸 열기 `+`와 같은 부품이다. 첫 항목은 키보드로 열 때만 켜진다(Base UI의
 * 기본 — 마우스로 열면 팝업 자신이 포커스를 받는다. 셸 열기 `+`는 앱이 따로 켜 주지만(sidebar-active-band S10) 이 메뉴는 작업 ⋯처럼
 * 부품의 기본대로 둔다). Esc · 바깥 누르기는 닫기만 하고 포커스를 여는 버튼으로 돌려준다. 버튼은 이름이 없는 아이콘 버튼이라 툴팁 글자가 곧 이름이다(`Hint`, sidebar-active-band S28 — 작업
 * ⋯와 같다). 이 버튼을 감싸는 것에는 `title`을 걸지 않는다 — 브라우저 툴팁이 이 툴팁과 겹친다(명령줄은 이름 글자에 — `TreeRow`). 모양과 크기(24px)는 `icon-button` 한 곳이 든다. 켜짐이 있는 아이콘 버튼이라 hover는 꺼진
 * 가지 안에만 둔다 — 줄 끝 글자 버튼(`RowButton`)과 같은 한 단 짙은 겹이다(줄의 hover 위에서 갈려 보이게). 항목의 모양 · 폭 · 굵기는
 * 부품의 기본값이다(DS `.at-menu-row` — 400) — 작업 ⋯ 메뉴와 같이 여기서 덧칠하지 않는다.
 */
export function RowMenu({ name }: { name: string }) {
  const [open, setOpen] = useState(false);
  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <Hint
        text="프로세스 메뉴"
        announce="name"
        render={
          <DropdownMenuTrigger
            className={cn(
              "icon-button transition-colors",
              open ? "toggle-on" : "text-fg-secondary hover:bg-fill-active hover:text-fg",
            )}
          />
        }
      >
        <Ellipsis aria-hidden className="size-3.5" />
      </Hint>
      {/* 줄의 오른쪽 끝에 선 버튼이라 오른쪽 맞춤이다 — 왼쪽 맞춤이면 메뉴가 창 밖으로 뻗는다. */}
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => void keepAsException(name)}>
          <span className="min-w-0 flex-1 truncate">예외로 두기</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

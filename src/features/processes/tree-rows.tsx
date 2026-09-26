import { useId, useState } from "react";
import { Ellipsis } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { keepAsException } from "./actions";
import { formatCpu, formatMemory, formatPorts } from "./metrics";
import type { ProcessMetrics } from "./types";

// **`Processes`의 줄 조각** — 셸 묶음(티켓 27), 고아 · 다른 인스턴스 · 예외 묶음(티켓 31), 주인 잃은 셸 · 화면 밖 셸 · 정리 기록
// 묶음(티켓 32)이 같은 줄 · 같은 숫자 칸 · 같은 동작 자리를 쓴다. 묶음마다 따로 그리면 칸의 너비가 갈려 숫자가 세로로 안 맞는다.

/**
 * 묶음 하나 — 머리 줄(제목 · 수 · 동작)과 그 몸. **영역의 이름이 제목이다**(`aria-labelledby`) — 스크린리더가 묶음 사이를 건너뛰고,
 * 검사가 묶음을 이름으로 찾는다. 수(`note`)는 제목 밖에 둔다: 이름에 들면 박자마다 영역의 이름이 바뀐다. 무엇을 세는지는 묶음마다
 * 다르다(프로세스 · 셸 · 기록) — 그래서 글자로 받는다.
 */
export function Section({
  title,
  note,
  action,
  children,
}: {
  title: string;
  note: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="mt-8 flex flex-col gap-0.5">
      <div className="flex h-8 min-w-0 items-center gap-2 pr-1">
        <h3 id={id} className="text-[12.5px] font-semibold">
          {title}
        </h3>
        <span className="text-[12px] text-tertiary">{note}</span>
        <span className="flex-1" />
        <Actions>{action}</Actions>
      </div>
      {children}
    </section>
  );
}

/**
 * 트리의 한 줄. 들여쓰기가 깊이를 눈으로 말하고 `aria-level`이 귀로 말한다. 접근성 이름은 줄마다 지은 한 문장이다 — 안의 글자
 * 조각(이름 · 상태 · 버튼)을 이어 읽으면 「zsh 조용함 2h 이동 닫기」가 된다.
 *
 * 자손 줄이 받는 `title`(명령줄 전체)은 앱 툴팁(`Hint`)이 아니다 — `sidebar-active-band` S29의 「버튼이 아닌 자리」와 같은 까닭으로,
 * 툴팁 트리거로 세우면 누를 것 없는 줄에 포커스와 역할이 새로 생긴다(spec 레이아웃 편집기의 잘린 경로가 같은 선택을 했다).
 */
export function TreeRow({
  level,
  label,
  className,
  children,
  ...rest
}: { level: number; label: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      role="treeitem"
      aria-level={level}
      aria-label={label}
      className={cn("flex h-8 min-w-0 items-center gap-2 rounded-[8px] pr-1", className)}
      style={{ paddingLeft: `${(level - 1) * 18}px` }}
      {...rest}
    >
      {children}
    </div>
  );
}

/**
 * 행의 숫자 칸 — 메모리 · CPU · 포트(프로세스 결정 10 · 티켓 28). 글자는 표기 함수의 결과 그대로다(`formatMemory` · `formatCpu` ·
 * `formatPorts` — nav 메타와 다른 묶음도 같은 함수를 읽는다). 칸마다 너비가 정해져 있어 들여쓰기가 달라도 세로로 맞는다. work 행과
 * 다른 인스턴스의 실행 줄은 포트 칸이 없다(S53) — 자리만 비워 둔다.
 */
export function Figures({ metrics, ports = true }: { metrics: ProcessMetrics; ports?: boolean }) {
  const listed = formatPorts(metrics.ports);
  return (
    <>
      <span data-cell="memory" className="w-16 shrink-0 text-right text-[12.5px] tabular-nums text-muted-foreground">
        {formatMemory(metrics.memory)}
      </span>
      <span data-cell="cpu" className="w-11 shrink-0 text-right text-[12.5px] tabular-nums text-muted-foreground">
        {formatCpu(metrics.cpu)}
      </span>
      {ports ? (
        <span
          data-cell="ports"
          // 잘린 포트 목록의 전체는 `title`이 보인다 — 툴팁(`Hint`)이 아닌 것은 `sidebar-active-band` S29의 「버튼이 아닌 자리」와
          // 같은 까닭이다: 툴팁 트리거로 세우면 누를 것 없는 글자에 포커스와 역할이 새로 생긴다(spec 레이아웃 편집기의 잘린 경로와 같다).
          title={listed || undefined}
          className="w-28 shrink-0 truncate pl-2 text-[12.5px] tabular-nums text-muted-foreground"
        >
          {listed}
        </span>
      ) : (
        <span aria-hidden className="w-28 shrink-0" />
      )}
    </>
  );
}

/** 행 끝의 동작 자리 — 줄마다 같은 너비라 숫자 칸이 동작이 없는 줄(work · 다른 인스턴스 · 예외)에서도 셸 행과 같은 자리에 선다. */
export function Actions({ children }: { children?: React.ReactNode }) {
  return <span className="flex w-[92px] shrink-0 items-center justify-end">{children}</span>;
}

/** 줄 끝의 글자 버튼 — [이동] · [닫기] · [끝내기] · [정리]가 같은 모양이다. */
export function RowButton({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="h-6 shrink-0 rounded-[8px] px-2 text-[12.5px] font-medium text-muted-foreground transition-colors quiet-hover"
    >
      {children}
    </button>
  );
}

/**
 * **행 메뉴** — 「예외로 두기」 하나(프로세스 스펙 S7 · 티켓 31). 누르면 그 이름이 설정의 예외 목록에 더해진다(`keepAsException`).
 * 셸 자손과 고아 행에 선다 — 다른 인스턴스와 예외 행은 보기 전용이라 안 선다.
 *
 * **메뉴 부품(`DropdownMenu`)이 다 한다** — 작업 ⋯ · 셸 열기 `+`와 같은 부품이다. 열리면 첫 항목이 켜지고, Esc · 바깥 누르기는
 * 닫기만 하고 포커스를 여는 버튼으로 돌려준다. 버튼은 이름이 없는 아이콘 버튼이라 툴팁 글자가 곧 이름이다(`Hint`, S28 — 작업
 * ⋯와 같다). 모양과 크기(24px)는 `icon-button` 한 곳이 든다. 켜짐이 있는 아이콘 버튼이라 quiet-hover는 꺼진 가지 안에만
 * 둔다. 항목의 모양 · 폭은 부품의 기본값이고, 이름은 작업 ⋯의 항목처럼 굵다.
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
            className={cn("icon-button transition-colors", open ? "toggle-on" : "text-muted-foreground quiet-hover")}
          />
        }
      >
        <Ellipsis aria-hidden className="size-3.5" />
      </Hint>
      {/* 줄의 오른쪽 끝에 선 버튼이라 오른쪽 맞춤이다 — 왼쪽 맞춤이면 메뉴가 창 밖으로 뻗는다. */}
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => void keepAsException(name)}>
          <span className="min-w-0 flex-1 truncate font-medium">예외로 두기</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

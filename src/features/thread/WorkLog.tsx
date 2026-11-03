import { createContext, Fragment, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  Bot,
  Check,
  ChevronRight,
  Command,
  FileText,
  Globe,
  Pencil,
  Search,
  ShieldCheck,
  SquareTerminal,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { SMALL_GLYPH_STROKE } from "@/components/ui/icon-stroke";
import { cn } from "@/lib/utils";
import { autoAllowReason } from "./approval";
import { useArrival, useChanged } from "./arrival";
import { CopyButton } from "./CopyButton";
import { DocPlace } from "./doc-place";
import type { ToolEntry } from "./fold";
import { logRows, type LogGroup } from "./log";
import { RULE } from "./ThreadMarkdown";
import { motionMs, reducedMotion } from "./motion";
import { elapsed, phraseText, shownPath, type DiffLine, type DiffPiece, type ToolGlyph, type ToolView } from "./tool-view";

// 작업 로그의 줄들(restart 02b-4 · Tools 보드 · States 05 · 08 · 10) — 도구 줄 · 묶음 줄 · 펼친 안(명령 출력 · 변경 카드 · MCP 호출). 문구와 묶기는
// 순수 함수가 짓고(`tool-view.ts` · `log.ts`), 여기는 그린다.
//
// - **도구 줄**(Tools 보드 `.ra-tool`) — 글만큼의 줄(24부터 · 14 / 20 `fg-tool`)에 종류 글리프 14와 사이 6. 도는 줄은 「watcher.rs 읽는 중」이 통째로
//   반짝이고(`chat-shimmer` · 바탕 `fg-tool-running`) 글리프가 옅다. 선 줄은 동사 뒤에 대상이 고정폭 13 `fg-secondary`로 서고, 편집이면 `+N −N`(13)과
//   새 파일 · 지운 파일 점(5)이 붙는다. 실패는 색이 아니라 동사(「읽지 못함」 · 「코드 종료 1」)가 말한다. 멈추거나 끊긴 줄 · 거부한 줄은 글리프 자리에 ■(16 칸의 9 · 둥근 2)이다. 마우스를
//   올리면 `fg`가 되고, 걸린 시간(12 `fg-tertiary`)과 셰브런(12 `fg-tertiary` — 펼칠 것이 있을 때)이 글 뒤에 선다. 펼치면 셰브런이 늘 서고 90° 돈다.
// - **묶음 줄**(「묶음 접힘 · 펼침」) — 이어진 읽기 · 찾기는 「파일 4개 살펴봄 · 검색 2번 ›」 한 줄이고(셰브런이 늘 선다), 펼치면 그 줄들이 줄 사이 4로
//   아래에 선다(`.ra-group` — 위 4 · 아래 2, 선 없음).
// - **서브에이전트 줄**(01b-7 · 스토리 63 · 「서브에이전트」) — 기록된 안쪽 도구가 있으면 펼친 안에 그 도구 줄들이 왼쪽 선(글리프 가운데 7 · 1 `border-heavy`)
//   안 13에 서고(`InnerTools`), 돌려준 글이 그 뒤에 선다. 안쪽 도구가 없으면 도구 줄 하나로 내려간다. 글리프는 로봇이다.
// - **명령 출력**(「명령 출력」 · `.ra-out`) — 도는 동안 저절로 펼친다. 회색 상자(`surface-tool` · 1 `border-tool` · 둥근 12 · 안쪽 9 12 9 9) 안에 「Shell」 ·
//   `$ 명령` · 출력(고정폭 13 / 20, 144까지 — 넘치면 끝 줄들이 보이고 위 24가 옅다) · 끝 줄(오른쪽, 13 `fg-tool-status` — 「✓ 성공」 · 「코드 종료 101」 ·
//   「중지됨」)이다. 성공하면 끝난 뒤 700ms(`--delay-fold`)에 스스로 접히고, 실패 · 멈춤은 펼친 채 남는다. 출력이 없이 끝나면 「출력 없음」이다.
// - **변경 카드**(「변경 카드」 · `.ra-diffcard`) — 머리 30(`diff-header` · 이름 · `+N −N` · 복사)과 바뀐 줄(고정폭 12 / 21.6, 4 막대 — 더한 줄은 막대가
//   차고 지운 줄은 빗금), 240까지 — 넘치면 아래가 옅다. **줄 번호는 없다** — ACP diff 내용은 파일 안의 자리를 싣지 않는다(Claude는 입력의 조각이다).
// - **MCP 호출**(「MCP 호출」 · DS `.at-code`) — 받은 값이 코드 상자에 고정폭 13 / 20으로 서고, JSON이면 머리에 `json` 꼬리표가 선다.
// - **펼침 · 접힘**은 높이와 투명도가 함께 .3s로 움직이고 셰브런이 90° 돈다(02 구현 스펙 §12 — `Unfold` · `Chevron`). 작업 구분선 · 도구 줄의 안 · 묶음
//   줄이 같다. 동작 줄이기에서는 곧바로다.
//
// - **방패 줄**(보드 「자동 허용 줄」, v1 티켓 23 · 구현 스펙 §9) — 판정이 묻지 않고 허용한 도구 줄 앞에 방패 · 「자동으로 허용함」 ·
//   대상(고정폭 12) · 까닭 알약(「편집 자동」 · 「비슷한 명령 허용」 …)이 한 줄로 선다. 나중에 왜 묻지 않았는지 알 수 있게다. 까닭은
//   화면의 말이다 — 엔진은 허락을 「이 Work에서는 다시 묻지 않기」로 적고, 화면이 넘어간 도구의 종류로 카드의 말을 고른다(`autoAllowReason` —
//   02 코드 리뷰 A1). 그 도구 줄은 제 줄 그대로 뒤에 선다(결과 · 펼친 안은 도구 줄의 것이다).
//
// - **spec 문서 줄**(Thread 보드 · States 08 · restart 02b-6) — 이은 작업공간의 spec 폴더에 새로 쓴 문서는 문서 글리프 · 「생성됨 재시도-규칙.md」 · 새 파일
//   점이고 `+N −N`과 셰브런이 없다(펼칠 diff가 없다). 그 문서는 답 아래 문서 카드가 연다. spec 폴더는 문서 카드와 같은 자리(`DocPlace`)에서 읽는다.
//
// 줄은 그 문구를 이름으로 단 묶음(`role="group"`)이다. 변경 카드 머리에는 「변경 복사」만 선다 — 보드(Tools · Thread)의 머리에 「작업공간 패널에서
// 열기」가 없다(restart 02b-6). 한때 Work 패널(31)이 서는 날 단다고 적었다.

/** 그 Thread의 작업 폴더(Host Session의 `cwd`) — 변경 상자 머리가 경로를 이 폴더에서 본 자리로 줄인다(`shownPath`). */
export const LogPlace = createContext<string | null>(null);

/** 도구 줄들 — 이어진 읽기 · 찾기는 묶음 줄로 선다. 판정이 묻지 않고 허용한 줄은 그 앞에 방패 줄이 선다. */
export function ToolRows({ tools }: { tools: readonly ToolEntry[] }) {
  const specRoot = useContext(DocPlace)?.specRoot ?? null;
  return (
    <>
      {logRows(tools, specRoot).map((row) =>
        row.kind === "group" ? (
          <GroupLine key={row.key} group={row} />
        ) : (
          <Fragment key={row.key}>
            {row.tool.allowed !== null && <AutoLine view={row.view} reason={autoAllowReason(row.tool.allowed, row.tool.call)} />}
            <ToolLine tool={row.tool} view={row.view} />
          </Fragment>
        ),
      )}
    </>
  );
}

/**
 * 방패 줄(보드 `.auto`) — 방패 체크 14 · 「자동으로 허용함」 13/20 `fg-tertiary` · 대상(고정폭 12 `fg-secondary`) · 까닭 알약(20 높이 · 6
 * 반경 · `fill-soft` · `fg-secondary`). 좁으면 알약이 다음 줄로 접힌다. 높이는 도구 줄과 같은 24부터다.
 */
function AutoLine({ view, reason }: { view: ToolView; reason: string }) {
  const { subject, mono } = view.phrase;
  return (
    <p data-auto-allowed className="flex min-h-6 flex-wrap items-center gap-1.5 text-chat-meta leading-5 text-fg-tertiary">
      <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
      <span>자동으로 허용함</span>
      {subject !== null && (
        <span className={cn("min-w-0 truncate text-fg-secondary", mono && "font-mono text-xs")}>{subject}</span>
      )}
      <span className="inline-flex h-5 shrink-0 items-center rounded-sm bg-fill-soft px-1.5 text-2xs text-fg-secondary">{reason}</span>
    </p>
  );
}

/** 도구 줄 · 묶음 줄의 줄(Tools 보드 `.ra-tool`) — 글만큼의 폭, 24부터, 사이 6, 14 / 20 `fg-tool`. 단추면 마우스를 올린 줄이 `fg`다. */
const ROW = "group inline-flex w-fit max-w-full min-h-6 min-w-0 items-center gap-1.5 rounded-md text-left text-sm text-fg-tool";
const ROW_BUTTON = "transition-colors hover:text-fg focus-ring";

/** 도구 줄 앞의 종류 글리프(Tools 보드 「도구 줄 — 종류 × 상태」) — 갈래는 `describeTool`이 정하고(`ToolGlyph`), 그림은 lucide다. */
const GLYPHS: Record<ToolGlyph, LucideIcon> = {
  read: BookOpen,
  edit: Pencil,
  doc: FileText,
  execute: SquareTerminal,
  search: Search,
  web: Globe,
  mcp: Command,
  skill: Wrench,
  agent: Bot,
  other: Zap,
};

/** 종류 글리프 14 — 그림이라 숨고 문구가 말한다. 도는 줄은 옅다(`fg-tool-running`). */
function Glyph({ glyph, running = false }: { glyph: ToolGlyph; running?: boolean }) {
  const Icon = GLYPHS[glyph];
  return <Icon className={cn("size-3.5 shrink-0", running && "text-fg-tool-running")} aria-hidden data-glyph={glyph} />;
}

/** 멈춘 줄의 ■(DS `.at-stop`) — 16 칸 가운데 9 · 둥근 2, 글자색이다. */
function StopMark() {
  return (
    <span data-glyph="stopped" className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
      <span className="size-2.25 rounded-2xs bg-current" />
    </span>
  );
}

/** 펼침 셰브런 — 접히면 ›, 펼치면 90° 돌아 ∨다(Motion 보드 「작업 묶음 펼침」 — .3s `ease-enter`, States 보드 `.ra-chev`). 동작 줄이기에서는 곧바로 바뀐다. */
function Chevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <ChevronRight
      className={cn(
        "size-3 shrink-0 transition-transform duration-relaxed ease-enter motion-reduce:transition-none",
        open && "rotate-90",
        className,
      )}
      strokeWidth={SMALL_GLYPH_STROKE}
      aria-hidden
    />
  );
}

/**
 * 도구 줄의 셰브런(Tools 보드 `.ra-tool .ra-chev`) — `fg-tertiary`이고, 펼친 줄 · 묶음 줄은 늘, 그 밖은 마우스를 올리거나 초점이 있을 때만 선다.
 */
function RowChevron({ open, always = false }: { open: boolean; always?: boolean }) {
  return (
    <Chevron
      open={open}
      className={cn(
        "text-fg-tertiary transition-[transform,opacity]",
        open || always ? "opacity-100" : "opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100",
      )}
    />
  );
}

/**
 * 펼침 · 접힘(02 구현 스펙 §12) — 높이 0 → auto와 투명도가 함께 .3s로 움직인다(`index.css`의 `unfold`). 펼칠 때 그 안을 그리고, 접으면 다
 * 접힌 뒤에 걷는다 — 접힌 줄들이 DOM에 남지 않는다. 처음부터 펼친 채 선 것(다시 연 Thread)은 움직이지 않는다. 동작
 * 줄이기에서는 곧바로 펴고 걷는다.
 *
 * `from`은 처음 설 때의 모양이다(기본은 `open`). 펼친 모양으로 서서 곧바로 접히면 그 안을 그린 채 접히며 걷힌다 — 다른 칸에 펼친 채 서
 * 있던 줄들이 이 상자로 옮겨 오며 접히는 때다(멈춘 턴을 처음 접음 — `ThreadFlow`의 `TurnView`, restart 02b-7).
 */
export function Unfold({
  open,
  from = open,
  className,
  children,
}: {
  open: boolean;
  from?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [mounted, setMounted] = useState(from);
  const [shown, setShown] = useState(from);
  const [settled, setSettled] = useState(from);
  const box = useRef<HTMLDivElement>(null);
  if (open && !mounted) setMounted(true);
  useLayoutEffect(() => {
    if (open) {
      // 접힌 모양(0fr)을 한 번 재 둔 뒤에 펼친다 — 재지 않고 바꾸면 처음 그림부터 펼친 모양이라 전이가 걸리지 않는다.
      box.current?.getBoundingClientRect();
      setShown(true);
      return;
    }
    // 접을 때도 지금 모양을 한 번 재 둔다 — 펼친 모양으로 막 선 상자(`from`)는 재지 않으면 처음 그림부터 접힌 모양이라 전이가 걸리지 않는다.
    box.current?.getBoundingClientRect();
    setShown(false);
    setSettled(false);
  }, [open]);
  useEffect(() => {
    if (open || !mounted) return;
    const ms = reducedMotion() ? 0 : motionMs("--duration-relaxed");
    if (ms === 0) {
      setMounted(false);
      return;
    }
    // 끝을 알리는 `transitionend`가 오지 않는 때(그 사이에 화면에서 빠짐)에도 걷히게 — 전이 길이 뒤에 한 번 더 본다.
    const timer = window.setTimeout(() => setMounted(false), ms + 50);
    return () => window.clearTimeout(timer);
  }, [open, mounted]);
  if (!mounted) return null;
  return (
    <div
      ref={box}
      data-open={shown || undefined}
      data-settled={(shown && settled) || undefined}
      onTransitionEnd={(event) => {
        if (event.target !== event.currentTarget) return;
        if (open) setSettled(true);
        else setMounted(false);
      }}
      className={cn("unfold", className)}
    >
      <div>{children}</div>
    </div>
  );
}

/** 문구 — 도는 줄은 한 글이 반짝이고(바탕 `fg-tool-running`), 선 줄은 동사 · 대상(고정폭 13 `fg-secondary`)이다. 실패한 줄도 색은 같다 — 동사가 말한다. */
function Phrase({ view }: { view: ToolView }) {
  const { phrase } = view;
  if (phrase.target === null && view.state === "running" && !view.waiting && !view.stopped) {
    return <span className="min-w-0 truncate chat-shimmer [--chat-shimmer-dim:var(--fg-tool-running)]">{phrase.verb}</span>;
  }
  return (
    <>
      <span className={phrase.target === null ? "min-w-0 truncate" : "shrink-0"}>{phrase.verb}</span>
      {phrase.target !== null && <span className="min-w-0 truncate font-mono text-code text-fg-secondary">{phrase.target}</span>}
    </>
  );
}

/**
 * 명령 출력이 펼쳐 있나(Tools 보드 「명령 출력」) — 도는 동안 저절로 펼치고, 성공하면 끝난 뒤 `--delay-fold`(700ms)에 스스로 접는다. 실패 · 멈춤은 펼친 채
 * 남는다. 사람이 누르면 그 뒤로는 사람이 고른 쪽이다. 끝난 채 처음 그린 줄(다시 연 Thread · 접힌 로그를 펼침)은 그 끝의 모양으로 선다 — 성공은 접히고
 * 실패 · 멈춤은 펼친다. 승인을 기다리는 명령은 아직 돌지 않아 접혀 있다.
 */
function useShellOpen(view: ToolView): [boolean, () => void] {
  const fits = view.shell !== null && !view.waiting && !(view.state === "done" && !view.shell.bad && !view.stopped);
  const [auto, setAuto] = useState(fits);
  const [picked, setPicked] = useState<boolean | null>(null);
  useEffect(() => {
    if (fits) {
      setAuto(true);
      return;
    }
    const ms = reducedMotion() ? 0 : motionMs("--delay-fold");
    const timer = window.setTimeout(() => setAuto(false), ms);
    return () => window.clearTimeout(timer);
  }, [fits]);
  const open = picked ?? auto;
  return [open, () => setPicked(!open)];
}

function ToolLine({ tool, view }: { tool: ToolEntry; view: ToolView }) {
  const [shellOpen, toggleShell] = useShellOpen(view);
  const [picked, setPicked] = useState(false);
  const open = view.shell !== null ? shellOpen : picked;
  const toggle = view.shell !== null ? toggleShell : () => setPicked((was) => !was);
  // 하던 줄이 끝나 완료형이 되면 그 자리에서 떠오른다(v1 티켓 43 · Motion 보드 「도구 줄 바뀜」). 처음 그린 줄 · 끝난 채 선 줄은 그대로다.
  const swapped = useChanged(view.state);
  const label = phraseText(view.phrase);
  const received = view.mcp !== null && view.mcp.received !== "";
  // spec 문서 줄은 셈 · 펼침이 없다 — 그 문서는 답 아래 문서 카드가 연다(Thread 보드 「생성됨 재시도-규칙.md」).
  const diffs = view.doc ? [] : view.diffs;
  const expandable = view.shell !== null || diffs.length > 0 || received || view.text !== null || tool.inner.length > 0;
  const added = view.diffs.reduce((sum, piece) => sum + piece.added, 0);
  const deleted = view.diffs.reduce((sum, piece) => sum + piece.deleted, 0);
  const took = view.state === "running" || view.stopped ? null : elapsed(tool);
  const line = (
    <>
      {view.stopped ? <StopMark /> : <Glyph glyph={view.glyph} running={view.state === "running" && !view.waiting} />}
      <Phrase view={view} />
      {diffs.length > 0 && view.state === "done" && !view.stopped && (
        <>
          <span className="shrink-0 text-code text-diff-added tabular-nums">+{added}</span>
          <span className="shrink-0 text-code text-diff-deleted tabular-nums">−{deleted}</span>
        </>
      )}
      {view.dot && view.state === "done" && !view.stopped && (
        <span
          data-dot={view.dot}
          className={cn("size-1.25 shrink-0 rounded-full", view.dot === "created" ? "bg-dot-created" : "bg-dot-deleted")}
          aria-label={view.dot === "created" ? "새 파일" : "지운 파일"}
        />
      )}
      {took && (
        <span className="shrink-0 text-xs text-fg-tertiary opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          {took}
        </span>
      )}
      {expandable && <RowChevron open={open} />}
    </>
  );
  return (
    <div role="group" aria-label={label} data-tool-stop={tool.stop ?? undefined} className="flex min-w-0 flex-col">
      {expandable ? (
        <button type="button" tabIndex={0} aria-expanded={open} onClick={toggle} className={cn(ROW, ROW_BUTTON, swapped && "row-in")}>
          {line}
        </button>
      ) : (
        <div className={cn(ROW, swapped && "row-in")}>{line}</div>
      )}
      {expandable && (
        <Unfold open={open}>
          <div className="flex flex-col gap-1.5 pt-1.5 pb-1">
            {tool.inner.length > 0 && <InnerTools tools={tool.inner} />}
            <Inside view={view} />
          </div>
        </Unfold>
      )}
    </div>
  );
}

/** 서브에이전트의 안쪽 도구 줄들 — 글리프 가운데(7)의 왼쪽 선 안 13에 작업 로그와 같은 줄로 선다(Tools 보드 「서브에이전트」). */
export function InnerTools({ tools }: { tools: readonly ToolEntry[] }) {
  return (
    <div data-inner-tools className="ml-1.75 flex flex-col gap-1 border-l border-border-heavy pt-1 pb-0.5 pl-3">
      <ToolRows tools={tools} />
    </div>
  );
}

/** 묶음 줄 — 접으면 한 줄, 펼치면 그 줄들이 줄 사이 4로 아래에 선다(Tools 보드 「묶음 접힘 · 펼침」 `.ra-group`). 셰브런이 늘 선다. */
function GroupLine({ group }: { group: LogGroup }) {
  const [open, setOpen] = useState(false);
  return (
    <div role="group" aria-label={group.label} className="flex min-w-0 flex-col">
      <button type="button" tabIndex={0} aria-expanded={open} onClick={() => setOpen((was) => !was)} className={cn(ROW, ROW_BUTTON)}>
        <Glyph glyph={group.glyph} />
        <span className="min-w-0 truncate">{group.label}</span>
        <RowChevron open={open} always />
      </button>
      <Unfold open={open}>
        <div className="flex flex-col gap-1 pt-1 pb-0.5">
          {group.tools.map(({ tool, view }) => (
            <ToolLine key={tool.key} tool={tool} view={view} />
          ))}
        </div>
      </Unfold>
    </div>
  );
}

/** 펼친 도구 줄의 안 — 명령 출력 · 변경 카드 · MCP 호출 · 글 출력. */
function Inside({ view }: { view: ToolView }) {
  if (view.shell) return <CommandOutput shell={view.shell} />;
  if (view.diffs.length > 0) {
    return (
      <>
        {view.diffs.map((piece, at) => (
          <DiffCard key={`${piece.path}-${at}`} piece={piece} />
        ))}
      </>
    );
  }
  if (view.mcp && view.mcp.received !== "") return <McpResult name={view.mcp.name} received={view.mcp.received} json={view.mcp.receivedCode} />;
  return view.text ? <TextOutput text={view.text} /> : null;
}

/** 명령 출력 · 글 출력의 상자(Tools 보드 `.ra-out`) — `surface-tool` · 1 `border-tool` · 둥근 12 · 안쪽 9 12 9 9 · 고정폭 13 / 20, 칸 사이 8. */
const OUT_BOX = "flex flex-col gap-2 rounded-xl bg-surface-tool py-2.25 pr-3 pl-2.25 font-mono text-code inset-ring inset-ring-border-tool";

/**
 * 명령 출력(Tools 보드 「명령 출력」) — 「Shell」(12 / 18 `fg-tool`) · `$ 명령`(`$`는 `fg-tertiary`) · 출력(144까지 — 넘치면 끝 줄들이 보이고 위 24가 옅다) ·
 * 끝 줄(오른쪽 13 `fg-tool-status` — 「✓ 성공」 · 「코드 종료 101」 · 「중지됨」). 빨강을 쓰지 않는다. 끝났는데 출력이 없으면 「출력 없음」이다.
 */
function CommandOutput({ shell }: { shell: NonNullable<ToolView["shell"]> }) {
  return (
    <figure aria-label="명령 출력" className={OUT_BOX}>
      <span className="font-sans text-xs text-fg-tool">Shell</span>
      {shell.command !== null && (
        <div className="break-all whitespace-pre-wrap text-fg-secondary">
          <span className="text-fg-tertiary">$</span>
          {` ${shell.command}`}
        </div>
      )}
      {shell.output !== "" ? (
        <pre data-tool-output className="tool-output-fade flex max-h-36 flex-col justify-end overflow-hidden break-all whitespace-pre-wrap text-fg-secondary">
          {shell.output}
        </pre>
      ) : (
        shell.status !== null && <span className="text-fg-tertiary">출력 없음</span>
      )}
      {shell.status !== null && (
        <span className="flex items-center justify-end gap-1 font-sans text-chat-meta text-fg-tool-status">
          {shell.status === "성공" && <Check className="size-3.5" aria-hidden />}
          {shell.status}
        </span>
      )}
    </figure>
  );
}

/** 글 출력 — 실패한 도구의 오류 글 · 서브에이전트가 돌려준 글. 명령 출력과 같은 상자에 머리 없이 서고, 길면 상자 안에서 구른다. */
function TextOutput({ text }: { text: string }) {
  return (
    <figure aria-label="출력" className={OUT_BOX}>
      <pre className="max-h-36 overflow-auto break-all whitespace-pre-wrap text-fg-secondary scroll-quiet">{text}</pre>
    </figure>
  );
}

/** MCP 호출의 받은 값(Tools 보드 「MCP 호출」 · DS `.at-code`) — 코드 상자(둥근 20 · `surface-code` · 1 `border-light`)에 고정폭 13 / 20. JSON이면 머리에 `json` 꼬리표다. */
function McpResult({ name, received, json }: { name: string; received: string; json: boolean }) {
  return (
    <figure aria-label={`${name} 호출`} className="overflow-hidden rounded-3xl bg-surface-code inset-ring inset-ring-border-light">
      <figcaption className="flex items-center gap-2 pt-3 pr-3 pb-1 pl-4 text-chat-meta">
        <span className="h-3.75 min-w-6.5 rounded-xs px-0.75 text-center font-mono text-2xs font-medium leading-3.75 text-fg-tertiary inset-ring-[0.5px] inset-ring-border-heavy">
          {json ? "json" : "text"}
        </span>
      </figcaption>
      <pre className="max-h-60 overflow-auto px-4 pt-1.5 pb-4 font-mono text-code whitespace-pre scroll-quiet">{received}</pre>
    </figure>
  );
}

/** 변경을 글로 — 줄마다 `+` · `-` · 빈칸을 앞에 붙인다. 건너뛴 자리는 「…」다. */
function diffText(lines: readonly DiffLine[]): string {
  return lines
    .map((line) => (line.type === "gap" ? "…" : `${line.type === "add" ? "+" : line.type === "del" ? "-" : " "}${line.text}`))
    .join("\n");
}

/** 변경 카드가 서는 높이(Tools 보드 「변경 카드 — 최대 240」)와 줄 높이(12 / 21.6) — 줄이 이보다 많으면 아래가 옅다. */
const DIFF_MAX = 240;
const DIFF_LINE = 21.6;

/**
 * 변경 카드(Tools 보드 「변경 카드」 `.ra-diffcard`) — 둥근 12 · 1 `diff-border`. 머리 30(`diff-header` · 아래 1 선)에 이름 · `+N −N`(13 / 18
 * `fg-tool`)과 「변경 복사」(대화의 복사 단추 `CopyButton` — `.ra-ic-btn` 26 · ✓ 1.6초, restart 02b-6b), 아래 바뀐 줄(고정폭 12 / 21.6). 더한 줄은 `diff-added-line` 바탕에 찬 막대, 지운 줄은 `diff-deleted-line` 바탕에 빗금 막대다. 더한 줄은
 * `<ins>`, 지운 줄은 `<del>`이라 보조 기술도 더함 · 지움을 읽는다. 바뀌지 않은 먼 줄은 「N줄 숨김」 한 줄로 접는다. 240을 넘으면 아래가 옅다.
 */
export function DiffCard({ piece }: { piece: DiffPiece }) {
  const cwd = useContext(LogPlace);
  const over = piece.lines.length * DIFF_LINE > DIFF_MAX;
  return (
    <figure aria-label={`${piece.path} 변경`} className="flex flex-col overflow-hidden rounded-xl inset-ring inset-ring-diff-border">
      <figcaption className="flex h-7.5 shrink-0 items-center gap-2 border-b border-diff-border bg-diff-header pr-1.5 pl-2.5 text-chat-meta text-fg-tool">
        <span className="min-w-0 truncate" title={shownPath(piece.path, cwd)}>
          {baseNameOf(piece.path)}
        </span>
        <span className="shrink-0 text-diff-added tabular-nums">+{piece.added}</span>
        <span className="shrink-0 text-diff-deleted tabular-nums">−{piece.deleted}</span>
        <CopyButton text={diffText(piece.lines)} label="변경 복사" className="ml-auto" />
      </figcaption>
      <div className={cn("max-h-60 overflow-hidden font-mono text-xs leading-[21.6px]", over && "diff-overflow-fade")}>
        {piece.lines.map((line, at) => {
          const key = `${at}`;
          if (line.type === "gap") {
            return (
              <div key={key} className="bg-fill-soft pl-3.5 font-sans text-fg-tertiary">
                {line.count}줄 숨김
              </div>
            );
          }
          const text = <span className="pl-2.5 whitespace-pre">{line.text === "" ? " " : line.text}</span>;
          if (line.type === "add") {
            return (
              <ins key={key} className="flex bg-diff-added-line no-underline">
                <span aria-hidden className="w-1 shrink-0 bg-diff-added" />
                {text}
              </ins>
            );
          }
          if (line.type === "del") {
            return (
              <del key={key} className="flex bg-diff-deleted-line no-underline">
                <span aria-hidden className="diff-bar-deleted w-1 shrink-0" />
                {text}
              </del>
            );
          }
          return (
            <div key={key} className="flex">
              <span aria-hidden className="w-1 shrink-0" />
              {text}
            </div>
          );
        })}
      </div>
    </figure>
  );
}

/** 변경 카드 머리의 이름 — 파일 이름만이다(Tools 보드 「watcher.rs」). 전체 자리는 `title`이다. */
const baseNameOf = (path: string): string => path.replace(/\/+$/, "").split("/").pop() || path;

/** 턴 머리의 글 줄 — 14 / 20 `fg-tertiary`가 22 줄 가운데에 서고, 셰브런 12가 4 뒤에 선다(States 보드 `.ra-wh`). 줄은 글만큼이다. */
const HEAD_LABEL = "flex min-h-5.5 w-fit max-w-full items-center gap-1 text-left text-sm text-fg-tertiary";

/**
 * 턴 머리(States 보드 `.ra-whblock` · restart 02b-1) — 글 줄 아래 9에 0.5 `border-heavy` 선이 열 폭으로 그어진다. 끝난 턴은 「N초 동안 작업함 ›」 ·
 * 「N초 후에 중단했습니다 ›」, 도는 턴은 「N초 동안 작업 중입니다」가 같은 자리에 선다(`RunningHead` — 셰브런 없음). 펼칠 것이 있으면(`onToggle`) 글 줄이
 * 단추이고 셰브런이 펼치면 ∨로 돈다. 펼칠 것 없이 끝 까닭만 있는 턴(거부 …)도 셰브런 없는 같은 줄이다. 턴이 끝나 도는 줄이 이 줄로 바뀌면 글이 같은
 * 자리에서 떠오른다(v1 티켓 43 · 줄 바뀜 — `arrival`은 그 턴의 열쇠다). 선은 움직이지 않는다.
 *
 * 다음 줄까지는 끝난 턴이 16, 바로 아래에 작업 로그가 선 머리(도는 턴 · 사람이 접기 전의 멈춘 턴)가 12다(턴 안 줄 사이 8 + `mb`) — 시안의 턴 칸
 * 사이 16과 작업 로그의 위 12다. 끝난 턴의 펼친 로그는 그 안에서 4를 당겨 12에 선다(`ThreadFlow`의 `OpenedLog`).
 */
export function WorkDivider({
  open = false,
  onToggle,
  arrival,
  logged = false,
  children,
}: {
  open?: boolean;
  onToggle?: () => void;
  arrival?: string;
  /** 바로 아래에 작업 로그의 줄들이 선다(도는 턴 · 사람이 접기 전의 멈춘 턴) — 다음 줄(작업 로그의 첫 줄)까지 12다. */
  logged?: boolean;
  children: ReactNode;
}) {
  const moving = useArrival("row-in", arrival);
  const rising = arrival === undefined ? undefined : moving;
  return (
    <div data-turn-head className={cn("flex w-full flex-col gap-2.25", logged ? "mb-1" : "mb-2")}>
      {onToggle ? (
        <button
          type="button"
          tabIndex={0}
          data-work-divider
          aria-expanded={open}
          onClick={onToggle}
          className={cn(HEAD_LABEL, "rounded-xs transition-colors hover:text-fg-secondary focus-ring", rising)}
        >
          {children}
          <Chevron open={open} />
        </button>
      ) : (
        <div data-work-divider className={cn(HEAD_LABEL, rising)}>
          {children}
        </div>
      )}
      <div aria-hidden className={RULE} />
    </div>
  );
}

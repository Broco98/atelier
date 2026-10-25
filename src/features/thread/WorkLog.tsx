import { createContext, Fragment, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  BookOpen,
  Check,
  ChevronRight,
  Copy,
  Globe,
  Pen,
  Plug,
  Search,
  ShieldCheck,
  SquareTerminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { SMALL_GLYPH_STROKE } from "@/components/ui/icon-stroke";
import { cn } from "@/lib/utils";
import { autoAllowReason } from "./approval";
import { useArrival, useChanged } from "./arrival";
import type { ToolEntry } from "./fold";
import { logRows, type LogGroup } from "./log";
import { motionMs, reducedMotion } from "./motion";
import { elapsed, phraseText, shownPath, type DiffPiece, type ToolGlyph, type ToolView } from "./tool-view";

// 작업 로그의 줄들(v1 티켓 05 · 캔버스 WorkLog 보드) — 도구 줄 · 묶음 줄 · 펼친 안(명령 출력 · 변경 · MCP 호출). three-axes 도구 줄
// (`chat/ToolRow.tsx`)을 옮겨 보드의 모양으로 고쳤다. 문구와 묶기는 순수 함수가 짓고(`tool-view.ts` · `log.ts`), 여기는 그린다.
//
// - **도구 줄**(`.tool`) — 앞에 종류 글리프 14(읽기 · 편집 · 명령 · 검색 · 웹 · MCP · 그 밖 — 02 구현 스펙 §8, `GLYPHS`)와 사이 6, 대상(고정폭
//   13 · 2단계 색 `fg-secondary`)과 동사(14/20 · 60% `fg-tool`), 최소 높이 28. 하는 중이면 문구 전체가 반짝이고 글리프가 옅다
//   (`fg-tool-running`). 실패한 줄은 동사만 진하다. 우리가 멈춘 줄은 글리프 자리에 ■이다. 펼칠 것이 있으면 줄이 단추이고, 마우스를
//   올리면 오른쪽에 걸린 시간과 셰브런이 선다.
// - **묶음 줄** — 이어진 읽기 · 찾기는 「파일 4개 살펴봄 · 검색 2번 ›」 한 줄이고(셰브런은 늘 선다 — 보드 「접힘」, 글리프는 읽기 · 찾기만이면
//   검색), 펼치면 왼쪽 선 안에 그 줄들이 선다(`.nest`).
// - **펼침 · 접힘**은 높이와 투명도가 함께 .3s로 움직이고 셰브런이 90° 돈다(02 구현 스펙 §12 — `Unfold` · `Chevron`). 작업 구분선 · 도구
//   줄의 안 · 묶음 줄이 같다. 동작 줄이기에서는 곧바로다.
// - **펼친 안**은 처음에 접혀 있다(「펼쳐야 보이고」 — 보드 머리말). 명령 출력은 20 반경의 회색 블록 하나에 `$ 명령` · 출력 · 끝 줄
//   (「코드 종료 0 · 4.2초」), 변경은 경로 · `+N −N` 머리와 바뀐 줄 둘레, MCP는 플러그 · 이름 머리 아래 「보낸 값」 · 「받은 값」 두
//   줄이다(받은 값은 글이면 본문 글꼴, JSON이면 고정폭 — v1 티켓 17).
//
// - **방패 줄**(보드 「자동 허용 줄」, v1 티켓 23 · 구현 스펙 §9) — 판정이 묻지 않고 허용한 도구 줄 앞에 방패 · 「자동으로 허용함」 ·
//   대상(고정폭 12) · 까닭 알약(「편집은 허용」 · 「이 Work에서 늘 허용」 …)이 한 줄로 선다. 나중에 왜 묻지 않았는지 알 수 있게다. 까닭은
//   화면의 말이다 — 엔진은 「늘 허용」 허락을 옛 이름(「이 Work에서는 다시 묻지 않기」)으로 적어 카드의 말로 읽는다(`autoAllowReason` — 02
//   코드 리뷰 A1). 그 도구 줄은 제 줄 그대로 뒤에 선다(결과 · 펼친 안은 도구 줄의 것이다).
//
// 줄은 그 문구를 이름으로 단 묶음(`role="group"`)이다. 변경 머리의 「Work 패널에서 열기」는 Work 패널(31)이 서는 날 단다.

/** 그 Thread의 작업 폴더(Host Session의 `cwd`) — 변경 상자 머리가 경로를 이 폴더에서 본 자리로 줄인다(`shownPath`). */
export const LogPlace = createContext<string | null>(null);

/** 도구 줄들 — 이어진 읽기 · 찾기는 묶음 줄로 선다. 판정이 묻지 않고 허용한 줄은 그 앞에 방패 줄이 선다. */
export function ToolRows({ tools }: { tools: readonly ToolEntry[] }) {
  return (
    <>
      {logRows(tools).map((row) =>
        row.kind === "group" ? (
          <GroupLine key={row.key} group={row} />
        ) : (
          <Fragment key={row.key}>
            {row.tool.allowed !== null && <AutoLine view={row.view} reason={autoAllowReason(row.tool.allowed)} />}
            <ToolLine tool={row.tool} view={row.view} />
          </Fragment>
        ),
      )}
    </>
  );
}

/**
 * 방패 줄(보드 `.auto`) — 방패 체크 14 · 「자동으로 허용함」 13/20 `fg-tertiary` · 대상(고정폭 12 `fg-secondary`) · 까닭 알약(20 높이 · 6
 * 반경 · `fill-soft` · `fg-secondary`). 좁으면 알약이 다음 줄로 접힌다.
 */
function AutoLine({ view, reason }: { view: ToolView; reason: string }) {
  const { subject, mono } = view.phrase;
  return (
    <p data-auto-allowed className="flex min-h-7 flex-wrap items-center gap-1.5 text-chat-meta leading-5 text-fg-tertiary">
      <ShieldCheck className="size-3.5 shrink-0" aria-hidden />
      <span>자동으로 허용함</span>
      {subject !== null && (
        <span className={cn("min-w-0 truncate text-fg-secondary", mono && "font-mono text-xs")}>{subject}</span>
      )}
      <span className="inline-flex h-5 shrink-0 items-center rounded-sm bg-fill-soft px-1.5 text-2xs text-fg-secondary">{reason}</span>
    </p>
  );
}

const ROW = "flex min-h-7 w-full min-w-0 items-center gap-1.5 text-left text-sm text-fg-tool";

/** 도구 줄 앞의 종류 글리프(02 구현 스펙 §8) — 갈래는 `describeTool`이 정하고(`ToolGlyph`), 그림은 lucide다(16에서 1.5 선 — 14에 그린다). */
const GLYPHS: Record<ToolGlyph, LucideIcon> = {
  read: BookOpen,
  edit: Pen,
  execute: SquareTerminal,
  search: Search,
  web: Globe,
  mcp: Plug,
  other: Wrench,
};

/** 종류 글리프 14 — 그림이라 숨고 문구가 말한다. 도는 줄은 옅다(시안 Screen-Live 단계 3). */
function Glyph({ glyph, running = false }: { glyph: ToolGlyph; running?: boolean }) {
  const Icon = GLYPHS[glyph];
  return <Icon className={cn("size-3.5 shrink-0", running && "text-fg-tool-running")} aria-hidden data-glyph={glyph} />;
}

/** 펼침 셰브런 — 접히면 ›, 펼치면 90° 돌아 ∨다(Motion 보드 「작업 묶음 펼침」 — .3s). 동작 줄이기에서는 곧바로 바뀐다. */
function Chevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <ChevronRight
      className={cn(
        "size-3 shrink-0 transition-transform duration-relaxed ease-default motion-reduce:transition-none",
        open && "rotate-90",
        className,
      )}
      strokeWidth={SMALL_GLYPH_STROKE}
      aria-hidden
    />
  );
}

/**
 * 펼침 · 접힘(02 구현 스펙 §12) — 높이 0 → auto와 투명도가 함께 .3s로 움직인다(`index.css`의 `unfold`). 펼칠 때 그 안을 그리고, 접으면 다
 * 접힌 뒤에 걷는다 — 접힌 줄들이 DOM에 남지 않는다. 처음부터 펼친 채 선 것(다시 연 Thread · Session 보기)은 움직이지 않는다. 동작
 * 줄이기에서는 곧바로 펴고 걷는다.
 */
export function Unfold({ open, className, children }: { open: boolean; className?: string; children: ReactNode }) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(open);
  const [settled, setSettled] = useState(open);
  const box = useRef<HTMLDivElement>(null);
  if (open && !mounted) setMounted(true);
  useLayoutEffect(() => {
    if (open) {
      // 접힌 모양(0fr)을 한 번 재 둔 뒤에 펼친다 — 재지 않고 바꾸면 처음 그림부터 펼친 모양이라 전이가 걸리지 않는다.
      box.current?.getBoundingClientRect();
      setShown(true);
      return;
    }
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

/** 문구 — 대상(고정폭이면 13)과 동사 · 꼬리. 하는 중이면 문구 전체가 반짝인다. */
function Phrase({ view }: { view: ToolView }) {
  const { phrase } = view;
  const subject = phrase.subject !== null && (
    <span className={cn("min-w-0 truncate text-fg-secondary", phrase.mono && "font-mono text-code")}>{phrase.subject}</span>
  );
  const glued = phrase.verb.startsWith("에게");
  if (view.state === "running" && !view.waiting && phrase.verb.endsWith("중")) {
    return (
      <span className="flex min-w-0 items-center gap-1.5 chat-shimmer">
        {phrase.before && <span className="shrink-0">{phrase.before.trim()}</span>}
        {phrase.subject !== null && (
          <span className={cn("min-w-0 truncate", phrase.mono && "font-mono text-code")}>{phrase.subject}</span>
        )}
        <span className={cn("shrink-0", glued && "-ml-1.5")}>{phrase.verb}</span>
      </span>
    );
  }
  return (
    <>
      {phrase.before && <span className="shrink-0">{phrase.before.trim()}</span>}
      {subject}
      <span className={cn("shrink-0", glued && "-ml-1.5", phrase.failed && "font-medium text-fg")}>{phrase.verb}</span>
      {phrase.tail && <span className="shrink-0">{phrase.tail.replace(/^ /, "")}</span>}
    </>
  );
}

function ToolLine({ tool, view }: { tool: ToolEntry; view: ToolView }) {
  const [open, setOpen] = useState(false);
  // 하던 줄이 끝나 완료형이 되면 그 자리에서 떠오른다(v1 티켓 43 · Motion 보드 「도구 줄 바뀜」). 처음 그린 줄 · 끝난 채 선 줄은 그대로다.
  const swapped = useChanged(view.state);
  const label = phraseText(view.phrase);
  const received = view.mcp && (view.mcp.received !== "" || view.mcp.sent !== "");
  const expandable = view.shell !== null || view.diffs.length > 0 || Boolean(received) || view.text !== null;
  const added = view.diffs.reduce((sum, piece) => sum + piece.added, 0);
  const deleted = view.diffs.reduce((sum, piece) => sum + piece.deleted, 0);
  const took = elapsed(tool);
  const stopped = tool.stop === "stopped";
  const line = (
    <>
      {stopped ? (
        <span className="flex size-3.5 shrink-0 items-center justify-center" aria-hidden>
          <span className="size-2 rounded-2xs bg-current" />
        </span>
      ) : (
        <Glyph glyph={view.glyph} running={view.state === "running" && !view.waiting} />
      )}
      <Phrase view={view} />
      {view.diffs.length > 0 && view.state === "done" && (
        <>
          <span className="shrink-0 text-diff-added">+{added}</span>
          <span className="shrink-0 text-diff-deleted">−{deleted}</span>
        </>
      )}
      {expandable && (
        <span className="ml-auto flex shrink-0 items-center gap-1 pl-2 text-xs opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          {took}
          <Chevron open={open} />
        </span>
      )}
      {!expandable && took && view.state !== "running" && !stopped && (
        <span className="ml-auto shrink-0 pl-2 text-xs opacity-0 transition-opacity group-hover:opacity-100">{took}</span>
      )}
    </>
  );
  return (
    <div role="group" aria-label={label} data-tool-stop={tool.stop ?? undefined} className="flex min-w-0 flex-col">
      {expandable ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
          className={cn(ROW, "group rounded-md transition-colors hover:text-fg-secondary focus-ring", swapped && "row-in")}
        >
          {line}
        </button>
      ) : (
        <div className={cn(ROW, "group", swapped && "row-in")}>{line}</div>
      )}
      {expandable && (
        <Unfold open={open}>
          <div className="flex flex-col gap-2 pt-1 pb-2">
            <Inside tool={tool} view={view} took={took} />
          </div>
        </Unfold>
      )}
    </div>
  );
}

/** 묶음 줄 — 접으면 한 줄, 펼치면 왼쪽 선 안에 그 줄들이다(보드 「묶음 줄」). */
function GroupLine({ group }: { group: LogGroup }) {
  const [open, setOpen] = useState(false);
  return (
    <div role="group" aria-label={group.label} className="flex min-w-0 flex-col">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
        className={cn(ROW, "rounded-md transition-colors hover:text-fg-secondary focus-ring", open && "text-fg-secondary")}
      >
        <Glyph glyph={group.glyph} />
        <span className="min-w-0 truncate">{group.label}</span>
        <Chevron open={open} />
      </button>
      <Unfold open={open}>
        <div className="ml-2 flex flex-col border-l border-border-heavy pl-3.5">
          {group.tools.map(({ tool, view }) => (
            <ToolLine key={tool.key} tool={tool} view={view} />
          ))}
        </div>
      </Unfold>
    </div>
  );
}

/** 펼친 도구 줄의 안 — 명령 출력 · 변경 · MCP 호출 · 오류 글. */
function Inside({ tool, view, took }: { tool: ToolEntry; view: ToolView; took: string | null }) {
  if (view.shell) {
    return <CommandOutput command={view.shell.command} output={view.shell.output} status={view.shell.status} bad={view.shell.bad} />;
  }
  if (view.diffs.length > 0) {
    return (
      <>
        {view.diffs.map((piece, at) => (
          <DiffView key={`${piece.path}-${at}`} piece={piece} />
        ))}
      </>
    );
  }
  if (view.mcp) {
    return (
      <figure aria-label={`${view.mcp.name} 호출`} className="overflow-hidden rounded-3xl bg-surface shadow-hairline">
        <figcaption className="flex h-9 items-center gap-2 border-b-[0.5px] border-border bg-surface-under px-3.5">
          <Plug className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 truncate font-mono text-xs">{view.mcp.name}</span>
          {took && <span className="ml-auto shrink-0 text-xs text-fg-tertiary">{took}</span>}
        </figcaption>
        <dl className="grid grid-cols-[56px_minmax(0,1fr)] gap-x-3 gap-y-2 px-3.5 py-3 text-chat-meta">
          <dt className="pt-1 text-xs text-fg-tertiary">보낸 값</dt>
          <dd className="max-h-40 overflow-auto rounded-md bg-surface-code px-2 py-1 font-mono text-xs whitespace-pre-wrap scroll-quiet">
            {view.mcp.sent || "없음"}
          </dd>
          <dt className="pt-1 text-xs text-fg-tertiary">받은 값</dt>
          <dd
            className={cn(
              "max-h-60 overflow-auto whitespace-pre-wrap scroll-quiet",
              view.mcp.receivedCode ? "font-mono text-xs text-fg-secondary" : "pt-0.5 wrap-anywhere",
            )}
          >
            {view.mcp.received || (tool.call.status === "completed" ? "없음" : "아직 없음")}
          </dd>
        </dl>
      </figure>
    );
  }
  return view.text ? <CommandOutput command={null} output={view.text} status={null} bad={false} /> : null;
}

/**
 * 명령 출력(보드 「명령 출력」) — 20 반경의 회색 블록 하나: 머리 `$ 명령`과 복사, 출력, 끝 줄(종료 코드 · 걸린 시간). 실패면 끝 줄의 앞
 * 조각(「코드 종료 1」)이 진하다. 명령이 아닌 글(서브에이전트가 돌려준 글 · 실패한 도구의 오류 글)도 같은 블록에 머리 없이 선다.
 */
function CommandOutput({
  command,
  output,
  status,
  bad,
}: {
  command: string | null;
  output: string;
  status: string | null;
  bad: boolean;
}) {
  const [head, ...rest] = status?.split(" · ") ?? [];
  return (
    <figure aria-label={command === null ? "출력" : "명령 출력"} className="overflow-hidden rounded-3xl bg-surface-code">
      {command !== null && (
        <figcaption className="flex h-9 items-center gap-2 pr-1.5 pl-4 font-mono text-xs text-fg-secondary">
          <span className="min-w-0 truncate">$ {command}</span>
          <CopyButton text={command} label="명령 복사" />
        </figcaption>
      )}
      {output !== "" && (
        <pre
          className={cn(
            "max-h-80 overflow-auto px-4 pb-2.5 font-mono text-xs whitespace-pre text-fg-secondary scroll-quiet",
            command === null && "pt-2.5",
          )}
        >
          {output}
        </pre>
      )}
      {status && (
        <div className="flex items-center gap-1 border-t-[0.5px] border-border px-4 py-2 text-xs text-fg-tertiary">
          <span className={cn(bad && "font-medium text-fg")}>{head}</span>
          {rest.length > 0 && <span>· {rest.join(" · ")}</span>}
        </div>
      )}
    </figure>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => setCopied(true));
      }}
      className="ml-auto icon-button-quiet icon-button-sm text-fg-secondary focus-ring"
    >
      {copied ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    </button>
  );
}

/**
 * 변경(보드 「변경」) — 머리(경로 · `+N` `−N`)와 바뀐 줄 둘레. 더한 줄은 `<ins>`, 지운 줄은 `<del>`이라 보조 기술도 더함 · 지움을 읽는다.
 * 바뀌지 않은 먼 줄은 「N줄 숨김」 한 줄로 접는다. **줄 번호는 없다** — ACP diff 내용은 파일 안의 자리를 싣지 않는다(Claude는 입력의
 * 조각이다).
 */
function DiffView({ piece }: { piece: DiffPiece }) {
  const cwd = useContext(LogPlace);
  return (
    <figure aria-label={`${piece.path} 변경`} className="overflow-hidden rounded-3xl bg-surface shadow-hairline">
      <figcaption className="flex h-9.5 items-center gap-2 border-b-[0.5px] border-border bg-surface-under pr-2 pl-3.5 text-chat-meta">
        <span className="min-w-0 truncate font-mono text-xs" title={piece.path}>
          {shownPath(piece.path, cwd)}
        </span>
        <span className="shrink-0 text-diff-added">+{piece.added}</span>
        <span className="shrink-0 text-diff-deleted">−{piece.deleted}</span>
      </figcaption>
      <div className="overflow-x-auto py-1.5 font-mono text-xs leading-5 scroll-quiet">
        {piece.lines.map((line, at) => {
          const key = `${at}`;
          if (line.type === "gap") {
            return (
              <div key={key} className="flex bg-fill-soft px-3.5 font-sans text-fg-tertiary">
                {line.count}줄 숨김
              </div>
            );
          }
          const body = (sign: string, signClass?: string) => (
            <>
              <span className={cn("w-2.5 shrink-0 text-fg-tertiary", signClass)}>{sign}</span>
              <span className="whitespace-pre">{line.text === "" ? " " : line.text}</span>
            </>
          );
          if (line.type === "add") {
            return (
              <ins key={key} className="flex gap-2.5 bg-diff-added-line px-3.5 no-underline">
                {body("+", "text-diff-added")}
              </ins>
            );
          }
          if (line.type === "del") {
            return (
              <del key={key} className="flex gap-2.5 bg-diff-deleted-line px-3.5 no-underline">
                {body("-", "text-diff-deleted")}
              </del>
            );
          }
          return (
            <div key={key} className="flex gap-2.5 px-3.5">
              {body("")}
            </div>
          );
        })}
      </div>
    </figure>
  );
}

/** 작업 구분선의 줄 — 글자 14/20 `fg-subtle`, 그 아래 9에 1 `separator-soft` 선이 열 폭으로 그어지고, 다음 줄까지 14다(턴 안 줄 사이 8 + 6). */
const DIVIDER = "flex w-full items-center gap-1 border-b border-separator-soft pt-0.5 pb-2.25 mb-1.5 text-left text-sm text-fg-subtle";

/**
 * 작업 구분선(02 구현 스펙 §8 · Diff-Chat · Screen-Live — Codex 결) — 「N초 동안 작업 ›」과 그 아래 가는 선. 펼칠 것이 있으면(`onToggle`)
 * 단추이고 셰브런이 펼치면 ∨로 돈다. 도는 동안은 「N초 동안 작업 중입니다」가 같은 줄에 선다(셰브런 없음). 펼칠 것 없이 끝 까닭만 있는
 * 턴(길이 한도 …)도 셰브런 없는 같은 줄이다. 턴이 끝나 도는 줄이 이 줄로 바뀌면 같은 자리에서 떠오른다(v1 티켓 43 · 줄 바뀜 —
 * `arrival`은 그 턴의 열쇠다). 위 2(`pt-0.5`)는 말풍선 → 첫 글자 잉크 51.5를 지킨다(`ThreadFlow`의 `TURN_GAP`).
 */
export function WorkDivider({
  open = false,
  onToggle,
  arrival,
  children,
}: {
  open?: boolean;
  onToggle?: () => void;
  arrival?: string;
  children: ReactNode;
}) {
  const moving = useArrival("row-in", arrival);
  const rising = arrival === undefined ? undefined : moving;
  if (!onToggle) {
    return (
      <div data-work-divider className={cn(DIVIDER, rising)}>
        {children}
      </div>
    );
  }
  return (
    <button
      type="button"
      data-work-divider
      aria-expanded={open}
      onClick={onToggle}
      className={cn(DIVIDER, "transition-colors hover:text-fg-secondary", rising)}
    >
      {children}
      <Chevron open={open} />
    </button>
  );
}

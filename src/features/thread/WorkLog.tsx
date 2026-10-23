import { createContext, Fragment, useContext, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Copy, Plug, ShieldCheck } from "lucide-react";
import { SMALL_GLYPH_STROKE } from "@/components/ui/icon-stroke";
import { cn } from "@/lib/utils";
import type { ToolEntry } from "./fold";
import { logRows, type LogGroup } from "./log";
import { elapsed, phraseText, shownPath, type DiffPiece, type ToolView } from "./tool-view";

// 작업 로그의 줄들(v1 티켓 05 · 캔버스 WorkLog 보드) — 도구 줄 · 묶음 줄 · 펼친 안(명령 출력 · 변경 · MCP 호출). three-axes 도구 줄
// (`chat/ToolRow.tsx`)을 옮겨 보드의 모양으로 고쳤다. 문구와 묶기는 순수 함수가 짓고(`tool-view.ts` · `log.ts`), 여기는 그린다.
//
// - **도구 줄**(`.tool`) — 아이콘 없이 한 줄이다: 대상(고정폭 13 · `fg-secondary`)과 동사(14/20 · `fg-tertiary`), 최소 높이 28. 하는
//   중이면 문구 전체가 반짝인다(`chat-shimmer`). 실패한 줄은 동사만 진하다. 펼칠 것이 있으면 줄이 단추이고, 마우스를 올리면 오른쪽에 걸린
//   시간과 셰브런이 선다.
// - **묶음 줄** — 이어진 읽기 · 찾기는 「파일 4개 살펴봄 · 검색 2번 ›」 한 줄이고(셰브런은 늘 선다 — 보드 「접힘」), 펼치면 왼쪽 선
//   안에 그 줄들이 선다(`.nest`).
// - **펼친 안**은 처음에 접혀 있다(「펼쳐야 보이고」 — 보드 머리말). 명령 출력은 20 반경의 회색 블록 하나에 `$ 명령` · 출력 · 끝 줄
//   (「코드 종료 0 · 4.2초」), 변경은 경로 · `+N −N` 머리와 바뀐 줄 둘레, MCP는 플러그 · 이름 머리 아래 「보낸 값」 · 「받은 값」 두
//   줄이다(받은 값은 글이면 본문 글꼴, JSON이면 고정폭 — v1 티켓 17).
//
// - **방패 줄**(보드 「자동 허용 줄」, v1 티켓 23 · 구현 스펙 §9) — 판정이 묻지 않고 허용한 도구 줄 앞에 방패 · 「자동으로 허용함」 ·
//   대상(고정폭 12) · 까닭 알약(「편집은 허용」 · 「이 Work에서는 다시 묻지 않기」 …)이 한 줄로 선다. 나중에 왜 묻지 않았는지 알 수
//   있게다. 그 도구 줄은 제 줄 그대로 뒤에 선다(결과 · 펼친 안은 도구 줄의 것이다).
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
            {row.tool.allowed !== null && <AutoLine view={row.view} reason={row.tool.allowed} />}
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

const ROW = "flex min-h-7 w-full min-w-0 items-center gap-1.5 text-left text-sm text-fg-tertiary";

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
  const label = phraseText(view.phrase);
  const received = view.mcp && (view.mcp.received !== "" || view.mcp.sent !== "");
  const expandable = view.shell !== null || view.diffs.length > 0 || Boolean(received) || view.text !== null;
  const added = view.diffs.reduce((sum, piece) => sum + piece.added, 0);
  const deleted = view.diffs.reduce((sum, piece) => sum + piece.deleted, 0);
  const took = elapsed(tool);
  const stopped = tool.stop === "stopped";
  const line = (
    <>
      {stopped && (
        <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
          <span className="size-2 rounded-2xs bg-current" />
        </span>
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
          {open ? (
            <ChevronDown className="size-3" strokeWidth={SMALL_GLYPH_STROKE} aria-hidden />
          ) : (
            <ChevronRight className="size-3" strokeWidth={SMALL_GLYPH_STROKE} aria-hidden />
          )}
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
          className={cn(ROW, "group rounded-md transition-colors hover:text-fg-secondary focus-ring")}
        >
          {line}
        </button>
      ) : (
        <div className={cn(ROW, "group")}>{line}</div>
      )}
      {expandable && open && (
        <div className="flex flex-col gap-2 pt-1 pb-2">
          <Inside tool={tool} view={view} took={took} />
        </div>
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
        <span className="min-w-0 truncate">{group.label}</span>
        {open ? (
          <ChevronDown className="size-3 shrink-0" strokeWidth={SMALL_GLYPH_STROKE} aria-hidden />
        ) : (
          <ChevronRight className="size-3 shrink-0" strokeWidth={SMALL_GLYPH_STROKE} aria-hidden />
        )}
      </button>
      {open && (
        <div className="ml-2 flex flex-col border-l border-border-heavy pl-3.5">
          {group.tools.map(({ tool, view }) => (
            <ToolLine key={tool.key} tool={tool} view={view} />
          ))}
        </div>
      )}
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

/** 작업 머리줄의 버튼 · 줄 모양(보드 `.lhead`) — 14/20 `fg-tertiary`, 접히면 아래 0.5px 선. */
export function LogHead({
  open,
  onToggle,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className={cn(
        "flex w-full items-center gap-1 pt-0.5 text-left text-sm text-fg-tertiary transition-colors hover:text-fg-secondary",
        open ? "pb-0.5" : "border-b-[0.5px] border-border-heavy pb-2",
      )}
    >
      {children}
      {open ? <ChevronDown className="size-3.5" aria-hidden /> : <ChevronRight className="size-3.5" aria-hidden />}
    </button>
  );
}

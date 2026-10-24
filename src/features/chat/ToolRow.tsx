import { useContext, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useHomeDir } from "@/features/works/hooks";
import { cn } from "@/lib/utils";
import { ChatDocsContext } from "./chat-docs";
import { spoken, toolDone, type ToolEntry, type TurnEnd } from "./fold";
import { TOOL_ICONS } from "./tool-icons";
import { baseName, commandOf, describeTool, lineOf, specPathOf, type DiffPiece, type ToolView } from "./tool-view";

// 도구 줄(three-axes 티켓 18 · 20) — 에이전트가 지금 무엇을 하는지 따라가는 줄이다(스토리 39). 모양은 캔버스 Tools 보드의
// `.cx-tool`(아이콘 16 + 사람이 읽는 문장 하나 · 14/21 · 60% 글자)이고, 문구 · 안의 것은 `tool-view.ts`가 ACP 모양으로 짓는다.
//
// - **진행형 → 완료형.** `tool_call`이 오면 진행형 문구가 반짝이고(글자만 40% + shimmer), `tool_call_update`가 끝을 알리면 완료형
//   문구로 바뀐다. 실패는 색이 아니라 문장이다 — 「~하지 못함」, 그리고 펼친 상자의 상태 글(「코드 종료 2」 · 「실패」).
// - **안의 것.** 명령은 명령 출력 상자(`$` 명령 · 출력 · 오른쪽 아래 상태, 스토리 40), 편집은 diff(스토리 41), MCP 호출은 ⌘ 아이콘과
//   「서버 통합 · 도구」 문구로 구별되고 펼치면 원본 출력이다(스토리 42). 줄을 누르면 안의 것이 접히고 펴진다. 명령 출력과 diff는
//   **펴진 채로 선다** — 턴이 도는 동안에도 무엇이 나왔고 어떻게 고쳤는지 본다. 턴이 끝나면 줄째로 머리줄 아래로 접힌다(티켓 17).
// - **파일 링크.** 줄의 파일(그리고 diff 머리의 경로)이 spec 폴더 안이면 누를 수 있는 링크다 — 스펙 창이 그 파일을 연다(스토리 77).
//   spec 폴더 밖의 파일은 스펙 창이 보이지 않으므로 글로만 선다.
// - **멈춘 턴의 줄**(티켓 20)은 대화 접기가 가른 둘이다(`fold.ts`의 `ToolStop`):
//   - **멈춘 뒤에도 도는 중**(`ran-on`, three-axes 결정 28) — 「명령 출력」 셋째 상자: 스피너와 「Shell · 멈춘 뒤에도 도는 중」, `$` 명령, 늦게 온
//     출력, 오른쪽 아래 「턴은 N초 후에 멈췄어요 — 명령은 끝까지 돌아요」. 명령이 끝나면 「멈춘 뒤에 끝남」이고 출력은 그대로다.
//     끝을 받기 전에 에이전트가 사라졌으면(`cut`) 「멈춘 뒤에 끊김」이다 — 명령도 프로세스 그룹과 함께 끝났다.
//   - **멈춤**(`stopped`) — `.cx-stop`의 ■(16 상자 안 9 네모)와 도구 제목이다. 멈춤과 함께 닫혀 더 올 것이 없다.
//
// 줄은 그 문구(멈춘 줄은 도구 제목)를 이름으로 단 묶음(`role="group"`)이다 — 상태 글과 안의 것은 그 안의 보이는 글이다.

/**
 * 멈춘 줄의 이름 — 엔진이 지은 제목, 없으면 명령, 그것도 없으면 kind로 지은 대상(실측 함정 49)이다. 명령은 도구 줄 문구와 같은
 * 규칙으로 읽는다(`commandOf` — codex 배열 명령의 셸 감싸개를 벗긴다): 도는 동안과 멈춘 뒤의 이름이 같다.
 */
function titleOf(tool: ToolEntry): string {
  const { title, rawInput } = tool.call;
  if (typeof title === "string" && title.trim() !== "") return title;
  const command = typeof rawInput === "object" && rawInput !== null ? commandOf((rawInput as { command?: unknown }).command) : null;
  return command ?? describeTool(tool).phrase.subject ?? "명령";
}

function ToolRow({ tool, end }: { tool: ToolEntry; end: TurnEnd | null }) {
  if (tool.stop === "ran-on") return <RanOn tool={tool} end={end} />;
  if (tool.stop === "stopped") return <Stopped tool={tool} />;
  return <ToolLine tool={tool} />;
}

/**
 * 스펙 창이 여는 파일 링크의 자리 — `link`는 경로가 spec 폴더 안이면 그 파일을 여는 일을, 밖이면 null을 준다. `docName`은 diff
 * 머리에 적을 이름이다: spec 폴더 안이면 spec 폴더 기준 경로, 밖이면 엔진이 준 경로 그대로다.
 */
function useDocLink(): {
  link: (path: string, line: number | null) => (() => void) | null;
  docName: (path: string) => string;
} {
  const docs = useContext(ChatDocsContext);
  const { data: home } = useHomeDir();
  const relative = (path: string) => (docs ? specPathOf(path, docs.specDir, home ?? null) : null);
  return {
    link: (path, line) => {
      const rel = relative(path);
      return docs && rel ? () => docs.onOpenDoc(rel, line) : null;
    },
    docName: (path) => relative(path) ?? path,
  };
}

function ToolLine({ tool }: { tool: ToolEntry }) {
  const view = describeTool(tool);
  const { link, docName } = useDocLink();
  const mcpOutput = view.mcp && view.mcp.output !== "" ? view.mcp.output : null;
  const expandable = view.shell !== null || view.diffs.length > 0 || mcpOutput !== null || view.text !== null;
  // 명령 출력과 diff는 펴진 채로 선다(머리말). MCP 출력 · 오류 글은 펼쳐야 보인다.
  const [open, setOpen] = useState(view.shell !== null || view.diffs.length > 0);
  const running = view.state === "running";
  const added = view.diffs.reduce((sum, piece) => sum + piece.added, 0);
  const deleted = view.diffs.reduce((sum, piece) => sum + piece.deleted, 0);
  const Icon = TOOL_ICONS[view.icon];
  // 지운 파일은 열 것이 없다 — 링크를 세우지 않는다(알약 목록과 같다, 티켓 26).
  const fileLink = !running && !view.removed && view.phrase.file ? link(view.phrase.file, lineOf(tool, view.phrase.file)) : null;

  const phrase = running ? (
    <span className="min-w-0 truncate chat-shimmer [--chat-shimmer-dim:var(--fg-tool-running)]">{view.label}</span>
  ) : (
    <span className="min-w-0 truncate">
      {view.phrase.before}
      {view.phrase.subject !== null &&
        (fileLink && !expandable ? (
          <button
            type="button"
            onClick={fileLink}
            className="text-fg-tool-running underline-offset-2 hover:text-fg hover:underline"
          >
            {view.phrase.subject}
          </button>
        ) : (
          <span className={view.phrase.file ? "text-fg-tool-running" : undefined}>{view.phrase.subject}</span>
        ))}
      {view.phrase.after}
    </span>
  );
  const line = (
    <>
      <Icon className="size-4 shrink-0" aria-hidden />
      {phrase}
      {view.diffs.length > 0 && !running && (
        <span className="shrink-0">
          <span className="text-diff-added">+{added}</span> <span className="text-diff-deleted">-{deleted}</span>
        </span>
      )}
      {(view.removed || (view.diffs.length > 0 && view.diffs.every((piece) => piece.written))) && !running && (
        <span
          aria-hidden
          className={cn("size-[5px] shrink-0 rounded-full", view.removed ? "bg-dot-deleted" : "bg-dot-created")}
        />
      )}
    </>
  );
  const rowClass =
    "flex w-fit max-w-full min-h-[21px] items-center gap-1.5 text-left text-sm leading-5.25 text-fg-tool";
  return (
    // 펼친 줄은 아래로 한 틈(4)을 더 둔다 — 상자 바로 밑에 다음 줄이 붙지 않게(묶음의 줄 사이는 4다).
    <div role="group" aria-label={view.label} className={cn("flex min-w-0 flex-col gap-2", expandable && open && "pb-1")}>
      {expandable ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((was) => !was)}
          className={cn(rowClass, "group transition-colors hover:text-fg")}
        >
          {line}
          {open ? (
            <ChevronDown className="size-3 shrink-0" aria-hidden />
          ) : (
            <ChevronRight
              className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
             
              aria-hidden
            />
          )}
        </button>
      ) : (
        <div className={rowClass}>{line}</div>
      )}
      {expandable && open && <Inside tool={tool} view={view} link={link} docName={docName} />}
    </div>
  );
}

/** 펼친 도구 줄의 안 — 명령 출력 · diff · MCP 출력 · 오류 글. */
function Inside({
  tool,
  view,
  link,
  docName,
}: {
  tool: ToolEntry;
  view: ToolView;
  link: (path: string, line: number | null) => (() => void) | null;
  docName: (path: string) => string;
}) {
  if (view.shell) {
    return (
      <ShellOutput
        name="명령 출력"
        label="Shell"
        command={view.shell.command}
        output={view.shell.output}
        status={view.shell.status && <StatusText ok={view.shell.ok}>{view.shell.status}</StatusText>}
      />
    );
  }
  if (view.diffs.length > 0) {
    return (
      <>
        {view.diffs.map((piece, at) => (
          <DiffView
            key={`${piece.path}-${at}`}
            piece={piece}
            name={docName(piece.path)}
            open={view.removed ? null : link(piece.path, lineOf(tool, piece.path))}
          />
        ))}
      </>
    );
  }
  if (view.mcp && view.mcp.output !== "") {
    return (
      <figure
        aria-label={`${view.mcp.tool} 출력`}
        className="rounded-xl bg-surface-code inset-ring inset-ring-border-light"
      >
        <figcaption className="px-4 pt-2.5 pb-1 text-xs text-fg-secondary">{view.mcp.tool}</figcaption>
        <pre className="overflow-x-auto px-4 pt-1.5 pb-3 font-mono text-code scroll-quiet">{view.mcp.output}</pre>
      </figure>
    );
  }
  return view.text ? <ShellOutput name="출력" label="출력" command={null} output={view.text} status={null} /> : null;
}

/**
 * 명령 출력 상자 — 캔버스 `.cx-shell-out`: 위 kind 글, `$` 명령, 출력, 오른쪽 아래 상태. 명령이 아닌 글(서브에이전트가 돌려준 글 ·
 * 실패한 도구의 오류 글)도 같은 상자에 그리므로, 상자의 이름(`name`)은 무엇의 출력인지에 맞춰 부르는 쪽이 준다 — 「명령」은 셸 안에서
 * 도는 프로세스다.
 */
function ShellOutput({
  name,
  label,
  command,
  output,
  status,
}: {
  name: string;
  label: ReactNode;
  command: string | null;
  output: string;
  status: ReactNode;
}) {
  return (
    <figure
      aria-label={name}
      className="flex flex-col gap-2.5 rounded-xl bg-surface-tool py-2.25 pr-3 pl-2.25 inset-ring inset-ring-border-tool"
    >
      <figcaption className="flex items-center gap-1.5 text-xs text-fg-tool">{label}</figcaption>
      {command !== null && (
        <span className="font-mono text-code break-all whitespace-pre-wrap">
          <span className="text-fg-tertiary">$</span> {command}
        </span>
      )}
      {output !== "" && (
        <span className="font-mono text-code break-all whitespace-pre-wrap text-fg-secondary">{output}</span>
      )}
      {status}
    </figure>
  );
}

function StatusText({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1 self-end text-chat-meta text-fg-tool-status">
      {ok && <Check className="size-3" aria-hidden />}
      {children}
    </span>
  );
}

/**
 * diff — 캔버스 `.cx-diff`: 머리(경로 · `+N` `-N`)와 줄들. 더한 줄은 `<ins>`, 지운 줄은 `<del>`이라 보조 기술도 더함 · 지움을
 * 읽는다. 바뀌지 않은 줄은 바뀐 줄 둘레만 옅게 남기고 나머지는 건너뛴 자리 한 줄로 접는다. **줄 번호는 없다** — ACP diff 내용은
 * 파일 안의 자리를 싣지 않고(Claude는 입력의 조각이다, 변환기 S2), 조각 안에서 센 번호는 파일의 줄과 어긋난다.
 */
function DiffView({ piece, name, open }: { piece: DiffPiece; name: string; open: (() => void) | null }) {
  return (
    <figure
      aria-label={`${baseName(piece.path)} diff`}
      className="flex flex-col overflow-hidden rounded-xl inset-ring inset-ring-diff-border"
    >
      <figcaption className="flex h-[30px] items-center gap-2 border-b border-diff-border bg-diff-header pr-1.5 pl-2.5 text-chat-meta">
        {open ? (
          <button
            type="button"
            onClick={open}
            className="min-w-0 truncate text-left text-fg-tool underline-offset-2 hover:text-fg hover:underline"
          >
            {name}
          </button>
        ) : (
          <span className="min-w-0 truncate text-fg-tool">{name}</span>
        )}
        <span className="shrink-0 text-diff-added">+{piece.added}</span>
        <span className="shrink-0 text-diff-deleted">-{piece.deleted}</span>
      </figcaption>
      <div className="overflow-x-auto font-mono text-xs leading-[21.6px] scroll-quiet">
        {piece.lines.map((line, at) => {
          const key = `${at}`;
          if (line.type === "gap") {
            return (
              <div key={key} className="pl-4 text-fg-tertiary">
                ⋯ {line.count}줄
              </div>
            );
          }
          const text = <span className="pr-3 pl-3 whitespace-pre">{line.text === "" ? " " : line.text}</span>;
          if (line.type === "add") {
            return (
              <ins key={key} className="grid grid-cols-[4px_minmax(0,1fr)] bg-diff-added-line no-underline">
                <span className="bg-diff-added" />
                {text}
              </ins>
            );
          }
          if (line.type === "del") {
            return (
              <del key={key} className="grid grid-cols-[4px_minmax(0,1fr)] bg-diff-deleted-line no-underline">
                <span className="bg-[repeating-linear-gradient(135deg,var(--diff-deleted)_0_1px,transparent_1px_2.8px)]" />
                {text}
              </del>
            );
          }
          return (
            <div key={key} className="grid grid-cols-[4px_minmax(0,1fr)] opacity-50">
              <span />
              {text}
            </div>
          );
        })}
      </div>
    </figure>
  );
}

function RanOn({ tool, end }: { tool: ToolEntry; end: TurnEnd | null }) {
  const title = titleOf(tool);
  const done = toolDone(tool);
  const running = !done && !tool.cut;
  const kind = tool.call.kind === "execute" ? "Shell" : "도구";
  return (
    <div role="group" aria-label={title} data-tool-stop="ran-on" className="flex min-w-0 flex-col">
      <ShellOutput
        name={kind === "Shell" ? "명령 출력" : "도구 출력"}
        label={
          <>
            {running && <Spinner className="size-3" aria-hidden />}
            {kind} · {running ? "멈춘 뒤에도 도는 중" : done ? "멈춘 뒤에 끝남" : "멈춘 뒤에 끊김"}
          </>
        }
        command={title}
        output={tool.output.replace(/\n+$/, "")}
        status={
          running && end ? (
            <StatusText ok={false}>턴은 {spoken(end.durationMs)} 후에 멈췄어요 — 명령은 끝까지 돌아요</StatusText>
          ) : null
        }
      />
    </div>
  );
}

function Stopped({ tool }: { tool: ToolEntry }) {
  const title = titleOf(tool);
  return (
    <div
      role="group"
      aria-label={title}
      data-tool-stop="stopped"
      className="flex w-fit max-w-full items-center gap-1.5 text-sm leading-5.25 text-fg-tool"
    >
      <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
        <span className="size-[9px] rounded-xs bg-current" />
      </span>
      <span className="min-w-0 truncate">{title}</span>
      <span className="shrink-0">멈춤</span>
    </div>
  );
}

export default ToolRow;

import { Spinner } from "@/components/ui/spinner";
import { spoken, toolDone, type ToolEntry, type TurnEnd } from "./fold";

// 도구 줄(three-axes 티켓 20) — 지금은 **멈춘 턴의 줄**만 그린다. 진행형 → 완료형 문구 · 명령 출력 · diff · MCP 호출은 티켓 18이
// 이 자리에 더한다(그때 멈추지 않은 줄도 선다). 멈춘 턴의 줄은 대화 접기가 ACP 모양으로 가른 둘이다(`fold.ts`의 `ToolStop`).
//
// - **멈춘 뒤에도 도는 중**(`ran-on`, 결정 28) — 캔버스 Tools 보드의 「명령 출력」 셋째 상자다: 스피너와 「Shell · 멈춘 뒤에도 도는
//   중」, `$` 명령, 늦게 온 출력, 오른쪽 아래 「턴은 N초 후에 멈췄어요 — 명령은 끝까지 돌아요」. 명령이 끝나면 「멈춘 뒤에 끝남」이고
//   출력은 그대로 붙어 있다.
// - **멈춤**(`stopped`) — 캔버스 `.cx-tool`의 ■(`.cx-stop` — 16 상자 안 9 네모)와 도구 제목이다. 멈춤과 함께 닫혀 더 올 것이 없다.
//
// 줄은 도구 제목을 이름으로 단 묶음(`role="group"`)이다 — 상태 글은 그 안의 보이는 글이다.

/** 도구의 화면 이름 — 엔진이 지은 제목, 없으면 명령, 그것도 없으면 「명령」이다(빈 제목의 kind 문구는 18). */
function titleOf(tool: ToolEntry): string {
  const { title, rawInput } = tool.call;
  if (typeof title === "string" && title.trim() !== "") return title;
  const command = typeof rawInput === "object" && rawInput !== null ? (rawInput as { command?: unknown }).command : null;
  if (typeof command === "string" && command.trim() !== "") return command;
  if (Array.isArray(command) && command.every((part) => typeof part === "string")) return command.join(" ");
  return "명령";
}

function ToolRow({ tool, end }: { tool: ToolEntry; end: TurnEnd | null }) {
  const title = titleOf(tool);
  if (tool.stop === "ran-on") {
    const running = !toolDone(tool);
    const kind = tool.call.kind === "execute" ? "Shell" : "도구";
    return (
      <div
        role="group"
        aria-label={title}
        data-tool-stop="ran-on"
        className="flex flex-col gap-2.5 rounded-(--chat-radius-block) bg-(--chat-surface-tool) py-[9px] pr-3 pl-[9px] shadow-(--chat-shadow-tool)"
      >
        <span className="flex items-center gap-1.5 text-caption text-(--chat-fg-tool)">
          {running && <Spinner className="size-3" aria-hidden />}
          {kind} · {running ? "멈춘 뒤에도 도는 중" : "멈춘 뒤에 끝남"}
        </span>
        <span className="font-mono text-mono break-all whitespace-pre-wrap">
          <span className="text-tertiary">$</span> {title}
        </span>
        {tool.output !== "" && (
          <span className="font-mono text-mono break-all whitespace-pre-wrap text-muted-foreground">
            {tool.output.replace(/\n+$/, "")}
          </span>
        )}
        {running && end && (
          <span className="self-end text-ui text-(--chat-fg-tool-status)">
            턴은 {spoken(end.durationMs)} 후에 멈췄어요 — 명령은 끝까지 돌아요
          </span>
        )}
      </div>
    );
  }
  if (tool.stop === "stopped") {
    return (
      <div
        role="group"
        aria-label={title}
        data-tool-stop="stopped"
        className="flex w-fit max-w-full items-center gap-1.5 text-row leading-(--chat-leading-tool) text-(--chat-fg-tool)"
      >
        <span className="flex size-4 shrink-0 items-center justify-center" aria-hidden>
          <span className="size-[9px] rounded-xs bg-current" />
        </span>
        <span className="min-w-0 truncate">{title}</span>
        <span className="shrink-0">멈춤</span>
      </div>
    );
  }
  return null;
}

export default ToolRow;

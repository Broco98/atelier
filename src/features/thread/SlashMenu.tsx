import { useEffect, useRef } from "react";
import type { CommandOption } from "./chips";

// 「/」 메뉴(v1 티켓 05 · restart 02b-2 · 시안 Composer 「「/」 명령」 · Thread 보드 `.ra-menu.wide`) — 입력칸이 「/」로 시작하면 입력창 위 8에 같은
// 폭으로 선다. 머리는 그 채팅 Runtime의 명령(「Claude Code 명령」)이고, 화면이 하는 명령(`/new` 새 Thread)이 먼저, Runtime이 보낸 명령이 뒤에
// 붙는다(구현 스펙 §14). 모양은 입력창 칩의 메뉴와 같은 카드(16 반경 · 안쪽 6 · 떠 있는 면 · 줄 사이 1)이고, 줄(30 · 좌우 8 · 둥글기 10)은 고정폭 13의
// 명령 뒤 10에 설명(12/16 `fg-tertiary`)이 이어 선다 — 설명이 길면 말줄임으로 끊긴다. 켜진 줄은 `fill-soft` 면이다. 문구는 Runtime이 보낸
// 대로다. three-axes 메뉴(`chat/SlashMenu.tsx`)의 규칙 그대로 **포커스는 입력칸에 남는다** — 입력칸이 `aria-activedescendant`로 켜진 줄을 가리키고
// ↑ · ↓ · Enter · Tab · Esc는 입력칸이 받는다.

/** 메뉴가 찾는 말 — 입력칸이 「/」로 시작하고 아직 띄어 쓰지 않았으면 「/」 뒤의 글자, 아니면 `null`. */
export function slashQuery(draft: string): string | null {
  const typed = /^\/(\S*)$/.exec(draft);
  return typed ? typed[1] : null;
}

const bare = (name: string) => name.replace(/^\$/, "").toLowerCase();

/** 친 글자로 명령을 찾는다 — 그 글자로 시작하는 것을 먼저, 품은 것을 뒤에 둔다. 차례는 준 차례 그대로다. */
export function matchCommands(commands: readonly CommandOption[], query: string): CommandOption[] {
  const typed = query.toLowerCase();
  const keys = (command: CommandOption) => [bare(command.name), ...command.aliases.map(bare)];
  const starts = commands.filter((command) => keys(command).some((key) => key.startsWith(typed)));
  const contains = commands.filter((command) => !starts.includes(command) && keys(command).some((key) => key.includes(typed)));
  return [...starts, ...contains];
}

export const commandText = (command: CommandOption) => (command.name.startsWith("$") ? command.name : `/${command.name}`);

export const optionId = (menuId: string, at: number) => `${menuId}-${at}`;

function SlashMenu({
  id,
  items,
  active,
  onPick,
  onPoint,
  runtime,
}: {
  id: string;
  items: readonly CommandOption[];
  active: number;
  onPick: (command: CommandOption) => void;
  onPoint: (at: number) => void;
  /** 그 채팅 Runtime의 이름 — 메뉴 머리가 「… 명령」이다. */
  runtime: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[id="${optionId(id, active)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [id, active]);
  return (
    <div
      ref={list}
      id={id}
      role="listbox"
      aria-label="명령"
      className="absolute inset-x-0 bottom-full z-10 mb-2 flex max-h-[min(320px,50vh)] flex-col gap-px overflow-y-auto rounded-2xl bg-surface-elevated p-1.5 shadow-prominent scroll-quiet"
    >
      <div aria-hidden className="shrink-0 px-2 pt-1.5 pb-0.5 text-xs text-fg-tertiary">
        {runtime} 명령
      </div>
      {items.map((command, at) => (
        <div
          key={command.name}
          id={optionId(id, at)}
          role="option"
          aria-selected={at === active}
          aria-label={commandText(command)}
          aria-description={command.description || undefined}
          onMouseDown={(event) => event.preventDefault()}
          onMouseMove={() => {
            if (at !== active) onPoint(at);
          }}
          onClick={() => onPick(command)}
          className="flex min-h-7.5 shrink-0 cursor-default items-center gap-2.5 rounded-lg px-2 text-chat-meta whitespace-nowrap text-fg aria-selected:bg-fill-soft"
        >
          <span className="max-w-48 shrink-0 truncate font-mono text-code">{commandText(command)}</span>
          <span className="min-w-0 truncate text-xs leading-4 text-fg-tertiary">{command.description}</span>
        </div>
      ))}
    </div>
  );
}

export default SlashMenu;

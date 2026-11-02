import { useEffect, useRef, type ReactNode } from "react";
import { File } from "lucide-react";
import type { CommandOption } from "./chips";
import type { MentionFile } from "./mentions";

// 「/」 메뉴(v1 티켓 05 · restart 02b-2 · 시안 Composer 「「/」 명령」 · Thread 보드 `.ra-menu.wide`) — 입력칸이 「/」로 시작하면 입력창 위 8에 같은
// 폭으로 선다. 머리는 그 채팅 Runtime의 명령(「Claude Code 명령」)이고, 화면이 하는 명령(`/new` 새 Thread)이 먼저, Runtime이 보낸 명령이 뒤에
// 붙는다(구현 스펙 §14). 모양은 입력창 칩의 메뉴와 같은 카드(16 반경 · 안쪽 6 · 떠 있는 면 · 줄 사이 1)이고, 줄(30 · 좌우 8 · 둥글기 10)은 고정폭 13의
// 명령 뒤 10에 설명(12/16 `fg-tertiary`)이 이어 선다 — 설명이 길면 말줄임으로 끊긴다. 켜진 줄은 `fill-soft` 면이다. 문구는 Runtime이 보낸
// 대로다. three-axes 메뉴(`chat/SlashMenu.tsx`)의 규칙 그대로 **포커스는 입력칸에 남는다** — 입력칸이 `aria-activedescendant`로 켜진 줄을 가리키고
// ↑ · ↓ · Enter · Tab · Esc는 입력칸이 받는다.
//
// 「@」 메뉴(restart 02b-3 · Composer 「「@」 언급」)도 같은 카드 · 같은 줄이다(`MentionMenu`) — 머리 「파일」 아래 줄마다 파일 글리프(15
// `fg-secondary`)와 경로가 서고, 작업 폴더 밖의 파일은 줄 끝에 자리 이름(12 `fg-tertiary` — `.ra-mi .k`)이 선다. 둘 다 열 때 움직이지 않는다(Motion
// 「메뉴가 열린다」는 앱 그대로 — 움직이는 메뉴는 모델 메뉴 하나다).

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

/** 입력창 위의 목록 카드 — 머리 한 줄과 줄들. 켜진 줄이 보이게 구른다. */
function ComposerListbox({ id, label, head, active, children }: { id: string; label: string; head: string; active: number; children: ReactNode }) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>(`[id="${optionId(id, active)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [id, active]);
  return (
    <div
      ref={list}
      id={id}
      role="listbox"
      aria-label={label}
      className="absolute inset-x-0 bottom-full z-10 mb-2 flex max-h-[min(320px,50vh)] flex-col gap-px overflow-y-auto rounded-2xl bg-surface-elevated p-1.5 shadow-prominent scroll-quiet"
    >
      <div aria-hidden className="shrink-0 px-2 pt-1.5 pb-0.5 text-xs text-fg-tertiary">
        {head}
      </div>
      {children}
    </div>
  );
}

/** 목록의 줄 하나 — 누르기 전에 포커스를 가져가지 않고(입력칸에 남는다), 가리키면 켜진다. */
function ListOption({
  id,
  selected,
  label,
  description,
  onPick,
  onPoint,
  children,
}: {
  id: string;
  selected: boolean;
  label: string;
  description?: string;
  onPick: () => void;
  onPoint: () => void;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      role="option"
      aria-selected={selected}
      aria-label={label}
      aria-description={description || undefined}
      onMouseDown={(event) => event.preventDefault()}
      onMouseMove={() => {
        if (!selected) onPoint();
      }}
      onClick={onPick}
      className="flex min-h-7.5 shrink-0 cursor-default items-center gap-2.5 rounded-lg px-2 text-chat-meta whitespace-nowrap text-fg aria-selected:bg-fill-soft"
    >
      {children}
    </div>
  );
}

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
  return (
    <ComposerListbox id={id} label="명령" head={`${runtime} 명령`} active={active}>
      {items.map((command, at) => (
        <ListOption
          key={command.name}
          id={optionId(id, at)}
          selected={at === active}
          label={commandText(command)}
          description={command.description}
          onPick={() => onPick(command)}
          onPoint={() => onPoint(at)}
        >
          <span className="max-w-48 shrink-0 truncate font-mono text-code">{commandText(command)}</span>
          <span className="min-w-0 truncate text-xs leading-4 text-fg-tertiary">{command.description}</span>
        </ListOption>
      ))}
    </ComposerListbox>
  );
}

/** 「@」 메뉴 — 찾은 파일. 고르면 입력칸이 그 파일의 `@경로`를 넣는다(`insertMention`). */
export function MentionMenu({
  id,
  files,
  active,
  onPick,
  onPoint,
}: {
  id: string;
  files: readonly MentionFile[];
  active: number;
  onPick: (file: MentionFile) => void;
  onPoint: (at: number) => void;
}) {
  return (
    <ComposerListbox id={id} label="파일" head="파일" active={active}>
      {files.map((file, at) => (
        <ListOption
          key={file.path}
          id={optionId(id, at)}
          selected={at === active}
          label={file.shown}
          description={file.place ?? undefined}
          onPick={() => onPick(file)}
          onPoint={() => onPoint(at)}
        >
          <File className="size-3.75 shrink-0 text-fg-secondary" aria-hidden />
          <span className="min-w-0 flex-1 truncate">{file.shown}</span>
          {file.place && <span className="shrink-0 text-xs text-fg-tertiary">{file.place}</span>}
        </ListOption>
      ))}
    </ComposerListbox>
  );
}

export default SlashMenu;

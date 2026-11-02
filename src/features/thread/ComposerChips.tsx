import type { ReactNode, RefObject } from "react";
import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import {
  Bot,
  ChevronDown,
  Eye,
  Folder,
  GitBranch,
  Layers,
  Map as MapGlyph,
  MessageSquare,
  Pencil,
  Shield,
  Terminal,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { addProject } from "@/features/projects/add-store";
import { useProjects } from "@/features/projects/hooks";
import { useServices } from "@/features/services/hooks";
import type { ReadingScope, ScopePick } from "@/features/services/scope";
import { scopeMenu } from "@/features/services/service-view";
import { ASK_LEVELS, askLevelOf, chipLabel, chipParts, type ModeChipValue, type ModelChipValue } from "./chips";
import { RUNTIMES, runtimeNameOf, type Runtime } from "./runtime";
import { scopeChip, scopeLine, type ShownScope } from "./service-chip";
import type { AskLevel } from "./types";
import { NEW_WORK } from "./work-chip";

// 입력창의 칩과 메뉴(v1 티켓 05 · 23 · 31 · 02 티켓 10 · 03 구현 스펙 §5 · §6 · restart 01c-3 · 01c-5 · 02b-2 · 시안 Composer · Thread 보드) — 입력칸 아래
// 줄에 `+` 다음으로 모드 칩이, 보내기 원 앞에 Runtime 칩과 모델 칩이 선다. 트레이(첫 말 전의 새 채팅만)에는 「새 작업공간」 칩과 범위 칩이 선다.
// 받는 이 칩은 없다(결정.md 「사용자 결정: 입력창 다듬기」).
// - **칩은 시안 `.ra-cc`다** — 테두리 · 면 없는 28 알약 · 좌우 8 · 글리프와 글자 사이 5 · 13/18. 가리키거나 메뉴가 열린 동안 `fill-hover` 면이 선다.
//   모드 칩 · 트레이 칩은 `fg-secondary`, Runtime · 모델 칩은 본문색, 잠긴 칩은 `fg-tertiary`다. 셰브런 12와 생각 깊이는 `fg-tertiary`다.
// - **모드 칩**은 방패 · 지금 모드 이름이다(Claude Code는 물어보는 정도, Codex는 Codex 모드). 입력창이 520보다 좁으면 방패만 남는다(「좁을 때」 —
//   이름은 접근성 이름에 남는다).
// - **Runtime 칩**은 새 채팅에서만 이름 ▾로 메뉴가 열리고, 턴이 시작되면 이름만 남아 잠긴다(`.ra-cc.locked`).
// - **모델 칩**은 「모델 생각 깊이 ▾」다 — 모델은 본문색, 생각 깊이는 옅은 글자다(「Opus 5.5 High」). 생각 깊이는 턴이 도는 동안 바꿀 수 없다(엔진이
//   거절한다 — 그래서 그동안 잠근다). 목록이 없으면 보이기만 한다.
// - **메뉴는 시안 `.ra-menu`다** — 입력창 상자 위 8에 서고(모드 · 범위 메뉴는 상자 왼쪽 8, Runtime · 모델 메뉴는 오른쪽 8), 폭 280(Runtime ·
//   범위는 320) · 안쪽 6 · 둥글기 16 · 떠 있는 면 · 줄 사이 1이다. 머리 글자는 위 6 · 좌우 8 · 아래 2의 12/18 `fg-tertiary`, 줄(`.ra-mi`)은
//   글리프 15 · 이름 13/18과 그 아래 설명 12/16 `fg-tertiary` · 끝의 체크 14이고 가리킨 줄은 `fill-soft` 면이다. 설명은 줄을 바꿔 다 선다.
//   위험한 줄(묻지 않음 · Full access)은 이름과 글리프가 경고 색이다.
// - **「새 작업공간」 칩**은 작업공간 만들기로 연 새 채팅에만 범위 칩 앞에 서고 ×로 뺀다(git-branch · `fg-secondary`). **범위 칩**은 「범위 없음 ▾」
//   이거나 고른 Service · Project의 이름 ▾다 — 빼기는 메뉴의 「범위 없음」이다. 그 곁의 **범위 줄**이 지금 읽는 Project를 한 줄로 말한다.

/** 칩(`.ra-cc`) — 28 알약 · 좌우 8 · 사이 5 · 13/18. 색은 갈래가 더한다. */
const CHIP =
  "flex h-7 min-w-7 shrink-0 items-center justify-center gap-1.25 rounded-full px-2 text-chat-meta whitespace-nowrap transition-colors outline-none focus-ring";
/** 누르는 칩 — 가리키거나 메뉴가 열린 동안 켜짐 면. */
const PRESS = "hover:bg-fill-hover data-[popup-open]:bg-fill-hover";
/** 칩 안의 옅은 조각(`.ra-cc .m`) — 셰브런 · 생각 깊이 · ×. */
const MUTED = "text-fg-tertiary";
/** 칩 끝의 셰브런 12. */
const chevron = <ChevronDown className={cn("size-3 shrink-0", MUTED)} aria-hidden />;

/** 메뉴 카드(`.ra-menu`) — 입력창 상자 위 8, 상자 끝에서 8 들어선다. 줄 사이는 1이다. */
function ComposerMenu({
  anchor,
  align,
  width,
  grows,
  children,
}: {
  anchor?: RefObject<HTMLElement | null>;
  align: "start" | "end";
  width: "prompt" | "prompt-wide";
  grows?: boolean;
  children: ReactNode;
}) {
  return (
    <DropdownMenuContent anchor={anchor} side="top" align={align} sideOffset={8} alignOffset={8} width={width} grows={grows} className={LIST_GAP}>
      {children}
    </DropdownMenuContent>
  );
}

/** 메뉴의 줄 사이 1 — 카드와 묶음이 함께 쓴다. */
const LIST_GAP = "gap-px";

/** 메뉴 머리 글자(`.ra-menu .sec`) — 위 6 · 좌우 8 · 아래 2. */
function MenuHead({ children }: { children: ReactNode }) {
  return <DropdownMenuLabel className="pt-1.5 pb-0.5">{children}</DropdownMenuLabel>;
}

/**
 * 고르는 줄(`.ra-mi`) — 글리프 · 이름과 그 아래 설명 · 고른 것의 체크다. 위아래 5 · 가운데 맞춤이고, 가리킨 줄은 `fill-soft` 면이다. 위험한
 * 줄은 이름과 글리프가 경고 색이다(설명은 그대로 옅다).
 */
function PickRow({
  value,
  name,
  description,
  glyph: Glyph,
  risk = false,
  label = name,
  after,
}: {
  value: string;
  name: string;
  description?: string | null;
  glyph?: LucideIcon;
  risk?: boolean;
  /** 접근성 이름 — 기본은 보이는 이름이다. */
  label?: string;
  /** 이름 뒤의 옅은 곁말(범위 메뉴의 「문제 있음」). */
  after?: ReactNode;
}) {
  return (
    <DropdownMenuRadioItem
      value={value}
      label={name}
      aria-label={label}
      aria-description={description ?? undefined}
      size="note"
      className={cn(ROW, risk && "text-warning focus:text-warning")}
    >
      {Glyph && <Glyph className={cn(risk && "text-warning")} aria-hidden />}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate">{name}</span>
          {after && <span className="shrink-0 text-xs text-fg-tertiary">{after}</span>}
        </span>
        {description && <span className="text-xs leading-4 text-fg-tertiary">{description}</span>}
      </span>
    </DropdownMenuRadioItem>
  );
}

/** 고르는 줄의 바탕 — 위아래 5 · 가운데 맞춤 · 가리킨 줄은 `fill-soft`(앱 메뉴의 `fill-hover`보다 옅다). */
const ROW = "items-center py-1.25 focus:bg-fill-soft";

/** 모델 칩이 받는 것 — 그 채팅의 Runtime과 칩의 값(`ModelChipValue`), 고르기. */
export interface ModelChoice extends ModelChipValue {
  runtime: Runtime | string;
  onModel: (value: string) => void;
  onEffort: (value: string) => void;
}

interface ModelChipProps extends ModelChoice {
  /** 턴이 도는가 — 생각 깊이를 잠근다. */
  running: boolean;
  /** 메뉴의 열림 — 칩을 누르거나 `/model`이 연다. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 메뉴의 닻 — 입력창 상자. */
  anchor?: RefObject<HTMLElement | null>;
}

/**
 * 모델 칩과 메뉴(Composer 「모델」 · Thread 보드 「모델과 생각 깊이」) — 「모델 생각 깊이 ▾」. 메뉴는 「모델」 아래 Runtime이 보낸 모델이 이름과
 * 설명으로 서고, 그 아래 「생각 깊이」 칸 줄이다. 열릴 때 움직이는 메뉴는 이것 하나다 — .32s · 30ms 늦게 · .98배 · 아래 2에서 선다(Motion 「메뉴가
 * 열린다」).
 */
export function ModelChip({ models, model, efforts, effort, running, onModel, onEffort, open, onOpenChange, anchor }: ModelChipProps) {
  const label = chipLabel(models, model, effort, efforts);
  const parts = chipParts(models, model, effort, efforts);
  const text = (
    <>
      <span className="min-w-0 truncate">{parts.model}</span>
      {parts.depth && <span className={cn(MUTED, "shrink-0")}>{parts.depth}</span>}
    </>
  );
  if (!models || models.length === 0) {
    // 고를 목록이 없다 — Session이 열려야 Runtime이 낸 목록이 선다. 그때까지는 채팅의 값을 보이기만 한다.
    return (
      <span aria-label={`모델 ${label}`} className={cn(CHIP, "text-fg")}>
        {text}
      </span>
    );
  }
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger aria-label={`모델과 생각 깊이 ${label}`} className={cn(CHIP, PRESS, "max-w-56 min-w-0 text-fg")}>
        {text}
        {chevron}
      </DropdownMenuTrigger>
      <ComposerMenu anchor={anchor} align="end" width="prompt" grows>
        <DropdownMenuGroup className={LIST_GAP}>
          <MenuHead>모델</MenuHead>
          <DropdownMenuRadioGroup
            value={model ?? ""}
            onValueChange={(next: string) => {
              if (next !== model) onModel(next);
            }}
          >
            {models.map((option) => (
              <PickRow key={option.value} value={option.value} name={option.name} description={option.description} />
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        {efforts && efforts.length > 0 && (
          <DropdownMenuGroup className={LIST_GAP}>
            <MenuHead>{running ? "생각 깊이 · 턴이 끝나면 바꿀 수 있어요" : "생각 깊이"}</MenuHead>
            {/* 칸 줄(DS `.at-seg`) — 메뉴의 라디오 줄이라 ↑ · ↓로도 지난다. 고른 칸만 떠 있는 흰 면이다. 칸 폭은 제 글자 폭에서 남는 폭을
                나눠 갖는다(`flex-auto`) — 다섯을 같은 폭으로 나누면 「아주 높음」만 칸에 빠듯했다(v1 티켓 46). */}
            <MenuPrimitive.RadioGroup
              value={effort ?? ""}
              onValueChange={(next: string) => {
                if (next !== effort) onEffort(next);
              }}
              className="mx-1 mt-0.5 mb-1 flex gap-0.5 rounded-lg bg-fill-soft p-0.5"
            >
              {efforts.map((one) => (
                <MenuPrimitive.RadioItem
                  key={one.value}
                  value={one.value}
                  label={one.name}
                  disabled={running}
                  closeOnClick
                  className="flex h-6.5 flex-auto cursor-default items-center justify-center rounded-md px-1.5 text-xs whitespace-nowrap text-fg-secondary outline-hidden select-none focus:bg-fill-hover data-checked:bg-surface data-checked:text-fg data-checked:shadow-hairline data-disabled:opacity-55"
                >
                  {one.name}
                </MenuPrimitive.RadioItem>
              ))}
            </MenuPrimitive.RadioGroup>
          </DropdownMenuGroup>
        )}
      </ComposerMenu>
    </DropdownMenu>
  );
}

/** 「새 작업공간」 칩이 받는 것 — 뺀다. 빼면 그냥 새 채팅이다. */
export interface NewWorkChoice {
  kind: "new-work";
  onDrop: () => void;
}

/** 범위 칩이 받는 것 — 쥔 범위(없으면 `null`), 그 칩이 바꾸는 것이 Work의 Service인가(메뉴에 Project 줄이 없다), 고르기, 범위 줄의 읽는 범위. */
export interface ScopeChoice {
  /** 칩이 보이는 범위 — 읽는 범위가 싣는 것이다(없거나 그것이 사라졌으면 `null`). */
  shown: ShownScope | null;
  ofWork: boolean;
  onPick: (pick: ScopePick) => void;
  reading: ReadingScope | undefined;
}

/**
 * 입력창 트레이(Composer 「새 채팅 · 범위 트레이」) — 첫 말 전의 새 채팅에만 상자 아래에 붙는 회색 띠다. 작업공간 만들기로 연 새 채팅이면 「새
 * 작업공간」 칩(`work`)이 앞에 서고, 그 뒤에 범위 칩과 범위 줄이 선다(`scope`).
 */
export interface ComposerTray {
  work?: NewWorkChoice;
  scope?: ScopeChoice;
}

/**
 * 「새 작업공간」 칩(Composer 「새 채팅 · 범위 트레이」) — 작업공간 만들기로 연 새 채팅의 첫 말 전에만 범위 칩 앞에 선다. 고르는 메뉴는 없고 ×로 빼면
 * 그냥 새 채팅이다. 다시 세우는 길은 칩에 없다 — 작업공간 만들기로 다시 연다.
 */
export function NewWorkChip({ onDrop }: NewWorkChoice) {
  return (
    <span data-slot="new-work-chip" className={cn(CHIP, "pr-1 text-fg-secondary")}>
      <GitBranch className="size-3.5 shrink-0" aria-hidden />
      {NEW_WORK}
      {/* × — 이름 끝 5에 선 12 글리프의 단추다. 누를 자리는 글리프보다 크다(20). */}
      <button
        type="button"
        aria-label={`${NEW_WORK} 빼기`}
        onClick={onDrop}
        className={cn("-ml-1 flex size-5 shrink-0 items-center justify-center rounded-full outline-none hover:text-fg focus-ring", MUTED)}
      >
        <X className="size-3" aria-hidden />
      </button>
    </span>
  );
}

/** 고른 범위의 글리프 — Service는 층, Project는 폴더다(시안 Composer 「범위 메뉴」). 범위 없음은 층이다. */
const SCOPE_GLYPH = { service: Layers, project: Folder } as const;

/**
 * 범위 칩과 메뉴(03 §5 · Composer 「새 채팅 · 범위 트레이」 · 「범위 메뉴」) — 「범위 없음 ▾」이거나 고른 Service · Project의 이름 ▾다(`fg-secondary`).
 * 누르면 입력창 상자 위에 범위 메뉴가 열린다 — 빼기는 메뉴의 「범위 없음」이다.
 */
export function ScopeChip({ shown, ofWork, onPick, anchor }: ScopeChoice & { anchor?: RefObject<HTMLElement | null> }) {
  const look = scopeChip(shown);
  const Glyph = look.kind === "on" ? SCOPE_GLYPH[look.of] : Layers;
  const name = look.kind === "on" ? look.name : "범위 없음";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={look.kind === "on" ? `범위: ${look.name}` : "범위 없음"}
        className={cn(CHIP, PRESS, "min-w-0 shrink text-fg-secondary")}
      >
        <Glyph className="size-3.5 shrink-0" aria-hidden />
        <span className="max-w-44 min-w-0 truncate">{name}</span>
        {chevron}
      </DropdownMenuTrigger>
      <ComposerMenu anchor={anchor} align="start" width="prompt-wide">
        <ScopeMenuItems current={shown} onPick={onPick} withProjects={!ofWork} />
      </ComposerMenu>
    </DropdownMenu>
  );
}

/** 범위 메뉴 줄의 글리프 — 범위 없음은 말풍선이다(시안 Composer 「범위 메뉴」). */
const SCOPE_ROW_GLYPH: Record<"none" | "service" | "project", LucideIcon> = { none: MessageSquare, ...SCOPE_GLYPH };

/** 범위 메뉴의 라디오 값 — Service와 Project의 slug가 겹쳐도 갈린다. */
const scopeValue = (pick: ScopePick) => (pick === null ? "\u0000none" : `${pick.kind}:${pick.slug}`);

/**
 * 범위 메뉴의 몸(시안 Composer 「범위 메뉴」) — 「이 채팅이 읽을 곳」 아래 범위 없음 · Service · Project에서 이 채팅이 읽을 곳을 고른다. 고른 것은
 * 입력창이 쥐었다가 첫 말과 함께 간다. 작업공간을 고른 동안은 그 작업공간의 Service만 고른다(`withProjects`가 아니다). 줄은 순수 함수가 짓는다
 * (`scopeMenu`). 보드 칸에 없는 끝 줄(「Service 관리」 · 「대화로 Service 만들기」)은 두지 않는다 — Service 화면이 그 길이다.
 */
function ScopeMenuItems({ current, onPick, withProjects }: { current: ScopePick; onPick: (pick: ScopePick) => void; withProjects: boolean }) {
  const { data: services = [] } = useServices();
  const { data: projects = [] } = useProjects();
  const rows = scopeMenu(services, projects, current, withProjects);
  const value = scopeValue(rows.find((row) => row.current)?.pick ?? null);
  return (
    <DropdownMenuRadioGroup
      value={value}
      onValueChange={(next: string) => {
        if (next === value) return;
        const row = rows.find((one) => scopeValue(one.pick) === next);
        if (row) onPick(row.pick);
      }}
    >
      <DropdownMenuGroup className={LIST_GAP}>
        <MenuHead>이 채팅이 읽을 곳</MenuHead>
        {rows.map((row) => (
          <PickRow
            key={scopeValue(row.pick)}
            value={scopeValue(row.pick)}
            name={row.name}
            label={row.troubled ? `${row.name} 문제 있음` : row.name}
            after={row.troubled && "문제 있음"}
            description={row.note}
            glyph={SCOPE_ROW_GLYPH[row.pick?.kind ?? "none"]}
          />
        ))}
      </DropdownMenuGroup>
    </DropdownMenuRadioGroup>
  );
}

/**
 * 범위 줄(03 §5 · 시안 `.tray .scope`) — 범위 칩 옆 한 줄, 지금 읽는 Project다(읽는 범위 — `scopeLine`). 칩 틈에 4를 더 띄우고 좁으면
 * 말줄임으로 끊긴다. 빈 Service · 등록된 Project 없음은 경고 색이고, 등록된 Project가 없으면 끝의 「Project 추가」가 Project 추가 창을 연다 —
 * 대화는 막지 않는다. 범위를 아직 못 읽었으면 서지 않는다.
 */
export function ScopeLineText({ scope }: { scope: ReadingScope | undefined }) {
  if (!scope) return null;
  const line = scopeLine(scope);
  return (
    <span
      data-slot="scope-line"
      className={cn("ml-1 min-w-0 truncate text-xs", line.warn ? "text-fg-notice-warn-line" : "text-fg-tertiary")}
    >
      {line.text}
      {line.addProject && (
        <>
          {" · "}
          <button type="button" onClick={() => void addProject()} className="rounded-sm text-mine outline-none hover:underline focus-ring">
            Project 추가
          </button>
        </>
      )}
    </span>
  );
}

/** Runtime 칩이 받는 것 — 그 채팅의 Runtime과, 새 채팅이면 고르기. 고르기가 없으면 잠긴 칩이다(턴이 시작된 채팅). */
export interface RuntimeChoice {
  value: Runtime | string;
  onPick?: (runtime: Runtime) => void;
}

/** Runtime 메뉴 줄의 글리프(Composer 「Runtime 고르기」 — `ic-bot` · `ic-terminal`). */
const RUNTIME_GLYPH: Record<Runtime, LucideIcon> = { "claude-code": Bot, codex: Terminal };

/**
 * Runtime 칩(Composer 「Runtime 고르기」) — 고를 수 있으면 지금 Runtime 이름 ▾(본문색)에 메뉴가 열리고, 잠겼으면 옅은 이름만 선다. 메뉴는 「이 채팅을
 * 돌릴 Runtime」 아래 Claude Code와 Codex가 글리프 · 이름 · 설명으로 서고 고른 것에만 체크가 붙는다. 쓸 수 있는지 확인하는 동안 보내기를 잠그는 것은
 * 입력창이다(`checking`).
 */
export function RuntimeChip({ value, onPick, anchor }: RuntimeChoice & { anchor?: RefObject<HTMLElement | null> }) {
  const name = runtimeNameOf({ runtime: value });
  if (!onPick) {
    return (
      <span data-slot="runtime-chip" aria-label={`Runtime ${name}`} className={cn(CHIP, "cursor-default text-fg-tertiary")}>
        {name}
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger data-slot="runtime-chip" aria-label={`Runtime: ${name}`} className={cn(CHIP, PRESS, "text-fg")}>
        {name}
        {chevron}
      </DropdownMenuTrigger>
      <ComposerMenu anchor={anchor} align="end" width="prompt-wide">
        <DropdownMenuGroup className={LIST_GAP}>
          <MenuHead>이 채팅을 돌릴 Runtime</MenuHead>
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(next: Runtime) => {
              if (next !== value) onPick(next);
            }}
          >
            {RUNTIMES.map((one) => (
              <PickRow key={one.value} value={one.value} name={one.name} description={one.description} glyph={RUNTIME_GLYPH[one.value]} />
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </ComposerMenu>
    </DropdownMenu>
  );
}

/** 모드 칩이 받는 것 — Claude Code는 물어보는 정도와 바꾸기, Codex는 Codex 모드와 고르기(restart 01c-5). */
export type ModeChoice =
  | (Extract<ModeChipValue, { kind: "ask" }> & { onLevel: (level: AskLevel) => void })
  | (Extract<ModeChipValue, { kind: "codex" }> & { onPick: (mode: string) => void });

/** 모드 칩의 얼굴 — 방패 14와 이름. 입력창이 520보다 좁으면 방패만 남는다(Composer 「좁을 때」). */
function ModeFace({ name }: { name: string }) {
  return (
    <>
      <Shield className="size-3.5 shrink-0" aria-hidden />
      <span className="@max-[520px]:hidden">{name}</span>
    </>
  );
}

/**
 * Codex 모드의 글리프(Composer 「모드 · Codex」) — 모드 id로 고른다. 읽기만은 눈, 작업공간은 연필, 자동 검토는 방패, 전체 권한은 번개이고 위험한
 * 줄이다. 모르는 모드는 방패다 — 이름과 설명은 Codex가 보낸 글 그대로다.
 */
const CODEX_MODE_LOOK: Readonly<Record<string, { glyph: LucideIcon; risk?: true }>> = {
  "read-only": { glyph: Eye },
  "workspace-write": { glyph: Pencil },
  agent: { glyph: Shield },
  "agent-full-access": { glyph: Zap, risk: true },
};

/**
 * Codex 모드 칩과 메뉴(Composer 「모드 · Codex」 · 스토리 24) — 방패 · 지금 모드 이름이다. 메뉴는 「Codex가 정하는 모드예요」 아래 Codex가 보낸 모드를
 * 이름과 설명 그대로 세우고 고른 것에만 체크가 붙는다. Claude의 물어보는 정도와 합치지 않는다. 목록이 없으면(첫 말 전 — 「첫 말 전 Codex」) 보이기만 한다.
 */
export function CodexModeChip({
  value,
  name,
  options,
  onPick,
  anchor,
}: Extract<ModeChoice, { kind: "codex" }> & { anchor?: RefObject<HTMLElement | null> }) {
  if (!options || options.length === 0) {
    return (
      <span aria-label={`Codex 모드 ${name}`} className={cn(CHIP, "text-fg-secondary")}>
        <ModeFace name={name} />
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={`Codex 모드 ${name}`} className={cn(CHIP, PRESS, "text-fg-secondary")}>
        <ModeFace name={name} />
      </DropdownMenuTrigger>
      <ComposerMenu anchor={anchor} align="start" width="prompt">
        <DropdownMenuGroup className={LIST_GAP}>
          <MenuHead>Codex가 정하는 모드예요</MenuHead>
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(next: string) => {
              if (next !== value) onPick(next);
            }}
          >
            {options.map((one) => {
              const look = CODEX_MODE_LOOK[one.value] ?? { glyph: Shield };
              return (
                <PickRow
                  key={one.value}
                  value={one.value}
                  name={one.name}
                  description={one.description}
                  glyph={look.glyph}
                  risk={look.risk === true}
                />
              );
            })}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </ComposerMenu>
    </DropdownMenu>
  );
}

/** 물어보는 정도 칩이 받는 것 — 지금 정도 · 바꾸기, 그리고 `/policy`가 메뉴를 여는 열림 상태. */
export interface AskChoice {
  level: AskLevel;
  onLevel: (level: AskLevel) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 메뉴의 닻 — 입력창 상자. */
  anchor?: RefObject<HTMLElement | null>;
}

/** 물어보는 정도의 글리프(Composer 「모드 · Claude Code」) — 매번 묻기 방패 · 편집 자동 연필 · 계획 지도 · 묻지 않음 번개(위험한 줄). */
const ASK_LOOK: Record<AskLevel, { glyph: LucideIcon; risk?: true }> = {
  always: { glyph: Shield },
  edits: { glyph: Pencil },
  plan: { glyph: MapGlyph },
  auto: { glyph: Zap, risk: true },
};

/** 물어보는 정도 칩과 메뉴(Composer 「모드 · Claude Code」 — 앱이 쥔 네 모드, 판정은 앱이 한다). */
export function AskChip({ level, onLevel, open, onOpenChange, anchor }: AskChoice) {
  const name = askLevelOf(level)?.name ?? level;
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger aria-label={`물어보는 정도 ${name}`} className={cn(CHIP, PRESS, "text-fg-secondary")}>
        <ModeFace name={name} />
      </DropdownMenuTrigger>
      <ComposerMenu anchor={anchor} align="start" width="prompt">
        <DropdownMenuGroup className={LIST_GAP}>
          <MenuHead>물어보는 정도</MenuHead>
          <DropdownMenuRadioGroup
            value={level}
            onValueChange={(next: AskLevel) => {
              if (next !== level) onLevel(next);
            }}
          >
            {ASK_LEVELS.map((one) => (
              <PickRow
                key={one.value}
                value={one.value}
                name={one.name}
                description={one.description}
                glyph={ASK_LOOK[one.value].glyph}
                risk={ASK_LOOK[one.value].risk === true}
              />
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </ComposerMenu>
    </DropdownMenu>
  );
}

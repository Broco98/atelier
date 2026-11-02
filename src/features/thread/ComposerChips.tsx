import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { ChevronDown, Folder, FolderPlus, Layers, MessageSquare, Shield, X, type LucideIcon } from "lucide-react";
import { agentMarkOf } from "@/components/ui/agent-mark";
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
import type { ReadingScope, ScopePick } from "@/features/services/scope";
import { ScopeMenuItems } from "@/features/services/ServiceMenu";
import { ASK_LEVELS, askLevelOf, chipLabel, chipParts, EFFORTS, type ChoiceOption } from "./chips";
import { RUNTIMES, runtimeNameOf, type Runtime } from "./runtime";
import { scopeChip, scopeLine, type ShownScope } from "./service-chip";
import type { AskLevel, ThreadLink } from "./types";
import { NEW_WORK, type LockedWork } from "./work-chip";

// 입력창의 칩(v1 티켓 05 · 23 · 31 · 02 티켓 10 · 02 구현 스펙 §9 · 03 구현 스펙 §5 · §6 · 캔버스 v35 Diff-Chat · v52 F4-KitComposer) — 입력칸
// 아래 줄에 `+` 다음으로 물어보는 정도가, 보내기 원 앞에 모델 · 생각 깊이가 선다(입력창 안은 이 셋뿐이다 — `@` 단추는 숨겼다, 03 §6). Work
// 칩은 입력창 **밖** 트레이에 선다 — 첫 화면은 상자 아래, Thread 화면은 상자 위다(03 §5). 받는 이 칩은 없다(결정.md 「사용자 결정: 입력창
// 다듬기」) — 받는 이는 말의 첫 멘션이 정하고 입력칸의 멘션 칠이 보인다.
// - **칩은 Codex의 ghost 알약이다**(Diff-Chat 「칩」) — 테두리 · 면 없는 28 알약 · 좌우 6 · 13px `fg-subtle`. 모델 칩만 본문색 · 좌우 8이다
//   (시안의 「Claude Code Default」 칩). 내용과 메뉴는 v1 그대로다.
// - **모델 · 생각 깊이**(「Opus · 높음」)는 그 채팅의 값이다(스토리 33). 앞에 Runtime 표시(Claude 마크)가 선다.
//   누르면 16 반경 메뉴에 「Claude Code」 모델 목록과 「생각 깊이」 칸 줄이 선다. 생각 깊이는 턴이 도는 동안 바꿀 수 없다(엔진이
//   거절한다 — 그래서 그동안 잠근다). 목록이 없으면(앉지 않은 Agent를 멘션했다) 보이기만 한다.
// - **Work 칩**은 고르는 칩이 아니다(구현 스펙 「01a — 범위와 새 채팅」) — 어디서 일할지는 주소 씨앗이 정한다. `?new=work`로 연 새 채팅에만 「새 작업공간」
//   칩이 범위 칩 앞에 서고 ×로 뺀다(`NewWorkChip`). 씨앗이 없으면 첫 말 전의 트레이에 Work 칩이 없다. 그 밖에는 잠겨 보이기만 한다(연결을 끊는 길은
//   없다 — v1 §11). Work에 이은 칩만 누를 수 있고, 누르면 그 Work 화면으로 간다.
// - **범위 칩**(03 §5 · 티켓 06 · Composer 「범위 메뉴」)은 새 채팅의 트레이에 선다(Work 칩이 있으면 그 바로 뒤) — 비어 있으면 흐린 「범위 없음」, 고르면 흰 칩 「결제 서비스 ×」
//   (×는 빼기)이고, 바꾸는 것이 Work의 Service면 × 대신 ▾다. 메뉴는 범위 없음 · Service · Project에서 고른다(`ScopeMenuItems`). 첫 말 뒤에는 서지
//   않는다 — 대화로 바꾼다. 그 곁의 **범위 줄**이 지금 읽는 Project를 한 줄로 말한다(읽는 범위 — `scopeLine`).
// - **물어보는 정도**(v1 티켓 23 · 스토리 84)는 방패 · 지금 정도 이름의 칩이다(시안의 「매번 묻기」 — 셰브런 없이). 누르면 「언제
//   물어볼까요」 아래 넷이 이름과 설명 한 줄로 서고 고른 것에만 체크가 붙는다. 입력창의 `/policy`도 이 메뉴를 연다.
// - **Runtime 칩**(restart 01c-3 · Composer 「Runtime 고르기」 · 스토리 30 · 31)은 모델 칩 앞에 선다. 새 채팅에서만 이름 ▾로 열려 「이 채팅을 돌릴
//   Runtime」 아래 Claude Code와 Codex가 이름과 설명 한 줄로 서고, 턴이 시작되면 이름만 남아 잠긴다(시안 `.ra-cc.locked`).

/** 입력창 칩 — 28 · 알약 · 좌우 6 · 글리프와 글자 사이 4 · 13/18 `fg-subtle`, 테두리 · 면 없음(Diff-Chat 「칩」 · F1-Home `.chip`). */
const CHIP =
  "flex h-7 shrink-0 items-center gap-1 rounded-full px-1.5 text-chat-meta whitespace-nowrap text-fg-subtle transition-colors outline-none focus-ring";
/** 누르면 메뉴가 서는 칩 — hover와 열린 동안 켜짐 면. */
const MENU_CHIP = cn(CHIP, "quiet-hover data-[popup-open]:bg-fill-hover data-[popup-open]:text-fg");
/** 모델 칩 — 본문색 · 좌우 8(시안 「Claude Code Default」 칩). */
const MODEL_CHIP = "px-2 text-fg";
/** 트레이 칩의 얼굴(시안 v52 `.tray .tc`) — 글리프와 글자 사이 5 · 13/18. 흰 칩은 흰 면 안에서 이것으로 이름 자리를 세운다. */
const TRAY_FACE = "flex min-w-0 items-center gap-1.25 text-chat-meta whitespace-nowrap outline-none focus-ring";
/** 트레이 칩 — 26 · 알약 · 좌우 8, 테두리 · 면 없음. 칩 줄이 좁으면 칩이 줄어 이름이 말줄임으로 끊긴다(`shrink`). */
const TRAY_CHIP = cn(TRAY_FACE, "h-6.5 shrink rounded-full px-2");
/** 흰 트레이 칩(시안 `.tc.on`) — 흰 면 + 0.5 고리. 고른 범위 칩과 「새 작업공간」 칩이다. */
const ON_CHIP = "flex h-6.5 min-w-0 shrink items-center rounded-full bg-surface ring-[0.5px] ring-border-tray-on";
/** 트레이 칩 이름의 폭 — 긴 Work 제목이 범위 줄(03 티켓 06)의 자리를 다 먹지 않게. */
const TRAY_NAME = "max-w-44 min-w-0 truncate";
/** 고른 것의 글리프 — 새 Work는 폴더 더하기, Work 없이 대화는 말풍선, Work는 폴더다(시안 v52). */
const WORK_GLYPH: Record<ThreadLink["kind"], LucideIcon> = { "new-work": FolderPlus, "no-work": MessageSquare, work: Folder };

/** 모델 칩 앞의 Runtime 표시 — Claude Code의 마크. 단색이라 칩 글자색을 따른다(`agent-mark.tsx` — 브랜드 색을 박지 않는다). */
const ClaudeMark = agentMarkOf("claude")?.Glyph;

interface ModelChipProps {
  /** 모델 목록 — Session이 알린 것, 열기 전이면 claude가 받는 별칭(`CLAUDE_MODELS`). 없으면 칩은 보이기만 한다. */
  models: readonly ChoiceOption[] | null;
  model: string | null;
  effort: string | null;
  /** 턴이 도는가 — 생각 깊이를 잠근다. */
  running: boolean;
  onModel: (value: string) => void;
  onEffort: (value: string) => void;
  /** 메뉴의 열림 — 칩을 누르거나 `/model`이 연다. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ModelChip({ models, model, effort, running, onModel, onEffort, open, onOpenChange }: ModelChipProps) {
  const label = chipLabel(models, model, effort);
  const parts = chipParts(models, model, effort);
  const mark = ClaudeMark && <ClaudeMark className="size-3.5 shrink-0" />;
  // 모델은 본문색, 생각 깊이는 옅은 글자다(Diff-Chat 「GPT-6.1 Sol High」). 글은 칩 글자 그대로다.
  const text = (
    <>
      {parts.model}
      {parts.depth && <span className="text-fg-subtle">{` · ${parts.depth}`}</span>}
    </>
  );
  if (!models || models.length === 0) {
    // 고를 목록이 없다 — Session이 열려야 Runtime이 낸 목록이 선다. 그때까지는 채팅의 값을 보이기만 한다.
    return (
      <span aria-label={`모델 ${label}`} className={cn(CHIP, MODEL_CHIP)}>
        {mark}
        {text}
      </span>
    );
  }
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger aria-label={`모델과 생각 깊이 ${label}`} className={cn(MENU_CHIP, MODEL_CHIP, "max-w-56 min-w-0")}>
        {mark}
        <span className="min-w-0 truncate">{text}</span>
        <ChevronDown className="size-3 shrink-0" aria-hidden />
      </DropdownMenuTrigger>
      {/* 열릴 때 움직이는 메뉴는 이것 하나다 — .32s · 30ms 늦게 · 0.98에서 커진다(02 구현 스펙 §12 · Codex 모델 피커). */}
      <DropdownMenuContent side="top" align="end" grows>
        <DropdownMenuGroup>
          <DropdownMenuLabel>Claude Code</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={model ?? ""}
            onValueChange={(next: string) => {
              if (next !== model) onModel(next);
            }}
          >
            {models.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value} label={option.name} aria-label={option.name}>
                <span className="min-w-0 flex-1 truncate">{option.name}</span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
        <DropdownMenuGroup>
          <DropdownMenuLabel>{running ? "생각 깊이 · 턴이 끝나면 바꿀 수 있어요" : "생각 깊이"}</DropdownMenuLabel>
          {/* 칸 줄(보드 `.segm`) — 메뉴의 라디오 줄이라 ↑ · ↓로도 지난다. 고른 칸만 떠 있는 흰 면이다. 칸 폭은 제 글자 폭에서 남는 폭을
              나눠 갖는다(`flex-auto`) — 다섯을 같은 폭으로 나누면 「아주 높음」만 칸에 빠듯했다(v1 티켓 46). */}
          <MenuPrimitive.RadioGroup
            value={effort ?? ""}
            onValueChange={(next: string) => {
              if (next !== effort) onEffort(next);
            }}
            className="mx-1 mb-1 flex gap-0.5 rounded-lg bg-fill-soft p-0.5"
          >
            {EFFORTS.map((one) => (
              <MenuPrimitive.RadioItem
                key={one.value}
                value={one.value}
                label={one.label}
                disabled={running}
                closeOnClick
                className="flex h-6.5 flex-auto cursor-default items-center justify-center rounded-md px-1.5 text-xs whitespace-nowrap text-fg-secondary outline-hidden select-none focus:bg-fill-hover data-checked:bg-surface data-checked:text-fg data-checked:shadow-hairline data-disabled:opacity-55"
              >
                {one.label}
              </MenuPrimitive.RadioItem>
            ))}
          </MenuPrimitive.RadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 「새 작업공간」 칩이 받는 것 — 뺀다. 빼면 그냥 새 채팅이다. */
export interface NewWorkChoice {
  kind: "new-work";
  onDrop: () => void;
}

/** 잠긴 Work 칩이 받는 것 — 첫 말 뒤의 칩 글(`lockedWork`)과, 이은 Work로 가는 길(그 Work의 slug를 받는다). */
export interface LockedChoice {
  kind: "locked";
  locked: LockedWork;
  onOpen: (slug: string) => void;
}

/** 범위 칩이 받는 것 — 쥔 범위(없으면 `null`), 그 칩이 바꾸는 것이 Work의 Service인가(× 대신 ▾), 고르기, 범위 줄의 읽는 범위(읽기 전이면 `undefined`). */
export interface ScopeChoice {
  /** 칩이 보이는 범위 — 읽는 범위가 싣는 것이다(없거나 그것이 사라졌으면 `null`). */
  shown: ShownScope | null;
  ofWork: boolean;
  onPick: (pick: ScopePick) => void;
  reading: ReadingScope | undefined;
}

/**
 * 입력창 트레이(03 §5 · 시안 v52 `.tray`) — 입력창 상자에 붙은 회색 띠다. 자리는 입력창의 자리를 따른다: 입력창이 가운데인 첫 화면은 상자
 * 아래(`below`), 화면 아래에 붙은 Thread 화면은 상자 위(`above` — 창 끝에 눌려 칩이 입력창 뒤로 숨지 않게)다. 첫 칩이 Work 칩이다 — `?new=work`로
 * 연 새 채팅의 「새 작업공간」(`NewWorkChoice`)이거나 잠긴 칩(`LockedChoice`)이고, 씨앗 없는 새 채팅에는 없다. 새 채팅이면 그 뒤에 범위 칩과 범위 줄이
 * 선다(`scope`).
 */
export interface ComposerTray {
  at: "below" | "above";
  work?: NewWorkChoice | LockedChoice;
  scope?: ScopeChoice;
}

/** 흰 칩 끝의 × — 이름 자리 옆의 따로 선 단추다(이름 → × 사이 6: 시안 `.x{margin-left:1px}` + 칩 틈 5). */
function ChipRemove({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="flex h-full shrink-0 items-center rounded-full pr-2 pl-1 text-fg-subtle transition-colors outline-none hover:text-fg focus-ring"
    >
      <X className="size-2.5" aria-hidden />
    </button>
  );
}

/**
 * 「새 작업공간」 칩(Composer 「새 채팅 · 범위 트레이」) — 작업공간 만들기로 연 새 채팅의 첫 말 전에만 범위 칩 앞에 선다. 고르는 메뉴는 없고 ×로 빼면
 * 그냥 새 채팅이다. 다시 세우는 길은 칩에 없다 — 작업공간 만들기로 다시 연다.
 */
export function NewWorkChip({ onDrop }: NewWorkChoice) {
  const Glyph = WORK_GLYPH["new-work"];
  return (
    <span data-slot="new-work-chip" className={ON_CHIP}>
      <span className={cn(TRAY_FACE, "pr-0.5 pl-2 text-fg")}>
        <Glyph className="size-3.5 shrink-0 text-fg-icon" aria-hidden />
        <span className={TRAY_NAME}>{NEW_WORK}</span>
      </span>
      <ChipRemove label={`${NEW_WORK} 빼기`} onClick={onDrop} />
    </span>
  );
}

/**
 * 잠긴 Work 칩(03 §5 · S3 · F4-KitComposer 「첫 말 뒤」) — 메뉴 없이 보이기만 한다(시안 `.tc.lock` — 글자 60% · 글리프 40%, 셰브런 없음).
 * Work에 이은 칩은 누르면 그 Work 화면으로 가는 단추다. 아직 Work가 서지 않은 「새 작업공간」은 더 흐리다(`.tc.ghost`) — 「작업공간을 만드는 중」이다.
 */
export function LockedWorkChip({ locked, onOpen }: LockedChoice) {
  const Glyph = WORK_GLYPH[locked.kind];
  const ghost = locked.kind === "new-work";
  const face = (
    <>
      <Glyph className={cn("size-3.5 shrink-0", ghost ? "text-fg-tray-ghost-icon" : "text-fg-tray-locked-icon")} aria-hidden />
      <span className={TRAY_NAME}>{locked.label}</span>
    </>
  );
  if (locked.kind !== "work") {
    return (
      <span data-slot="work-chip" className={cn(TRAY_CHIP, ghost ? "text-fg-tray-ghost" : "text-fg-tray-locked")}>
        {face}
      </span>
    );
  }
  const slug = locked.slug;
  return (
    <button
      type="button"
      data-slot="work-chip"
      aria-label={`작업공간으로 가기: ${locked.label}`}
      onClick={() => onOpen(slug)}
      className={cn(TRAY_CHIP, "text-fg-tray-locked transition-colors quiet-hover")}
    >
      {face}
    </button>
  );
}

/** 고른 범위의 글리프 — Service는 층, Project는 폴더다(시안 Composer 「범위 메뉴」). */
const SCOPE_GLYPH = { service: Layers, project: Folder } as const;

/**
 * 범위 칩과 메뉴(03 §5 · 티켓 06 · Composer 「범위 메뉴」) — 새 채팅의 첫 화면에만 서고 칩 아래로 범위 메뉴가 열린다. 비어 있으면 흐린 「범위 없음」
 * (셰브런 없음, 시안 `.tc.ghost`), 고르면 흰 면 + 0.5 고리의 칩(`.tc.on`)에 이름과 ×(빼기 — 이름 단추 옆의 따로 선 단추)다. 바꾸는 것이 Work의
 * Service면 × 대신 ▾다 — 빼기도 메뉴에서만 한다.
 */
export function ScopeChip({ shown, ofWork, onPick }: ScopeChoice) {
  const look = scopeChip(shown, ofWork);
  // 메뉴 카드는 트레이 바깥 6에 선다(시안 `.pmenu{top:calc(100% + 6px)}`) — 칩 아래끝에서 트레이 안쪽 6을 지나 6이다.
  const menu = (
    <DropdownMenuContent side="bottom" align="start" sideOffset={12} width="note">
      <ScopeMenuItems current={shown} onPick={onPick} withProjects={!ofWork} />
    </DropdownMenuContent>
  );
  if (look.kind === "ghost") {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="범위 없음"
          className={cn(TRAY_CHIP, "text-fg-tray-ghost transition-colors quiet-hover data-[popup-open]:bg-fill-hover")}
        >
          <Layers className="size-3.5 shrink-0 text-fg-tray-ghost-icon" aria-hidden />
          <span className={TRAY_NAME}>범위 없음</span>
        </DropdownMenuTrigger>
        {menu}
      </DropdownMenu>
    );
  }
  const Glyph = SCOPE_GLYPH[look.of];
  return (
    <span data-slot="scope-chip" className={ON_CHIP}>
      <DropdownMenu>
        {/* 이름 → × 사이 6 — 이름 단추의 오른쪽 2와 × 단추의 왼쪽 4다. */}
        <DropdownMenuTrigger
          aria-label={`범위: ${look.name}`}
          className={cn(TRAY_FACE, "h-full rounded-full pl-2 text-fg", look.end === "menu" ? "pr-2" : "pr-0.5")}
        >
          <Glyph className="size-3.5 shrink-0 text-fg-icon" aria-hidden />
          <span className={TRAY_NAME}>{look.name}</span>
          {look.end === "menu" && <ChevronDown className="size-3 shrink-0 text-fg-subtle" aria-hidden />}
        </DropdownMenuTrigger>
        {menu}
      </DropdownMenu>
      {look.end === "remove" && <ChipRemove label="범위 빼기" onClick={() => onPick(null)} />}
    </span>
  );
}

/**
 * 범위 줄(03 §5 · 시안 `.tray .scope`) — 범위 칩 옆 한 줄, 지금 읽는 Project다(읽는 범위 — `scopeLine`). 칩 틈 4에 4를 더 띄우고 좁으면
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

/**
 * Runtime 칩(Composer 「Runtime 고르기」) — 고를 수 있으면 지금 Runtime 이름 ▾에 메뉴가 열리고, 잠겼으면 이름만 선다. 메뉴는 고른 것에만 체크가 붙고 설명은
 * 한 줄로 끝난다. 쓸 수 있는지 확인하는 동안 보내기를 잠그는 것은 01c-9다.
 */
export function RuntimeChip({ value, onPick }: RuntimeChoice) {
  const name = runtimeNameOf({ runtime: value });
  if (!onPick) {
    return (
      <span data-slot="runtime-chip" aria-label={`Runtime ${name}`} className={CHIP}>
        {name}
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger data-slot="runtime-chip" aria-label={`Runtime: ${name}`} className={MENU_CHIP}>
        {name}
        <ChevronDown className="size-3 shrink-0" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>이 채팅을 돌릴 Runtime</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={value}
            onValueChange={(next: Runtime) => {
              if (next !== value) onPick(next);
            }}
          >
            {RUNTIMES.map((one) => (
              <DropdownMenuRadioItem
                key={one.value}
                value={one.value}
                label={one.name}
                aria-label={one.name}
                aria-description={one.description}
                size="note"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{one.name}</span>
                  <span className="truncate text-xs text-fg-tertiary">{one.description}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 물어보는 정도 칩이 받는 것 — 지금 정도 · 바꾸기, 그리고 `/policy`가 메뉴를 여는 열림 상태. */
export interface AskChoice {
  level: AskLevel;
  onLevel: (level: AskLevel) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 물어보는 정도 칩과 메뉴(보드 「아래 줄 메뉴 · 물어보는 정도」 — 16 반경 메뉴, 고른 것에만 체크, 설명은 한 줄로 끝난다). */
export function AskChip({ level, onLevel, open, onOpenChange }: AskChoice) {
  const name = askLevelOf(level)?.name ?? level;
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger aria-label={`물어보는 정도 ${name}`} className={MENU_CHIP}>
        <Shield className="size-3.5" aria-hidden />
        {name}
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start">
        <DropdownMenuGroup>
          <DropdownMenuLabel>언제 물어볼까요</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={level}
            onValueChange={(next: AskLevel) => {
              if (next !== level) onLevel(next);
            }}
          >
            {ASK_LEVELS.map((one) => (
              <DropdownMenuRadioItem
                key={one.value}
                value={one.value}
                label={one.name}
                aria-label={one.name}
                aria-description={one.description}
                size="note"
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{one.name}</span>
                  <span className="truncate text-xs text-fg-tertiary">{one.description}</span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { ChevronDown, ChevronRight, Folder, FolderPlus, Layers, MessageSquare, Shield, X, type LucideIcon } from "lucide-react";
import { agentMarkOf } from "@/components/ui/agent-mark";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { addProject } from "@/features/projects/add-store";
import type { ReadingScope, ScopeSpace } from "@/features/spaces/scope";
import { SpaceMenuItems } from "@/features/spaces/SpaceMenu";
import { ASK_LEVELS, askLevelOf, chipLabel, chipParts, EFFORTS, type ChoiceOption } from "./chips";
import { useRecentWorks } from "./hooks";
import { scopeLine, spaceChip } from "./space-chip";
import type { AskLevel, ThreadLink } from "./types";
import type { LockedWork } from "./work-chip";

// 입력창의 칩(v1 티켓 05 · 23 · 31 · 02 티켓 10 · 02 구현 스펙 §9 · 03 구현 스펙 §5 · §6 · 캔버스 v35 Diff-Chat · v52 F4-KitComposer) — 입력칸
// 아래 줄에 `+` 다음으로 물어보는 정도가, 보내기 원 앞에 모델 · 생각 깊이가 선다(입력창 안은 이 셋뿐이다 — `@` 단추는 숨겼다, 03 §6). Work
// 칩은 입력창 **밖** 트레이에 선다 — 첫 화면은 상자 아래, Thread 화면은 상자 위다(03 §5). 받는 이 칩은 없다(결정.md 「사용자 결정: 입력창
// 다듬기」) — 받는 이는 말의 첫 멘션이 정하고 입력칸의 멘션 칠이 보인다.
// - **칩은 Codex의 ghost 알약이다**(Diff-Chat 「칩」) — 테두리 · 면 없는 28 알약 · 좌우 6 · 13px `fg-subtle`. 모델 칩만 본문색 · 좌우 8이다
//   (시안의 「Claude Code Default」 칩). 내용과 메뉴는 v1 그대로다.
// - **모델 · 생각 깊이**(「Opus · 높음」)는 다음 말을 받을 참여자 Session의 값이다(스토리 33). 앞에 Runtime 표시(Claude 마크)가 선다.
//   누르면 16 반경 메뉴에 「Claude Code」 모델 목록과 「생각 깊이」 칸 줄이 선다. 생각 깊이는 턴이 도는 동안 바꿀 수 없다(엔진이
//   거절한다 — 그래서 그동안 잠근다). 목록이 없으면(앉지 않은 Agent를 멘션했다) 보이기만 한다.
// - **Work 칩**(03 §5 · F4-KitComposer · F4-HomeWorkMenu)은 스위치다 — 첫 말 전의 메뉴에 「새 Work」 · 「Work 없이 대화」(설명 한 줄 · 지금
//   것에 ✓)와 최근 Work 다섯(줄 끝에 그 Work의 Space 이름)이 선다. 입력창의 `/work`도 이 메뉴를 연다. 첫 말을 보낸 뒤에는 잠겨 보이기만
//   한다(연결을 끊는 길은 없다 — v1 §11). Work에 이은 칩만 누를 수 있고, 누르면 그 Work 화면으로 간다.
// - **Space 칩**(03 §5 · 티켓 06 · F4-HomeSpaceMenu · F4-HomeSpacePicked)은 Work 칩 바로 뒤다 — 비어 있으면 흐린 「Space 넣기」, 고르면 흰 칩
//   「결제 서비스 ×」(×는 빼기)이고, 바꾸는 것이 Work의 Space면 × 대신 ▾다. 메뉴는 Work 화면 머리 줄과 같은 Space 메뉴다(맨 위 「Space 없음
//   — 등록된 Project N개 읽기」). 첫 말 뒤에도 바꾼다. 그 곁의 **범위 줄**이 지금 읽는 Project를 한 줄로 말한다(읽는 범위 — `scopeLine`).
// - **물어보는 정도**(v1 티켓 23 · 스토리 84)는 방패 · 지금 정도 이름의 칩이다(시안의 「매번 묻기」 — 셰브런 없이). 누르면 「언제
//   물어볼까요」 아래 넷이 이름과 설명 한 줄로 서고 고른 것에만 체크가 붙는다. 끝의 「Policy 열기」는 다음 말을 받을 Agent의 파일을
//   Library에서 연다 — 정도보다 먼저 드는 그 Agent의 `ask_before` · `forbid`가 거기 있다. 입력창의 `/policy`도 이 메뉴를 연다.

/** 입력창 칩 — 28 · 알약 · 좌우 6 · 글리프와 글자 사이 4 · 13/18 `fg-subtle`, 테두리 · 면 없음(Diff-Chat 「칩」 · F1-Home `.chip`). */
const CHIP =
  "flex h-7 shrink-0 items-center gap-1 rounded-full px-1.5 text-chat-meta whitespace-nowrap text-fg-subtle transition-colors outline-none focus-ring";
/** 누르면 메뉴가 서는 칩 — hover와 열린 동안 켜짐 면. */
const MENU_CHIP = cn(CHIP, "quiet-hover data-[popup-open]:bg-fill-hover data-[popup-open]:text-fg");
/** 모델 칩 — 본문색 · 좌우 8(시안 「Claude Code Default」 칩). */
const MODEL_CHIP = "px-2 text-fg";
/** 트레이 칩의 얼굴(시안 v52 `.tray .tc`) — 글리프와 글자 사이 5 · 13/18. 고른 Space 칩은 흰 면 안에서 이것으로 이름 단추를 세운다. */
const TRAY_FACE = "flex min-w-0 items-center gap-1.25 text-chat-meta whitespace-nowrap outline-none focus-ring";
/** 트레이 칩 — 26 · 알약 · 좌우 8, 테두리 · 면 없음. 칩 줄이 좁으면 칩이 줄어 이름이 말줄임으로 끊긴다(`shrink`). */
const TRAY_CHIP = cn(TRAY_FACE, "h-6.5 shrink rounded-full px-2");
/** 고르는 트레이 칩 — 본문색 글자 · `fg-icon` 글리프 · `fg-subtle` 셰브런. hover와 메뉴가 열린 동안 켜짐 면(시안 `.tc.open`). */
const PICK_CHIP = cn(TRAY_CHIP, "text-fg transition-colors quiet-hover data-[popup-open]:bg-fill-hover");
/** 트레이 칩 이름의 폭 — 긴 Work 제목이 범위 줄(03 티켓 06)의 자리를 다 먹지 않게. */
const TRAY_NAME = "max-w-44 min-w-0 truncate";
/** Work 칩의 접근성 이름 — 칩 글자(「새 Work」 · 「Work 없이 대화」 · 제목)만으로는 무엇을 고르는 칩인지 말하지 않는다. */
const workName = (label: string) => `어디서 일할지 ${label}`;
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
    // 앉지 않은 Agent를 멘션했다 — 그 Agent가 들어와 Session이 열려야 값이 그 Session의 것이 된다. 그때까지는 정의 파일의 값을 보이기만 한다.
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

/** 고르는 Work 칩이 받는 것 — 칩 글자와 고르기(첫 말 전의 새 Thread). */
export interface WorkChoice {
  /** 칩 글자 — 「새 Work」 · 「Work 없이 대화」 · Work 제목(`workHome`). */
  label: string;
  link: ThreadLink;
  /** 골랐다 — 최근 Work면 그 제목도 함께 온다(입력창 안내가 쓴다). */
  onPick: (link: ThreadLink, title: string | null) => void;
}

/** 잠긴 Work 칩이 받는 것 — 첫 말 뒤의 칩 글(`lockedWork`)과, 이은 Work로 가는 길(그 Work의 slug를 받는다). */
export interface LockedChoice {
  locked: LockedWork;
  onOpen: (slug: string) => void;
}

/**
 * Space 칩이 받는 것 — 쥔 Space(없으면 `null`), 그 칩이 바꾸는 것이 Work의 Space인가(× 대신 ▾), 고르기, 범위 줄의 읽는 범위(읽기 전이면
 * `undefined`). 첫 말을 보내 Session을 기다리는 동안은 고르지 못한다(`disabled`).
 */
export interface SpaceChoice {
  /** 칩이 보이는 Space — 읽는 범위가 싣는 것이다(없거나 그 파일이 없으면 `null`). */
  current: ScopeSpace | null;
  ofWork: boolean;
  onPick: (space: string | null) => void;
  scope: ReadingScope | undefined;
  disabled?: boolean;
}

/**
 * 입력창 트레이(03 §5 · 시안 v52 `.tray`) — 입력창 상자에 붙은 회색 띠다. 자리는 입력창의 자리를 따른다: 입력창이 가운데인 첫 화면은 상자
 * 아래(`below`), 화면 아래에 붙은 Thread 화면은 상자 위(`above` — 창 끝에 눌려 칩이 입력창 뒤로 숨지 않게)다. 첫 칩이 Work 칩이다 — 첫
 * 말 전이면 고르는 스위치(`WorkChoice`), 뒤면 잠긴 칩(`LockedChoice`)이다. 그 뒤에 Space 칩과 범위 줄이 선다(`space` — 03 티켓 06).
 */
export interface ComposerTray {
  at: "below" | "above";
  work: WorkChoice | LockedChoice;
  space?: SpaceChoice;
}

/** 메뉴 고르기의 값 — 새 Work · Work 없이 대화 · 그 Work. slug와 겹치지 않는 머리를 단다. */
const valueOf = (link: ThreadLink): string => (link.kind === "work" ? `work:${link.slug}` : link.kind);

/** 스위치 둘 — 차례 · 이름 · 설명 한 줄이 시안 v52 그대로다(03 §5 · 스토리 15–17). */
const SWITCHES = [
  { kind: "new-work", name: "새 Work", description: "첫 말로 Work를 만들고 그 안에서 시작해요" },
  { kind: "no-work", name: "Work 없이 대화", description: "묻고 답하기 · 나중에 Host 제안으로 Work가 될 수 있어요" },
] as const;

/**
 * 고르는 Work 칩과 메뉴(03 §5 · F4-HomeWorkMenu · F4-KitComposer 「Work 칩 메뉴」) — 칩 아래로 연다. 위에 스위치 둘(설명 한 줄 · 지금 것에 ✓),
 * 구분선 아래 「최근 Work — 그 Work에 새 Thread로」와 진행 중인 Work 다섯이 선다. Work가 하나도 없으면 그 묶음 대신 「아직 Work가 없어요」
 * 한 줄이다(시안 「Work 칩 메뉴 — Work가 없을 때」). 최근 Work를 아직 읽지 못했으면 스위치 둘만 선다. 메뉴의 열림은 `/work`도 연다.
 */
export function WorkChip({
  label,
  link,
  onPick,
  open,
  onOpenChange,
}: WorkChoice & { open: boolean; onOpenChange: (open: boolean) => void }) {
  const recent = useRecentWorks();
  const value = valueOf(link);
  const Glyph = WORK_GLYPH[link.kind];
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger aria-label={workName(label)} className={PICK_CHIP}>
        <Glyph className="size-3.5 shrink-0 text-fg-icon" aria-hidden />
        <span className={TRAY_NAME}>{label}</span>
        <ChevronDown className="size-3 shrink-0 text-fg-subtle" aria-hidden />
      </DropdownMenuTrigger>
      {/* 트레이 아래 6에 선다(시안 `.pmenu{top:calc(100% + 6px)}`) — 칩 아래끝에서 트레이 안쪽 6을 지나 6이다. */}
      <DropdownMenuContent side="bottom" align="start" sideOffset={12} width="note">
        <DropdownMenuRadioGroup
          value={value}
          onValueChange={(next: string) => {
            if (next === value) return;
            if (next === "no-work" || next === "new-work") return onPick({ kind: next }, null);
            const work = recent?.find((one) => valueOf({ kind: "work", slug: one.slug }) === next);
            if (work) onPick({ kind: "work", slug: work.slug }, work.title);
          }}
        >
          {SWITCHES.map((one) => {
            const SwitchGlyph = WORK_GLYPH[one.kind];
            return (
              <DropdownMenuRadioItem
                key={one.kind}
                value={one.kind}
                label={one.name}
                aria-label={one.name}
                aria-description={one.description}
                size="note"
              >
                <SwitchGlyph className="mt-0.5" aria-hidden />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{one.name}</span>
                  <span className="truncate text-xs text-fg-tertiary">{one.description}</span>
                </span>
              </DropdownMenuRadioItem>
            );
          })}
          {recent && (
            <>
              <DropdownMenuSeparator />
              {recent.length > 0 ? (
                <DropdownMenuGroup>
                  <DropdownMenuLabel>최근 Work — 그 Work에 새 Thread로</DropdownMenuLabel>
                  {recent.map((work) => (
                    <DropdownMenuRadioItem
                      key={work.slug}
                      value={valueOf({ kind: "work", slug: work.slug })}
                      label={work.title}
                      aria-label={work.title}
                      aria-description={work.space ?? undefined}
                    >
                      <Folder aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{work.title}</span>
                      {/* 그 Work의 Space — 흐린 곁말(시안 F4-HomeWorkMenu 줄 끝 「결제 서비스」). ✓는 부품이 이 뒤에 붙인다. */}
                      {work.space && <span className="shrink-0 pl-3 text-xs text-fg-tertiary">{work.space}</span>}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuGroup>
              ) : (
                <DropdownMenuGroup>
                  <DropdownMenuLabel>아직 Work가 없어요</DropdownMenuLabel>
                </DropdownMenuGroup>
              )}
            </>
          )}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * 잠긴 Work 칩(03 §5 · S3 · F4-KitComposer 「첫 말 뒤」) — 메뉴 없이 보이기만 한다(시안 `.tc.lock` — 글자 60% · 글리프 40%, 셰브런 없음).
 * Work에 이은 칩은 누르면 그 Work 화면으로 가는 단추다. 아직 Work가 서지 않은 「새 Work」는 더 흐리다(`.tc.ghost`) — 「Work를 만드는 중」이다.
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
      aria-label={`Work로 가기: ${locked.label}`}
      onClick={() => onOpen(slug)}
      className={cn(TRAY_CHIP, "text-fg-tray-locked transition-colors quiet-hover")}
    >
      {face}
    </button>
  );
}

/**
 * Space 칩과 메뉴(03 §5 · 티켓 06 · F4-KitComposer · F4-HomeSpaceMenu · F4-HomeSpacePicked) — 칩 아래로(Thread 화면의 상자 위 트레이면 위로)
 * Space 메뉴가 열린다. 비어 있으면 흐린 「Space 넣기」(셰브런 없음, 시안 `.tc.ghost`), 고르면 흰 면 + 0.5 고리의 칩(`.tc.on`)에 이름과
 * ×(빼기 — 이름 단추 옆의 따로 선 단추)다. 바꾸는 것이 Work의 Space면 × 대신 ▾다 — 빼기도 메뉴에서만 한다.
 */
export function SpaceChip({ at, current, ofWork, onPick, disabled }: SpaceChoice & { at: ComposerTray["at"] }) {
  const look = spaceChip(current, ofWork);
  // 메뉴 카드는 트레이 바깥 6에 선다(Work 칩 메뉴와 같은 띄움 — 시안 `.pmenu{top:calc(100% + 6px)}`).
  const menu = (
    <DropdownMenuContent side={at === "below" ? "bottom" : "top"} align="start" sideOffset={12} width="note">
      <SpaceMenuItems current={look.kind === "on" ? look.slug : null} onPick={onPick} place="chip" />
    </DropdownMenuContent>
  );
  if (look.kind === "ghost") {
    return (
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label="Space 넣기"
          disabled={disabled}
          className={cn(TRAY_CHIP, "text-fg-tray-ghost transition-colors quiet-hover data-[popup-open]:bg-fill-hover")}
        >
          <Layers className="size-3.5 shrink-0 text-fg-tray-ghost-icon" aria-hidden />
          <span className={TRAY_NAME}>Space 넣기</span>
        </DropdownMenuTrigger>
        {menu}
      </DropdownMenu>
    );
  }
  return (
    <span data-slot="space-chip" className="flex h-6.5 min-w-0 shrink items-center rounded-full bg-surface ring-[0.5px] ring-border-tray-on">
      <DropdownMenu>
        {/* 이름 → × 사이 6(시안 `.x{margin-left:1px}` + 칩 틈 5) — 이름 단추의 오른쪽 2와 × 단추의 왼쪽 4다. */}
        <DropdownMenuTrigger
          aria-label={`Space: ${look.name}`}
          disabled={disabled}
          className={cn(TRAY_FACE, "h-full rounded-full pl-2 text-fg", look.end === "menu" ? "pr-2" : "pr-0.5")}
        >
          <Layers className="size-3.5 shrink-0 text-fg-icon" aria-hidden />
          <span className={TRAY_NAME}>{look.name}</span>
          {look.end === "menu" && <ChevronDown className="size-3 shrink-0 text-fg-subtle" aria-hidden />}
        </DropdownMenuTrigger>
        {menu}
      </DropdownMenu>
      {look.end === "remove" && (
        <button
          type="button"
          aria-label="Space 빼기"
          disabled={disabled}
          onClick={() => onPick(null)}
          className="flex h-full shrink-0 items-center rounded-full pr-2 pl-1 text-fg-subtle transition-colors outline-none hover:text-fg focus-ring"
        >
          <X className="size-2.5" aria-hidden />
        </button>
      )}
    </span>
  );
}

/**
 * 범위 줄(03 §5 · 시안 `.tray .scope`) — Space 칩 옆 한 줄, 지금 읽는 Project다(읽는 범위 — `scopeLine`). 칩 틈 4에 4를 더 띄우고 좁으면
 * 말줄임으로 끊긴다. 빈 Space · 등록된 Project 없음은 경고 색이고, 등록된 Project가 없으면 끝의 「Project 추가」가 Project 추가 창을 연다 —
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

/** 물어보는 정도 칩이 받는 것 — 지금 정도 · 바꾸기 · 「Policy 열기」, 그리고 `/policy`가 메뉴를 여는 열림 상태. */
export interface AskChoice {
  level: AskLevel;
  onLevel: (level: AskLevel) => void;
  /** 「Policy 열기」 — 다음 말을 받을 Agent의 파일로 간다. 없으면 그 줄이 서지 않는다. */
  onOpenPolicy?: () => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** 물어보는 정도 칩과 메뉴(보드 「아래 줄 메뉴 · 물어보는 정도」 — 16 반경 메뉴, 고른 것에만 체크, 설명은 한 줄로 끝난다). */
export function AskChip({ level, onLevel, onOpenPolicy, open, onOpenChange }: AskChoice) {
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
        {onOpenPolicy && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={onOpenPolicy} className="text-fg-secondary">
              Policy 열기
              <ChevronRight className="ml-auto size-3.5" aria-hidden />
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

import { Menu as MenuPrimitive } from "@base-ui/react/menu";
import { ChevronDown, Folder, Shield } from "lucide-react";
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
import { chipLabel, EFFORTS, type ChoiceOption } from "./chips";
import HostFace from "./HostFace";

// 입력창의 칩(v1 티켓 05 · 구현 스펙 §14 「입력창 아래 줄」 · 캔버스 Composer 보드). three-axes 칩(`chat/ComposerChips.tsx`)을 옮겨 보드의
// 자리로 나눴다.
// - **모델 · 생각 깊이**는 입력창 안, 보내기 원 앞의 칩 하나다(「Opus · 높음」). 누르면 16 반경 메뉴에 「Claude Code」 모델 목록과
//   「생각 깊이」 칸 줄이 선다. 값은 다음 말을 받을 참여자 Session의 것이다(스토리 33) — 바꾸면 다음 턴부터 든다. 생각 깊이는 턴이 도는
//   동안 바꿀 수 없다(엔진이 거절한다 — 그래서 그동안 잠근다).
// - **아래 줄**은 받는 이(Host) · Work · 물어보는 정도다. 지금은 셋 다 **보이기만 한다** — 받는 이를 고르는 것은 14, Work 칩은 31,
//   물어보는 정도는 23이 단다. 누를 것이 없으니 단추가 아니고 셰브런도 없다.

/** 입력창 안 칩 — 30 · 좌우 9 · 10 반경 · 13/18 `fg-secondary`, hover와 열린 동안 켜짐 면(보드 `.chip`). */
const CHIP =
  "flex h-7.5 shrink-0 items-center gap-1.25 rounded-lg px-2.25 text-chat-meta whitespace-nowrap text-fg-secondary transition-colors outline-none focus-ring";

interface ModelChipProps {
  /** 모델 목록 — Session을 연 적 없으면 null이다. 목록이 없으면 칩은 보이기만 한다. */
  models: readonly ChoiceOption[] | null;
  model: string | null;
  effort: string | null;
  /** 턴이 도는가 — 생각 깊이를 잠근다. */
  running: boolean;
  onModel: (value: string) => void;
  onEffort: (value: string) => void;
}

export function ModelChip({ models, model, effort, running, onModel, onEffort }: ModelChipProps) {
  const label = chipLabel(models, model, effort);
  if (!models || models.length === 0) {
    // 새 Thread — 첫 말을 보내야 Host의 Session이 열리고 목록이 선다. 그때까지는 Host 정의 파일의 값을 보이기만 한다.
    return (
      <span aria-label={`모델 ${label}`} className={CHIP}>
        {label}
      </span>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`모델과 생각 깊이 ${label}`}
        className={cn(CHIP, "max-w-56 min-w-0 quiet-hover data-[popup-open]:bg-fill-hover data-[popup-open]:text-fg")}
      >
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown className="size-3 shrink-0" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="end">
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
          {/* 칸 줄(보드 `.segm`) — 메뉴의 라디오 줄이라 ↑ · ↓로도 지난다. 고른 칸만 떠 있는 흰 면이다. */}
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
                className="flex h-6.5 min-w-0 flex-1 cursor-default items-center justify-center rounded-md px-1 text-xs whitespace-nowrap text-fg-secondary outline-hidden select-none focus:bg-fill-hover data-checked:bg-surface data-checked:text-fg data-checked:shadow-hairline data-disabled:opacity-55"
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

/** 아래 줄 칩 — 28 · 12.5 → `text-xs`(보드 `.tray .chip`). 보이기만 한다(머리말). */
const TRAY_CHIP = "flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-xs whitespace-nowrap text-fg-secondary";

/** 입력창 아래 줄 — 받는 이 · Work · 물어보는 정도(머리말). */
export function ComposerTray() {
  return (
    <div role="group" aria-label="이 말을 어떻게 보낼지" className="flex flex-wrap items-center gap-0.5 px-2 pt-1.5">
      <span className={TRAY_CHIP} aria-label="받는 이 Host">
        <HostFace className="size-4" />
        Host
      </span>
      <span className={TRAY_CHIP} aria-label="Work 없음">
        <Folder className="size-3.5" aria-hidden />
        Work 없음
      </span>
      <span className={TRAY_CHIP} aria-label="물어보는 정도 매번 묻기">
        <Shield className="size-3.5" aria-hidden />
        매번 묻기
      </span>
    </div>
  );
}

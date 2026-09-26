import { useRef, type RefObject } from "react";
import { X } from "lucide-react";
import { Dialog, DialogClose, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { samePath, type EntryPath } from "./draft";
import type { LayoutPreview } from "./types";

// 「LLM이 받는 텍스트」 팝업(spec 레이아웃 티켓 14 · 결정 11·28 · 구현 스펙 5절 「배치」). 편집기 머리의 버튼으로 연다 —
// 늘 떠 있는 열이 아니다(프로토타입 뒤 사용자 선택). 보이는 글은 편집기가 마지막으로 받은 미리보기의 것이고, 그것은
// 엔진이 지금 초안을 **저장하면 에이전트가 받을 글** 그대로다(스토리 29). 여기는 글을 짓지도 고치지도 않는다.

/**
 * 팝업 — **창은 Dialog다**(develop 판 3 · S31, 전체화면 뷰어 `FullscreenModal`과 같은 손버릇). 막(`modal-scrim`)과
 * 가운데 카드, 스크린리더의 모달 창, 창 안에 가둔 포커스, Esc와 막 누르기로 닫기는 부품이 한다 — 창 keydown 리스너는
 * 없다. 막은 누르고 뗀 클릭에 닫힌다: 창 안에서 글을 끌어 고르다 막 위에서 손을 떼도 닫히지 않는다.
 *
 * **열리면 창 자신이 포커스를 받는다**(S45) — 첫 버튼(닫기)이면 연 순간 그 버튼에 링과 툴팁이 선다. 포커스가 창
 * 안에 갇히므로 트리의 ⌥화살표가 막 뒤의 항목을 옮기지 않는다. 닫히면 포커스는 여는 버튼(`opener`)으로 간다 —
 * 부품의 기본값(열기 전 포커스)에 맡기지 않는 것은 WebKit이 버튼을 눌러도 포커스를 주지 않아서다.
 *
 * 여닫음은 편집기가 든다 — 레이아웃이 읽지 못하게 깨지면 편집기가 닫는다.
 */
function PreviewDialog({
  open,
  onOpenChange,
  opener,
  answer,
  selected,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 여는 버튼 — 닫힌 뒤 포커스가 돌아갈 자리다. */
  opener: RefObject<HTMLButtonElement | null>;
  answer: LayoutPreview | null;
  selected: EntryPath;
}) {
  const popup = useRef<HTMLDivElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* 부품의 닫기(×)를 세우지 않는다 — 머리 줄의 오른쪽 끝에 제 닫기가 있다. 창의 이름은 제목이 준다. */}
      <DialogContent
        ref={popup}
        variant="preview"
        showCloseButton={false}
        initialFocus={popup}
        finalFocus={opener}
      >
        <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-border pr-3 pl-5">
          <DialogTitle>LLM이 받는 텍스트</DialogTitle>
          <span className="text-[12.5px] text-tertiary">저장 전 초안</span>
          {/* 툴팁은 스크린리더에 아무것도 주지 않는다 — 단축키는 설명으로 남긴다(S28 — `shortcut`). */}
          <Hint
            text="닫기"
            shortcut="Esc"
            announce="name"
            render={<DialogClose className="icon-button-quiet ml-auto size-[30px] text-muted-foreground" />}
          >
            <X aria-hidden className="size-4" strokeWidth={2} />
          </Hint>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto bg-sidebar pt-3.5 pb-5 scroll-quiet">
          <PreviewText answer={answer} selected={selected} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 팝업의 본문 — 엔진이 준 글을 줄마다 그대로 보이고, **고른 항목의 줄을 칠해 둔다**(구현 스펙 5절 「배치」). 어느 줄이
 * 그 항목의 것인지도 엔진이 준다(`lines`) — 줄 규칙은 render의 것이라 여기서 글을 다시 읽어 셈하지 않는다(결정 13).
 * 머리 `spec/`을 골랐으면(`[]`) 방침 문단의 줄이다.
 *
 * **답에 오류가 있으면 글 대신 한 줄이다**(결정 28) — 저장이 잠겨 있으니 「저장하면 받을 글」이 없다. 답이 아직
 * 오지 않았으면 아무것도 보이지 않는다.
 */
export function PreviewText({ answer, selected }: { answer: LayoutPreview | null; selected: EntryPath }) {
  if (answer === null) return null;
  if (answer.errors.length > 0 || answer.text === null) {
    return <p className="px-5 text-[13px] leading-[1.6] text-tertiary">오류를 고치면 보여요</p>;
  }
  const held = answer.lines.find(({ path }) => samePath(path, selected));
  return (
    <div className="font-mono text-[12px] leading-[1.65] text-foreground">
      {answer.text.split("\n").map((line, index) => {
        const picked = held !== undefined && index >= held.start && index < held.start + held.count;
        return (
          <div
            key={index}
            data-line=""
            data-selected={picked ? "" : undefined}
            className={cn("min-h-5 whitespace-pre-wrap break-words px-5", picked && "bg-primary/10")}
          >
            {line}
          </div>
        );
      })}
    </div>
  );
}

export default PreviewDialog;

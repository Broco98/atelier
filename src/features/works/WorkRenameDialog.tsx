import { useRef, useState, type RefObject } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { Mode } from "@/mode";
import { useSetWorkTitle } from "./hooks";
import type { WorkView } from "./types";
import { itemNameOf } from "./work-sections";

/**
 * 이름 바꾸기 창(결정 8). 머리행 ⋯ 메뉴의 「이름 바꾸기」가 연다. slug는 바뀌지 않는다(ProjectDetail의
 * TitleEditor와 같은 계약).
 *
 * **한때 ⋯ 메뉴 안의 입력이었다.** 메뉴가 메뉴 부품(`DropdownMenu`)이 되면서 항목이 입력칸을 품을 수 없게
 * 됐고, 작업 화면 머리에는 제목이 없다 — 그래서 확인 창과 한 계열인 작은 창에서 받는다. 입력 규칙은 그대로다:
 * Enter는 저장, Esc는 취소.
 *
 * **바깥 누르기는 취소다**(P7). 옛 입력은 포커스를 잃으면 저장했는데, 창 밖을 누른 것은 「그만두겠다」로
 * 읽힌다 — 입력 중인 이름이 모르는 새 저장되지 않게 한다.
 *
 * 닫히면 포커스는 ⋯로 돌아간다(`returnFocus`). 창을 연 메뉴 항목은 그때 이미 사라졌으므로 부품의 기본값
 * (열기 전 자리)에 맡기지 않는다.
 */
function WorkRenameDialog({
  mode,
  work,
  open,
  onClose,
  returnFocus,
}: {
  mode: Mode;
  work: WorkView;
  open: boolean;
  /** 어느 길로 닫히든(저장 · 취소 · Esc · 바깥 누르기) 여기로 온다. 저장은 창이 이미 했다. */
  onClose: () => void;
  /** 닫힌 뒤 포커스가 갈 자리 — 창을 연 메뉴의 ⋯. */
  returnFocus: RefObject<HTMLElement | null>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      {/* 닫기(×) 버튼을 세우지 않는다 — 아래 「취소」와 같은 일을 하는 자리가 둘이 된다(확인 창도 그렇다). */}
      <DialogContent showCloseButton={false} initialFocus={inputRef} finalFocus={returnFocus}>
        <RenameBody mode={mode} work={work} inputRef={inputRef} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * 창의 속. **창이 떠 있는 동안에만 선다**(Portal의 자식이다) — 그래서 열 때마다 지금 이름에서 새로
 * 시작하고, 지난번에 쓰다 만 이름이 남지 않는다.
 */
function RenameBody({
  mode,
  work,
  inputRef,
  onClose,
}: {
  mode: Mode;
  work: WorkView;
  inputRef: RefObject<HTMLInputElement | null>;
  onClose: () => void;
}) {
  const setTitle = useSetWorkTitle(mode);
  const [draft, setDraft] = useState(work.title);
  const title = draft.trim();
  // 저장할 것이 있는가 — **비었거나 그대로면 없다**(지금 규칙). 「저장」이 누를 수 없게 서는 것(P12)과 Enter가
  // 저장 없이 닫는 것이 이 한 값을 본다.
  const changed = title !== "" && title !== work.title;
  // 한 번만 끝낸다 — 창은 닫히는 동안(100ms) 서 있어, 그 사이의 Enter가 저장을 한 번 더 부르지 않게.
  const finished = useRef(false);

  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    if (commit && changed) setTitle.mutate({ slug: work.slug, title });
    onClose();
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>{itemNameOf(mode)} 이름 바꾸기</DialogTitle>
      </DialogHeader>
      <Input
        ref={inputRef}
        aria-label={`${itemNameOf(mode)} 이름`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        // **지금 이름을 전부 고른 채 선다** — 새 이름을 바로 치면 옛 이름이 갈린다. 창의 첫 포커스
        // (`initialFocus`)는 포커스만 주므로 고르는 것은 여기서 따로 한다.
        onFocus={(e) => e.currentTarget.select()}
        // 키는 **입력칸이 받는다** — 옛 인라인 편집기와 같은 모양이고, 폼 제출로 바꾸지 않는다. Esc는 여기
        // 없다: 창이 받아 닫는다(`onOpenChange`). 한글 조합을 끝내는 Enter를 따로 거르지 않는 것도 옛
        // 편집기와 같다(판 3 실물 확인에서 본다).
        onKeyDown={(e) => {
          if (e.key === "Enter") finish(true);
        }}
      />
      {/* 버튼은 판 3 동안 확인 창(`AppDialog`)의 버튼 모양 그대로다 — Button으로 바꾸는 것은 판 4다. */}
      <DialogFooter>
        <button
          type="button"
          onClick={() => finish(false)}
          className="h-7 rounded-[8px] px-3 text-[12.5px] font-medium text-muted-foreground transition-colors outline-none hover:bg-state-1 focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          취소
        </button>
        <button
          type="button"
          // 저장될 것이 없으면 누를 수 없고 흐리게 선다(P12) — 눌러도 아무 일이 없는 버튼을 두지 않는다.
          disabled={!changed}
          onClick={() => finish(true)}
          className="h-7 rounded-[8px] bg-primary px-3 text-[12.5px] font-medium text-primary-foreground transition-colors outline-none hover:bg-primary/85 focus-visible:ring-2 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
        >
          저장
        </button>
      </DialogFooter>
    </>
  );
}

export default WorkRenameDialog;

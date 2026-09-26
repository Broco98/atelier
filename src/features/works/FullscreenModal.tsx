import { useRef, useState, type ReactElement, type ReactNode } from "react";
import { Maximize2, X } from "lucide-react";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Hint } from "@/components/ui/tooltip";

// 본문 블록을 전면 창으로 키워 보는 틀 — 다이어그램과 표가 같은 손버릇으로 열고 닫히도록
// 한 곳에서 여는 버튼과 모양과 닫는 방법을 정한다. 본문(children)만 블록마다 다르다.
// children은 창의 세로 흐름에 그대로 놓이므로 스크롤 상자 노릇까지 스스로 해야 한다
// (min-h-0 flex-1 overflow-auto). 여기서 감싸면 상자가 둘이 되어 가로 스크롤바가
// 콘텐츠 밑에 붙고 화면 밖으로 내려간다.
//
// **여는 버튼도 이 틀의 것이다**(셸 열기 메뉴 `ShellPicker`가 `+`를 쥐는 것과 같다). 떠 있는가와 닫힌 뒤
// 포커스가 돌아갈 자리가 곧 그 버튼이라, 블록마다 state와 ref와 같은 버튼을 따로 들면 셋이 한 벌로 움직인다는
// 것이 아무 데도 안 적힌다. 블록은 버튼의 모양과 (있으면) 제 이름만 넘긴다. 그래서 이 틀은 여는 버튼이 선 자리에
// 놓인다 — 창은 Portal로 body 끝에 뜨므로 그 자리의 DOM에는 버튼 하나뿐이다.
//
// **창은 Dialog다**(스토리 78·79, S31). 스크린리더에 모달 창으로 읽히고, 포커스는 창 안에 갇히며, Esc와
// 가림막 클릭은 부품이 받는다 — 옛 창 keydown 리스너는 없다. 닫히면 포커스는 여는 버튼(`finalFocus`)으로
// 간다. 부품의 기본값(열기 전 포커스)에 맡기지 않는 것은 WebKit이 버튼을 눌러도 포커스를 주지 않아서다 —
// 눌러서 연 창의 「열기 전 포커스」는 버튼이 아니다. 버튼을 부품의 여는 버튼(`DialogTrigger`)으로 세우지
// 않는 것은 그것이 `aria-haspopup`·`aria-expanded`를 더해 스크린리더가 듣는 말이 늘어서다.
//
// **가림막은 누르고 뗀 클릭에 닫힌다.** 창 안에서 시작한 눌림(다이어그램을 끄는 손, 표 셀의 글자를 끌어
// 고르는 손)을 가림막 위에서 놓으면, 그 뒤의 바깥 클릭 하나를 부품이 버린다(스토리 80). 한때 이 틀은 같은
// 까닭으로 가림막을 **누르는 순간**에 닫았다 — click은 눌린 곳과 뗀 곳의 공통 조상에서 나서다.
//
// **열리면 창 자신이 포커스를 받는다.** 부품의 기본값(창 안의 첫 버튼)이면 표 창은 닫기 버튼이 첫 버튼이라,
// 연 순간 그 버튼에 포커스 링과 툴팁이 선다 — 누를 것을 고른 적 없는데 하나가 골라진 채 열린다. 옛 뷰어는
// 포커스를 옮기지 않았다. 창 자신이면 스크린리더는 창의 이름을 읽고, Tab은 머리 줄의 첫 버튼으로 간다.
//
// 창 안(Portal의 자식)은 **떠 있는 동안에만 선다.** 여는 순간의 효과로 창 안의 상자를 재면 아직 없다 —
// 재야 하는 쪽(다이어그램의 맞춤 배율)은 그 상자가 붙는 순간에 잰다.
function FullscreenModal({
  name,
  label,
  trigger,
  controls,
  children,
}: {
  /** 창의 읽는 이름(「다이어그램」·「표」). 보이는 머리(`label`)가 이름이 못 되는 자리가 있어 따로 받는다. */
  name: string;
  /** 머리 왼쪽의 보이는 글자. 다이어그램은 `mermaid`다. */
  label: string;
  /**
   * 여는 버튼의 겉(`<button>`) — 모양은 블록마다 다르다(다이어그램은 머리 줄의 툴바 버튼, 표는 모서리에 뜨는
   * 버튼). 글리프와 툴팁 「전체화면으로 크게 보기」와 여는 일은 여기서 얹는다. 툴팁 글자가 곧 이름이다 — 겉이
   * 제 `aria-label`을 들고 오면(표 — 「표를 전체화면으로 보기」) 그것이 이긴다(`render`의 속성이 이긴다).
   */
  trigger: ReactElement;
  controls?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  return (
    // 창은 여는 버튼으로만 열린다 — 부품이 부르는 것은 닫는 길(닫기 · Esc · 가림막)뿐이다.
    <Dialog open={open} onOpenChange={setOpen}>
      <Hint
        text="전체화면으로 크게 보기"
        announce="name"
        ref={opener}
        type="button"
        onClick={() => setOpen(true)}
        render={trigger}
      >
        <Maximize2 className="size-3" strokeWidth={2} />
      </Hint>
      {/* 부품의 닫기(×)를 세우지 않는다 — 머리 줄의 오른쪽 끝에 제 닫기가 있다. */}
      <DialogContent
        ref={popup}
        variant="fullscreen"
        showCloseButton={false}
        aria-label={name}
        initialFocus={popup}
        finalFocus={opener}
      >
        <div className="flex h-[46px] shrink-0 items-center justify-between border-b px-3.5">
          <span className="font-mono text-[12px] text-tertiary">{label}</span>
          <span className="flex items-center gap-1">
            {controls}
            {/* 툴팁은 스크린리더에 아무것도 주지 않는다 — 이름보다 더 말하던 단축키는 설명으로 남긴다(S28 — `shortcut`). */}
            <Hint
              text="닫기"
              shortcut="Esc"
              announce="name"
              render={<DialogClose className="icon-button-quiet ml-1 text-tertiary" />}
            >
              <X className="size-3.5" strokeWidth={2} />
            </Hint>
          </span>
        </div>
        {children}
      </DialogContent>
    </Dialog>
  );
}

export default FullscreenModal;

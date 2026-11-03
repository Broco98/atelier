import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { InlineRename } from "@/components/ui/inline-rename";
import { HOTKEYS, pressed } from "@/lib/hotkeys";
import { cn } from "@/lib/utils";
import { CARD_FACE, type HeadRename } from "./Frame";
import { HEAD_CRUMB_GAP, HEAD_NAME, HeadEnd, ScreenHead } from "./ShellHead";

// **Thread · 첫 화면 · Projects · Service가 틀에 건네는 것**(02 구현 스펙 §3 · v1 티켓 07 · 03 · restart 02a-2) — 틀은 앱 셸 하나다: 크롬
// 맨 위 머리 줄(44)과 그 아래 사이드바 오른쪽 카드 자리(`AppShell` · `ShellHead`). 이 화면들은 머리 줄에 놓을 것(이름 앞 · 이름 · 오른쪽
// 끝)과 본문 카드에 놓을 것(본문)만 건넨다. 공용 틀(`Frame`)의 화면들(Terminal · Processes · Archive · Settings · Work 화면)도 같은 머리 줄에
// 제 이름 · 할 일을 보낸다(`FrameHead`).
//
//   머리 줄의 화면 자리(`ScreenHead`) ─ 이름 앞(`lead`) · 이름(있으면 · 그 자리에서 바꾼다) · 이름의 ⋯(`menu`) ··· 오른쪽 끝(`end`)
//   카드 자리 ─ 본문 카드 `<main>` — 화면이 건넨 것이 곧장 선다
//
// - **머리 줄의 자리 · 끌기 · 세로선은 셸의 것이다** — 이름이 셸 컨트롤 뒤 세로선 다음에 서는 것도 셸이 든다(`ShellHeadRow`). 바꿀 수 있는
//   이름은 포커스를 받는 요소라 Tauri가 끌기에서 스스로 비켜 둔다 — 끄는 자리의 두 번 클릭은 창 키우기라, 두 번 클릭이 이름 바꾸기인
//   이름은 끌면 안 된다. 새 채팅은 화면 이름 「새 채팅」을 보낸다(시안 Home — restart 03-12a, 한때 가운데가 비었다).
// - **시안 Main 머리 줄 모양이다**(`.ra-crumb` · `.ra-tbtn`, restart 03-12a — 한때 Codex `.tb-c` · `.tb-r`) — 왼쪽은 이름 앞 · 이름이 틈 6으로 한
//   줄이고, 오른쪽 끝은 28 아이콘 버튼들이 틈 없이 선다(왼쪽과 적어도 12 띄움). 오른쪽 끝 여백 8은 셸의 화면 자리가 든다. 이름 글자 · 오른쪽 끝 묶음의 값은 머리 줄 부품 한
//   곳(`ShellHead`의 `HEAD_NAME` · `HeadEnd`)이 들고, 공용 틀 화면의 머리(`FrameHead`)도 같은 것을 쓴다 — 머리 줄은 한 결이다.
// - **머리 줄 아래 선은 없다** — 본문 카드의 위끝이 경계다. 한때(02 S2) 본문이 제 카드 없이 흰 판에 곧장 섰다.
// - **이름은 그 자리에서 바꾼다**(F2 — 두 번 클릭은 한 번 누르는 일이 없는 이름만) — 공용 틀 화면의 머리 줄 이름과 같은 길이다(`HeadRename` ·
//   `InlineRename`). 채팅의 이름은 한 번 누르면 요약 카드가 열리는 단추다(`HeadOpen` — restart 03-15a).

/** 머리 줄 이름을 한 번 눌러 하는 일 — 채팅의 요약 카드 열기(restart 03-15a · 시안 Main `isLoose` `.ra-crumb button`). */
export interface HeadOpen {
  /** 단추의 이름 앞말 — 「요약 카드 열기」. 뒤에 「: <이름>」이 붙는다. */
  label: string;
  onOpen: () => void;
}

interface PlainHeadProps {
  /** 이름 앞 — Thread가 이은 Work의 「폴더 · 작업공간 이름 ›」(02 §6 · S13). */
  lead?: ReactNode;
  /** 머리 줄의 이름 — 없으면 머리 줄 가운데가 빈다. 새 채팅은 화면 이름 「새 채팅」이다(고치기 없음). */
  title?: { name: string; rename?: HeadRename; open?: HeadOpen };
  /** 이름 바로 뒤 — 그 이름의 ⋯(채팅 메뉴, restart 02a-7 · 시안 MainLoose `.ra-crumb` 뒤 `.ra-tbtn`). 이름과 틈 없이 붙는다. */
  menu?: ReactNode;
  /** 머리 줄 오른쪽 끝 — Thread의 요약 단추(「요약 카드」 — 02 §6 · restart 02a-9). */
  end?: ReactNode;
}

interface PlainFrameProps extends PlainHeadProps {
  /** 본문(`<main>`)의 이름(`aria-label`). */
  label: string;
  children: ReactNode;
}

export function PlainFrame({ lead, title, menu, end, label, children }: PlainFrameProps) {
  return (
    <>
      {(lead || title || menu || end) && (
        <ScreenHead>
          <PlainHead lead={lead} title={title} menu={menu} end={end} />
        </ScreenHead>
      )}
      {/* 본문 카드 — 카드 자리를 다 쓴다(카드 자리가 가로 줄이다). 겉은 공용 틀의 본문 카드와 한 벌이다(`CARD_FACE` — 면 surface · 둥글기 8
          · 0.5 링, restart 02a-2). **제 내용 폭을 카드 밖에 알리지 않는다**(`contain-inline-size`) — 사이드바가 카드의 형제라 카드 자리는 본문의
          min-content를 바닥으로 들고 사이드바와 자리를 나눈다(`AppShell`의 카드 자리 `min-w-min`). 긴 코드 줄 · 주소가 그 바닥을 부풀리면
          사이드바가 좁아지고 카드가 창 밖으로 밀린다 — 그려지는 폭은 카드 자리가 늘여 준다. 표식(`data-slot="card"`)도 공용 틀의 카드와 한
          벌이다 — 카드를 집는 자리가 같은 표식으로 집는다(02a-15). */}
      <main
        aria-label={label}
        data-slot="card"
        className={cn("flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-surface contain-inline-size", CARD_FACE)}
      >
        {children}
      </main>
    </>
  );
}

/**
 * 머리 줄 화면 자리에 서는 것 — 셸의 화면 자리(가로 flex · 가운데 맞춤)의 직계로 선다. 이름 뒤 ⋯(`menu`)는 이름 묶음 밖 바로 뒤에 틈 없이
 * 선다 — 시안 `.ra-title`은 틈이 없어 28 상자가 이름 글자 끝에 붙는다. 이름이 길면 이름만 줄어 말줄임이 되고 ⋯는 그대로다.
 */
export function PlainHead({ lead, title, menu, end }: PlainHeadProps) {
  return (
    <>
      {(lead || title) && (
        <div className={cn("flex min-w-0 items-center", HEAD_CRUMB_GAP)}>
          {lead}
          {title && <PlainTitle name={title.name} rename={title.rename} open={title.open} />}
        </div>
      )}
      {menu && <div className="flex shrink-0 items-center">{menu}</div>}
      {end && <HeadEnd>{end}</HeadEnd>}
    </>
  );
}

/**
 * 머리 줄의 이름 — 13/18 한 줄(`HEAD_NAME` — 시안 `.ra-crumb`). 바꿀 수 있으면 포커스를 받고 F2가 고치기에 들며, 고치는 동안은 이름 자리에
 * 입력칸이 선다. 키로 끝내면 포커스가 이 이름으로 돌아온다.
 *
 * **한 번 누르는 일(`open`)이 있으면 이름이 단추다**(restart 03-15a · 시안 Main `isLoose` — `aria-label="요약 카드 열기: <이름>"`, hover에 `fg-secondary`
 * `duration-basic`) — 그때 두 번 눌러도 이름 바꾸기에 들지 않는다(두 번 누름은 카드를 연 단추를 한 번 더 누른 것이다). 이름은 F2와 ⋯의 「이름
 * 바꾸기」로 바꾼다(스토리 92). 한때 이름은 포커스만 받는 글자였고 두 번 누르면 이름 바꾸기였다(02a-7).
 */
function PlainTitle({ name, rename, open }: { name: string; rename?: HeadRename; open?: HeadOpen }) {
  const nameEl = useRef<HTMLElement>(null);
  if (rename?.editing) {
    return (
      <InlineRename
        value={name}
        label={rename.label}
        emptyMeans="revert"
        fit="text"
        onCommit={rename.onCommit}
        onDone={rename.onEnd}
        returnFocus={() => nameEl.current}
        className={cn("-ml-1 h-6 px-1", HEAD_NAME)}
      />
    );
  }
  const renameKeys = {
    "aria-keyshortcuts": rename ? HOTKEYS.rename.aria : undefined,
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (rename && pressed(event, "rename")) {
        event.preventDefault();
        rename.onStart();
      }
    },
  };
  if (open) {
    return (
      <button
        ref={(element) => {
          nameEl.current = element;
        }}
        type="button"
        tabIndex={0}
        aria-label={`${open.label}: ${name}`}
        onClick={open.onOpen}
        {...renameKeys}
        className={cn(
          "min-w-0 truncate rounded-md transition-colors duration-basic ease-default hover:text-fg-secondary focus-ring",
          HEAD_NAME,
        )}
      >
        {name}
      </button>
    );
  }
  return (
    <span
      ref={(element) => {
        nameEl.current = element;
      }}
      tabIndex={rename ? 0 : undefined}
      {...renameKeys}
      onDoubleClick={rename?.onStart}
      className={cn("min-w-0 truncate rounded-md", HEAD_NAME, rename && "focus-ring")}
    >
      {name}
    </span>
  );
}

import { useEffect, useRef } from "react";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  opensTargetMenu,
  useHiddenContextMenu,
} from "@/components/ui/context-menu";
import { focusPlaceOf } from "@/features/terminal/shell-focus";
import { requestCloseShell, shellEditAt, type ShellEdit } from "@/features/terminal/terminal-store";

// **입력칸 · 터미널의 편집 메뉴**(codex-ds 스펙 §9 · S9 · 구현 노트 Q12 · Q17). 웹뷰의 기본 메뉴 대신 서는 앱의 메뉴다.
// - 입력칸(앱의 `input` · `textarea`): 잘라내기 · 복사 · 붙여넣기 · 모두 고르기. 고른 글자가 없으면 잘라내기 · 복사가 흐리다.
// - 터미널: 복사 · 붙여넣기 · 모두 고르기 — 화면 지우기 — 셸 닫기. 셸 닫기는 ⌘W · `×`와 같은 길(`requestCloseShell` — 도는 것이
//   있으면 묻는다)이고, 화면 지우기는 xterm의 `clear`다.
// 단축키 칸은 단축키 표의 글자다(`cut` · `copy` · `paste` · `selectAll` · `closeShell`). 붙여넣기는 클립보드 플러그인으로 읽고
// (웹뷰의 읽기는 WKWebView에서 시스템 붙여넣기 확인을 띄운다), 복사 · 잘라내기는 웹 클립보드에 쓴다 — 토스트가 없다(편집 메뉴는
// 조용히 한다). 잘라내기는 쓰기가 된 뒤에 칸의 글자를 지운다 — 쓰기가 거절되면 글자가 칸에 남는다.
//
// **메뉴 하나가 앱 전체를 맡고, 앱의 아무것도 감싸지 않는다**(Q12). 이 조각은 앱 뿌리 안의 형제로 서고(`AppShell`), 우클릭은
// document에서 듣는다 — 사건이 거기까지 올라온 뒤 그것이 난 자리를 가르고(`targetAt`), 편집 메뉴의 자리면 이 메뉴의 숨은 Trigger에
// 같은 자리의 우클릭 사건을 대신 낸다(`openAt` — 대상 메뉴 `TargetMenu`와 한 손잡이 `useHiddenContextMenu`다). 그러면 우클릭 메뉴의
// 길(`ContextMenuTrigger`)이 그대로 돈다 — 카드가 커서 자리에 서고, 메뉴를 연 오른쪽 버튼의 놓음은 줄을 누르지 않는다. 메뉴의
// 뿌리(`ContextMenu`)를 앱 둘레에 두지 않는 까닭: Base UI는 우클릭 메뉴 뿌리의 밑에 선 메뉴 줄을 모두 「우클릭 메뉴의 줄」로 쳐서,
// 앱의 다른 메뉴(⋯ · 상태 · 셸 고르기 …)를 누른 채 끌어 놓는 고름이 오른쪽 버튼의 놓음만 받게 된다.
// - **터미널을 먼저 본다** — xterm의 숨은 입력칸도 `textarea`라, 입력칸을 먼저 보면 둘째 우클릭이 입력칸 메뉴가 된다. 둘 다 아니면
//   아무것도 안 연다(결정 8 — 웹뷰의 기본 메뉴는 `AppShell`이 같은 document에서 막는다).
// - **제 메뉴를 가진 대상**(work 행 · 띠 줄 · 머리 줄 이름 — `WorkContextMenu`, 셸 탭 · spec 탭 — `ShellTabs`, 프로젝트 · Archive
//   목록 행 · Processes 행 · spec 레이아웃 행 · spec 트리 파일 행 · 문서 글 — `TargetMenu`)의 우클릭은 document까지 안 온다 — 그
//   Trigger · 자리가 사건을 멈추고, React가 그 전파를 앱 뿌리(`#root`)에서 끊는다. 대상 위의 우클릭은 대상 메뉴다. **그 Trigger
//   안의 입력칸은 이 메뉴의 자리다** — 사이드바 행의 이름을 고치는 칸(`InlineRename`)은 행의 우클릭을 받는 목록 안에 서는데, 그 자리에서는
//   Trigger가 물러서(`opensEditMenu`) 사건이 여기 닿는다. 머리 줄 이름은 고치는 동안 입력칸이 이름 자리를 갈아 끼워 Trigger 밖이다.
// - 포털(검색 팔레트 · 확인 창)은 `#root` 밖이지만 사건은 document까지 오므로, 그 안의 칸도 같은 메뉴를 받는다.
//
// **⇧F10 · 메뉴 키**(표의 `openMenu` · `menuKey` — `opensTargetMenu`)는 포커스된 입력칸에서 이 메뉴를 그 칸의 왼쪽 아래에 연다 —
// 대상 메뉴(`openMenuByKey`)와 같은 키 · 같은 자리이고, 그렇게 열면 카드가 포커스를 쥐어 ↓가 첫 줄이다. 키의 기본 동작은 막는다 —
// 그 키로 `contextmenu`를 스스로 내는 웹뷰(리눅스 WebKitGTK)가 한 번 더 열지 않게. 터미널에서는 그 키가 셸로 간다(`keyRoute` —
// 셸 안의 프로그램이 받는 키다).
//
// **대상 테두리**(`focus-ring`의 `[data-menu-target]` — 결정 11)는 메뉴가 열린 동안 그 입력칸에 선다. 칸은 앱 곳곳의 부품이라 표식을
// 손잡이가 칸에 직접 달고(`ringOf`) 닫히면 걷는다. 링이 서는 자리는 그 칸이 포커스 링을 입는 자리다 — 칸 자신, 검색칸은 감싼 상자
// (`InputGroup` — `focus-ring`의 `:has` 갈래). 링을 두지 않는 칸(검색 팔레트의 입력 줄 — Input의 `bare`)에는 테두리도 없다.
// 터미널에도 없다 — 셸 화면은 포커스 링을 입지 않는 자리이고(`TerminalPane`), 메뉴가 다룰 글자는 xterm의 고름이 보인다.
//
// **고름은 연 순간의 것이다.** macOS WebKit은 우클릭한 낱말을 스스로 고르고 나서 우클릭 사건을 내고, 셸은 xterm이 같은 것을 한다
// (`ShellEdit`) — 둘 다 사건이 document에 닿기 전이라, 메뉴가 다루는 고름이 사람이 화면에서 보는 고름이다. 닫히면 포커스가 그 칸 ·
// 그 셸로 돌아간다(`finalFocus`). 이름을 고치는 칸은 그동안 고치기를 접지 않고 기다린다 — 카드로 간 포커스는 「다른 곳」이 아니다
// (`InlineRename`).

/** 메뉴를 연 입력칸과 그때의 고름. */
interface FieldEdit {
  element: HTMLInputElement | HTMLTextAreaElement;
  start: number;
  end: number;
}

type EditTarget = { kind: "field"; edit: FieldEdit } | { kind: "shell"; edit: ShellEdit };

/**
 * 편집 메뉴를 받는 입력칸 — 글을 쓰는 칸(`focusPlaceOf`의 「입력 칸」)이고 고름을 다룰 수 있는 것(`input` · `textarea` — 고름 API가
 * 있는 종류)이다. 꺼진 칸은 아니다. `contentEditable`은 앱에 없다.
 */
function fieldOf(from: Element): FieldEdit | null {
  if (!(from instanceof HTMLInputElement || from instanceof HTMLTextAreaElement)) return null;
  if (focusPlaceOf(from) !== "field" || from.disabled || from.selectionStart === null) return null;
  const start = from.selectionStart;
  return { element: from, start, end: from.selectionEnd ?? start };
}

/** 그 칸의 고름을 되살리고 편집 명령을 낸다 — `execCommand`라 React의 `onChange`가 받고 ⌘Z로 되돌릴 수 있다(사람이 친 것과 같다). */
function editField({ element, start, end }: FieldEdit, command: "delete" | "insertText", text?: string): void {
  element.focus();
  element.setSelectionRange(start, end);
  document.execCommand(command, false, text);
}

/** 웹 클립보드에 쓴다 — 됐으면 `true`다. 실패는 알리지 않는다(편집 메뉴는 조용하다 — 토스트 없음). */
function writeClipboard(text: string): Promise<boolean> {
  return navigator.clipboard.writeText(text).then(
    () => true,
    () => false,
  );
}

/** 클립보드 플러그인으로 글자를 읽는다. 비었거나 글자가 아니면 플러그인이 거절한다 — 그때는 아무것도 안 붙인다. */
async function readClipboard(): Promise<string | null> {
  try {
    return await readText();
  } catch {
    return null;
  }
}

function FieldItems({ edit }: { edit: FieldEdit }) {
  const picked = edit.start !== edit.end;
  const text = () => edit.element.value.slice(edit.start, edit.end);
  return (
    <>
      <ContextMenuItem
        shortcut="cut"
        disabled={!picked}
        onClick={async () => {
          if ((await writeClipboard(text())) && edit.element.isConnected) editField(edit, "delete");
        }}
      >
        잘라내기
      </ContextMenuItem>
      <ContextMenuItem shortcut="copy" disabled={!picked} onClick={() => void writeClipboard(text())}>
        복사
      </ContextMenuItem>
      <ContextMenuItem
        shortcut="paste"
        onClick={async () => {
          const pasted = await readClipboard();
          if (pasted !== null && edit.element.isConnected) editField(edit, "insertText", pasted);
        }}
      >
        붙여넣기
      </ContextMenuItem>
      <ContextMenuItem
        shortcut="selectAll"
        onClick={() => {
          edit.element.focus();
          edit.element.select();
        }}
      >
        모두 고르기
      </ContextMenuItem>
    </>
  );
}

function ShellItems({ edit }: { edit: ShellEdit }) {
  return (
    <>
      <ContextMenuItem shortcut="copy" disabled={edit.selection === ""} onClick={() => void writeClipboard(edit.selection)}>
        복사
      </ContextMenuItem>
      <ContextMenuItem
        shortcut="paste"
        onClick={async () => {
          const pasted = await readClipboard();
          if (pasted !== null) edit.paste(pasted);
        }}
      >
        붙여넣기
      </ContextMenuItem>
      <ContextMenuItem shortcut="selectAll" onClick={edit.selectAll}>
        모두 고르기
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={edit.clear}>화면 지우기</ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem shortcut="closeShell" onClick={() => void requestCloseShell(edit.id)}>
        셸 닫기
      </ContextMenuItem>
    </>
  );
}

/**
 * 우클릭이 난 자리(`from`)가 편집 메뉴의 자리인가 — 터미널이면 셸, 아니면 입력칸, 둘 다 아니면 `null`이다. 터미널을 먼저 본다
 * (머리말).
 */
function targetAt(from: Element): EditTarget | null {
  const shell = shellEditAt(from);
  if (shell) return { kind: "shell", edit: shell };
  const field = fieldOf(from);
  return field ? { kind: "field", edit: field } : null;
}

/**
 * 그 자리의 우클릭이 편집 메뉴의 것인가(입력칸 · 터미널). 제 메뉴를 가진 대상이 그 안의 이 자리에서 물러서는 데 쓴다 —
 * 사이드바 행 목록 안의 이름을 고치는 칸(`WorkContextMenu`)과 대상 메뉴 자리 안의 입력칸(`TargetMenu` — 프로젝트 목록 행의 이름을
 * 고치는 칸)이 그렇다.
 */
export function opensEditMenu(from: Element): boolean {
  return targetAt(from) !== null;
}

/** 편집 메뉴 — 앱 뿌리 안에 형제로 하나 선다(`AppShell`). 아무것도 감싸지 않는다(머리말). */
export default function EditMenu() {
  // 닫히면 포커스가 돌아갈 자리 — 그 칸, 또는 셸의 숨은 입력칸.
  const back = useRef<HTMLElement | null>(null);
  // 숨은 Trigger · 닫혀도 남는 칸 · 셸 · 대상 테두리는 대상 메뉴와 한 손잡이다(머리말). 테두리는 입력칸에만 선다.
  const { menu, openAt, trigger, root, hiddenTrigger } = useHiddenContextMenu<EditTarget>({
    ringOf: (target) => (target.kind === "field" ? target.edit.element : null),
    onOpen: (target) => {
      back.current = target.kind === "shell" ? target.edit.input : target.edit.element;
    },
  });

  useEffect(() => {
    // 숨은 Trigger에 낸 우클릭도 document까지 올라온다 — 그것은 다시 가르지 않는다.
    const onContextMenu = (event: MouseEvent) => {
      if (!(event.target instanceof Element) || event.target === trigger.current) return;
      const target = targetAt(event.target);
      if (target) openAt(target, event.clientX, event.clientY);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || !opensTargetMenu(event)) return;
      const focused = document.activeElement;
      // 셸의 숨은 입력칸은 입력칸이 아니다 — 그 키는 셸 몫이다(머리말).
      const target = focused instanceof Element ? targetAt(focused) : null;
      if (target?.kind !== "field") return;
      event.preventDefault();
      const spot = target.edit.element.getBoundingClientRect();
      openAt(target, spot.left, spot.bottom);
    };
    document.addEventListener("contextmenu", onContextMenu);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("contextmenu", onContextMenu);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [openAt, trigger]);

  return (
    <ContextMenu {...root}>
      {hiddenTrigger}
      <ContextMenuContent finalFocus={back}>
        {menu?.target.kind === "field" && <FieldItems edit={menu.target.edit} />}
        {menu?.target.kind === "shell" && <ShellItems edit={menu.target.edit} />}
      </ContextMenuContent>
    </ContextMenu>
  );
}

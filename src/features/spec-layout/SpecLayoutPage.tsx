import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Bot, Check, MoreHorizontal, Pencil, RotateCcw, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { showProblem } from "@/components/ui/confirm-store";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Hint } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { SettingsGroup, SettingsLead, SettingsRow, SettingsSection } from "@/features/settings/SettingsGroup";
import { layoutDirRef } from "@/features/works/refs";
import { invalidateSpecLayout, specLayoutStateQuery, useRevertSpecLayout } from "./hooks";
import { askRevert } from "./revert";
import { LAYOUT_NAME, type SpecLayoutState } from "./types";

// 설정의 「spec 레이아웃」 페이지(spec 레이아웃 결정 20·23·25, 티켓 08). 레이아웃은 하나라 행도 하나다
// (ui-refresh 결정 3 · 23). **이 화면의 주된 쓰임은 확인이다** — 레이아웃은 대부분 에이전트가
// 고치고, 사람은 여기서 참조를 복사해 앱 터미널의 에이전트에게 붙인다. 되돌리기는 사람만 한다(결정 21) —
// 고친 행의 ⋯에서 확인을 거쳐 레이아웃 폴더를 지운다(티켓 10). 손질은 행의 [편집]이 여는
// 편집기에서 한다(티켓 11) — 이 페이지 아래의 고정 하위 주소(`/settings/spec-layout/edit`)다.
//
// **설정 파일 읽기 게이트 밖에 선다**(에이전트 훅 페이지와 같다) — 레이아웃은 `settings.json`에 살지
// 않고, 설정 초안의 저장 버튼도 지나지 않는다.
//
// 행은 페이지를 열 때, 레이아웃 폴더가 바뀔 때(셸의 `useFollowLayoutChanges`), [다시 읽기]를 누를 때,
// 되돌린 뒤에 새로 읽는다(`specLayoutStateQuery`에 `staleTime`이 없다). [다시 읽기]는 감시가 놓친 경우를 메우는
// 버튼이라 감시와 같은 문(`invalidateSpecLayout`)을 연다 — spec 트리를 싣고 오는 work 목록과 아카이브 문서도 함께
// 다시 읽힌다. 행의 상태는 엔진이 판정해 준 그대로 그린다 — resolve 규칙을 여기서 다시 계산하지 않는다.

/** 화면 아래 메시지가 떠 있는 시간. 참조 한 줄과 할 일 한 문장을 읽을 만큼 — 닫기 버튼도 있다. */
const NOTICE_MS = 6000;

/** 화면 아래 메시지 — 무엇을 했는가와, 그 일의 레이아웃 참조. 한 번에 하나다: 뒤의 것이 앞의 것을 갈아 낀다. */
type Notice = { kind: "copied" | "reverted"; reference: string };

function SpecLayoutPage() {
  const query = useQuery(specLayoutStateQuery());
  const state = query.data;
  const queryClient = useQueryClient();
  const revertLayout = useRevertSpecLayout();
  const navigate = useNavigate();
  const [notice, setNotice] = useState<Notice | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const show = (next: Notice) => {
    setNotice(next);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setNotice(null), NOTICE_MS);
  };
  // **참조는 상태가 준 폴더 경로로 짓는다**(결정 23) — 폴더가 아직 없어도 같은 모양이다: 붙여 받은
  // 에이전트의 도구가 내장본을 돌려준다. 읽지 못하는 행에도 있다: 에이전트가 원문과 오류를 읽고 고친다.
  const ask = (layout: SpecLayoutState) => {
    const reference = layoutDirRef(layout.folder);
    navigator.clipboard.writeText(reference);
    show({ kind: "copied", reference });
  };
  const closeNotice = () => {
    window.clearTimeout(timer.current);
    setNotice(null);
  };
  // 감시가 놓친 경우를 메우므로 감시와 같은 문을 연다(구현 스펙 3절·5절) — 행만이 아니라 spec 트리를 싣고 오는 work
  // 목록과 아카이브 문서도 새 레이아웃으로 다시 읽힌다.
  const reread = () => void invalidateSpecLayout(queryClient);
  // 편집기는 이 설정 nav 항목 아래의 하위 주소다(티켓 11) — 설정 한 열 밖의 별도 화면이다.
  const edit = () => void navigate({ to: "/settings/spec-layout/edit" });
  // **확인을 거친 뒤에만 지운다** — 폴더째 지우므로 템플릿과 레이아웃이 모르는 파일도 사라진다. 되돌리기는
  // 늘 된다(깨진 폴더도). 메시지는 다시 읽기가 끝난 뒤에 선다: 행이 이미 「내장본 그대로」다.
  const revert = async (layout: SpecLayoutState) => {
    if (revertLayout.isPending || !(await askRevert(layout))) return;
    try {
      await revertLayout.mutateAsync();
    } catch (e) {
      await showProblem(`되돌리지 못했습니다: ${e}`);
      return;
    }
    show({ kind: "reverted", reference: layoutDirRef(layout.folder) });
  };

  return (
    <>
      {state !== undefined && (
        <SpecLayoutSection
          state={state}
          onAsk={() => ask(state)}
          onEdit={edit}
          onReread={reread}
          onRevert={() => void revert(state)}
        />
      )}
      {/* 읽기 자체가 실패한 길(IPC). 레이아웃 폴더가 깨진 것은 여기가 아니라 그 행에 선다. 자리는 큰 제목 아래 구획
          자리다(설정 틀 — 설정 파일 읽기 게이트의 실패와 같다). */}
      {query.error !== null && (
        <div className="mt-7 flex flex-col items-start gap-3">
          <p className="text-chat-meta break-words text-danger">{String(query.error)}</p>
          {/* 설정 파일 읽기 게이트의 [다시 읽기]와 같은 쪽 동작 버튼이다(`SettingsPage`의 `SettingsFileGate`). */}
          {state === undefined && (
            <Button variant="ghost" size="sm" onClick={reread}>
              다시 읽기
            </Button>
          )}
        </div>
      )}
      {notice?.kind === "copied" && <CopiedNotice reference={notice.reference} onClose={closeNotice} />}
      {notice?.kind === "reverted" && (
        <RevertedNotice reference={notice.reference} onClose={closeNotice} />
      )}
    </>
  );
}

/**
 * 머리글과 레이아웃 행 — 설정 묶음(목록) 하나에 행 하나다(프로토타입 `Settings-layout`, ui-refresh 결정 16의 옅은 면). 구획
 * 제목은 두지 않는다(판 06 문구 표 S9 — 줄이 하나뿐이라 큰 제목 「spec 레이아웃」을 되풀이한다). 값을 들지 않는다:
 * 페이지가 들고 이쪽은 그리기만 한다(마크업 테스트가 클릭을 못 건다 — `HooksSection`과 같은 이유). ⋯ 메뉴가
 * 열렸는지만 그 행이 든다 — 화면 밖 누구도 그것을 묻지 않는다.
 */
export function SpecLayoutSection({
  state,
  onAsk,
  onEdit,
  onReread,
  onRevert,
}: {
  state: SpecLayoutState;
  onAsk: () => void;
  /** 편집기를 연다(티켓 11). 읽을 수 있는 행에만 [편집]이 선다. */
  onEdit: () => void;
  /** 레이아웃 상태를 다시 읽는다. 감시(티켓 09)가 놓친 경우를 위한 길이다. */
  onReread: () => void;
  /** ⋯ 메뉴의 「기본값으로 되돌리기」를 골랐다. 확인은 부르는 쪽이 묻는다. */
  onRevert: () => void;
}) {
  return (
    <>
      <SettingsLead>
        <code>spec</code> 패널과 에이전트가 받는 안내문이 같은 레이아웃에서 나와요.{" "}
        <strong className="font-medium text-fg">부탁</strong>을 누르면 참조가 복사돼요 —
        앱 터미널의 에이전트에게 붙이고 원하는 모양을 이어 적으세요.
      </SettingsLead>
      <SettingsSection>
        <SettingsGroup as="ul">
          <LayoutRow state={state} onAsk={onAsk} onEdit={onEdit} onReread={onReread} onRevert={onRevert} />
        </SettingsGroup>
      </SettingsSection>
    </>
  );
}

/**
 * 레이아웃 한 행. 상태는 셋 중 하나다 — 내장본 그대로, 고침(가린 폴더 경로와 템플릿 개수), 읽지 못해
 * 내장본으로 물러섬(경고색 `warning`의 한 줄, 경로와 이유 한 줄, [다시 읽기]). 읽지 못한 행도 가린 폴더가 있으므로
 * 고친 행이다(구현 스펙 5절) — 그래서 ⋯(기본값으로 되돌리기)는 둘 다에 선다. 읽지 못하는 행에는 [편집] 대신
 * [다시 읽기]가 선다: 편집기가 열 레이아웃이 없다.
 */
function LayoutRow({
  state,
  onAsk,
  onEdit,
  onReread,
  onRevert,
}: {
  state: SpecLayoutState;
  onAsk: () => void;
  onEdit: () => void;
  onReread: () => void;
  onRevert: () => void;
}) {
  // 행의 머리. 편집기의 위치 · 되돌리기 창과 같은 이름이다.
  const name = LAYOUT_NAME;
  const reference = layoutDirRef(state.folder);
  const fellBack = state.fallback !== null;
  return (
    <SettingsRow
      name={name}
      // 「고침」 꼬리표 — 디자인 시스템의 `Tag`(`.at-tag`)이고 모양은 `tag` 한 곳이 든다. 글자는 DS의 12px(`text-xs`)다.
      tail={state.edited ? <span className="tag text-xs">고침</span> : undefined}
      description={
        fellBack ? (
          <div className="flex items-start gap-2">
            <TriangleAlert
              aria-hidden
              className="mt-[3px] size-3.5 shrink-0 text-warning"
            />
            <div className="flex min-w-0 flex-col gap-0.5">
              {/* 경고색 글자는 medium이다 — `warning`은 흰 면 위 3.8:1이라 13px 이상 medium 글자에만 쓴다(DS README 「대비」). */}
              <span className="font-medium text-warning">
                읽지 못해 내장본으로 보여 주고 있어요
              </span>
              {/* 까닭은 엔진의 글 그대로다 — 에이전트가 물러선 안내문에서 받는 것과 같다. */}
              <span className="break-words">
                {reference} · {state.fallback}
              </span>
            </div>
          </div>
        ) : state.edited ? (
          `${reference} 폴더가 내장본을 가리고 있어요 · 템플릿 ${state.templateCount ?? 0}개`
        ) : (
          "내장본 그대로예요"
        )
      }
      // 행의 버튼은 쪽 동작이다 — 저장 같은 주 버튼이 아니라 이 화면의 「다시 읽기」와 같은 조용한 글자 버튼(`Button`의
      // ghost · sm, 폼 안 버튼이라 10px 모서리 — handoff)이고, 아이콘은 글자 앞에 선다(`data-icon="inline-start"` — 왼쪽
      // 여백이 한 단 준다).
      control={
        <>
          {/* 도움말은 복사할 참조다 — 이름(「… 부탁」)보다 더 말하는 것이라 설명으로도 남는다(S28). */}
          <Hint
            text={`${reference} 참조를 복사해요`}
            announce="description"
            render={
              <Button
                variant="ghost"
                size="sm"
                onClick={onAsk}
                aria-label={`${name} 레이아웃을 에이전트에게 부탁`}
              />
            }
          >
            <Bot data-icon="inline-start" aria-hidden />
            부탁
          </Hint>
          {!fellBack && (
            <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`${name} 레이아웃 편집`}>
              <Pencil data-icon="inline-start" aria-hidden />
              편집
            </Button>
          )}
          {fellBack && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onReread}
              aria-label={`${name} 레이아웃 다시 읽기`}
            >
              다시 읽기
            </Button>
          )}
          {/* 되돌릴 것은 가린 폴더다 — 내장본 행에는 되돌릴 것이 없다. 깨진 폴더도 가린 폴더라 선다. */}
          {state.edited && <RevertMenu name={name} onRevert={onRevert} />}
        </>
      }
    />
  );
}

/**
 * 고친 행의 ⋯ — 메뉴에는 붉은 「기본값으로 되돌리기」 하나가 있다(프로토타입). 고르면 메뉴가 닫히고
 * 부르는 쪽에 알린다: 폴더를 지우는 일이라 확인 창을 먼저 거친다(페이지의 `revert`).
 *
 * **메뉴 부품(`DropdownMenu`)이 다 한다**(develop 판 3 — 작업 ⋯와 같다) — 여닫이, 줄 옮기기, Esc 닫기와 ⋯로
 * 포커스 돌려주기, 바깥 누르기가 닫기만 하는 것(S9). ⋯가 「메뉴를 연다」와 「열렸다/닫혔다」를 말한다
 * (`aria-haspopup` · `aria-expanded`). 확인 창이 닫히면 포커스는 ⋯로 온다 — 창을 연 항목은 그때 이미
 * 사라졌고, 부품의 포커스 기록이 그 앞 자리(⋯)로 돌려준다.
 */
function RevertMenu({ name, onRevert }: { name: string; onRevert: () => void }) {
  // 열림을 여기서 든다 — ⋯의 켜짐(`toggle-on`)이 그것을 그린다.
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const noteId = useId();
  const label = `${name} 레이아웃 메뉴`;

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      {/* 도움말은 작업 ⋯와 같다 — 이름이 없는 아이콘 버튼이라 툴팁 글자가 곧 이름이다(S28). */}
      <Hint
        text={label}
        announce="name"
        render={
          <DropdownMenuTrigger
            // 아이콘 버튼의 모양은 `icon-button` 한 곳이 들고, 크기만 이 자리가 준다(S41) — 옆 글자 버튼(28px)과
            // 한 줄 높이다. 켜짐이 있는 아이콘 버튼이라 quiet-hover는 꺼진 가지 안에만 둔다(`index.css`의 그 유틸리티).
            className={cn(
              "icon-button size-7 transition-colors",
              open ? "toggle-on" : "text-fg-secondary quiet-hover",
            )}
          />
        }
      >
        <MoreHorizontal aria-hidden className="size-4" />
      </Hint>
      {/* 오른쪽 맞춤이다 — ⋯가 행의 오른쪽 끝이라 왼쪽 맞춤이면 메뉴가 설정 열 밖으로 뻗는다. */}
      <DropdownMenuContent align="end" width="layout" aria-label={label}>
        <DropdownMenuItem
          variant="destructive"
          size="note"
          // 이름은 머리 한 줄이고, 아래 줄은 그 설명이다 — 이름에 섞이면 「기본값으로 되돌리기폴더를…」이 된다.
          aria-labelledby={titleId}
          aria-describedby={noteId}
          onClick={onRevert}
        >
          <RotateCcw aria-hidden className="mt-[3px] size-3.5" />
          <span className="flex min-w-0 flex-col gap-0.5">
            <span id={titleId} className="font-medium">
              기본값으로 되돌리기
            </span>
            <span id={noteId} className="text-xs text-fg-tertiary">
              폴더를 지우고 내장본으로 돌아가요
            </span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * [부탁]을 누른 뒤 화면 아래에 서는 어두운 메시지 하나(프로토타입). 복사한 참조와 다음에 할 일을 적는다
 * — 클립보드에 든 것은 참조 한 줄뿐이고, 부탁은 사람이 앱 터미널에서 이어 적는다(결정 23).
 */
export function CopiedNotice({ reference, onClose }: { reference: string; onClose: () => void }) {
  return (
    <PageNotice title="참조를 복사했어요" reference={reference} onClose={onClose}>
      앱 터미널의 에이전트에게 붙이고 부탁을 이어 적으세요.
    </PageNotice>
  );
}

/**
 * 되돌린 뒤의 짧은 메시지(티켓 10 · 프로토타입). 지운 폴더와, 되돌린 것이 어디까지 따라가는가를 적는다 —
 * `spec` 패널의 트리도, 에이전트가 다음 호출부터 받는 안내문도 내장본이다.
 */
export function RevertedNotice({ reference, onClose }: { reference: string; onClose: () => void }) {
  return (
    <PageNotice title="되돌렸어요" reference={reference} onClose={onClose}>
      내장본으로 돌아갔어요. <code className="font-mono text-xs">spec</code> 패널과 에이전트 안내문도
      따라가요.
    </PageNotice>
  );
}

/**
 * 화면 아래에 서는 어두운 메시지 하나의 모양 — 머리 한 줄(무엇을 했는가와 그 참조), 설명 한 줄, 닫기.
 * 설정 본문 카드(`SettingsPage`의 `main`)의 바닥에 서고, 폭은 설정 틀의 글 폭(`--measure-read`)이라 묶음과 같은 열에 가운데
 * 선다 — 카드가 그보다 좁으면 카드 안 여백(`--card-pad`)까지다.
 *
 * **앱의 토스트(`showToast`)가 아니다.** 토스트는 한 장 · 한 줄 · 1600ms · 닫기 없음이고 부르는 길이
 * `showToast(title, kind)` 하나뿐이다(S26 · S27 · S47). 이 메시지는 붙여 넣을 참조와 다음에 할 일을 두 줄로
 * 적고, 그것을 읽을 만큼 서 있으며, 닫기가 있다(구현 스펙 5절 · 프로토타입). 그 셋을 토스트에 넣으면 한 장짜리
 * 표면의 규칙을 넓혀야 해서, 이 페이지만의 표면으로 둔다.
 *
 * 스펙이 「복사 알림」이라 부른 것을 코드는 「메시지」라 부른다 — 앱의 「알림」은 셸이 나를 부르는 사건의 말이다
 * (`CONTEXT.md` 「알림 띠」: 토스트를 「알림」이라 부르지 않는다).
 *
 * 면은 뒤집힌 면(`fg` 위 `fg-inverse` — DS 툴팁 · `.at-split`과 같은 짝)이고, **체크도 글자색이다.** Codex의 뜻의 색은
 * 그 테마의 면 위에서 읽히게 고른 값이라 뒤집힌 면 위에 얹을 `success`가 없다 — 라이트 `success`(#00692a)는 이 면(#1a1c1f)
 * 위 2.5:1로 그림 요소의 바닥(3:1)에 못 미친다. DS의 뒤집힌 면들도 뜻의 색을 얹지 않는다.
 */
function PageNotice({
  title,
  reference,
  onClose,
  children,
}: {
  title: string;
  reference: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      className="absolute inset-x-(--card-pad) bottom-7 z-20 mx-auto flex max-w-(--measure-read) items-start gap-2.5 rounded-card bg-fg py-3 pr-3 pl-3.5 text-fg-inverse shadow-lg"
    >
      <Check aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="text-chat-meta font-medium break-words">
          {title} <code className="font-mono text-xs opacity-80">{reference}</code>
        </span>
        <span className="text-chat-meta opacity-75">{children}</span>
      </div>
      {/* 무엇을 닫는지는 자리(이 메시지 `status` 안)가 말한다. 어두운 바탕 위라 hover는 바탕 대신 농도로 선다 —
          모양은 아이콘 버튼 규격(`icon-button`)이다. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="닫기"
        className="icon-button opacity-75 transition-opacity hover:opacity-100"
      >
        <X aria-hidden className="size-3.5" />
      </button>
    </div>
  );
}

export default SpecLayoutPage;

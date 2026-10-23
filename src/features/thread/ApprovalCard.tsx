import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import ChatCard from "@/features/chat/ChatCard";
import { TOOL_ICONS } from "@/features/chat/tool-icons";
import { threadApi } from "./api";
import { approvalChoices, describeApproval, type ApprovalChoice } from "./approval";
import type { PendingPermission } from "./fold";

// v1 티켓 05가 three-axes 승인 카드를 Thread 열쇠(Thread id · 물은 참여자)로 옮겼다 — 모양과 규칙은 그대로이고, 카드 시안(Approval
// 보드)은 그 장(22)이 맞춘다.
//
// 승인 카드(three-axes 티켓 21) — 에이전트가 권한을 물으면 **입력창 자리에** 서서(스토리 57) 무엇을 하려는지(도구 · 명령이나 경로 ·
// 까닭)를 보이고(스토리 58), 엔진이 준 선택지를 그대로 고르게 한다(스토리 59). 계획 승인 요청(kind `switch_mode`)이면 같은 틀의
// 「이 계획대로 할까요?」 카드가 된다(스토리 66 · three-axes 결정 29). 모양은 캔버스 Tools 보드의 `.cx-approval`(r28 · 입력창 그림자 ·
// 위 16 16 12 · 칩 줄 · 오른쪽 단추 줄)이다.
//
// 이 카드는 권한 답 명령을 부르기만 한다. 고른 답은 기록의 `answered` 줄로 오고, 그 줄이 오면 대화 접기가 이 요청을 빼서 카드가
// 걷힌다(스토리 62) — 거둬짐(멈춤 · 에이전트가 턴을 끝냄)도 같다. 답이 오기 전에 두 번 고르지 않게, 고른 뒤로는 단추가 잠긴다.
//
// **멈추기가 카드 안에 있다.** 입력창(그 멈추기 단추)이 카드에 자리를 내주므로, 카드가 서 있는 동안 멈추는 길(스토리 62)을 카드가
// 든다 — 입력창의 멈추기와 같은 단추다. 멈추면 호스트가 그 요청을 거두고 `cancelled`로 답한다(티켓 08).

/**
 * 선택지 단추가 엔진의 긴 이름(「Yes, and don't ask again for commands that start with …」)을 담는 꼴 — 높이를 풀고 단추 안에서 줄을
 * 바꾸며, 줄보다 넓어지지 않는다(앱 단추는 한 줄 · 줄지 않음이 기본이다).
 */
const WRAPPING = "h-auto min-h-8 max-w-full shrink whitespace-normal py-1 wrap-anywhere";
/** 칩 · 선택지 단추의 알약 — 32 · `radius-full`(DS `.at-split`). 앱 단추의 알약 크기는 걷혔다(codex-ds 결정 3) — 카드 안 단추 단에 모서리만 덮는다. */
const PILL = "rounded-full";

interface ApprovalCardProps {
  thread: string;
  /** 물은 참여자의 화면 이름 — 카드 머리의 엔진 줄이다. */
  name: string;
  /** 맨 앞의 답하지 않은 요청. 부르는 쪽이 요청 id를 key로 건다 — 다음 요청이 오면 고른 표시가 새로 선다. */
  request: PendingPermission;
  /** 턴이 도는가 — 돌면 카드에 멈추기가 선다. */
  running: boolean;
}

function ApprovalCard({ thread, name, request, running }: ApprovalCardProps) {
  const titleId = useId();
  const [chosen, setChosen] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const view = describeApproval(request);
  const choices = approvalChoices(request);

  const answer = (choice: ApprovalChoice) => {
    setChosen(choice.option.optionId);
    setProblem(null);
    threadApi.answerPermission(thread, request.who, request.requestId, choice.option.optionId).catch((error: unknown) => {
      // 답하지 못했다 — 다시 고를 수 있게 풀고 까닭을 보인다(이미 닫힌 요청이면 곧 그 줄이 와서 카드가 걷힌다).
      setChosen(null);
      setProblem(String(error));
    });
  };
  const stop = () => {
    setProblem(null);
    threadApi.stop(thread).catch((error: unknown) => setProblem(String(error)));
  };

  const chips = choices.filter((choice) => choice.place === "chip");
  const actions = [
    ...choices.filter((choice) => choice.place === "reject"),
    ...choices.filter((choice) => choice.place === "primary"),
  ];
  return (
    <ChatCard
      as="group"
      titleId={titleId}
      icon={TOOL_ICONS[view.icon]}
      // 계획 승인은 「Codex · 계획 모드」, 그 밖은 「터미널 · Codex」 — 보드의 두 카드 그대로다.
      head={request.planReview ? `${name} · ${view.tool}` : `${view.tool} · ${name}`}
      title={view.title}
      subject={view.subject}
      reason={view.reason && `사유 · ${view.reason}`}
      problem={problem}
      roomy={request.planReview}
      className="shrink-0"
    >
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2 px-3 pb-3.5">
          {chips.map((choice) => (
            <Button
              key={choice.option.optionId}
              variant="outline"
              disabled={chosen !== null}
              onClick={() => answer(choice)}
              className={cn(WRAPPING, PILL, "min-h-7 text-left")}
            >
              {choice.label}
            </Button>
          ))}
        </div>
      )}
      {/* 멈추기는 왼쪽 끝, 선택지는 오른쪽에 모인다 — 엔진의 이름이 길면 선택지끼리 줄을 바꾸고 단추 안에서도 줄이 바뀐다. */}
      <div className="flex items-end gap-2 px-3 pb-3">
        {running && (
          <button
            type="button"
            aria-label="멈추기"
            onClick={stop}
            className="flex size-8 shrink-0 items-center justify-center rounded-full bg-fill-hover text-fg transition-colors hover:bg-fill-active"
          >
            <span className="size-2.5 rounded-xs bg-current" aria-hidden />
          </button>
        )}
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2">
          {actions.map((choice) =>
            choice.place === "reject" ? (
              <Button
                key={choice.option.optionId}
                variant="outline"
                disabled={chosen !== null}
                onClick={() => answer(choice)}
                className={cn(WRAPPING, PILL)}
              >
                {choice.label}
              </Button>
            ) : (
              // 주 동작 — 검정 면(캔버스 `.cx-split` · 계획 승인의 「구현」은 `.cx-btn.primary`). 앱의 주 버튼이 그 면이다(`ChatCard` 머리말).
              <Button
                key={choice.option.optionId}
                disabled={chosen !== null}
                onClick={() => answer(choice)}
                className={cn(WRAPPING, !request.planReview && PILL)}
              >
                {choice.label}
              </Button>
            ),
          )}
        </div>
      </div>
    </ChatCard>
  );
}

export default ApprovalCard;

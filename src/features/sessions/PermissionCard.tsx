import { message } from "@tauri-apps/plugin-dialog";
import { ShieldQuestion } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAnswerPermission } from "./hooks";
import type { PermissionLine } from "./types";

interface PermissionCardProps {
  card: PermissionLine;
  sessionId: string;
  /**
   * 지금 붙어 있는 에이전트가 답을 기다리는가. **살아있음과 다르다** — 다시 띄운 세션에는
   * 답을 못 받고 끝난 지난 연결의 카드가 기록에 남아 있고, 그 카드로는 돌려줄 자리가 없다.
   */
  answerable: boolean;
}

/**
 * 에이전트가 도구를 쓰기 전에 묻는 자리. **정책 판정 없이 매번 사람에게 묻는다**(판 05가
 * 워크트리 안/밖과 태세를 다룬다). 버튼은 에이전트가 준 선택지 그대로이고, 아틀리에가
 * 선택지를 만들거나 지우지 않는다.
 */
function PermissionCard({ card, sessionId, answerable }: PermissionCardProps) {
  const answer = useAnswerPermission(sessionId);
  const chosen = card.answered
    ? (card.options.find((option) => option.optionId === card.answered?.optionId) ?? null)
    : null;

  const send = async (optionId: string) => {
    if (answer.isPending || answer.isSuccess) return;
    try {
      await answer.mutateAsync({ requestId: card.requestId, optionId });
    } catch (e) {
      await message(`답을 돌려주지 못했습니다: ${e}`, { title: "오류", kind: "error" });
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-2.5 rounded-[14px] border px-4 py-3.5",
        // 답하기 전에는 눈에 띈다 — 내가 기다리는 게 아니라 에이전트가 나를 기다리는 중이다
        card.answered === null && answerable ? "border-primary bg-primary/[0.06]" : "bg-inset",
      )}
    >
      <span className="flex items-start gap-2 text-[13px] font-medium">
        <ShieldQuestion className="mt-px size-4 shrink-0 text-tertiary" strokeWidth={1.7} />
        {/* 자르지 않는다 — 입력이 없는 도구(실물의 편집)에서는 이 줄이 승인 대상의 전부다 */}
        <span className="min-w-0 break-words font-mono">{card.title}</span>
      </span>

      {card.input !== "" && (
        <pre className="max-h-[180px] overflow-auto rounded-[9px] bg-background px-3 py-2 font-mono text-[11.5px] leading-[1.55] text-muted-foreground">
          {card.input}
        </pre>
      )}

      {card.answered !== null ? (
        <span className="text-[12.5px] text-tertiary">
          {card.answered.outcome === "allow" ? "허용했어요" : "거부했어요"}
          {chosen && ` — ${chosen.name}`}
        </span>
      ) : !answerable ? (
        <span className="text-[12.5px] text-tertiary">
          답하지 않은 채로 그때의 대화가 끝났어요.
        </span>
      ) : (
        <span className="flex flex-wrap gap-1.5">
          {card.options.map((option) => (
            <button
              key={option.optionId}
              type="button"
              onClick={() => void send(option.optionId)}
              // 답이 기록을 거쳐 이벤트로 돌아오기까지의 틈에 두 번 눌리지 않도록,
              // 보낸 뒤로는 다시 열리지 않는다
              disabled={answer.isPending || answer.isSuccess}
              // 이름은 자르지 않는다 — 무엇을 허용하는지가 버튼 밖으로 숨으면 안 된다
              className={cn(
                "min-h-7 max-w-full rounded-[9px] px-2.5 py-1 text-left text-[13px] font-medium transition-[filter] hover:brightness-[1.08] disabled:opacity-40",
                option.kind.startsWith("allow")
                  ? "bg-primary text-primary-foreground"
                  : "border bg-background text-muted-foreground",
              )}
            >
              {option.name}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}

export default PermissionCard;

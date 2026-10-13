import { useRef, useState } from "react";
import { Clock, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chatApi } from "./api";
import type { QueuedMessage } from "./types";

// 대기 중인 말(three-axes 티켓 20 · 스토리 49 · 50 · 52 · 결정 20) — 턴이 도는 동안 보낸 말이 입력창 위 「대기 중」에 쌓인다. 대기
// 줄은 호스트의 것이다: 이 화면은 대기 줄 바뀜 이벤트(처음에는 대화 목록)가 준 대로 그리고, 고치기 · 지우기 · 「지금 보내기」는 대기
// id를 실어 호스트 명령으로 보낸다. 바뀐 대기 줄은 다시 이벤트로 온다 — 누른 자리에서 줄을 미리 고치지 않는다.
//
// 모양은 캔버스 보드 04 · 14의 대기 줄이다: 시계 14 · 「대기 중」 · 글(한 줄로 자른다) · 「지금 보내기」(xs) · ×, 틈 8 · 안쪽
// 8 8 8 14 · r12 · 옅은 면에 0.5px 안쪽 선 · 13/18. 고치기는 보드에 없어 × 앞에 연필 아이콘 버튼을 두었다 — 누르면 그 줄의 글이
// 글칸이 되고 Enter(또는 다른 곳을 누름)로 보내고 Esc로 그만둔다.
//
// 「지금 보내기」를 누른 말은 호스트가 맨 앞에 세우고 도는 턴을 멈춘다 — 멈춤(`cancelled`)을 기다리는 동안은 「멈추고 보내는 중」이다.

interface QueuedMessagesProps {
  work: string;
  conversation: string;
  queue: readonly QueuedMessage[];
}

function QueuedMessages({ work, conversation, queue }: QueuedMessagesProps) {
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // 고친 글을 한 번만 보낸다 — Enter가 보낸 뒤 글칸이 사라지며 다른 곳을 누른 것(blur)으로 한 번 더 오지 않게.
  const saving = useRef<string | null>(null);

  if (queue.length === 0) return null;

  // 호스트가 거절하면(이미 갔거나 지운 말 · 에이전트가 없는 대화) 그 글을 그대로 보인다 — 호스트의 오류는 화면에 보일 글이다.
  const run = (call: Promise<void>) => {
    setProblem(null);
    call.catch((error: unknown) => setProblem(String(error)));
  };

  const save = (message: QueuedMessage, text: string) => {
    if (saving.current === message.id) return;
    saving.current = message.id;
    setEditing(null);
    const next = text.trim();
    // 비웠거나 그대로면 고칠 것이 없다 — 지우는 것은 ×다.
    if (next !== "" && next !== message.text) run(chatApi.editQueued(work, conversation, message.id, next));
  };

  return (
    <div className="flex flex-col gap-1.5">
      <ul role="list" aria-label="대기 중인 말" className="flex flex-col gap-1.5">
        {queue.map((message) => (
          <li
            key={message.id}
            data-queued={message.id}
            className="flex items-center gap-2 rounded-(--chat-radius-block) bg-(--chat-surface-under) py-2 pr-2 pl-3.5 text-ui shadow-(--chat-shadow-under)"
          >
            <Clock className="size-3.5 shrink-0 text-muted-foreground" strokeWidth={1.8} aria-hidden />
            <span className="shrink-0 text-muted-foreground">{message.sendNow ? "멈추고 보내는 중" : "대기 중"}</span>
            {editing?.id === message.id ? (
              <input
                aria-label="고칠 말"
                autoFocus
                value={editing.text}
                onFocus={() => {
                  saving.current = null;
                }}
                onChange={(event) => setEditing({ id: message.id, text: event.target.value })}
                onBlur={() => save(message, editing.text)}
                onKeyDown={(event) => {
                  if (event.nativeEvent.isComposing) return;
                  if (event.key === "Enter") {
                    event.preventDefault();
                    save(message, editing.text);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    saving.current = message.id;
                    setEditing(null);
                  }
                }}
                className="min-w-0 flex-1 bg-transparent text-foreground outline-none"
              />
            ) : (
              <span className="min-w-0 flex-1 truncate" title={message.text}>
                {message.text}
              </span>
            )}
            {!message.sendNow && (
              <Button
                type="button"
                variant="secondary"
                size="xs"
                onClick={() => run(chatApi.sendNow(work, conversation, message.id))}
              >
                지금 보내기
              </Button>
            )}
            <button
              type="button"
              aria-label="대기 중인 말 고치기"
              onClick={() => setEditing({ id: message.id, text: message.text })}
              className="flex size-6 shrink-0 items-center justify-center rounded-inner text-tertiary quiet-hover"
            >
              <Pencil className="size-3.5" strokeWidth={1.8} aria-hidden />
            </button>
            <button
              type="button"
              aria-label="대기 중인 말 지우기"
              onClick={() => run(chatApi.deleteQueued(work, conversation, message.id))}
              className="flex size-6 shrink-0 items-center justify-center rounded-inner text-tertiary quiet-hover"
            >
              <X className="size-[13px]" strokeWidth={1.8} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      {problem && (
        <p role="alert" className="px-2 text-caption text-destructive">
          {problem}
        </p>
      )}
    </div>
  );
}

export default QueuedMessages;

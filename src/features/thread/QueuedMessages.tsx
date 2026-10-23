import { useRef, useState } from "react";
import { CornerDownRight, Pencil, Trash2 } from "lucide-react";
import { threadApi } from "./api";
import type { QueuedMessage } from "./types";

// 기다리는 메시지(v1 티켓 05 · 캔버스 Messages 보드 「기다리는 메시지」) — Agent가 일하는 동안 보낸 말이 입력창 위 상자에 쌓였다가 차례로
// 간다. 「지금 전하기」를 누르면 하던 일에 바로 끼워 넣는다(멈추고 그 말을 먼저 보낸다). three-axes 대기 줄(`chat/QueuedMessages.tsx`)의
// 규칙 그대로 대기 줄은 엔진의 것이다: 이 화면은 이벤트가 준 대로 그리고, 고치기 · 지우기 · 지금 전하기는 대기 id를 실어 보낸다.
//
// 모양은 보드의 `.queue`(20 반경 · `surface-under` · 0.5px 선 · 안쪽 6)와 줄 `.qrow`(36 · 14 반경 · 14/20, 지나면 켜짐 면)다. 「지금 전하기」 ·
// 고치기 · 지우기는 그 줄에 마우스를 올리거나 포커스가 들어갈 때만 선다(보드는 지난 줄에만 그렸다).

interface QueuedMessagesProps {
  thread: string;
  queue: readonly QueuedMessage[];
}

function QueuedMessages({ thread, queue }: QueuedMessagesProps) {
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const saving = useRef<string | null>(null);

  if (queue.length === 0) return null;

  const run = (call: Promise<void>) => {
    setProblem(null);
    call.catch((error: unknown) => setProblem(String(error)));
  };

  const save = (message: QueuedMessage, text: string) => {
    if (saving.current === message.id) return;
    saving.current = message.id;
    setEditing(null);
    const next = text.trim();
    if (next !== "" && next !== message.text) run(threadApi.editQueued(thread, message.id, next));
  };

  return (
    <div className="flex flex-col gap-1.5">
      <ul
        role="list"
        aria-label="기다리는 말"
        className="flex flex-col gap-0.5 rounded-3xl bg-surface-under p-1.5 shadow-hairline"
      >
        {queue.map((message) => (
          <li
            key={message.id}
            data-queued={message.id}
            className="group flex min-h-9 items-center gap-2.5 rounded-2xl pr-1 pl-2.5 text-sm hover:bg-fill-hover"
          >
            <CornerDownRight className="size-4 shrink-0 text-fg-tertiary" aria-hidden />
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
                className="min-w-0 flex-1 bg-transparent text-fg outline-none"
              />
            ) : (
              <span className="min-w-0 flex-1 truncate" title={message.text}>
                {message.sendNow ? <span className="text-fg-tertiary">멈추고 전하는 중 · </span> : null}
                {message.text}
              </span>
            )}
            <span className="flex shrink-0 items-center gap-2.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
              {!message.sendNow && (
                <button
                  type="button"
                  onClick={() => run(threadApi.sendNow(thread, message.id))}
                  className="h-6.5 shrink-0 rounded-md bg-surface px-2.25 text-xs text-fg-secondary shadow-hairline transition-colors hover:text-fg focus-ring"
                >
                  지금 전하기
                </button>
              )}
              <button
                type="button"
                aria-label="기다리는 말 고치기"
                onClick={() => setEditing({ id: message.id, text: message.text })}
                className="icon-button-quiet icon-button-sm shrink-0 text-fg-tertiary focus-ring"
              >
                <Pencil className="size-3.5" aria-hidden />
              </button>
              <button
                type="button"
                aria-label="기다리는 말 지우기"
                onClick={() => run(threadApi.deleteQueued(thread, message.id))}
                className="icon-button-quiet icon-button-sm shrink-0 text-fg-tertiary focus-ring"
              >
                <Trash2 className="size-3.5" aria-hidden />
              </button>
            </span>
          </li>
        ))}
      </ul>
      {problem && (
        <p role="alert" className="px-2 text-xs text-danger">
          {problem}
        </p>
      )}
    </div>
  );
}

export default QueuedMessages;

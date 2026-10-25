import { useRef, useState } from "react";
import { X } from "lucide-react";
import { threadApi } from "./api";
import { Arriving } from "./arrival";
import type { QueuedMessage } from "./types";

// 기다리는 메시지(v1 티켓 05 · 02 구현 스펙 §10 · 스토리 70 · 캔버스 v35 Components 「대기」) — Agent가 일하는 동안 보낸 말이 입력창 위에
// 줄로 쌓였다가 차례로 간다. 「지금 보내기」를 누르면 하던 일에 바로 끼워 넣는다(멈추고 그 말을 먼저 보낸다). three-axes 대기 줄
// (`chat/QueuedMessages.tsx`)의 규칙 그대로 대기 줄은 엔진의 것이다: 이 화면은 이벤트가 준 대로 그리고, 고치기 · 지우기 · 지금 보내기는
// 대기 id를 실어 보낸다.
//
// 모양은 Components의 대기 줄이다 — 줄마다 `surface-tray` 면 · 둥글기 12 · 안쪽 6 / 8 / 6 / 12 · 13 2단계 글자에 「대기」 라벨(12 3단계) ·
// 말 · 오른쪽 끝 「지금 보내기」(고스트 24) · ×(22, 지우기). 말을 누르면 그 자리에서 고친다(보드에 고치기 단추는 없다 — v1의 고치기를
// 잃지 않는다). 새로 쌓인 줄은 칩으로 나타난다(v1 티켓 43 · 02 티켓 10 `chip-in`).

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
      <ul role="list" aria-label="기다리는 말" className="flex flex-col gap-1">
        {queue.map((message) => (
          <Arriving
            as="li"
            motion="chip-in"
            arrival={`queued:${message.id}`}
            key={message.id}
            data-queued={message.id}
            className="flex min-h-9 items-center gap-2 rounded-xl bg-surface-tray py-1.5 pr-2 pl-3 text-chat-meta text-fg-secondary"
          >
            <span className="shrink-0 text-xs text-fg-tertiary">대기</span>
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
              <button
                type="button"
                aria-label={`기다리는 말 고치기: ${message.text}`}
                title={message.text}
                disabled={message.sendNow}
                onClick={() => setEditing({ id: message.id, text: message.text })}
                className="min-w-0 flex-1 truncate rounded-sm text-left transition-colors enabled:hover:text-fg focus-ring"
              >
                {message.sendNow ? <span className="text-fg-tertiary">멈추고 보내는 중 · </span> : null}
                {message.text}
              </button>
            )}
            {!message.sendNow && (
              <button
                type="button"
                onClick={() => run(threadApi.sendNow(thread, message.id))}
                className="h-6 shrink-0 rounded-full px-2 text-chat-meta text-fg-secondary transition-colors quiet-hover focus-ring"
              >
                지금 보내기
              </button>
            )}
            <button
              type="button"
              aria-label="기다리는 말 지우기"
              onClick={() => run(threadApi.deleteQueued(thread, message.id))}
              className="flex size-5.5 shrink-0 items-center justify-center rounded-md text-fg-subtle transition-colors quiet-hover focus-ring"
            >
              <X className="size-3" aria-hidden />
            </button>
          </Arriving>
        ))}
      </ul>
      {problem && (
        <p role="alert" className="px-2 text-xs text-fg-secondary">
          {problem}
        </p>
      )}
    </div>
  );
}

export default QueuedMessages;

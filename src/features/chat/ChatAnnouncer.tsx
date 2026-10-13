import { useStore } from "@tanstack/react-store";
import { chatAnnouncementStore } from "./chat-store";

/**
 * 대화의 알림 자리(스토리 121) — 앱에 하나다(`AppShell`). 흐르는 답은 대화창 안에서 조각마다 읽히지 않고(대화창의 기록에는
 * 알림 영역이 없다), 턴이 끝날 때 여기서 한 번 읽힌다. 대화창 밖에 두는 것은 대화창이 둘(작업 패널 · `chat` 탭)이어도 알림은
 * 하나여야 하고, 닫힌 작업 패널은 폭만 0이라 그 안의 알림 영역이 계속 읽히기 때문이다.
 *
 * 알림마다 새 줄로 갈아 끼운다(`key`) — 같은 글이 두 번 와도 새 알림으로 읽힌다.
 */
function ChatAnnouncer() {
  const announcement = useStore(chatAnnouncementStore, (state) => state);
  return (
    <div role="status" aria-label="대화 알림" className="sr-only">
      {announcement && <p key={announcement.id}>{announcement.text}</p>}
    </div>
  );
}

export default ChatAnnouncer;

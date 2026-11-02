import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useOpenChat } from "@/features/thread/chat-door";
import { useThread } from "@/features/thread/hooks";
import { ThreadScreen } from "@/features/thread/ThreadScreen";
import { chatHome } from "./-work-search";

// `/threads/<id>`는 그 Thread다(v1 구현 스펙 §13). 목록 화면이 아니라 정규화가 없다 — 들어온 주소 그대로 서고, 없는 id면 화면이 그렇게
// 말한다(엔진의 「채팅을 찾을 수 없어요」). id는 엔진이 지은 시각 꼴(`20261010-100000`)이다.
//
// **살아 있는 작업공간의 채팅은 여기 서지 않는다**(restart 02a-4) — 그 작업공간 화면의 채팅 탭으로 보낸다(`chatHome` — 판단은 코어의
// `gone`이다. 작업공간 목록은 방금 만든 작업공간을 아직 모를 수 있다). 작업공간 밖 채팅과 보관되거나 지워져 읽기만 되는 채팅만 여기
// 선다. 채팅이 처음 작업공간에 이은 순간도 이 길이다 — 주소만 바꾼다(replace). 세션 · 돌던 턴 · 입력창의 글은 엔진과 스토어에 있어 그대로다.
export const Route = createFileRoute("/threads/$id")({
  component: ThreadRoute,
});

function ThreadRoute() {
  const { id } = Route.useParams();
  const { data: view } = useThread(id);
  const openChat = useOpenChat();
  const home = view ? chatHome(view) : null;
  useEffect(() => {
    if (view && home !== null) openChat(view, { replace: true });
  }, [home, id]);
  // 보내는 동안은 채팅 화면을 세우지 않는다 — 머리 줄에 이 채팅의 이름이 한 틱 섰다 사라지지 않게.
  if (home !== null) return null;
  // Thread마다 새로 선다 — 굴린 자리 · 펼친 줄이 다른 Thread로 따라가지 않게. 틀(머리 줄 · 흰 판)은 앱 셸이 그린다.
  return <ThreadScreen key={id} thread={id} />;
}

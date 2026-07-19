// 하단 상태바 — 활성 작업/미확인 카운트는 Works·Review 데이터 도입 시 추가 (스펙 후속 티켓).
function StatusBar() {
  return (
    <footer className="flex h-[26px] shrink-0 items-center border-t bg-panel px-3 text-[11px] text-tertiary">
      <div className="flex items-center gap-3.5">
        <span className="font-mono">~/.atelier</span>
        <span className="flex items-center gap-[5px]">
          <span className="size-1.5 rounded-full bg-[#0f7b52]" />
          감시 중
        </span>
      </div>
    </footer>
  );
}

export default StatusBar;

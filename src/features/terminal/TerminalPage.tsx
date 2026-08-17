import PageHeader from "@/components/shell/PageHeader";
import TerminalPane from "./TerminalPane";

// 최상위 터미널(`/terminal`). Work에 매이지 않은 셸들이 사는 화면이고, cwd는 백엔드의
// 데이터 루트다(결정 12·25). 본문은 Work의 터미널 탭과 **같은 컴포넌트**라 여기서는
// 머리행과 자리만 만든다.
function TerminalPage({ sidebarOpen }: { sidebarOpen: boolean }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1">
      <main className="relative flex min-w-0 flex-1 flex-col">
        <PageHeader root="Terminal" inset={!sidebarOpen} />
        <TerminalPane work={null} />
      </main>
    </div>
  );
}

export default TerminalPage;

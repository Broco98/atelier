import SpecTree from "./SpecTree";

interface SpecSectionProps {
  files: string[];
  current: string | null;
  onSelect: (path: string) => void;
  // spec 폴더 기준 상대 경로를 받는다 — 참조 문자열 조립은 호출부가 한다.
  // 이 영역은 어느 work의 문서인지 알 필요가 없다.
  onCopy: (path: string) => void;
}

// 작업 패널의 Spec 영역 — 머리글과 파일 트리.
//
// **Fragment로 돌려주는 것이 계약의 일부다.** 스크롤 경계가 이 둘 사이에 있다:
// 머리글은 패널 카드에 고정되고 트리만 세로로 스크롤한다. 한 겹 감싸면 flex-1이
// 카드가 아니라 그 껍데기를 기준으로 잡혀 경계가 옮겨간다.
function SpecSection({ files, current, onSelect, onCopy }: SpecSectionProps) {
  return (
    <>
      <div className="flex items-center px-4 pb-0.5 pt-2">
        <span className="text-[13.5px] font-semibold">Spec</span>
      </div>
      {/* 세로 스크롤은 여기까지 — Git 요약과 Spec 머리글은 고정되어 항상 보인다 */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-0.5 pt-1 scroll-quiet">
        {files.length === 0 ? (
          <span className="px-2 py-1.5 text-[12.5px] text-tertiary">아직 spec 파일이 없어요</span>
        ) : (
          <SpecTree files={files} current={current} onSelect={onSelect} onCopy={onCopy} />
        )}
      </div>
    </>
  );
}

export default SpecSection;

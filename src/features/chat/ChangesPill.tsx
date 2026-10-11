import { FileText } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { firstChangedLine, type ChangedFile } from "./changes";

// 입력창 위 「N개 파일 변경됨」 알약(three-axes 티켓 26 · 스토리 71~73) — 그 대화의 **마지막 턴**의 고친 곳을 센다. 턴 앞뒤로 spec
// 폴더를 견준 것이라(three-axes 결정 22) 함께 돈 다른 대화가 고친 파일도 든다(스토리 74). 다음 턴이 시작하면 마지막 턴이 바뀌어
// 걷힌다. 모양은 캔버스 보드 04 · 14의 `.cx-floatpill`(34 · 좌우 16 · 알약 · 흰 면 · 실선과 카드 그림자 · 13/18)이다 — 보드의
// `+N` `-N`은 싣지 않는다: 호스트가 세는 것은 새 글 쪽의 바뀐 줄 범위뿐이라 지운 줄 수를 모른다.
//
// 누르면 파일 목록이 뜨고, 파일을 누르면 스펙 창이 그 파일을 첫 고친 자리로 연다(스토리 72). 새로 생긴 문서는 「새 문서」로
// 구별한다(스토리 73). 지운 파일은 열 것이 없어 고를 수 없는 줄로 선다 — 눌러도 아무 일이 없는 줄을 두지 않는다.

const KIND_TAG: Partial<Record<ChangedFile["change"], string>> = { created: "새 문서", deleted: "지운 문서" };

function ChangesPill({
  files,
  onOpenDoc,
}: {
  files: readonly ChangedFile[];
  onOpenDoc: (path: string, line: number | null) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex h-[34px] shrink-0 items-center self-center rounded-full bg-card px-4 text-ui whitespace-nowrap shadow-(--chat-shadow-pill) outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
        {files.length}개 파일 변경됨
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="center" width="layout">
        {files.map((file) => {
          const tag = KIND_TAG[file.change];
          return (
            <DropdownMenuItem
              key={file.path}
              disabled={file.change === "deleted"}
              onClick={() => onOpenDoc(file.path, firstChangedLine(file))}
            >
              <FileText aria-hidden />
              <span className="min-w-0 flex-1 truncate">{file.path}</span>
              {tag && <span className="tag text-caption">{tag}</span>}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ChangesPill;

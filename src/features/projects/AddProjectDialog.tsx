import { useEffect, useState } from "react";
import { message, open as openFolderPicker } from "@tauri-apps/plugin-dialog";
import { useCreateProject, useUpdateProject } from "./hooks";

interface AddProjectDialogProps {
  open: boolean;
  onClose: () => void;
  onCreated: (slug: string) => void;
}

// open일 때만 마운트해서 열 때마다 입력 상태가 초기화되게 한다
function AddProjectDialog({ open, onClose, onCreated }: AddProjectDialogProps) {
  if (!open) return null;
  return <DialogBody onClose={onClose} onCreated={onCreated} />;
}

function DialogBody({ onClose, onCreated }: Omit<AddProjectDialogProps, "open">) {
  const createProject = useCreateProject();
  const updateProject = useUpdateProject();
  const [folder, setFolder] = useState<string | null>(null);
  const [baseBranch, setBaseBranch] = useState("main");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pickFolder = async () => {
    const picked = await openFolderPicker({ directory: true });
    if (typeof picked === "string") setFolder(picked);
  };

  const submit = async () => {
    if (!folder || submitting) return;
    setSubmitting(true);
    try {
      const view = await createProject.mutateAsync(folder);
      const branch = baseBranch.trim();
      if (branch && branch !== view.baseBranch) {
        await updateProject.mutateAsync({ slug: view.slug, patch: { baseBranch: branch } });
      }
      onCreated(view.slug);
      onClose();
    } catch (e) {
      setSubmitting(false);
      await message(`프로젝트를 추가하지 못했습니다: ${e}`, { title: "오류", kind: "error" });
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-[rgba(18,18,24,0.4)] pt-[120px]"
      onClick={onClose}
    >
      <div
        className="w-[480px] rounded-[14px] border border-border-strong bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col gap-1 px-5 pt-[18px]">
          <h2 className="text-[15px] font-semibold">프로젝트 등록</h2>
          <p className="text-[12.5px] text-tertiary">
            로컬 저장소 폴더를 Atelier에 연결해요. 코드는 건드리지 않아요.
          </p>
        </div>

        <div className="flex flex-col gap-3.5 px-5 py-4">
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">폴더</span>
            {folder ? (
              <div className="flex items-center justify-between gap-2.5 rounded-[10px] border border-border-strong bg-inset px-3 py-2">
                <span className="truncate font-mono text-[12.5px]">{folder}</span>
                <button
                  type="button"
                  onClick={pickFolder}
                  className="h-6 shrink-0 rounded-[7px] border px-[9px] text-[11.5px] text-muted-foreground transition-colors hover:bg-accent"
                >
                  변경
                </button>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2.5 rounded-[12px] border border-dashed border-border-strong p-[18px]">
                <button
                  type="button"
                  onClick={pickFolder}
                  className="h-7 rounded-[9px] border border-border-strong bg-panel px-3 text-[12.5px] font-medium transition-colors hover:bg-accent"
                >
                  폴더 선택…
                </button>
                <span className="text-xs text-tertiary">네이티브 선택기가 열려요</span>
              </div>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="add-base-branch">
              baseBranch
            </label>
            <input
              id="add-base-branch"
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              placeholder="main"
              className="h-[30px] rounded-[9px] border border-border-strong bg-background px-2.5 font-mono text-[12.5px] outline-none focus:border-primary"
            />
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="h-[30px] rounded-[9px] border border-border-strong px-[13px] text-[12.5px] font-medium text-muted-foreground transition-colors hover:bg-accent"
          >
            취소
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!folder || submitting}
            className="h-[30px] rounded-[9px] px-3.5 text-[12.5px] font-medium transition-[filter] enabled:bg-primary enabled:text-primary-foreground enabled:hover:brightness-[1.08] disabled:bg-accent disabled:text-tertiary"
          >
            등록
          </button>
        </div>
      </div>
    </div>
  );
}

export default AddProjectDialog;

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sessionsApi } from "./api";

// sessions/ 는 앱이 유일한 필자라 파일 감시자가 없다. 목록은 변경을 만든 쪽이 무효화한다.
const SESSIONS_KEY = ["sessions"] as const;

export function useSessions() {
  return useQuery({ queryKey: SESSIONS_KEY, queryFn: sessionsApi.list });
}

export function useCreateSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (projectSlug: string) => sessionsApi.create(projectSlug),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: SESSIONS_KEY }),
  });
}

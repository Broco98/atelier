import { QueryClient } from "@tanstack/react-query";

// 라우터가 렌더 밖에서(beforeLoad) 목록을 읽어야 해서 모듈 수준에 둔다.
// main.tsx의 Provider와 라우터 context가 같은 인스턴스를 공유한다 —
// 안 그러면 라우트가 확보한 데이터를 컴포넌트가 다시 받아온다.
export const queryClient = new QueryClient();

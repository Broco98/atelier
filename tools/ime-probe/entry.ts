// 계측기가 앱에서 가져다 쓰는 것들. **손으로 베끼지 않기 위해** 있는 파일이다 —
// 여기 없는 값을 page.html에 적어 두면 그때부터 계측기는 앱이 아니라 자기 자신을 잰다.
export { attachIme } from "../../src/features/terminal/terminal-ime";
export { terminalLook } from "../../src/features/terminal/terminal-defaults";
export { terminalThemeFor } from "../../src/features/terminal/terminal-theme";

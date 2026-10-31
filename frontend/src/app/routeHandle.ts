/** 라우트 객체의 handle 에 넣는 정보 */
export interface RouteHandle {
  /** 탭 제목과 h1 */
  title: string
  /** 진입 시 읽어 줄 문구 */
  announce?: string
  /** 관리자 브레드크럼에 표시할 이름 */
  crumb?: string
}
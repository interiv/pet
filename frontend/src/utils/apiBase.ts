/**
 * 接口地址 / Socket 地址的统一出口
 *
 * 默认走「同源相对路径」：页面请求 /api，由 Nginx 反代到后端。
 * 这样做的好处是同一份 dist 可以直接丢到任意域名下用——
 * VITE_* 这类变量是在 build 时被内联进 js 的，一旦忘了改 .env，
 * 就会把请求打到别的站点上（表现为接口全挂或跨域被拦），很难排查。
 *
 * 只有「前后端分离部署」（前端域名与后端域名确实不同）才需要配 VITE_API_URL，
 * 它只是可选覆盖项；不配就是同源。
 */

const RAW_API_URL = String((import.meta as any).env?.VITE_API_URL || '').trim();

/** axios 的 baseURL：同源时为相对路径 /api */
export const API_BASE_URL = RAW_API_URL || '/api';

/** Socket.IO 的服务地址：与页面同源，避免额外的跨域握手问题 */
export const SOCKET_URL = (() => {
  if (!RAW_API_URL) return window.location.origin;
  try {
    // 从 https://域名/api 反推站点根：https://域名
    return new URL(RAW_API_URL, window.location.origin).origin;
  } catch (e) {
    return window.location.origin;
  }
})();

/**
 * 串站自查：配置指向的站点与当前页面不一致时立刻报警。
 * 之前多实例部署最典型的事故就是——打开 pet2，页面却把请求发到了 pet，
 * 后端日志只留下一条「不允许的跨域请求」，根因却在前端产物里。
 */
if (RAW_API_URL) {
  try {
    const configured = new URL(API_BASE_URL, window.location.origin);
    if (configured.origin !== window.location.origin) {
      console.warn(
        `[接口地址] 当前页面是 ${window.location.origin}，但 VITE_API_URL 指向 ${configured.origin}。\n` +
        '          请求会被跨域拦截。多实例部署请删掉 frontend/.env，让前端走同源 /api。'
      );
    }
  } catch (e) { /* 配置非法时忽略，交给实际请求报错 */ }
}

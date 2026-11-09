// 云端静态托管未提供深层路径回退时使用哈希路由；本地开发仍保留普通路径。
declare const __MYOL_HASH_ROUTER__: boolean;
export const HASH_ROUTING = __MYOL_HASH_ROUTER__;
export const appHref = (path: string): string => HASH_ROUTING ? '/#' + path : path;

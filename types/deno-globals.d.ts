// 本地类型检查用的最小 Deno 声明（真实校验在部署阶段用 deno check 完成）。

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

declare module 'npm:@supabase/supabase-js@2.57.4' {
  // deno-lint-ignore-file no-explicit-any
  export function createClient(url: string, key: string, options?: unknown): any;
  export type SupabaseClient = any;
}

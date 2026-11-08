// 本地类型检查用的最小 Deno 声明（真实校验在部署阶段用 deno check 完成）。

declare const Deno: {
  env: { get(key: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

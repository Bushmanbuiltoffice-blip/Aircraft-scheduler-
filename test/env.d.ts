/// <reference types="@cloudflare/vitest-pool-workers/types" />

declare module "*.sql" {
  const value: string;
  export default value;
}

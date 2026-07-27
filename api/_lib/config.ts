export function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const config = {
  allowedOrigin: () => requiredEnv("ALLOWED_ORIGIN").replace(/\/$/, ""),
  siteUrl: () => requiredEnv("PUBLIC_SITE_URL").replace(/\/$/, ""),
  supabaseUrl: () => requiredEnv("SUPABASE_URL"),
  supabaseServiceRoleKey: () => requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  cloverMerchantId: () => requiredEnv("CLOVER_MERCHANT_ID"),
  cloverPrivateToken: () => requiredEnv("CLOVER_PRIVATE_TOKEN"),
  cloverApiBaseUrl: () =>
    process.env.CLOVER_API_BASE_URL ?? "https://api.clover.com",
  cloverWebhookSecret: () => requiredEnv("CLOVER_WEBHOOK_SECRET")
};

/** Reads a required server setting and fails loudly (in the server log) when the admin forgot it. */
export function env(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) throw new Error(`Missing environment variable ${name}. Add it in Vercel or .env.local.`);
  return value.trim();
}

/** Public address of the app, without a trailing slash. */
export function appUrl(): string {
  return env("NEXT_PUBLIC_APP_URL").replace(/\/+$/, "");
}

export const STORAGE_BUCKET = "post-images";

/** Every image a student uploads lives under this public prefix. */
export function storagePrefix(userId: string): string {
  return `${env("NEXT_PUBLIC_SUPABASE_URL").replace(/\/+$/, "")}/storage/v1/object/public/${STORAGE_BUCKET}/${userId}/`;
}

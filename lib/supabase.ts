import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { env } from "./env";

let client: SupabaseClient | null = null;

/**
 * Server-only Supabase client using the service_role key.
 * Never import this file from a "use client" component.
 */
export function db(): SupabaseClient {
  if (!client) {
    client = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

export type PostStatus = "pending" | "publishing" | "published" | "failed";

export interface AccountRow {
  user_id: string;
  /** Login identity. Starts with "ig:" when the account was connected with Instagram Login. */
  fb_user_id: string;
  ig_user_id: string;
  ig_username: string;
  ig_profile_picture_url: string | null;
  access_token: string;
  token_expires_at: string | null;
}

export interface PostRow {
  id: string;
  user_id: string;
  image_url: string;
  caption: string;
  scheduled_at: string;
  status: PostStatus;
  post_type?: "image" | "carousel" | "reel" | null;
  media?: { kind: "image" | "video"; url: string }[] | null;
  cover_url?: string | null;
  container_id?: string | null;
}

/** The only post columns that are ever sent to a browser. error_message is not among them. */
export const PUBLIC_POST_COLUMNS = "id,image_url,caption,scheduled_at,status,student_message,published_at";

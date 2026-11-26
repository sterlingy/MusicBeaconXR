// Public settings for the shared beacon map (docs/beacon-database-plan.md).
// The Supabase project's address and its publishable key are public by
// design: they ship in the page, and per-row security rules on the server
// decide what anyone can read or write. Private credentials never go here
// (they live in .env.supabase, which git ignores).

export const SUPABASE_URL = "https://oegvbjizvbpltfrzqvba.supabase.co";
export const SUPABASE_KEY = "sb_publishable_RjUT2cwZ5jYCuNwe2naItw_aw85jVhc";

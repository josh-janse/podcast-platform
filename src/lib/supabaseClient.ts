import { createBrowserClient } from '@supabase/ssr'; // if using SSR features later, or use createClient from '@supabase/supabase-js' for basic client

// Option 1: Basic client for client-side only (if not using SSR features from @supabase/ssr yet)
// import { createClient } from '@supabase/supabase-js'
// const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
// const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
// export const supabase = createClient(supabaseUrl, supabaseAnonKey);


// Option 2: Using @supabase/ssr for Next.js App Router (recommended for full features)
// This setup is more robust for server components, client components, and auth.
export function createClient() {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

    return createBrowserClient( // Use createBrowserClient for client-side
        supabaseUrl,
        supabaseAnonKey
    );
}

// If you need a global client instance (less common with App Router, often per-component or context based)
// export const supabase = createClient();
// components/AuthUIManager.tsx
"use client";

import { useEffect, useState } from 'react';
import { User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client'; // Your Supabase client initialization
import Link from 'next/link';
import LogoutButton from './LogoutButton'; // Assuming you have this component

export default function AuthUIManager() {
  const supabase = createClient();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function getInitialSession() {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user ?? null);
      setLoading(false);
    }

    getInitialSession();

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      setLoading(false);
      // Optional: handle specific events like PASSWORD_RECOVERY, USER_UPDATED etc.
      // if (event === 'SIGNED_IN') // router.push('/dashboard') or similar
      // if (event === 'SIGNED_OUT') // router.push('/auth/login')
    });

    return () => {
      authListener?.subscription.unsubscribe();
    };
  }, [supabase.auth]);

  if (loading) {
    return <p>Loading...</p>; // Or a spinner component
  }

  return (
    <div className="auth-ui-manager p-4">
      {user ? (
        <div className="flex items-center space-x-4">
          <p>Logged in as: <span className="font-semibold">{user.email}</span></p>
          <LogoutButton />
        </div>
      ) : (
        <div className="flex items-center space-x-4">
          <p>You are not logged in.</p>
          <Link href="/auth/login" passHref>
            <button className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600">
              Login / Sign Up
            </button>
          </Link>
        </div>
      )}
    </div>
  );
}
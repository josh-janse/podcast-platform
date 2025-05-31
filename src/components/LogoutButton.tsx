// components/LogoutButton.tsx
"use client";

import { useRouter } from 'next/navigation'; // For client-side navigation in App Router
import { createClient } from '@/lib/supabaseClient'; // Adjust path if needed
import { Button } from "@/components/ui/button";
import { useState } from 'react';

export default function LogoutButton() {
  const supabase = createClient();
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleLogout = async () => {
    setLoading(true);
    setError('');
    try {
      const { error: signOutError } = await supabase.auth.signOut({
        scope: 'local' // 'local' logs out current session, 'global' logs out all sessions for the user
      }); // [cite: 364]
      if (signOutError) {
        throw signOutError;
      }
      // Redirect to login page or home page after logout
      // Using router.push for client-side navigation is generally preferred in Next.js
      // router.refresh() can be used to re-fetch server components and update UI
      router.push('/auth/login'); // Or your desired redirect path
      router.refresh(); // To update server components if any depend on auth state
    } catch (error: any) {
      console.error('Error logging out:', error);
      setError(error.message || 'Failed to log out.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <Button onClick={handleLogout} disabled={loading} variant="outline">
        {loading ? 'Logging out...' : 'Log Out'}
      </Button>
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </div>
  );
}
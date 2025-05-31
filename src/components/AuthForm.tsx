// components/AuthForm.tsx
"use client";

import { useState } from 'react';
import { createClient } from '@/lib/supabaseClient'; // Adjust path if needed
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export default function AuthForm() {
  const supabase = createClient(); // Initialize the client component-side
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false); // To toggle between Sign In and Sign Up
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleAuth = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoading(true);
    setMessage('');
    setError('');

    try {
      if (isSignUp) {
        // Sign Up
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          // You can add options for user_metadata here if needed for the profile
          // options: {
          //   data: {
          //     name: 'Initial Name from Signup' // Example
          //   }
          // }
        });

        if (signUpError) throw signUpError;

        if (signUpData.user) {
          setMessage('Signup successful! Please check your email to confirm.');
          // Call the RPC function to create the profile
          const { error: rpcError } = await supabase.rpc('create_user_profile', {
            new_user_id: signUpData.user.id
          });
          if (rpcError) {
            console.error('Error calling create_user_profile:', rpcError);
            // Handle RPC error - user is signed up, but profile creation might have failed
            // You might want to log this or inform the user to try setting up their profile later
            setError('Signup successful, but profile creation failed. Please contact support or try updating your profile later.');
          } else {
            setMessage('Signup successful and profile initiated! Please check your email to confirm your account.');
          }
        } else if (signUpData.session) {
          // This case might happen if email confirmation is disabled
          setMessage('Signup successful!');
          const { error: rpcError } = await supabase.rpc('create_user_profile', {
             new_user_id: signUpData.session.user.id
          });
          if (rpcError) console.error('Error calling create_user_profile:', rpcError);

        } else {
         // This case could happen if the user already exists but is not confirmed
          setMessage('Please check your email to confirm your account.');
        }

      } else {
        // Sign In
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
        setMessage('Signed in successfully!');
        // Redirect user or update UI
        // For Next.js App Router, you might use router.push('/') or router.refresh()
        window.location.href = '/'; // Simple redirect for now
      }
    } catch (error: any) {
      console.error('Authentication error:', error);
      setError(error.error_description || error.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md p-8 space-y-6 bg-white rounded-lg shadow-md">
      <h2 className="text-2xl font-bold text-center">
        {isSignUp ? 'Create Account' : 'Sign In'}
      </h2>
      <form onSubmit={handleAuth} className="space-y-4">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            placeholder="you@example.com"
          />
        </div>
        <div>
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            placeholder="••••••••"
          />
        </div>
        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? 'Processing...' : (isSignUp ? 'Sign Up' : 'Sign In')}
        </Button>
      </form>
      {message && <p className="text-sm text-green-600 text-center">{message}</p>}
      {error && <p className="text-sm text-red-600 text-center">{error}</p>}
      <p className="text-sm text-center">
        {isSignUp ? (
          <>
            Already have an account?{' '}
            <button onClick={() => setIsSignUp(false)} className="font-medium text-blue-600 hover:underline">
              Sign In
            </button>
          </>
        ) : (
          <>
            Don&apos;t have an account?{' '}
            <button onClick={() => setIsSignUp(true)} className="font-medium text-blue-600 hover:underline">
              Sign Up
            </button>
          </>
        )}
      </p>
    </div>
  );
}
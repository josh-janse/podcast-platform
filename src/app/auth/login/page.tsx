// app/auth/login/page.tsx
import AuthForm from '@/components/AuthForm'; // Adjust path if needed

export default function LoginPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100">
      <AuthForm />
    </div>
  );
}
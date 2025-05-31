// app/layout.tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import AuthUIManager from "@/components/AuthUIManager"; // Adjust path if needed
import Link from 'next/link'; // <-- ADD THIS LINE

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Interactive Podcast Platform",
  description: "Generate and listen to interactive podcasts",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <header className="bg-gray-800 text-white p-4 shadow-md">
          <nav className="container mx-auto flex justify-between items-center">
            <Link href="/" className="text-xl font-bold">
              PodcastPlatform
            </Link>
            <AuthUIManager /> {/* Authentication UI Manager here */}
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
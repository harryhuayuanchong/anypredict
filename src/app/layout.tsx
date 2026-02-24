import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AnyPredict",
  description: "Prediction market analysis across weather, geopolitics, sports, and more",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <header className="border-b bg-card">
          <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-6">
            <Link href="/runs" className="font-semibold text-lg">
              AnyPredict
            </Link>
            <nav className="flex gap-4 text-sm text-muted-foreground">
              <Link href="/events" className="hover:text-foreground transition-colors">
                Events
              </Link>
              <Link href="/runs" className="hover:text-foreground transition-colors">
                History
              </Link>
              <Link href="/backtest" className="hover:text-foreground transition-colors">
                Backtest
              </Link>
              <Link href="/new" className="hover:text-foreground transition-colors">
                Analysis
              </Link>
              <Link href="/trading" className="hover:text-foreground transition-colors">
                Pilot
              </Link>
            </nav>
          </div>
        </header>
        <main className="max-w-4xl mx-auto px-4 py-6">{children}</main>
      </body>
    </html>
  );
}

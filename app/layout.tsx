import { Anuphan, Inter } from 'next/font/google';
import { defaultMetadata } from '@/lib/seo';
import { SentryInit } from '@/components/sentry-init';
import './globals.css';

const anuphan = Anuphan({
  subsets: ['thai', 'latin'],
  variable: '--font-anuphan',
  display: 'swap',
});

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata = defaultMetadata;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="th">
      <body
        className={`${anuphan.variable} ${inter.variable} font-sans antialiased`}
      >
        <SentryInit />
        {children}
      </body>
    </html>
  );
}

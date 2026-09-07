import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Mechanical Computer Lab',
  description:
    'A fixed physics sandbox for designing and testing a two-bit mechanical adder.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

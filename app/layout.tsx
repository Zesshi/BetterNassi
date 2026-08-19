import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BetterNassi",
  description: "A simple drag and drop editor for Nassi-Shneiderman diagrams.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
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

import type { Metadata } from "next";
import { Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import { RootProvider } from "fumadocs-ui/provider/next";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const ibmPlexMono = IBM_Plex_Mono({
  variable: "--font-ibm-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://termpod.dev"),
  title: {
    template: "%s | TermPod",
    default: "TermPod — Your Terminal, Everywhere",
  },
  description:
    "A shared terminal app for developers. Start a session on your Mac and interact with it from your iPhone in real time. Built with Tauri, SwiftUI, and Cloudflare Workers.",
  keywords: [
    "terminal",
    "shared terminal",
    "remote terminal",
    "developer tools",
    "CLI",
    "macOS",
    "iOS",
    "real-time",
    "TermPod",
  ],
  openGraph: {
    title: "TermPod — Your Terminal, Everywhere",
    description:
      "Start a terminal session on your Mac. View and interact from your iPhone. Real-time, seamless, built for developers.",
    url: "https://termpod.dev",
    siteName: "TermPod",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "TermPod — Your Terminal, Everywhere",
    description:
      "Start a terminal session on your Mac. View and interact from your iPhone. Real-time, seamless, built for developers.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${spaceGrotesk.variable} ${ibmPlexMono.variable}`}
      suppressHydrationWarning
    >
      <body className="grain antialiased">
        <RootProvider theme={{ forcedTheme: "dark" }}>
          {children}
        </RootProvider>
      </body>
    </html>
  );
}

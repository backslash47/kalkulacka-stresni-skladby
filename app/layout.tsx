import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://stresni-fyzika-matus-zamborsky.matus18726.chatgpt.site"),
  title: {
    default: "Kalkulačka střešní skladby",
    template: "%s | Střešní fyzika",
  },
  description:
    "Konfigurovatelný výpočet průběhu teplot, rosného bodu a rizika kondenzace.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    type: "website",
    locale: "cs_CZ",
    title: "Kalkulačka střešní skladby",
    description:
      "Porovnejte teplotu, rosný bod a riziko kondenzace ve dvou skladbách střechy.",
    images: [
      {
        url: "/og.png",
        width: 1200,
        height: 630,
        alt: "Graf teploty a rosného bodu ve střešní skladbě",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Kalkulačka střešní skladby",
    description: "Konfigurovatelné teplotní a difuzní posouzení střechy.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="cs">
      <body>{children}</body>
    </html>
  );
}

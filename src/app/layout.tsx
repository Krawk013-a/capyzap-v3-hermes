import type { Metadata, Viewport } from "next";
import "./globals.css";
import PwaRegister from "@/components/PwaRegister";

export const metadata: Metadata = {
  title: "CapyZap",
  description: "Mensagens rápidas com alma de capivara 🌿",
  manifest: "/manifest.json",
  icons: { icon: "/icons/capy.svg", apple: "/icons/capy-192.png" },
  appleWebApp: {
    capable: true,
    title: "CapyZap",
    statusBarStyle: "black-translucent",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  themeColor: "#244E37",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="bg-capy-sand text-capy-dark antialiased">
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}

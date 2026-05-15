import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { appConfig } from "@/lib/config/app";
import "./globals.css";

export const metadata: Metadata = {
  title: appConfig.name,
  description: appConfig.description,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}

import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "AquaGuard",
  description: "Remote monitoring and control for your AquaGuard water-pump system.",
};

export const viewport: Viewport = {
  themeColor: "#0f172a",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${plex.className} min-h-screen bg-canvas text-slate-900 antialiased`}>
        {children}
        <script
          // Registers the service worker; kept minimal and inline rather than
          // adding a dependency for this one call.
          dangerouslySetInnerHTML={{
            __html: `
              if ('serviceWorker' in navigator) {
                window.addEventListener('load', function () {
                  navigator.serviceWorker.register('/sw.js').then(function (reg) {
                    return reg.update();
                  }).catch(function () {});
                });
              }
            `,
          }}
        />
      </body>
    </html>
  );
}

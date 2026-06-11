import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Portfolio Skyline",
  description: "Institutional portfolio dashboard.",
};

const themeBootstrap = `
(function(){
  try {
    var t = localStorage.getItem('theme');
    if (!t) {
      t = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark' : 'light';
    }
    if (t === 'dark') document.documentElement.classList.add('dark');
  } catch (e) {}
})();
`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="min-h-full flex flex-col bg-bg text-text-primary font-sans">
        {children}
        <Toaster
          position="bottom-right"
          theme="system"
          richColors
          closeButton
          toastOptions={{
            style: {
              background: "var(--bg-secondary)",
              color: "var(--text-primary)",
              border: "1px solid var(--hairline-soft)",
              boxShadow: "var(--shadow-elevated)",
              borderRadius: "12px",
              fontVariantNumeric: "tabular-nums",
            },
            classNames: {
              description: "text-text-secondary",
            },
          }}
        />
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import ClientRootLayout from './layout-client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ViewComfyProvider } from './providers/view-comfy-provider';
import { Suspense } from 'react';

const metadata: Metadata = {
  title: "ViewComfy - 从工作流生成可视化应用",
  description: "将 ComfyUI 工作流转化为漂亮的 Web 应用",
};

export function generateMetadata(): Metadata {
  return metadata;
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>
            <ViewComfyProvider>
              <Suspense>
                <ClientRootLayout>
                  {children}
                </ClientRootLayout>
              </Suspense>
            </ViewComfyProvider>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}

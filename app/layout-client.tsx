"use client"
import "./globals.css";
import { SettingsService } from '@/app/services/settings-service';
import { TopNav } from '@/components/top-nav';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider } from '@/components/ui/sidebar';
import { Toaster } from 'sonner';
import { FileJson, Images, Mic, SquareTerminal, Video, Wand2 } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from "next/navigation";
import { Suspense, useEffect } from "react";

const settingsService = new SettingsService();

export default function ClientRootLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (pathname === "/") {
      router.push(settingsService.getIsViewMode() ? "/playground" : "/editor");
    }
  }, [pathname, router]);

  const content = (
    <Suspense>
      <div className="flex flex-col h-screen w-full overflow-hidden" style={{ '--top-nav-height': '57px', '--sidebar-width': '12rem' } as React.CSSProperties}>
        <TopNav />
        <SidebarProvider>
          <div className="flex flex-1 overflow-hidden">
            <AppSidebar />
            <main className="flex-1 overflow-x-auto overflow-y-hidden ml-[var(--sidebar-width)]">
              {children}
            </main>
          </div>
        </SidebarProvider>
      </div>
      <Toaster />
    </Suspense>
  );

  return content;
}

export function AppSidebar() {
  const pathname = usePathname();

  const items = [
    ...(settingsService.getIsViewMode() ? [] : [{
      title: "编辑器",
      url: "/editor",
      icon: FileJson,
    }]),
    {
      title: "智能生图",
      url: "/playground",
      icon: SquareTerminal,
    },
    {
      title: "智能修图",
      url: "/image-edit",
      icon: Wand2,
    },
    {
      title: "视频生成",
      url: "/video-generate",
      icon: Video,
    },
    {
      title: "音频克隆",
      url: "/audio-clone",
      icon: Mic,
    },
    {
      title: "画廊",
      url: "/gallery",
      icon: Images,
    },
  ];

  return (
    <Sidebar className={"mt-2"}>
      <SidebarContent className={`flex flex-col h-full overflow-y-auto border-r bg-background transition-all duration-300`} style={{ width: 'var(--sidebar-width)' }}>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={pathname == item.url}>
                    <Link href={item.url}>
                      <item.icon className="size-5" />
                      <span className="ml-2">{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-r bg-background">
      </ SidebarFooter>
    </Sidebar>
  )
}
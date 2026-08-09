"use client"
import "./globals.css";
import { SettingsService } from '@/app/services/settings-service';
import { TopNav } from '@/components/top-nav';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider } from '@/components/ui/sidebar';
import { useEffect } from 'react';
import { Toaster } from 'sonner';
import { FileJson, SquareTerminal } from 'lucide-react';
import Link from 'next/link';
import { ImageComparisonProvider } from "@/components/comparison/image-comparison-provider";
import { usePathname, useRouter } from "next/navigation";
import { Suspense } from "react";

const settingsService = new SettingsService();

const validUrls = ["/playground", "/sso"];

const showSidebar = !(settingsService.getIsRunningInViewComfy() && settingsService.getIsViewMode());

export default function ClientRootLayout({ children }: { children: React.ReactNode }) {
  const appId: string | null | undefined = null;
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (settingsService.getIsRunningInViewComfy()) {
      if (settingsService.getIsViewMode()) {
        if (appId) {
          router.push(`/playground?appId=${appId}`);
        } else if (!validUrls.some(url => pathname.startsWith(url))) {
          router.push("/apps");
        }
      } else {
        if (pathname === "/" || pathname === "/apps") {
          router.push("/editor");
        }
      }
    } else {
      if (pathname === "/") {
        router.push("/editor");
      }
    }
  }, [pathname, router, appId]);


  const content = (
    <Suspense>
      <ImageComparisonProvider>
        <div className="flex flex-col h-screen w-full overflow-hidden" style={{ '--top-nav-height': '57px', '--sidebar-width': '12rem' } as React.CSSProperties}>
          <TopNav />
          <SidebarProvider>
            <div className="flex flex-1 overflow-hidden">
              <AppSidebar />
              <main className={`flex-1 overflow-x-auto overflow-y-hidden ${showSidebar ? 'ml-[var(--sidebar-width)]' : ''}`}>
                {children}
              </main>
            </div>
          </SidebarProvider>
        </div>
        <Toaster />
      </ImageComparisonProvider>
    </Suspense>
  );

  return content;
}

export function AppSidebar() {
  const items = [];
  const pathname = usePathname();
  const isPlaygroundRouteEnabled = settingsService.getIsRunningInViewComfy() && settingsService.getIsViewMode();
  if (!showSidebar) {
    return <></>
  }
  if (settingsService.getIsRunningInViewComfy()) {
    if (settingsService.getIsViewMode()) {
      items.push({
        title: "Apps",
        url: "/apps",
        icon: FileJson,
      });
    } else {
      items.push({
        title: "Editor",
        url: "/editor",
        icon: FileJson,
      });
    }
  } else {
    if (!settingsService.getIsViewMode()) {
      items.push({
        title: "Editor",
        url: "/editor",
        icon: FileJson,
      });
    }
  };

  items.push({
    title: "Playground",
    url: isPlaygroundRouteEnabled ? "" : "/playground",
    icon: SquareTerminal,
  });

  return (
    <Sidebar className={"mt-2"}>
      <SidebarContent className={`flex flex-col h-full overflow-y-auto border-r bg-background transition-all duration-300`} style={{ width: 'var(--sidebar-width)' }}>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild isActive={pathname == `/${item.title.toLocaleLowerCase()}`}>
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

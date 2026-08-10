import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ModeToggle } from "./toggle";
import { useViewComfy } from "@/app/providers/view-comfy-provider";
import { useEffect, useState } from "react";

export function TopNav() {
    const { viewComfyState } = useViewComfy();
    const [appTitle, setAppTitle] = useState("智绘·先锋");
    const [appImg, setAppImg] = useState("");

    useEffect(() => {
        setAppTitle(viewComfyState.appTitle || "智绘·先锋");
        setAppImg(viewComfyState.appImg || "");
    }, [viewComfyState]);

    return (
        <nav className="flex items-center justify-between px-4 py-2 bg-background border-b gap-2">
            <div className="flex items-center">
                <ViewComfyIconButton appTitle={appTitle} appImg={appImg} />
                <span className="ml-2 text-lg font-semibold">{appTitle}</span>
            </div>

            {/* Spacer */}
            <div className="flex-1" />

            <div className="flex items-center gap-2">
                <ModeToggle />
            </div>
        </nav>
    )
}

function ViewComfyIconButton({ appTitle, appImg }: { appTitle?: string, appImg?: string }) {
    const iconParams = {
        href: "/editor",
        target: "",
        rel: ""
    }

    return (
        <Button variant={appImg ? "ghost" : "outline"} size="icon" aria-label="Home" className="p-0 overflow-hidden" style={{ width: 'auto', maxWidth: '120px', height: appImg ? '48px' : '34px' }}>
            {!appImg ? (
                <Link href={iconParams.href} target={iconParams.target} rel={iconParams.rel} className="flex items-center justify-center w-full h-full">
                    <img
                        src="/favicon.ico"
                        alt={appTitle || ""}
                        className="object-contain"
                        style={{ width: '34px', height: '34px' }}
                    />
                </Link>
            ) : (
                <Link href={iconParams.href} target={iconParams.target} rel={iconParams.rel} className="flex items-center justify-center w-full h-full">
                    <img
                        src={appImg}
                        alt={appTitle || ""}
                        className="object-contain max-h-[49px] w-fit"
                        style={{ width: '120px', height: '34px' }}
                    />
                </Link>
            )}
        </Button>
    )
}

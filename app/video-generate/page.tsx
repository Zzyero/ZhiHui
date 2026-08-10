"use client"
import PlaygroundPage from "@/components/pages/playground/playground-page";
import { Suspense } from "react";

export default function Page() {
    return (<Suspense><PlaygroundPage sectionName="视频生成" /></Suspense>);
}

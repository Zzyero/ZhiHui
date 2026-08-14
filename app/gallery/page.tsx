"use client"
import GalleryPage from "@/components/pages/gallery/gallery-page";
import { Suspense } from "react";

export default function Page() {
    return (<Suspense><GalleryPage /></Suspense>);
}

"use client"
import AdminPage from "@/components/pages/admin/admin-page";
import { Suspense } from "react";

export default function Page() {
    return (<Suspense><AdminPage /></Suspense>);
}

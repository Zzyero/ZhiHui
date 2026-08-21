"use client"
import AgentPage from "@/components/pages/agent/agent-page";
import { Suspense } from "react";

export default function Page() {
    return (<Suspense><AgentPage /></Suspense>);
}

import { ReactNode } from "react";

interface SelectableImageProps {
    imageUrl?: string;
    children: ReactNode;
    className?: string;
}

export function SelectableImage({ children, className = "relative" }: SelectableImageProps) {
    return (
        <div className={className}>
            {children}
        </div>
    );
}

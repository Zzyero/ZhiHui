"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * 自适应变高的 textarea：初始为单行，随输入内容自动增高，
 * 内容清空后回到最小高度。
 * 兼容 react-hook-form 的 field（ref / onChange / value 等）。
 */
const AutoGrowTextarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, onChange, ...props }, ref) => {
  const innerRef = React.useRef<HTMLTextAreaElement | null>(null)

  const resize = React.useCallback(() => {
    const el = innerRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${el.scrollHeight}px`
  }, [])

  // 初始值 / 外部改值时也要重新量高（如载入工作流、随机种子等）
  React.useLayoutEffect(() => {
    resize()
  }, [resize, props.value])

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    resize()
    onChange?.(event)
  }

  const setRef = React.useCallback(
    (node: HTMLTextAreaElement | null) => {
      innerRef.current = node
      if (typeof ref === "function") {
        ref(node)
      } else if (ref) {
        ref.current = node
      }
    },
    [ref]
  )

  return (
    <textarea
      ref={setRef}
      onChange={handleChange}
      rows={1}
      className={cn(
        "flex min-h-10 w-full resize-none overflow-hidden rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        className
      )}
      {...props}
    />
  )
})
AutoGrowTextarea.displayName = "AutoGrowTextarea"

export { AutoGrowTextarea }

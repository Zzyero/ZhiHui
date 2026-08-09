"use client"

import * as React from "react"
import {
    CaretSortIcon,
    CheckIcon,
} from "@radix-ui/react-icons"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    CommandSeparator,
} from "@/components/ui/command"
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog"
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover"
import type { IViewComfy } from "@/app/providers/view-comfy-provider";
import { useEffect } from "react"

type PopoverTriggerProps = React.ComponentPropsWithoutRef<typeof PopoverTrigger>

interface WorkflowSwitcherProps extends PopoverTriggerProps {
    viewComfys: IViewComfy[];
    currentViewComfy: IViewComfy;
    onSelectChange: (data: IViewComfy) => void;

}

export default function WorkflowSwitcher({ className, currentViewComfy, viewComfys, onSelectChange }: WorkflowSwitcherProps) {
    const [open, setOpen] = React.useState(false);
    const [showNewTeamDialog, setShowNewTeamDialog] = React.useState(false);
    const [currentWorkflow, setCurrentWorkflow] = React.useState<IViewComfy>(currentViewComfy);

    useEffect(() => {
        setCurrentWorkflow(currentViewComfy);
    }, [currentViewComfy]);

    const groups = [
        {
            label: "工作流",
            viewComfys
        },
    ];

    return (
        <Dialog open={showNewTeamDialog} onOpenChange={setShowNewTeamDialog}>
            <Popover open={open} onOpenChange={setOpen}>
                <PopoverTrigger asChild>
                    <Button
                        variant="outline"
                        role="combobox"
                        aria-expanded={open}
                        aria-label="选择工作流"
                        className={cn("w-full max-w-[300px] justify-between overflow-hidden", className)}
                    >
                        <span className="line-clamp-1 overflow-hidden">
                            {currentWorkflow.viewComfyJSON.title}
                        </span>
                        <CaretSortIcon className="ml-auto h-4 w-4 opacity-50" />
                    </Button>
                </PopoverTrigger>
                <PopoverContent className="w-full p-0">
                    <Command>
                        <CommandInput placeholder="搜索工作流..." />
                        <CommandList>
                            <CommandEmpty>未找到工作流。</CommandEmpty>
                            {groups.map((group) => (
                                <CommandGroup key={group.label} heading={group.label}>
                                    {group.viewComfys.map((viewComfy) => (
                                        <CommandItem
                                            key={viewComfy.viewComfyJSON.id}
                                            onSelect={() => {
                                                onSelectChange(viewComfy)
                                                setOpen(false)
                                            }}
                                            className="text-sm"
                                        >
                                            {viewComfy.viewComfyJSON.title}
                                            <CheckIcon
                                                className={cn(
                                                    "ml-auto h-4 w-4",
                                                    currentWorkflow.viewComfyJSON.id === viewComfy.viewComfyJSON.id
                                                        ? "opacity-100"
                                                        : "opacity-0"
                                                )}
                                            />
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            ))}
                        </CommandList>
                        <CommandSeparator />
                        {/* <CommandList>
                            <CommandGroup>
                                <DialogTrigger asChild>
                                    <CommandItem
                                        onSelect={() => {
                                            setOpen(false)
                                            setShowNewTeamDialog(true)
                                        }}
                                    >
                                        <PlusCircledIcon className="mr-2 h-5 w-5" />
                                        Add Workflow
                                    </CommandItem>
                                </DialogTrigger>
                            </CommandGroup>
                        </CommandList> */}
                    </Command>
                </PopoverContent>
            </Popover>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>创建工作流</DialogTitle>
                    <DialogDescription>
                        添加一个新的工作流。
                    </DialogDescription>
                </DialogHeader>
                <div>
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={() => setShowNewTeamDialog(false)}>
                        取消
                    </Button>
                    <Button type="submit">继续</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

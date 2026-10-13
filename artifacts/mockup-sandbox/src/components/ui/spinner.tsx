import { Loader2Icon } from "lucide-react"
import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const iconProps = props as unknown as ComponentProps<typeof Loader2Icon>
  return (
    <Loader2Icon
      {...iconProps}
      role="status"
      aria-label="Loading"
      className={cn("size-4 animate-spin", className)}
    />
  )
}

export { Spinner }

import { cn } from "@/lib/utils"

function Skeleton({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-md bg-muted/80 loading-shimmer", className)}
      {...props}
    />
  )
}

export { Skeleton }

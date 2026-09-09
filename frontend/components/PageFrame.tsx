import { cn } from "@/lib/cn";

export function PageFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <main className={cn("mx-auto w-full max-w-5xl px-4 py-10 md:px-6", className)}>{children}</main>;
}

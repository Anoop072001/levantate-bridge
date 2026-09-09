import Link from "next/link";
import { LogoIcon } from "@/components/LogoIcon";
import { cn } from "@/lib/cn";

export function Brand({ className }: { className?: string }) {
  return (
    <Link href="/" className={cn("flex items-center gap-2", className)}>
      <LogoIcon className="h-8 w-8" />
      <span className="font-serif text-2xl tracking-wide italic">Levantate</span>
    </Link>
  );
}

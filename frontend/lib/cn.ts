import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const insetButtonClass =
  "group inline-flex h-10 cursor-pointer items-center gap-2 bg-zinc-200 px-5 text-sm font-medium text-black shadow-[inset_0_2px_0px_rgba(255,255,255,1),inset_0_-2px_0px_rgba(0,0,0,0.2)] transition-transform active:scale-[0.96] disabled:cursor-not-allowed";

export const insetButtonDarkClass =
  "group inline-flex h-10 cursor-pointer items-center gap-2 bg-zinc-900 px-5 text-sm font-medium text-white shadow-[inset_0_2px_0px_rgba(255,255,255,0.18),inset_0_-2px_0px_rgba(0,0,0,0.45)] transition-transform active:scale-[0.96] disabled:cursor-not-allowed";

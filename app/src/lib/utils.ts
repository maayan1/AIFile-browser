import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** shadcn's class helper: joins class names and lets later Tailwind classes win. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

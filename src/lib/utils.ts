import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Renter-facing views show only the owner's first name — no surname, no
// contact details — so renters can't look owners up or contact them outside
// GoMambo's messaging.
export function firstNameOnly(fullName: string) {
  return fullName.trim().split(/\s+/)[0] ?? fullName
}

"use client";

import { useRouter } from "next/navigation";

export function BackButton({ label = "Wstecz" }: { label?: string }) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="inline-block w-fit self-start text-left text-sm text-muted-foreground hover:underline"
    >
      ← {label}
    </button>
  );
}

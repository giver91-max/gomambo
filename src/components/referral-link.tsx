"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function ReferralLink({ link }: { link: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(link);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex gap-2">
      <Input value={link} readOnly onFocus={(e) => e.target.select()} className="text-sm" />
      <Button type="button" variant="outline" onClick={handleCopy}>
        {copied ? "Skopiowano!" : "Kopiuj"}
      </Button>
    </div>
  );
}

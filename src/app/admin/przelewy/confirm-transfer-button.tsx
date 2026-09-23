"use client";

import { useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { confirmBookingTransfer, confirmExtraChargeTransfer } from "./actions";

export function ConfirmTransferButton({
  id,
  kind,
}: {
  id: string;
  kind: "booking" | "extra_charge";
}) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    startTransition(async () => {
      const result =
        kind === "booking"
          ? await confirmBookingTransfer(id)
          : await confirmExtraChargeTransfer(id);
      // The page revalidates and this row disappears, so a toast is the only
      // place a message can survive long enough to be read.
      if (result?.error) {
        toast.error(result.error, { duration: Infinity, closeButton: true });
      } else {
        toast.success("Wpłata potwierdzona.");
      }
    });
  }

  return (
    <Button type="button" size="sm" onClick={handleClick} disabled={isPending}>
      {isPending ? "Potwierdzanie…" : "Potwierdź wpłatę"}
    </Button>
  );
}

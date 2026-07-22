"use client";

import { useState } from "react";
import { AvailabilityView, type SelectedRange } from "./availability-view";
import { InquiryForm } from "./inquiry-form";
import type { IdentityVerificationStatus } from "@/types/database";

export function AvailabilityAndInquiry({
  carId,
  availableDates,
  isLoggedIn,
  verificationStatus,
  verificationRejectionReason,
  pricePerDay,
  pricePerMonth,
}: {
  carId: string;
  availableDates: string[];
  isLoggedIn: boolean;
  verificationStatus: IdentityVerificationStatus | null;
  verificationRejectionReason: string | null;
  pricePerDay: number;
  pricePerMonth: number | null;
}) {
  const [range, setRange] = useState<SelectedRange>({ start: "", end: null });

  return (
    <div className="grid gap-6 sm:grid-cols-2 sm:items-start">
      <AvailabilityView availableDates={availableDates} onRangeChange={setRange} />
      <InquiryForm
        carId={carId}
        selectedRange={range}
        isLoggedIn={isLoggedIn}
        verificationStatus={verificationStatus}
        verificationRejectionReason={verificationRejectionReason}
        pricePerDay={pricePerDay}
        pricePerMonth={pricePerMonth}
      />
    </div>
  );
}

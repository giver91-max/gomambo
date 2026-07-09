"use client";

import { useState } from "react";
import { AvailabilityView, type SelectedRange } from "./availability-view";
import { InquiryForm } from "./inquiry-form";

export function AvailabilityAndInquiry({
  carId,
  availableDates,
  isLoggedIn,
}: {
  carId: string;
  availableDates: string[];
  isLoggedIn: boolean;
}) {
  const [range, setRange] = useState<SelectedRange>({ start: "", end: null });

  return (
    <div className="grid gap-6 sm:grid-cols-2 sm:items-start">
      <AvailabilityView availableDates={availableDates} onRangeChange={setRange} />
      <InquiryForm carId={carId} selectedRange={range} isLoggedIn={isLoggedIn} />
    </div>
  );
}

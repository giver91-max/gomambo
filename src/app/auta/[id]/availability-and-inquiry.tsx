"use client";

import { useState } from "react";
import { AvailabilityView, type SelectedRange } from "./availability-view";
import { InquiryForm } from "./inquiry-form";

export function AvailabilityAndInquiry({
  carId,
  availableDates,
}: {
  carId: string;
  availableDates: string[];
}) {
  const [range, setRange] = useState<SelectedRange>({ start: "", end: null });

  return (
    <div className="grid gap-6 sm:grid-cols-[20rem_1fr] sm:items-start">
      <AvailabilityView availableDates={availableDates} onRangeChange={setRange} />
      <InquiryForm carId={carId} selectedRange={range} />
    </div>
  );
}

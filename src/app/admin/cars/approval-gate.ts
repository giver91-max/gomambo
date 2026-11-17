import type { IdentityVerificationStatus, PartnerStatus } from "@/types/database";

/**
 * What a car still lacks before GoMambo may publish it.
 *
 * The database only refuses to publish a car whose OC or inspection date has
 * PASSED, or whose company is not active (enforce_car_update_rules, 0051) — a
 * missing date deliberately counts as "not expired" for cars listed before
 * 0051. So "Zatwierdź" used to publish cars with no plate, no OC policy, no
 * dates and no right-to-rent statement, owned by people who had never
 * verified their identity, and mail them "your car is approved".
 *
 * These are the same things every new car is asked for today (createCar,
 * parseCarListingForm, parseCarDocumentsForm, the policy upload) plus the
 * owner gate (ownerListingGate): the individual's verified identity, or for a
 * rental company, the company being verified. One list, used by the review
 * card to explain the greyed-out button and by approveCar to refuse.
 */
export type ApprovalFacts = {
  registrationNumber: string | null;
  insuranceDocumentPath: string | null;
  insuranceValidUntil: string | null;
  inspectionValidUntil: string | null;
  rentalRightConfirmedAt: string | null;
  /** Set when the car belongs to a rental company. */
  partner: { statusLabel: string; status: PartnerStatus } | null;
  /** The owner's identity verification; only checked for a private owner. */
  ownerVerification: IdentityVerificationStatus | null;
};

export function missingForApproval(facts: ApprovalFacts): string[] {
  const missing: string[] = [];
  if (!facts.registrationNumber?.trim()) missing.push("numer rejestracyjny");
  if (!facts.insuranceDocumentPath) missing.push("plik polisy OC");
  if (!facts.insuranceValidUntil) missing.push("data ważności OC");
  if (!facts.inspectionValidUntil) missing.push("termin badania technicznego");
  if (!facts.rentalRightConfirmedAt) missing.push("oświadczenie o prawie do wynajmu");
  if (facts.partner) {
    if (facts.partner.status !== "active") {
      missing.push(`zweryfikowana wypożyczalnia (teraz: ${facts.partner.statusLabel})`);
    }
  } else if (facts.ownerVerification !== "approved") {
    missing.push("zweryfikowana tożsamość właściciela");
  }
  return missing;
}

/**
 * The owner half of missingForApproval, seen from the owner's side: is GoMambo
 * the one holding things up? A car with all its documents tells its owner
 * "Sprawdzamy ogłoszenie — damy znać mailem" only when this is true;
 * otherwise "Zatwierdź" is greyed out on the admin card and that mail would
 * never come, while the owner waited for it.
 *
 * GoMambo's move: an approved or pending identity verification, a company
 * that is verified, or one under review with a registration document filed.
 * The owner's move: no verification, a rejected one, a company asked for
 * corrections ('draft') or one with no document yet. A suspended or ended
 * company counts as not ready too — nothing the review could fix.
 */
export function ownerSideReadyForReview({
  carPartnerId,
  partner,
  partnerDocumentCount,
  ownerVerification,
}: {
  carPartnerId: string | null;
  /** The company the viewing account acts for (getPartnerContext). */
  partner: { partnerId: string; status: PartnerStatus } | null;
  partnerDocumentCount: number;
  ownerVerification: IdentityVerificationStatus | null;
}): boolean {
  if (carPartnerId) {
    // A company this account does not act for (any more): nothing it could
    // do here, and the admin card names the company's status.
    if (!partner || partner.partnerId !== carPartnerId) return true;
    return partner.status === "active" || (partner.status === "pending" && partnerDocumentCount > 0);
  }
  return ownerVerification === "approved" || ownerVerification === "pending";
}

/** How the owner's verification reads on the review card. */
export const OWNER_VERIFICATION_LABELS: Record<IdentityVerificationStatus | "none", string> = {
  approved: "zweryfikowana",
  pending: "czeka na sprawdzenie",
  rejected: "odrzucona",
  none: "brak — nie przesłano dokumentu",
};

import type { PartnerDocumentKind } from "@/types/database";

// Shared by the upload menu (a client component) and the server action that
// files the document and tells the admins what arrived. Neither "use client"
// nor "use server" can export a plain value to the other side, so the list
// lives here.
export const PARTNER_DOCUMENT_KINDS: { value: PartnerDocumentKind; label: string }[] = [
  { value: "krs", label: "Odpis z KRS" },
  { value: "ceidg", label: "Wydruk z CEIDG" },
  { value: "nip_confirmation", label: "Potwierdzenie NIP" },
  { value: "insurance", label: "Polisa floty" },
  { value: "other", label: "Inny dokument" },
];

export function isPartnerDocumentKind(kind: string): kind is PartnerDocumentKind {
  return PARTNER_DOCUMENT_KINDS.some((k) => k.value === kind);
}

export function partnerDocumentLabel(kind: string): string {
  return PARTNER_DOCUMENT_KINDS.find((k) => k.value === kind)?.label ?? kind;
}

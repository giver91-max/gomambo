import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/back-button";
import { PARTNER_STATUS_LABELS } from "@/lib/partner";
import { DecidePartner, VerifyDocumentButton } from "./decide-partner";
import type { PartnerStatus } from "@/types/database";

const TABS: { value: PartnerStatus; label: string }[] = [
  { value: "pending", label: "Do weryfikacji" },
  { value: "active", label: "Zweryfikowane" },
  { value: "suspended", label: "Zawieszone" },
  { value: "terminated", label: "Zakończone" },
];

const DOC_LABELS: Record<string, string> = {
  krs: "Odpis z KRS",
  ceidg: "Wydruk z CEIDG",
  nip_confirmation: "Potwierdzenie NIP",
  insurance: "Polisa floty",
  other: "Inny dokument",
};

// Service role: the joins reach partner_private and profiles, and profiles
// has no admin SELECT policy. /admin/* is gated by middleware and the layout.
export default async function AdminPartnersPage({
  searchParams,
}: {
  searchParams: { status?: string };
}) {
  const status = (TABS.find((t) => t.value === searchParams.status)?.value ??
    "pending") as PartnerStatus;
  const admin = createAdminClient();

  const { data: partners } = await admin
    .from("partners")
    .select(
      `id, trade_name, city, description, status, created_at,
       partner_private(legal_name, nip, regon, krs, address_street,
                       address_postal_code, address_city, contact_email, contact_phone),
       partner_members(role, profiles(full_name, phone)),
       partner_documents(id, kind, original_name, storage_path, verified_at)`
    )
    .eq("status", status)
    .order("created_at", { ascending: true });

  const rows = (partners ?? []) as unknown as {
    id: string;
    trade_name: string;
    city: string | null;
    description: string | null;
    status: PartnerStatus;
    created_at: string;
    partner_private: {
      legal_name: string | null;
      nip: string | null;
      regon: string | null;
      krs: string | null;
      address_street: string | null;
      address_postal_code: string | null;
      address_city: string | null;
      contact_email: string | null;
      contact_phone: string | null;
    } | null;
    partner_members: { role: string; profiles: { full_name: string; phone: string | null } | null }[];
    partner_documents: {
      id: string;
      kind: string;
      original_name: string | null;
      storage_path: string;
      verified_at: string | null;
    }[];
  }[];

  // Short-lived signed links: these documents sit in a private bucket and
  // must never become durable URLs.
  const docUrls = new Map<string, string>();
  for (const partner of rows) {
    for (const doc of partner.partner_documents ?? []) {
      const { data: signed } = await admin.storage
        .from("partner-documents")
        .createSignedUrl(doc.storage_path, 60 * 10);
      if (signed?.signedUrl) docUrls.set(doc.id, signed.signedUrl);
    }
  }

  const { data: carCounts } = await admin
    .from("cars")
    .select("partner_id")
    .not("partner_id", "is", null);
  const carsByPartner = new Map<string, number>();
  for (const car of carCounts ?? []) {
    if (!car.partner_id) continue;
    carsByPartner.set(car.partner_id, (carsByPartner.get(car.partner_id) ?? 0) + 1);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackButton />
      <div>
        <h1 className="text-2xl font-bold">Wypożyczalnie</h1>
        <p className="text-sm text-muted-foreground">
          Weryfikacja firmy jest jednorazowa — po niej Partner dodaje dowolną liczbę aut bez
          podpisywania czegokolwiek przy każdym z nich.
        </p>
      </div>

      <div className="flex flex-wrap gap-2 border-b">
        {TABS.map((tab) => (
          <Link
            key={tab.value}
            href={`/admin/partnerzy?status=${tab.value}`}
            className={`px-3 py-2 text-sm ${
              status === tab.value
                ? "border-b-2 border-primary font-medium"
                : "text-muted-foreground"
            }`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Brak wypożyczalni w tej kategorii.</p>
      ) : (
        <div className="space-y-4">
          {rows.map((partner) => {
            const priv = partner.partner_private;
            return (
              <Card key={partner.id}>
                <CardHeader className="flex flex-row items-start justify-between space-y-0">
                  <CardTitle className="text-base">{partner.trade_name}</CardTitle>
                  <Badge variant={partner.status === "active" ? "default" : "secondary"}>
                    {PARTNER_STATUS_LABELS[partner.status]}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-3 text-sm text-muted-foreground">
                  <div className="space-y-0.5">
                    <p className="text-foreground">{priv?.legal_name ?? "—"}</p>
                    <p className="text-xs">
                      NIP {priv?.nip ?? "—"}
                      {priv?.regon ? ` · REGON ${priv.regon}` : ""}
                      {priv?.krs ? ` · KRS ${priv.krs}` : ""}
                    </p>
                    <p className="text-xs">
                      {[priv?.address_street, priv?.address_postal_code, priv?.address_city]
                        .filter(Boolean)
                        .join(", ") || "brak adresu"}
                    </p>
                    <p className="text-xs">
                      {priv?.contact_email ?? "—"}
                      {priv?.contact_phone ? ` · ${priv.contact_phone}` : ""}
                    </p>
                  </div>

                  {priv?.nip && (
                    <p className="text-xs">
                      Sprawdź w rejestrach:{" "}
                      <a
                        className="text-primary hover:underline"
                        href={`https://wyszukiwarkaregon.stat.gov.pl/appBIR/index.aspx`}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        REGON
                      </a>
                      {" · "}
                      <a
                        className="text-primary hover:underline"
                        href={`https://www.podatki.gov.pl/wykaz-podatnikow-vat-wyszukiwarka/`}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        biała lista VAT
                      </a>
                      {" · "}
                      <a
                        className="text-primary hover:underline"
                        href={`https://prod.ceidg.gov.pl/ceidg/ceidg.public.ui/search.aspx`}
                        target="_blank"
                        rel="noreferrer noopener"
                      >
                        CEIDG
                      </a>
                    </p>
                  )}

                  <p className="text-xs">
                    Osoby w firmie:{" "}
                    {(partner.partner_members ?? [])
                      .map((m) => `${m.profiles?.full_name ?? "—"} (${m.role})`)
                      .join(", ") || "—"}
                    {" · "}
                    aut w systemie: {carsByPartner.get(partner.id) ?? 0}
                  </p>

                  {(partner.partner_documents ?? []).length > 0 ? (
                    <ul className="space-y-1">
                      {partner.partner_documents.map((doc) => (
                        <li key={doc.id} className="flex flex-wrap items-center gap-2 border-t pt-1">
                          <span className="text-foreground">
                            {DOC_LABELS[doc.kind] ?? doc.kind}
                            {doc.original_name ? ` — ${doc.original_name}` : ""}
                          </span>
                          {docUrls.has(doc.id) && (
                            <a
                              className="text-primary hover:underline"
                              href={docUrls.get(doc.id)}
                              target="_blank"
                              rel="noreferrer noopener"
                            >
                              otwórz
                            </a>
                          )}
                          {doc.verified_at ? (
                            <Badge>Sprawdzony</Badge>
                          ) : (
                            <VerifyDocumentButton documentId={doc.id} />
                          )}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-destructive">
                      Brak dokumentów — poproś o odpis z KRS albo wydruk z CEIDG przed weryfikacją.
                    </p>
                  )}

                  <DecidePartner partnerId={partner.id} status={partner.status} />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/back-button";
import { getPartnerContext, PARTNER_STATUS_LABELS } from "@/lib/partner";
import { PartnerForm } from "./partner-form";
import { PartnerDocuments } from "./partner-documents";

export const metadata = { title: "Moja wypożyczalnia" };

export default async function PartnerPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const partner = await getPartnerContext(supabase, user.id);

  // partner_private and partner_documents are readable by members through
  // RLS, so the session client is enough — no service role needed here.
  const [{ data: privateData }, { data: documents }] = await Promise.all([
    partner
      ? supabase
          .from("partner_private")
          .select("*")
          .eq("partner_id", partner.partnerId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
    partner
      ? supabase
          .from("partner_documents")
          .select("id, kind, original_name, verified_at, created_at")
          .eq("partner_id", partner.partnerId)
          .order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
  ]);

  const { data: publicData } = partner
    ? await supabase
        .from("partners")
        .select("trade_name, city, description, rejection_reason")
        .eq("id", partner.partnerId)
        .maybeSingle()
    : { data: null };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackButton />
      <div>
        <h1 className="text-2xl font-bold">Moja wypożyczalnia</h1>
        <p className="text-sm text-muted-foreground">
          Jedno konto firmy, jedna umowa, dowolna liczba aut. Dane firmy podajesz raz — przy
          każdym kolejnym aucie nie trzeba już niczego podpisywać.
        </p>
      </div>

      {partner && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="text-base">{partner.tradeName}</CardTitle>
            <Badge
              variant={
                partner.status === "active"
                  ? "default"
                  : partner.status === "pending"
                    ? "secondary"
                    : "destructive"
              }
            >
              {PARTNER_STATUS_LABELS[partner.status]}
            </Badge>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            {partner.status === "pending" && (
              <p>
                Sprawdzamy dane firmy i dokumenty. Do tego czasu możesz przygotować flotę, ale
                auta nie będą jeszcze widoczne dla klientów.
              </p>
            )}
            {partner.status === "active" && (
              <p>
                Wypożyczalnia zweryfikowana — Twoje auta mogą trafić do katalogu po zatwierdzeniu
                każdego ogłoszenia.
              </p>
            )}
            {publicData?.rejection_reason && (
              <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-foreground">
                {publicData.rejection_reason}
              </p>
            )}
            <p className="text-xs">
              Rezerwacje w Twoich autach{" "}
              <strong className="text-foreground">wymagają Twojego potwierdzenia</strong> — klient
              nie rezerwuje automatycznie.
            </p>
          </CardContent>
        </Card>
      )}

      <PartnerForm
        initial={{
          trade_name: publicData?.trade_name ?? "",
          city: publicData?.city ?? "",
          description: publicData?.description ?? "",
          legal_name: privateData?.legal_name ?? "",
          nip: privateData?.nip ?? "",
          regon: privateData?.regon ?? "",
          krs: privateData?.krs ?? "",
          address_street: privateData?.address_street ?? "",
          address_postal_code: privateData?.address_postal_code ?? "",
          address_city: privateData?.address_city ?? "",
          contact_email: privateData?.contact_email ?? user.email ?? "",
          contact_phone: privateData?.contact_phone ?? "",
        }}
        isNew={!partner}
      />

      {partner && (
        <PartnerDocuments
          partnerId={partner.partnerId}
          documents={(documents ?? []).map((d) => ({
            id: d.id,
            kind: d.kind,
            originalName: d.original_name,
            verifiedAt: d.verified_at,
          }))}
        />
      )}
    </div>
  );
}

import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BackButton } from "@/components/back-button";
import { ResolveVerificationButton } from "./resolve-button";

// Service role: the joins reach bookings and profiles, neither of which has
// an admin SELECT policy. /admin/* is gated by middleware and the layout.
export default async function AdminBookingVerificationsPage() {
  const admin = createAdminClient();

  const { data: rows } = await admin
    .from("booking_verifications")
    .select(
      `booking_id, status, face_match_result, face_match_score,
       requested_at, submitted_at, selfie_path,
       booking_verification_notes(reason),
       bookings!inner(start_date, end_date, status, renter_id,
                      cars(brand, model, year, city),
                      renter:profiles!bookings_renter_id_fkey(full_name, phone),
                      owner:profiles!bookings_owner_id_fkey(full_name))`
    )
    // Everything still waiting on a human, not only what was escalated:
    // "admin zawsze" means GoMambo can step in at any point, and in practice
    // it has to when a host goes quiet.
    .neq("status", "approved")
    // A cancelled booking has nothing left to decide; without this it sits in
    // the queue for ever and approving it would mail the renter about
    // collecting a car that isn't theirs any more.
    .eq("bookings.status", "accepted")
    .order("requested_at", { ascending: true });

  // Past the 24h deadline first — those are the ones that need a phone call
  // or a cancellation today.
  const list = ((rows ?? []) as unknown as {
    booking_id: string;
    status: string;
    face_match_result: string | null;
    face_match_score: number | null;
    booking_verification_notes: { reason: string } | null;
    requested_at: string;
    submitted_at: string | null;
    selfie_path: string | null;
    bookings: {
      start_date: string;
      end_date: string;
      status: string;
      renter_id: string;
      cars: { brand: string; model: string; year: number; city: string } | null;
      renter: { full_name: string; phone: string | null } | null;
      owner: { full_name: string } | null;
    } | null;
  }[]).sort((a, b) => Number(b.status === "escalated") - Number(a.status === "escalated"));

  // Signed, short-lived: the selfie sits in the private id-documents bucket
  // and must never become a durable public URL.
  const selfieUrls = new Map<string, string>();
  // Unlike the host, GoMambo keeps access to the licence after approval —
  // it is the party that verified it in the first place and the one that has
  // to settle any later dispute.
  const licenceUrls = new Map<string, { front: string | null; back: string | null }>();
  const sign = async (path: string | null) => {
    if (!path) return null;
    const { data } = await admin.storage.from("id-documents").createSignedUrl(path, 60 * 10);
    return data?.signedUrl ?? null;
  };
  for (const row of list) {
    if (row.selfie_path) {
      const url = await sign(row.selfie_path);
      if (url) selfieUrls.set(row.booking_id, url);
    }
    const renterId = row.bookings?.renter_id;
    if (!renterId) continue;
    const { data: identity } = await admin
      .from("identity_verifications")
      .select("document_path, document_back_path")
      .eq("user_id", renterId)
      .maybeSingle();
    licenceUrls.set(row.booking_id, {
      front: await sign(identity?.document_path ?? null),
      back: await sign(identity?.document_back_path ?? null),
    });
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <BackButton />
      <div>
        <h1 className="text-2xl font-bold">Weryfikacje przed wynajmem</h1>
        <p className="text-sm text-muted-foreground">
          Sprawy, których nie rozstrzygnął ani automat, ani właściciel. Zatwierdzenie tutaj
          odblokowuje wysyłkę danych do odbioru — nie anuluje rezerwacji.
        </p>
      </div>

      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nic nie czeka na Twoją decyzję.</p>
      ) : (
        <div className="space-y-4">
          {list.map((row) => {
            const car = row.bookings?.cars;
            const label = car ? `${car.brand} ${car.model} (${car.year})` : "auto";
            const selfieUrl = selfieUrls.get(row.booking_id);
            return (
              <Card key={row.booking_id}>
                <CardHeader className="flex flex-row items-start justify-between space-y-0">
                  <CardTitle className="text-base">{label}</CardTitle>
                  <Badge variant={row.face_match_result === "match" ? "default" : "destructive"}>
                    {row.face_match_result === "match"
                      ? "Automat: zgodne"
                      : row.face_match_result === "no_match"
                        ? "Automat: niezgodne"
                        : "Automat: brak wyniku"}
                    {row.face_match_score !== null ? ` (${Number(row.face_match_score).toFixed(0)}%)` : ""}
                  </Badge>
                </CardHeader>
                <CardContent className="space-y-2 text-sm text-muted-foreground">
                  <p>
                    Najemca: {row.bookings?.renter?.full_name || "—"}
                    {row.bookings?.renter?.phone ? ` · ${row.bookings.renter.phone}` : ""}
                  </p>
                  <p className="text-xs">
                    Właściciel: {row.bookings?.owner?.full_name || "—"} · {car?.city} · odbiór{" "}
                    {row.bookings?.start_date} · rezerwacja {row.booking_id}
                  </p>
                  {row.booking_verification_notes?.reason && (
                    <p className="rounded-md border bg-muted/40 p-3 text-foreground">
                      {row.booking_verification_notes.reason}
                    </p>
                  )}
                  {/* Signed URLs from a private bucket — not public assets,
                      so next/image optimisation would only get in the way. */}
                  <div className="flex flex-wrap gap-3">
                    {selfieUrl && (
                      <figure className="space-y-1">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={selfieUrl} alt="Selfie najemcy" className="max-h-44 rounded-md border" />
                        <figcaption className="text-xs">Selfie przed odbiorem</figcaption>
                      </figure>
                    )}
                    {licenceUrls.get(row.booking_id)?.front && (
                      <figure className="space-y-1">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={licenceUrls.get(row.booking_id)!.front!}
                          alt="Prawo jazdy — przód"
                          className="max-h-44 rounded-md border"
                        />
                        <figcaption className="text-xs">Prawo jazdy — przód</figcaption>
                      </figure>
                    )}
                    {licenceUrls.get(row.booking_id)?.back && (
                      <figure className="space-y-1">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={licenceUrls.get(row.booking_id)!.back!}
                          alt="Prawo jazdy — tył"
                          className="max-h-44 rounded-md border"
                        />
                        <figcaption className="text-xs">Prawo jazdy — tył</figcaption>
                      </figure>
                    )}
                  </div>
                  {!selfieUrl && <p className="text-xs">Najemca nie przesłał jeszcze selfie.</p>}
                  <ResolveVerificationButton
                    bookingId={row.booking_id}
                    overdue={row.status === "escalated"}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

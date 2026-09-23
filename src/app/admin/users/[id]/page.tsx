import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveCommissionRate } from "@/lib/commission";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BackButton } from "@/components/back-button";
import { setOwnerCommission, startConversationWithUser } from "../actions";
import { DeleteUserButton } from "./delete-user-button";
import type { CarStatus } from "@/types/database";

const carStatusLabel: Record<CarStatus, string> = {
  pending: "Oczekuje",
  approved: "Zatwierdzone",
  rejected: "Odrzucone",
  paused: "Wstrzymane",
};

const carStatusVariant: Record<CarStatus, "secondary" | "default" | "destructive"> = {
  pending: "secondary",
  approved: "default",
  rejected: "destructive",
  paused: "secondary",
};

const commissionNotices: Record<string, { text: string; error: boolean }> = {
  saved: { text: "Zapisano stawkę prowizji.", error: false },
  invalid: { text: "Nieprawidłowa stawka (0–99,5%) lub data.", error: true },
  error: { text: "Nie udało się zapisać stawki. Czy migracja 0033 została zastosowana?", error: true },
  forbidden: { text: "Brak uprawnień.", error: true },
};

// PostgREST codes for "table not there yet" — migration 0033 not applied.
const MIGRATION_MISSING_CODES = new Set(["PGRST205", "42P01"]);

// The promo end is stored as 23:59:59 UTC of the chosen day; render in UTC
// so the label matches the date input below it regardless of server TZ.
const formatPromoDate = (date: Date) => date.toLocaleDateString("pl-PL", { timeZone: "UTC" });

export default async function AdminUserDetailPage({
  params,
  searchParams,
}: {
  params: { id: string };
  searchParams?: { commission?: string };
}) {
  const supabase = await createClient();

  const [{ data: profile }, { data: cars }, { data: verification }] = await Promise.all([
    supabase.from("profiles").select("*").eq("id", params.id).single(),
    supabase
      .from("cars")
      .select("id, brand, model, year, city, price_per_day, status")
      .eq("owner_id", params.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("identity_verifications")
      .select("status, rejection_reason")
      .eq("user_id", params.id)
      .maybeSingle(),
  ]);

  if (!profile) {
    notFound();
  }

  const admin = createAdminClient();
  const [{ data: authUser }, overrideResult] = await Promise.all([
    admin.auth.admin.getUserById(params.id),
    admin
      .from("owner_commission_overrides")
      .select("commission_rate, commission_rate_until")
      .eq("owner_id", params.id)
      .maybeSingle(),
  ]);
  const email = authUser?.user?.email ?? "";

  const avatarUrl = profile.avatar_path
    ? supabase.storage.from("avatars").getPublicUrl(profile.avatar_path).data.publicUrl
    : null;

  const override = overrideResult.error ? null : overrideResult.data;
  const migrationMissing =
    overrideResult.error !== null && MIGRATION_MISSING_CODES.has(overrideResult.error.code);
  const effectiveRate = resolveCommissionRate(override);
  const effectiveRateLabel = `${Number((effectiveRate * 100).toFixed(2))}%`;
  const overrideUntil = override?.commission_rate_until ? new Date(override.commission_rate_until) : null;
  const overrideLapsed = overrideUntil !== null && overrideUntil <= new Date();
  const commissionNotice = searchParams?.commission
    ? commissionNotices[searchParams.commission] ?? null
    : null;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <BackButton />

      <div className="flex flex-wrap items-center gap-4">
        <Avatar size="lg" className="size-16">
          <AvatarImage src={avatarUrl ?? undefined} alt={profile.full_name} />
          <AvatarFallback className="text-lg">
            {(profile.full_name || "?").slice(0, 1).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">{profile.full_name || "Użytkownik"}</h1>
            {profile.role === "admin" && <Badge variant="secondary">Admin</Badge>}
          </div>
          <p className="text-muted-foreground">{email}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <form action={startConversationWithUser.bind(null, params.id)}>
          <Button type="submit">Napisz wiadomość</Button>
        </form>
        <DeleteUserButton userId={params.id} userName={profile.full_name || "ten użytkownik"} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Dane konta</CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm text-muted-foreground">
          <p>Telefon: {profile.phone || "brak"}</p>
          <p>Zarejestrowano: {new Date(profile.created_at).toLocaleDateString("pl-PL")}</p>
          <p>
            Regulamin zaakceptowany:{" "}
            {profile.terms_accepted_at
              ? new Date(profile.terms_accepted_at).toLocaleString("pl-PL")
              : "brak danych (konto sprzed wprowadzenia zgody)"}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Prowizja platformy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            Obecnie naliczana:{" "}
            <span className="font-semibold text-foreground">{effectiveRateLabel}</span>
            {!override && " (stawka domyślna)"}
            {override && overrideUntil && !overrideLapsed && (
              <> (promocja do {formatPromoDate(overrideUntil)})</>
            )}
            {override && overrideUntil && overrideLapsed && (
              <> (promocja wygasła {formatPromoDate(overrideUntil)} — wróciła stawka domyślna)</>
            )}
            {override && !overrideUntil && " (nadpisanie bez daty końca)"}
          </p>
          {migrationMissing && (
            <p className="text-destructive">
              Tabela stawek nie istnieje jeszcze w bazie — uruchom migrację 0033 w Supabase, zanim
              ustawisz promocję.
            </p>
          )}
          {commissionNotice && (
            <p className={commissionNotice.error ? "text-destructive" : "text-muted-foreground"}>
              {commissionNotice.text}
            </p>
          )}
          <form
            action={setOwnerCommission.bind(null, params.id)}
            className="flex flex-wrap items-end gap-3"
          >
            <div className="space-y-1">
              <Label htmlFor="ratePercent">Stawka (%)</Label>
              <Input
                id="ratePercent"
                name="ratePercent"
                type="number"
                min={0}
                max={99.5}
                step="0.5"
                placeholder="np. 0"
                defaultValue={
                  override ? Number((Number(override.commission_rate) * 100).toFixed(2)) : ""
                }
                className="w-28"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="until">Obowiązuje do</Label>
              <Input
                id="until"
                name="until"
                type="date"
                defaultValue={overrideUntil ? overrideUntil.toISOString().slice(0, 10) : ""}
                className="w-44"
              />
            </div>
            <Button type="submit">Zapisz</Button>
          </form>
          <p className="text-xs text-muted-foreground">
            Puste pole stawki przywraca domyślną stawkę platformy (10%). Zmiana dotyczy tylko nowych płatności — już
            opłacone rezerwacje zostają bez zmian.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Weryfikacja tożsamości</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {!verification ? (
            <p className="text-sm text-muted-foreground">
              Użytkownik nie przesłał jeszcze dokumentu.
            </p>
          ) : (
            <>
              <Badge
                variant={
                  verification.status === "approved"
                    ? "default"
                    : verification.status === "rejected"
                      ? "destructive"
                      : "secondary"
                }
              >
                {verification.status === "pending"
                  ? "Oczekuje"
                  : verification.status === "approved"
                    ? "Zweryfikowano"
                    : "Odrzucono"}
              </Badge>
              <Link href="/admin/verifications" className="block text-sm text-primary hover:underline">
                Zobacz w panelu weryfikacji →
              </Link>
            </>
          )}
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="font-semibold">Samochody ({cars?.length ?? 0})</h2>
        {!cars || cars.length === 0 ? (
          <p className="text-sm text-muted-foreground">Brak dodanych samochodów.</p>
        ) : (
          <div className="space-y-2">
            {cars.map((car) => (
              <Link key={car.id} href={`/dashboard/cars/${car.id}/edit`}>
                <Card className="transition-shadow hover:shadow-md">
                  <CardContent className="flex items-center justify-between gap-4 py-4">
                    <div>
                      <p className="font-medium">
                        {car.brand} {car.model} ({car.year})
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {car.city} · {Number(car.price_per_day).toFixed(2)} zł/dzień
                      </p>
                    </div>
                    <Badge variant={carStatusVariant[car.status]}>
                      {carStatusLabel[car.status]}
                    </Badge>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

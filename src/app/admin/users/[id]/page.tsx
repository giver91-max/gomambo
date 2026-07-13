import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/back-button";
import { startConversationWithUser } from "../actions";
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

export default async function AdminUserDetailPage({
  params,
}: {
  params: { id: string };
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
  const { data: authUser } = await admin.auth.admin.getUserById(params.id);
  const email = authUser?.user?.email ?? "";

  const avatarUrl = profile.avatar_path
    ? supabase.storage.from("avatars").getPublicUrl(profile.avatar_path).data.publicUrl
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

      <form action={startConversationWithUser.bind(null, params.id)}>
        <Button type="submit">Napisz wiadomość</Button>
      </form>

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
              <Link key={car.id} href={`/auta/${car.id}`}>
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

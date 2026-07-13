import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAuthEmailsByUserId } from "@/lib/admin-users";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/back-button";

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: { q?: string };
}) {
  const supabase = await createClient();

  const [{ data: profiles }, emailsById, { data: cars }, { data: verifications }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, role, created_at")
        .order("created_at", { ascending: false }),
      getAuthEmailsByUserId(),
      supabase.from("cars").select("owner_id"),
      supabase.from("identity_verifications").select("user_id, status"),
    ]);

  const carCountByOwner = new Map<string, number>();
  for (const c of cars ?? []) {
    carCountByOwner.set(c.owner_id, (carCountByOwner.get(c.owner_id) ?? 0) + 1);
  }
  const verificationByUser = new Map((verifications ?? []).map((v) => [v.user_id, v.status]));

  const query = (searchParams.q ?? "").trim().toLowerCase();
  const rows = (profiles ?? [])
    .map((p) => ({
      ...p,
      email: emailsById.get(p.id) ?? "",
      carCount: carCountByOwner.get(p.id) ?? 0,
      verificationStatus: verificationByUser.get(p.id) ?? null,
    }))
    .filter(
      (p) =>
        !query ||
        p.full_name.toLowerCase().includes(query) ||
        p.email.toLowerCase().includes(query)
    );

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <BackButton />
      <h1 className="text-2xl font-bold">Użytkownicy</h1>

      <form className="flex gap-2">
        <Input
          name="q"
          defaultValue={searchParams.q ?? ""}
          placeholder="Szukaj po imieniu lub e-mailu…"
          className="flex-1"
        />
        <Button type="submit">Szukaj</Button>
      </form>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">Brak użytkowników spełniających kryteria.</p>
      ) : (
        <div className="space-y-2">
          {rows.map((p) => (
            <Link key={p.id} href={`/admin/users/${p.id}`}>
              <Card className="transition-shadow hover:shadow-md">
                <CardContent className="flex items-center justify-between gap-4 py-4">
                  <div className="min-w-0">
                    <p className="font-medium">{p.full_name || "Użytkownik"}</p>
                    <p className="truncate text-sm text-muted-foreground">{p.email}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {p.role === "admin" && <Badge variant="secondary">Admin</Badge>}
                    {p.verificationStatus === "approved" && <Badge>Zweryfikowany</Badge>}
                    {p.carCount > 0 && (
                      <Badge variant="secondary">
                        {p.carCount} {p.carCount === 1 ? "auto" : "aut"}
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

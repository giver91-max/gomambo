import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SiteFooter } from "@/components/site-footer";

export default async function AutaLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b px-4 py-4 sm:px-6">
        <Link href="/" className="text-lg font-black tracking-tight">
          Go<span className="text-primary">Mambo</span>
        </Link>
        <nav className="flex flex-wrap items-center gap-3 text-sm sm:gap-4">
          <Link href="/auta" className="hover:underline">
            Przeglądaj auta
          </Link>
          {user ? (
            <Link href="/dashboard" className={buttonVariants({ size: "sm" })}>
              Panel
            </Link>
          ) : (
            <>
              <Link href="/login" className="hover:underline">
                Zaloguj się
              </Link>
              <Link
                href="/register"
                className={cn(buttonVariants({ size: "sm" }))}
              >
                Zostań właścicielem
              </Link>
            </>
          )}
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
      <SiteFooter />
    </div>
  );
}

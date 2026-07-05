import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t px-4 py-6 text-sm text-muted-foreground sm:px-6">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p>© {new Date().getFullYear()} GoMambo · Polska</p>
        <nav className="flex flex-wrap gap-x-4 gap-y-1">
          <Link href="/regulamin" className="hover:underline">
            Regulamin
          </Link>
          <Link href="/polityka-prywatnosci" className="hover:underline">
            Polityka prywatności
          </Link>
          <a href="mailto:kontakt@gomambo.pl" className="hover:underline">
            Kontakt
          </a>
        </nav>
      </div>
    </footer>
  );
}

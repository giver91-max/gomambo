import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function CheckEmailPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/30 px-4">
      <Link href="/" className="text-lg font-black tracking-tight">
        Go<span className="text-primary">Mambo</span>
      </Link>
      <Card className="w-full max-w-sm text-center">
        <CardHeader>
          <CardTitle>Sprawdź swoją skrzynkę</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Wysłaliśmy link potwierdzający na podany adres email. Kliknij go,
            żeby aktywować konto, a potem się zaloguj.
          </p>
          <Link href="/login" className="text-sm underline underline-offset-4">
            Przejdź do logowania
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

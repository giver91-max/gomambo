"use client";

import { useEffect, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

/**
 * Whatever a page throws — a server exception, or a form whose action
 * rejected inside a transition (React hands that to the nearest error
 * boundary). Without this file it was Next's English "Application error: a
 * client-side exception has occurred" with no way back.
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    console.error(error);
  }, [error]);

  // reset() alone re-renders the same server output; refreshing first asks
  // the server again, which is what helps after a passing failure.
  function retry() {
    startTransition(() => {
      router.refresh();
      reset();
    });
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-muted/30 px-4">
      <Link href="/" className="text-lg font-black tracking-tight">
        Go<span className="text-primary">Mambo</span>
      </Link>
      <Card className="w-full max-w-sm text-center">
        <CardHeader>
          <CardTitle>Coś poszło nie tak</CardTitle>
          <CardDescription>
            Nie udało się wyświetlić tej strony. Spróbuj ponownie — jeśli błąd się powtarza,
            odśwież stronę albo napisz do nas na{" "}
            <a href="mailto:kontakt@gomambo.pl" className="underline underline-offset-4">
              kontakt@gomambo.pl
            </a>
            .
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <Button className="w-full" onClick={retry} disabled={isPending}>
            {isPending ? "Chwileczkę…" : "Spróbuj ponownie"}
          </Button>
          <Link href="/" className={buttonVariants({ variant: "outline", className: "w-full" })}>
            Wróć na stronę główną
          </Link>
          {error.digest && (
            <p className="pt-2 text-xs text-muted-foreground">Kod błędu: {error.digest}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

import type { Metadata } from "next";

// The page itself is a client component and cannot export metadata.
// /register/sprawdz-email sets its own title.
export const metadata: Metadata = {
  title: "Załóż konto",
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

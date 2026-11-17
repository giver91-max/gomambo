import type { Metadata } from "next";

// The page itself is a client component and cannot export metadata.
export const metadata: Metadata = {
  title: "Nie pamiętasz hasła?",
};

export default function ForgotPasswordLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

import type { Metadata } from "next";

// The page itself is a client component and cannot export metadata.
export const metadata: Metadata = {
  title: "Logowanie",
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

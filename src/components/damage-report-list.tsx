import { Badge } from "@/components/ui/badge";

export type DamageReportItem = {
  id: string;
  description: string;
  reporter_role: "owner" | "renter";
  status: "open" | "resolved";
  created_at: string;
  mine: boolean;
};

/**
 * The reports filed on one booking, as both sides see them. Without this the
 * only trace of a report on the reporter's own screen is a transient
 * "wysłane" line, and the counterparty sees nothing but the notification.
 */
export function DamageReportList({ reports }: { reports: DamageReportItem[] }) {
  if (reports.length === 0) return null;

  return (
    <div className="space-y-2 rounded-md border p-3">
      <p className="text-sm font-medium text-foreground">Zgłoszenia do tego wynajmu</p>
      {reports.map((report) => (
        <div key={report.id} className="space-y-1 border-t pt-2 first:border-t-0 first:pt-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={report.status === "open" ? "default" : "secondary"}>
              {report.status === "open" ? "W toku" : "Zamknięte"}
            </Badge>
            <span className="text-xs">
              {report.mine
                ? "Twoje zgłoszenie"
                : report.reporter_role === "owner"
                  ? "Zgłoszenie właściciela"
                  : "Zgłoszenie najemcy"}{" "}
              · {new Date(report.created_at).toLocaleDateString("pl-PL")}
            </span>
          </div>
          <p className="whitespace-pre-wrap text-xs">{report.description}</p>
        </div>
      ))}
      <p className="text-xs">GoMambo dostało kopię każdego z nich.</p>
    </div>
  );
}

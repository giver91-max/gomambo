import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export type StepState = "done" | "waiting" | "todo" | "later";

export type OnboardingStep = {
  title: string;
  state: StepState;
  /** One line: what is happening, or what to do. */
  note: string;
  href?: string;
  cta?: string;
};

const MARK: Record<StepState, string> = {
  done: "✓",
  waiting: "…",
  todo: "○",
  later: "–",
};

const MARK_CLASS: Record<StepState, string> = {
  done: "bg-primary text-primary-foreground",
  waiting: "bg-yellow-600/15 text-yellow-700 dark:text-yellow-400",
  todo: "border",
  later: "bg-muted text-muted-foreground",
};

/**
 * "What is left before my car can be rented" on the owner's dashboard.
 *
 * Listing a car is six separate steps spread over four pages, and nothing
 * used to say which were done: of 9 accounts opened in a month, 2 sent a
 * verification and none added a car. The states are computed by the
 * dashboard from real data; "waiting" means GoMambo has the ball, "later"
 * that the step only opens when renting does.
 */
export function OnboardingSteps({ steps }: { steps: OnboardingStep[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Twoje auto na GoMambo — co zostało</CardTitle>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {steps.map((step) => (
            <li key={step.title} className="flex items-start gap-3 text-sm">
              <span
                aria-hidden
                className={`mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${MARK_CLASS[step.state]}`}
              >
                {MARK[step.state]}
              </span>
              <div className="min-w-0">
                <p className={step.state === "done" ? "text-muted-foreground line-through" : "font-medium"}>
                  {step.title}
                </p>
                <p className="text-muted-foreground">
                  {step.note}
                  {step.href && step.cta && step.state === "todo" && (
                    <>
                      {" "}
                      <Link href={step.href} className="text-primary hover:underline">
                        {step.cta} →
                      </Link>
                    </>
                  )}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

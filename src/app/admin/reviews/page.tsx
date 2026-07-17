import { createClient } from "@/lib/supabase/server";
import { Card, CardContent } from "@/components/ui/card";
import { BackButton } from "@/components/back-button";
import { DeleteReviewButton } from "./delete-review-button";

// reviews_select_public lets anyone (including admin's session client) read
// every review — only the moderation write needs the service-role client.
export default async function AdminReviewsPage() {
  const supabase = await createClient();

  const { data: rawReviews } = await supabase
    .from("reviews")
    .select(
      `id, rating, comment, created_at,
       cars(brand, model),
       reviewer:profiles!reviews_reviewer_id_fkey(full_name),
       reviewee:profiles!reviews_reviewee_id_fkey(full_name)`
    )
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(200);

  const reviews = (rawReviews ?? []) as unknown as {
    id: string;
    rating: number;
    comment: string | null;
    created_at: string;
    cars: { brand: string; model: string } | null;
    reviewer: { full_name: string } | null;
    reviewee: { full_name: string } | null;
  }[];

  return (
    <div className="space-y-6">
      <BackButton />
      <h1 className="text-2xl font-bold">Recenzje</h1>

      {reviews.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            Brak recenzji.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {reviews.map((review) => (
            <Card key={review.id}>
              <CardContent className="space-y-2 py-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium">
                    {"★".repeat(review.rating)}
                    {"☆".repeat(5 - review.rating)} — {review.reviewer?.full_name ?? "?"} →{" "}
                    {review.reviewee?.full_name ?? "?"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {new Date(review.created_at).toLocaleString("pl-PL")}
                  </p>
                </div>
                {review.cars && (
                  <p className="text-xs text-muted-foreground">
                    {review.cars.brand} {review.cars.model}
                  </p>
                )}
                {review.comment && <p className="text-sm">{review.comment}</p>}
                <DeleteReviewButton reviewId={review.id} />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

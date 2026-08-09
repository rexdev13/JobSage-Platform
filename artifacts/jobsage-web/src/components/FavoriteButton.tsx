import { useQueryClient } from "@tanstack/react-query";
import { Heart } from "lucide-react";
import {
  useListVacancyFavorites,
  useFavoriteVacancy,
  useUnfavoriteVacancy,
  getListVacancyFavoritesQueryKey,
  type VacancyFavoritesResponse,
} from "@workspace/api-client-react";

/**
 * Heart toggle for favoriting a vacancy. Works with the unified vacancy
 * id-space (roles ids, employer job listings +1M, sponsor vacancies +2M).
 * Optimistic UI: flips instantly, rolls back on error.
 */
export function FavoriteButton({ vacancyId, className }: { vacancyId: number; className?: string }) {
  const queryClient = useQueryClient();
  const { data } = useListVacancyFavorites();
  const favoriteMutation = useFavoriteVacancy();
  const unfavoriteMutation = useUnfavoriteVacancy();

  const queryKey = getListVacancyFavoritesQueryKey();
  const isFavorited = (data?.favorites ?? []).some((f) => f.vacancyId === vacancyId);

  function setOptimistic(favorited: boolean) {
    queryClient.setQueryData<VacancyFavoritesResponse>(queryKey, (prev) => {
      const favorites = prev?.favorites ?? [];
      return favorited
        ? { favorites: [{ vacancyId, createdAt: new Date().toISOString() }, ...favorites.filter((f) => f.vacancyId !== vacancyId)] }
        : { favorites: favorites.filter((f) => f.vacancyId !== vacancyId) };
    });
  }

  function toggle() {
    const next = !isFavorited;
    setOptimistic(next);
    const opts = {
      onError: () => setOptimistic(!next),
      onSettled: () => {
        void queryClient.invalidateQueries({ queryKey });
      },
    };
    if (next) favoriteMutation.mutate({ vacancyId }, opts);
    else unfavoriteMutation.mutate({ vacancyId }, opts);
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        toggle();
      }}
      title={isFavorited ? "Remove from favorites" : "Add to favorites"}
      aria-label={isFavorited ? "Remove from favorites" : "Add to favorites"}
      aria-pressed={isFavorited}
      className={`p-1.5 rounded-lg transition-colors hover:bg-muted ${
        isFavorited ? "text-rose-500 hover:text-rose-600" : "text-muted-foreground hover:text-rose-500"
      } ${className ?? ""}`}
    >
      <Heart className={`w-4 h-4 ${isFavorited ? "fill-current" : ""}`} />
    </button>
  );
}

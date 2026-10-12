import ReplayView from "@/components/ReplayView";

export default async function ReplayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <ReplayView
      apiUrl={`/api/tournament/matches/${id}/replay`}
      backLink="/arena/leaderboard"
      backLabel="← Leaderboard"
    />
  );
}

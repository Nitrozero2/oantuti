import { redirect } from "next/navigation";

/** Tournament sessions were replaced by the continuous TrueSkill queue. */
export default function LegacyTournamentPage() {
  redirect("/admin/rating");
}

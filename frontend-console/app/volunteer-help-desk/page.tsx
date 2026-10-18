import { redirect } from "next/navigation";

export default function VolunteerHelpDeskPage() {
  redirect("/volunteers?tab=desk");
}

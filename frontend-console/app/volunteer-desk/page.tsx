import { redirect } from "next/navigation";

export default function VolunteerDeskPage() {
  redirect("/volunteers?tab=desk");
}

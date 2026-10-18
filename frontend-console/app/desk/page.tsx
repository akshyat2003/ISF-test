import { redirect } from "next/navigation";

export default function DeskPage() {
  redirect("/volunteers?tab=desk");
}

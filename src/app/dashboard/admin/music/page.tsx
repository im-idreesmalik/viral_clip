import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isAdminEmail } from "@/lib/api";
import { AdminMusic } from "@/components/dashboard/AdminMusic";

export const dynamic = "force-dynamic";

export default async function AdminMusicPage() {
  const user = await getCurrentUser();
  if (!isAdminEmail(user?.email)) redirect("/dashboard");
  return <AdminMusic />;
}

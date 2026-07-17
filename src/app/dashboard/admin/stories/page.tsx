import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { isAdminEmail } from "@/lib/api";
import { AdminStories } from "@/components/dashboard/AdminStories";

export const dynamic = "force-dynamic";

export default async function AdminStoriesPage() {
  const user = await getCurrentUser();
  if (!isAdminEmail(user?.email)) redirect("/dashboard");
  return <AdminStories />;
}

import { getCurrentUser } from "@/lib/auth";
import { isAdminEmail } from "@/lib/api";
import { StoriesBrowser } from "@/components/dashboard/StoriesBrowser";

export const dynamic = "force-dynamic";

export default async function StoriesPage() {
  const user = await getCurrentUser();
  return <StoriesBrowser isAdmin={isAdminEmail(user?.email)} />;
}

/**
 * Route-transition fallback. Next.js shows this instantly when navigating to
 * any dashboard route while its content loads — giving immediate "it's loading"
 * feedback (a top progress bar) the moment a nav item or link is clicked.
 */
export default function DashboardLoading() {
  return (
    <>
      <div className="nav-progress-bar" role="progressbar" aria-label="Loading" />
      <div className="space-y-4">
        <div className="skeleton h-8 w-48" />
        <div className="skeleton h-4 w-72" />
        <div className="mt-6 grid gap-3">
          <div className="skeleton h-24 w-full" />
          <div className="skeleton h-24 w-full" />
          <div className="skeleton h-24 w-full" />
        </div>
      </div>
    </>
  );
}

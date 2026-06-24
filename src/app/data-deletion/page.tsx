import Link from "next/link";

// Public "Data Deletion Instructions" page. Meta (Facebook/Instagram) and other
// platforms require apps that access user data to provide either a deletion
// callback or instructions for users to delete their data. This page is the
// instructions URL — set it in Meta App settings → Basic → User data deletion.
const COMPANY = "ViralCut";
const CONTACT_EMAIL = "support@viralcut.app";
const LAST_UPDATED = "June 24, 2026";

export const metadata = {
  title: "Data Deletion — ViralCut",
  description: "How to delete your data from ViralCut, including data obtained from connected social accounts.",
};

export default function DataDeletionPage() {
  return (
    <div className="min-h-screen bg-ink-950 text-ink-100">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-5">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-500">✂️</span>
          <span className="font-semibold">ViralCut</span>
        </Link>
        <Link href="/" className="text-sm text-ink-100/70 hover:text-ink-100">← Home</Link>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-20">
        <h1 className="text-3xl font-semibold">Data Deletion Instructions</h1>
        <p className="mt-2 text-sm text-ink-100/50">Last updated: {LAST_UPDATED}</p>

        <div className="mt-8 space-y-6 text-sm leading-relaxed text-ink-100/80 [&_a]:text-brand-400 [&_a:hover]:underline [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
          <p>
            {COMPANY} lets you connect social accounts (such as TikTok, YouTube, Instagram, and
            Facebook) and stores the data needed to operate the service — your account details, the
            videos and clips you create, and the access tokens and basic profile information for any
            platform you connect. You can delete any or all of this data at any time.
          </p>

          <section>
            <h2 className="mb-2 text-lg font-medium text-ink-100">Delete a connected social account</h2>
            <p>
              Sign in, go to <strong>Connections</strong>, and click <strong>Disconnect</strong> on the
              platform you want to remove. This immediately revokes our access and permanently deletes
              the stored access/refresh tokens and profile data we obtained from that platform
              (including any data obtained from Meta/Instagram/Facebook).
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-medium text-ink-100">Delete your videos and clips</h2>
            <p>
              In your dashboard you can delete any video (which also deletes its generated clips and
              media) or any individual clip. Deleted media is removed from our storage.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-medium text-ink-100">Delete your entire account</h2>
            <p>
              To delete your account and all associated data — your profile, videos, clips, connected
              accounts, stored tokens, and publishing history — email us at{" "}
              <a href={`mailto:${CONTACT_EMAIL}?subject=Data%20deletion%20request`}>{CONTACT_EMAIL}</a>{" "}
              from your account email with the subject &ldquo;Data deletion request.&rdquo; We will
              permanently delete your data within 30 days and confirm by email.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-medium text-ink-100">Revoke access from the platform</h2>
            <p>
              You can also revoke {COMPANY}&rsquo;s access directly from each platform&rsquo;s settings:
            </p>
            <ul>
              <li><strong>Facebook/Instagram:</strong> Settings → Security and login → Business Integrations (or Apps and Websites) → remove {COMPANY}.</li>
              <li><strong>TikTok:</strong> Settings → Security → Manage app permissions → remove {COMPANY}.</li>
              <li><strong>YouTube/Google:</strong> Google Account → Security → Third-party access → remove {COMPANY}.</li>
            </ul>
            <p className="mt-2">
              Revoking access stops all future use and prompts us to delete the corresponding stored
              tokens.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-lg font-medium text-ink-100">Questions</h2>
            <p>
              For any data deletion request or question, contact{" "}
              <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>. See also our{" "}
              <Link href="/privacy">Privacy Policy</Link>.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}

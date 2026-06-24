import Link from "next/link";

// NOTE: Replace CONTACT_EMAIL / COMPANY with your real details, and have this
// policy reviewed by legal counsel before relying on it in production.
const COMPANY = "ViralCut";
const CONTACT_EMAIL = "support@viralcut.app";
const LAST_UPDATED = "June 24, 2026";

export const metadata = {
  title: "Privacy Policy — ViralCut",
  description: "How ViralCut collects, uses, stores, and protects your data, including data from connected social platforms.",
};

export default function PrivacyPage() {
  return (
    <LegalShell title="Privacy Policy" updated={LAST_UPDATED}>
      <p>
        This Privacy Policy explains how {COMPANY} (&ldquo;{COMPANY}&rdquo;, &ldquo;we&rdquo;,
        &ldquo;us&rdquo;) collects, uses, stores, and protects your information when you use our
        service to convert videos into short clips and publish them to social platforms.
      </p>

      <Section title="1. Information We Collect">
        <ul>
          <li><strong>Account information</strong> — your name, email address, and a securely hashed password.</li>
          <li><strong>Content you provide</strong> — videos you upload or import, and the clips, transcripts, captions, titles, and thumbnails generated from them.</li>
          <li><strong>Connected-account data</strong> — when you connect a social platform, the access/refresh tokens and basic profile details (such as your username, display name, channel/page identifiers, and avatar) needed to publish on your behalf.</li>
          <li><strong>Publishing activity</strong> — records of clips you publish or schedule, their status, and any errors returned by platforms.</li>
          <li><strong>Technical data</strong> — basic logs needed to operate and secure the service.</li>
        </ul>
      </Section>

      <Section title="2. How We Use Your Information">
        <ul>
          <li>To provide the service: download/import, transcode, transcribe, analyze, and generate clips.</li>
          <li>To publish clips to the platforms you explicitly connect and authorize.</li>
          <li>To authenticate you and keep your account and tokens secure.</li>
          <li>To operate, maintain, debug, and improve the service.</li>
        </ul>
        <p>We do not sell your personal information or your content.</p>
      </Section>

      <Section title="3. AI Processing & Transcription">
        <p>
          We generate transcripts (for captions and clip detection) and analyze content to identify
          clip-worthy moments. By default these run on locally hosted models, so your media is
          processed within the service&rsquo;s own environment. If an operator configures an optional
          third-party AI provider, the relevant text/audio may be sent to that provider to perform the
          processing, subject to that provider&rsquo;s terms.
        </p>
      </Section>

      <Section title="4. Social Platform Data (TikTok, YouTube, Meta)">
        <p>
          When you connect a platform via OAuth, we receive and store the credentials and minimal
          profile information required to act on your behalf. Specifically:
        </p>
        <ul>
          <li><strong>TikTok</strong> — using TikTok Login Kit and the Content Posting API, we access your basic profile information (e.g., open id, display name, avatar) and the permission to publish videos you choose to post. We use TikTok data only to display your connected account and to upload the clips you direct us to publish. We do not use TikTok user data for advertising, do not sell it, and do not share it except as needed to deliver your post to TikTok.</li>
          <li><strong>YouTube</strong> — we use the YouTube Data API to identify your channel and upload videos you choose to publish. Your use is also subject to the Google Privacy Policy and YouTube&rsquo;s Terms.</li>
          <li><strong>Instagram / Facebook</strong> — via the Meta Graph API, we access the Pages and linked accounts you manage to publish Reels you direct us to post.</li>
        </ul>
        <p>
          You can revoke our access at any time by disconnecting the platform in your account settings,
          and/or by removing the app from that platform&rsquo;s own app/permission settings. Revoking
          access stops further use and we delete the associated stored tokens.
        </p>
      </Section>

      <Section title="5. How We Share Information">
        <p>
          We share information only: (a) with the social platforms you connect, to perform the actions
          you request; (b) with infrastructure/AI subprocessors strictly to operate the service, where
          configured; and (c) if required by law. We do not sell your data or use connected-platform
          data for advertising or profiling.
        </p>
      </Section>

      <Section title="6. Data Retention">
        <p>
          We retain your account data, content, clips, and connected-account tokens for as long as your
          account is active or as needed to provide the service. You can delete videos and clips at any
          time, and deleting your account removes your associated content, clips, and stored tokens.
        </p>
      </Section>

      <Section title="7. Security">
        <p>
          We protect your data with industry-standard measures: passwords are hashed, and OAuth
          access/refresh tokens are encrypted at rest. No method of transmission or storage is 100%
          secure, but we work to safeguard your information.
        </p>
      </Section>

      <Section title="8. Your Rights & Choices">
        <ul>
          <li>Access, edit, or delete your videos and clips at any time.</li>
          <li>Disconnect any social account to revoke our access and delete its tokens.</li>
          <li>Delete your account, which removes your associated data.</li>
          <li>Contact us to exercise applicable data-protection rights (e.g., access or deletion).</li>
        </ul>
      </Section>

      <Section title="9. Children's Privacy">
        <p>
          The service is not directed to children under 18, and we do not knowingly collect their
          personal information.
        </p>
      </Section>

      <Section title="10. Changes to This Policy">
        <p>
          We may update this policy from time to time. Material changes will be reflected by updating
          the &ldquo;Last updated&rdquo; date above.
        </p>
      </Section>

      <Section title="11. Contact">
        <p>
          For privacy questions or data requests, contact us at{" "}
          <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>.
        </p>
      </Section>
    </LegalShell>
  );
}

function LegalShell({
  title,
  updated,
  children,
}: {
  title: string;
  updated: string;
  children: React.ReactNode;
}) {
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
        <h1 className="text-3xl font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-ink-100/50">Last updated: {updated}</p>
        <div className="legal mt-8 space-y-6 text-ink-100/80">{children}</div>
      </main>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 text-lg font-medium text-ink-100">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed [&_a]:text-brand-400 [&_a:hover]:underline [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-5">
        {children}
      </div>
    </section>
  );
}

import Link from "next/link";

// NOTE: Replace CONTACT_EMAIL / COMPANY with your real details, and have these
// terms reviewed by legal counsel before relying on them in production.
const COMPANY = "ViralCut";
const CONTACT_EMAIL = "support@viralcut.app";
const LAST_UPDATED = "June 24, 2026";

export const metadata = {
  title: "Terms of Service — ViralCut",
  description: "The terms governing use of the ViralCut video-to-short-clips service.",
};

export default function TermsPage() {
  return (
    <LegalShell title="Terms of Service" updated={LAST_UPDATED}>
      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of {COMPANY}
        (&ldquo;{COMPANY}&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;), a service that converts
        long-form videos into short-form clips and helps you publish them to third-party social
        platforms. By creating an account or using the service, you agree to these Terms.
      </p>

      <Section title="1. The Service">
        <p>
          {COMPANY} lets you import videos (by upload or supported URL), automatically detect and
          generate short vertical clips with captions, review and edit those clips, connect your
          social media accounts, and publish clips to platforms including TikTok, Instagram, Facebook,
          and YouTube. Features may change over time.
        </p>
      </Section>

      <Section title="2. Eligibility & Accounts">
        <p>
          You must be at least 18 years old (or the age of majority in your jurisdiction) to use the
          service. You are responsible for maintaining the confidentiality of your account credentials
          and for all activity under your account. Provide accurate information and keep it current.
        </p>
      </Section>

      <Section title="3. Your Content">
        <p>
          You retain ownership of the videos and other content you upload or import (&ldquo;Your
          Content&rdquo;). You grant {COMPANY} a limited, non-exclusive license to store, process,
          transcode, transcribe, analyze, and generate derivative clips from Your Content solely to
          provide the service to you. You represent and warrant that you own or have all rights,
          licenses, and permissions necessary to upload Your Content and to publish the resulting
          clips to the platforms you connect.
        </p>
      </Section>

      <Section title="4. Connected Social Accounts">
        <p>
          When you connect a third-party account (e.g., TikTok, YouTube, Instagram, or Facebook), you
          authorize {COMPANY} to access that platform and to publish content on your behalf using the
          permissions you grant. Your use of each platform remains subject to that platform&rsquo;s own
          terms and policies, including the{" "}
          <a href="https://developers.tiktok.com/terms" target="_blank" rel="noreferrer">TikTok Developer Terms</a>,{" "}
          <a href="https://www.youtube.com/t/terms" target="_blank" rel="noreferrer">YouTube Terms of Service</a>,
          and Meta&rsquo;s Platform Terms. You may disconnect a platform at any time from your account
          settings, which revokes our access going forward.
        </p>
      </Section>

      <Section title="5. Acceptable Use">
        <p>You agree not to use {COMPANY} to:</p>
        <ul>
          <li>upload, generate, or publish content you do not have the rights to use;</li>
          <li>infringe intellectual-property, privacy, or publicity rights;</li>
          <li>create or distribute unlawful, deceptive, harassing, hateful, or harmful content;</li>
          <li>violate the rules, rate limits, or terms of any connected platform;</li>
          <li>attempt to disrupt, reverse-engineer, or gain unauthorized access to the service.</li>
        </ul>
      </Section>

      <Section title="6. Intellectual Property">
        <p>
          The service, including its software, design, and trademarks, is owned by {COMPANY} and its
          licensors and is protected by law. These Terms do not grant you any rights in our
          intellectual property except the limited right to use the service.
        </p>
      </Section>

      <Section title="7. Third-Party Services">
        <p>
          The service integrates with third-party APIs and tools. We are not responsible for the
          availability, accuracy, or policies of third-party services, and your use of them is at your
          own risk and subject to their terms.
        </p>
      </Section>

      <Section title="8. Disclaimers">
        <p>
          The service is provided &ldquo;as is&rdquo; and &ldquo;as available,&rdquo; without warranties
          of any kind, express or implied, including merchantability, fitness for a particular purpose,
          and non-infringement. We do not warrant that the service will be uninterrupted, error-free, or
          that AI-generated clips, titles, scores, or captions will be accurate or suitable for any
          purpose.
        </p>
      </Section>

      <Section title="9. Limitation of Liability">
        <p>
          To the maximum extent permitted by law, {COMPANY} will not be liable for any indirect,
          incidental, special, consequential, or punitive damages, or any loss of data, revenue, or
          profits, arising from your use of the service.
        </p>
      </Section>

      <Section title="10. Termination">
        <p>
          You may stop using the service and delete your account at any time. We may suspend or
          terminate your access if you violate these Terms or use the service in a way that creates
          risk or legal exposure. Upon termination, your right to use the service ends.
        </p>
      </Section>

      <Section title="11. Changes to These Terms">
        <p>
          We may update these Terms from time to time. Material changes will be reflected by updating
          the &ldquo;Last updated&rdquo; date above. Your continued use of the service after changes
          take effect constitutes acceptance of the revised Terms.
        </p>
      </Section>

      <Section title="12. Contact">
        <p>
          Questions about these Terms? Contact us at{" "}
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

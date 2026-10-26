import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDocument as LegalPage } from '../_components/LegalDocument';
import { withSocial } from '@/lib/page-metadata';

export const metadata: Metadata = withSocial({
  title: 'Copyright & DMCA',
  description: 'How to ask Apex to remove material you believe infringes your copyright.',
  alternates: { canonical: '/legal/dmca' },
});

const CONTACT = 'shaurya@snappycrew.com';

/* Notice-and-takedown policy. The notice contents follow 17 U.S.C. § 512(c)(3). */
export default function DmcaPage() {
  return (
    <LegalPage
      title="Copyright"
      current="/legal/dmca"
      updated="2026-10-26"
      intro={
        <p>
          Apex respects the rights of photographers, publishers, broadcasters and every other creator. If you believe something on Apex
          infringes your copyright, tell us and it will be reviewed and, where appropriate, removed.
        </p>
      }
      sections={[
        {
          id: 'what',
          title: 'What Apex hosts',
          body: (
            <ul>
              <li>News headlines and short summaries link to the original publisher, who keeps the full article.</li>
              <li>Team logos, car images, driver photographs and trackside photographs belong to their owners. They are shown to identify the drivers and teams and are credited on the <Link href="/references">References</Link> page.</li>
              <li>Videos are embedded from YouTube. They are not copied onto Apex.</li>
              <li>News photographs load directly from the publisher&rsquo;s own servers and are credited where shown.</li>
              <li>Visitors cannot upload files or post text. Predictions store only driver choices.</li>
            </ul>
          ),
        },
        {
          id: 'notice',
          title: 'What to include in your notice',
          body: (
            <ol>
              <li>Your name, address, phone number and email address.</li>
              <li>A description of the copyrighted work you believe is infringed.</li>
              <li>The exact Apex page address (URL) where the material appears, and what it is.</li>
              <li>A statement that you believe in good faith that the use is not authorised by the owner, its agent or the law.</li>
              <li>A statement that the information in your notice is accurate and, under penalty of perjury, that you are the owner or are authorised to act for the owner.</li>
              <li>Your physical or electronic signature.</li>
            </ol>
          ),
        },
        {
          id: 'send',
          title: 'Where to send it',
          body: (
            <p>
              Email your notice to <a href={`mailto:${CONTACT}?subject=${encodeURIComponent('Apex · Copyright notice')}`}>{CONTACT}</a> with the
              subject &ldquo;Apex · Copyright notice&rdquo;. If the material is hosted by someone else (for example a video on YouTube or a photo
              on a publisher&rsquo;s site), please also contact that host, as removing the link from Apex does not remove the original.
            </p>
          ),
        },
        {
          id: 'response',
          title: 'What happens next',
          body: (
            <p>
              Complete notices are reviewed as quickly as possible. If the claim is valid, the material or link is removed or disabled on Apex,
              and you will receive a reply. Incomplete notices may need more information before any action can be taken.
            </p>
          ),
        },
        {
          id: 'counter',
          title: 'Counter-notice',
          body: (
            <p>
              If you believe material was removed by mistake, send a counter-notice to the same address with your contact details, the removed
              material and its former URL, a statement under penalty of perjury that you believe it was removed by mistake or misidentification,
              and your signature.
            </p>
          ),
        },
        {
          id: 'misrepresentation',
          title: 'False claims',
          body: <p>Knowingly misrepresenting that material infringes, or that it was removed by mistake, can make you liable for damages under 17 U.S.C. § 512(f).</p>,
        },
        {
          id: 'trademarks',
          title: 'Trade marks',
          body: (
            <p>
              For trade mark concerns, including Formula 1, team or sponsor marks, use the same address. How Apex uses these names is explained
              in the <Link href="/legal/terms">Terms</Link> and <Link href="/legal/disclaimer">Disclaimer</Link>.
            </p>
          ),
        },
      ]}
    />
  );
}

import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDocument as LegalPage } from '../_components/LegalDocument';
import { withSocial } from '@/lib/page-metadata';

export const metadata: Metadata = withSocial({
  title: 'Terms of Use',
  description: 'The terms for using Apex, an independent and unofficial Formula 1 fan website.',
  alternates: { canonical: '/legal/terms' },
});

const CONTACT = 'shaurya@snappycrew.com';

/*
 * Structure follows the Formula 1 Digital Products Terms of Use (who can
 * use it, changes, availability, how you may use material, linking, trade
 * marks, scraping, viruses, liability, governing law, contact), adapted to
 * a free, account-less fan site run by one person.
 */
export default function TermsPage() {
  return (
    <LegalPage
      title="Terms"
      current="/legal/terms"
      updated="2026-10-26"
      intro={
        <p>
          These terms apply when you use Apex. Apex is an independent, unofficial Formula 1 fan website built and run by Shaurya Punj.
          By using the site you agree to these terms. If you do not agree, please do not use Apex.
        </p>
      }
      sections={[
        {
          id: 'other-terms',
          title: 'Other terms that apply to you',
          body: (
            <p>
              These terms work together with the <Link href="/legal/privacy">Privacy Policy</Link>, the <Link href="/legal/disclaimer">Disclaimer</Link> and
              the <Link href="/legal/dmca">Copyright policy</Link>.
            </p>
          ),
        },
        {
          id: 'unofficial',
          title: 'Apex is unofficial',
          body: (
            <p>
              Apex is not affiliated with, endorsed by or associated with Formula 1, Formula One World Championship Limited, Formula One Licensing
              B.V., the FIA, Liberty Media, or any team or driver. It is a free fan project.
            </p>
          ),
        },
        {
          id: 'who',
          title: 'Who can use Apex',
          body: <p>Anyone can read Apex. You must be at least 16 to subscribe to the newsletter or submit predictions.</p>,
        },
        {
          id: 'changes',
          title: 'We may change these terms or the site',
          body: (
            <p>
              We may update these terms, and the date below will change when we do. We may also add, change or remove features at any time,
              for example to keep the site running or to reflect changes in the sport.
            </p>
          ),
        },
        {
          id: 'availability',
          title: 'No guarantee of availability or accuracy',
          body: (
            <p>
              Apex is provided free and &ldquo;as is&rdquo;. Schedules, results, standings, finished-session timing and news come from third-party sources
              and may be delayed, incomplete or wrong. Apex is not an official timing or results service and must not be relied on for
              betting, safety or any other important decision. We do not promise the site will always be available.
            </p>
          ),
        },
        {
          id: 'use',
          title: 'How you can use Apex',
          body: (
            <ul>
              <li>You may browse and share links to Apex for personal, non-commercial purposes.</li>
              <li>Do not copy the site&rsquo;s design, text or code into another product without permission.</li>
              <li>Do not use the site in a way that breaks the law or interferes with other people using it.</li>
            </ul>
          ),
        },
        {
          id: 'predictions',
          title: 'Predictions',
          body: (
            <p>
              Predictions are free and just for fun. There are no prizes or payments. Picks are tied to your browser, not to an account, and the
              leaderboard shows every player anonymously. We may remove an entry that abuses the service, for example automated submissions.
            </p>
          ),
        },
        {
          id: 'material',
          title: 'Content on Apex',
          body: (
            <ul>
              <li>News headlines and summaries link to the original publishers, who own their articles.</li>
              <li>Videos are embedded from YouTube and remain the property of their channels.</li>
              <li>Photographs belong to their photographers, publishers or licensors and are credited where shown.</li>
              <li>Statistics are compiled from public data sources listed on the <Link href="/references">References</Link> page.</li>
              <li>The Apex name, design, site text and code are the work of Shaurya Punj.</li>
            </ul>
          ),
        },
        {
          id: 'trademarks',
          title: 'Trade marks',
          body: (
            <p>
              F1, FORMULA 1, FORMULA ONE, GRAND PRIX and related marks are trade marks of Formula One Licensing B.V. Team and driver names,
              logos and liveries belong to their owners. Apex uses these names only to describe the sport and does not claim any right to them.
            </p>
          ),
        },
        {
          id: 'linking',
          title: 'Linking to Apex',
          body: <p>You are welcome to link to any page on Apex, as long as the link is fair and does not suggest an official connection or endorsement.</p>,
        },
        {
          id: 'scraping',
          title: 'No scraping or abuse',
          body: (
            <p>
              Do not use bots, scrapers or other automated tools to copy the site in bulk, overload it, get around its usage limits, or probe
              it for weaknesses. If you find a security issue, please report it privately to <a href={`mailto:${CONTACT}?subject=${encodeURIComponent('Apex · Security report')}`}>{CONTACT}</a>.
            </p>
          ),
        },
        {
          id: 'viruses',
          title: 'Viruses',
          body: <p>Do not upload or send anything harmful to the site. We take reasonable care, but we cannot guarantee the site is free from bugs or harmful code.</p>,
        },
        {
          id: 'liability',
          title: 'Our liability',
          body: (
            <p>
              As far as the law allows, Apex is not liable for any loss arising from use of the site or reliance on its content, including
              information from third-party sources. Nothing in these terms limits any liability that cannot be limited by law.
            </p>
          ),
        },
        {
          id: 'law',
          title: 'Governing law',
          body: <p>These terms are governed by the laws of India, where Apex is operated. This does not remove any rights you have under the laws of the country where you live.</p>,
        },
        {
          id: 'contact',
          title: 'Contacting us',
          body: (
            <p>
              Questions about these terms: <a href={`mailto:${CONTACT}?subject=${encodeURIComponent('Apex · Terms question')}`}>{CONTACT}</a>.
            </p>
          ),
        },
      ]}
    />
  );
}

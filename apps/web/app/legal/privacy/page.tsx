import type { Metadata } from 'next';
import { CookieSettingsButton } from '@/components/shell/CookieSettingsButton';
import { buttonClasses } from '@/components/ds';
import { LegalDocument as LegalPage } from '../_components/LegalDocument';
import { withSocial } from '@/lib/page-metadata';
import { analyticsConfigured } from '@/lib/analytics-config';

export const metadata: Metadata = withSocial({
  title: 'Privacy Policy',
  description: 'What personal data Apex handles, why, who processes it, how long it is kept and how to exercise your rights.',
  alternates: { canonical: '/legal/privacy' },
});

const CONTACT = 'shaurya@snappycrew.com';

/*
 * Structure follows the Formula 1 Fan Privacy Policy (contact, data
 * collected, how collected, how used, cookies, marketing opt-out, sharing,
 * children, retention, security, rights, complaints). Every statement below
 * describes what this codebase actually does; update it when that changes.
 * Analytics wording, the consent record and the "Cookie preferences" control
 * appear only when an analytics provider is configured (lib/analytics-config).
 */
export default function PrivacyPage() {
  const analytics = analyticsConfigured();
  return (
    <LegalPage
      title="Privacy"
      current="/legal/privacy"
      updated="2026-10-26"
      intro={
        <p>
          This policy explains how Apex (&ldquo;Apex&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) handles personal data when you use this
          website. Apex is an independent, unofficial Formula 1 fan project built and run by Snappy Crew, the studio founded by Shaurya Punj, based in India.
          Apex has no user accounts and asks for personal data in only two places: the newsletter and predictions.
        </p>
      }
      sections={[
        {
          id: 'contact',
          title: 'How to contact us',
          body: (
            <p>
              For any question about this policy or your data, email <a href={`mailto:${CONTACT}?subject=${encodeURIComponent('Apex · Privacy request')}`}>{CONTACT}</a> with
              the subject &ldquo;Apex · Privacy request&rdquo;.
            </p>
          ),
        },
        {
          id: 'collect',
          title: 'What personal data we collect',
          body: (
            <ul>
              <li><strong>Contact data.</strong> Your email address, only if you subscribe to the newsletter.</li>
              <li>
                <strong>Prediction data.</strong> If you save predictions: a random identifier stored in a signed cookie, your picks for each
                race and the score they earn. Apex does not ask for a name; the leaderboard shows players as &ldquo;Anonymous player&rdquo; with
                the first four characters of that random identifier.
              </li>
              <li>
                <strong>Technical data.</strong> Your IP address, used briefly to limit repeated submissions to the newsletter and prediction
                forms, and the standard request logs kept by our hosting provider.
              </li>
              {analytics ? (
                <li>
                  <strong>Usage data.</strong> Only if you accept analytics: which pages you view, when you play a video and whether you subscribe
                  to the newsletter.
                </li>
              ) : (
                <li><strong>No usage data.</strong> Apex runs no analytics, so it does not record which pages you view.</li>
              )}
            </ul>
          ),
        },
        {
          id: 'how',
          title: 'How we collect it',
          body: (
            <ul>
              <li><strong>Directly from you</strong>, when you subscribe or submit predictions.</li>
              <li><strong>Through your use of the site</strong>, from your browser&rsquo;s requests{analytics ? <> and, with your consent, analytics events</> : null}.</li>
              <li>We do not buy personal data or receive it about you from other companies.</li>
            </ul>
          ),
        },
        {
          id: 'use',
          title: 'How we use it',
          body: (
            <ul>
              <li>To send the newsletter you asked for, including a welcome email and race-week editions.</li>
              <li>To save your predictions, score them against official results and show the leaderboard.</li>
              <li>To keep the site working and protect it from abuse, such as automated repeated submissions.</li>
              {analytics && <li>With your consent, to understand which parts of the site are used so they can be improved.</li>}
            </ul>
          ),
        },
        {
          id: 'cookies',
          title: 'Cookies and similar storage',
          body: (
            <>
              <ul>
                {analytics && <li><strong>apex.consent.v1</strong> (browser local storage): remembers your cookie choice. Kept until you clear it or change your choice.</li>}
                <li><strong>apex:session-clock</strong> (browser local storage): remembers whether you read session times in your own time, track time or UTC. Kept until you clear it.</li>
                <li><strong>apex-prediction-attempts-v1</strong> (session storage): holds the picks you are saving until they are confirmed, so a reload cannot save them twice. It holds no personal details and is cleared when you close the tab.</li>
                <li><strong>apex:lights-out</strong> and <strong>apex:lights-out:weekend</strong> (session storage): remember that the start-lights animation has played, so it runs once per visit. Cleared when you close the tab.</li>
                <li><strong>apex_pid</strong> (cookie, one year): a random, signed identifier set only when you submit predictions, so your picks stay yours. It contains no personal details.</li>
                {analytics && <li><strong>Analytics cookies and storage</strong> (PostHog): set only after you accept analytics. Session recording and automatic click tracking are switched off.</li>}
              </ul>
              {analytics ? (
                <>
                  <p>Apex uses no advertising or marketing trackers. You can review or change your choice at any time:</p>
                  <CookieSettingsButton className={buttonClasses({ variant: 'secondary', className: 'mt-6' })} />
                </>
              ) : (
                <p>
                  Apex runs no analytics and uses no advertising or marketing trackers. Everything above only makes the site work, so there is
                  no cookie banner: there is nothing to consent to. If analytics are ever added, this page will name the provider and a banner
                  will ask you first.
                </p>
              )}
            </>
          ),
        },
        {
          id: 'opt-out',
          title: 'Newsletter opt-out',
          body: <p>Every newsletter email contains an unsubscribe link. Using it stops all further editions.</p>,
        },
        {
          id: 'share',
          title: 'How we share your data',
          body: (
            <>
              <p>We do not sell or rent personal data. We use a small number of service providers to run the site:</p>
              <ul>
                <li><strong>Vercel</strong> hosts the website and processes requests.</li>
                <li><strong>Resend</strong> stores newsletter email addresses and sends the emails.</li>
                {analytics && <li><strong>PostHog</strong> provides analytics, only after consent. Its servers may be in the United States.</li>}
                <li><strong>A managed PostgreSQL database</strong> stores predictions.</li>
                <li><strong>Upstash</strong> holds short-lived counters linked to your IP address to stop repeated automated submissions.</li>
              </ul>
              <p>
                Some content is loaded from other services when you view it: videos play through YouTube&rsquo;s privacy-enhanced
                (youtube-nocookie.com) player, news photos load from the publishers&rsquo; own servers and driver, team and trackside images load
                from Formula 1&rsquo;s own image servers. These services see your IP address but not which Apex page you are reading. Circuit and
                archive photos from Wikimedia Commons are fetched by Apex&rsquo;s own server and delivered from this website, so Wikimedia does not
                see your IP address and cannot set cookies in your browser. Links to news stories open the publisher&rsquo;s website, which has its own policy.
              </p>
            </>
          ),
        },
        {
          id: 'children',
          title: 'Children',
          body: <p>Apex is not directed at children. Please do not subscribe to the newsletter or submit predictions if you are under 16.</p>,
        },
        {
          id: 'retention',
          title: 'How long we keep it',
          body: (
            <ul>
              <li>Newsletter address: until you unsubscribe or ask us to delete it.</li>
              <li>Predictions: kept with the season&rsquo;s records, unless you ask us to delete them.</li>
              <li>Abuse-protection counters: deleted automatically, usually within a minute and never later than an hour.</li>
              {analytics && <li>Analytics data: kept by PostHog under its retention settings. You can withdraw consent at any time.</li>}
            </ul>
          ),
        },
        {
          id: 'security',
          title: 'Data security',
          body: (
            <p>
              Traffic is encrypted with HTTPS, the prediction cookie is signed and not readable by page scripts, stored data is reached only over
              encrypted connections, and administrative pages are password-protected. No online service can guarantee complete security.
            </p>
          ),
        },
        {
          id: 'rights',
          title: 'Your rights',
          body: (
            <p>
              Depending on where you live, you can ask to access, correct, export or delete your personal data, or object to its use. Email
              {' '}<a href={`mailto:${CONTACT}?subject=${encodeURIComponent('Apex · Privacy request')}`}>{CONTACT}</a> and we will respond as
              soon as we can. For prediction data, write from the browser you used and tell us which races you picked, so the right record can be found.
            </p>
          ),
        },
        {
          id: 'complaints',
          title: 'Complaints',
          body: <p>If you are unhappy with how your data has been handled, please contact us first. You may also complain to the data protection authority where you live.</p>,
        },
        {
          id: 'changes',
          title: 'Changes to this policy',
          body: <p>If the site starts handling data differently, this page is updated and the date below changes.</p>,
        },
      ]}
    />
  );
}

import type { Metadata } from 'next';
import { LegalDocument as LegalPage } from '../_components/LegalDocument';
import { withSocial } from '@/lib/page-metadata';

export const metadata: Metadata = withSocial({
  title: 'Disclaimer',
  description:
    'Apex is an independent, fan-built Formula 1 platform. It is not affiliated with Formula 1, FIA, FOM, Liberty Media, or any team or driver.',
  alternates: { canonical: '/legal/disclaimer' },
});

export default function DisclaimerPage() {
  return (
    <LegalPage
      title="Disclaimer"
      current="/legal/disclaimer"
      updated="2026-10-26"
      intro={
        <>
          <p>
            Apex is an independent, fan-built Formula 1 platform. It is{' '}
            <strong>not affiliated with, endorsed by, or associated with</strong> Formula 1, Formula
            One World Championship Limited, FIA, Formula One Management, Liberty Media, or any
            constructor or driver.
          </p>
          <p>
            The terms &ldquo;Formula 1&rdquo;, &ldquo;F1&rdquo;, &ldquo;Grand Prix&rdquo;, and team
            and driver names are used in a purely descriptive and nominative sense to identify the
            subject matter we cover.
          </p>
        </>
      }
      sections={[
        {
          id: 'sources',
          title: 'Sources and credits',
          body: (
            <>
              <p>
                Apex brings together public Formula 1 information: the calendar, results and standings back to 1950,
                timing from finished sessions, weather, driver biographies and circuit maps. Session timing appears once a
                session has finished. Apex does not show live timing.
              </p>
              <p>
                Every source and licence is listed on the <a href="/references">References</a> page.
              </p>
            </>
          ),
        },
        {
          id: 'news',
          title: 'News',
          body: (
            <p>
              Apex shows Formula 1 headlines and short summaries that link to the publishers who wrote them. The full
              articles and their photos remain with those publishers. Text from Wikipedia is credited where it is used.
            </p>
          ),
        },
        {
          id: 'video',
          title: 'Video',
          body: (
            <p>
              Video appears on Apex as embeds from YouTube, used only when
              the uploader has enabled embedding. We do not rehost broadcast video or F1 TV content.
            </p>
          ),
        },
        {
          id: 'logos',
          title: 'Names, logos & images',
          body: (
            <>
              <p>
                Team names and logos, car images and driver photographs belong to their owners, including Formula One
                Licensing B.V. and the teams. Trackside and archive photographs belong to their photographers and
                publishers. Apex holds no licence for them. They are shown only to identify the drivers, teams and races
                the pages describe and to comment on the sport, and they are credited on the{' '}
                <a href="/references">References</a> page.
              </p>
              <p>
                If you own an image or mark shown here and want it removed, see the{' '}
                <a href="/legal/dmca">Copyright page</a> or use the address below.
              </p>
            </>
          ),
        },
        {
          id: 'takedowns',
          title: 'Takedowns',
          body: (
            <p>
              To report a copyright or trademark concern, email{' '}
              <a href="mailto:shaurya@snappycrew.com?subject=Apex%20%C2%B7%20Copyright%20notice">shaurya@snappycrew.com</a>
              {' '}and follow the checklist on the <a href="/legal/dmca">Copyright page</a>.
            </p>
          ),
        },
      ]}
    />
  );
}

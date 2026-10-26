'use client';

import Script from 'next/script';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { analyticsConfigured } from '@/lib/analytics-config';
import { captureClient, hasAnalyticsConsent, setAnalyticsConsent, subscribeToConsentChanges } from '@/lib/analytics';

/**
 * Loads PostHog only when BOTH are true:
 *   1. NEXT_PUBLIC_POSTHOG_KEY is set, and
 *   2. the visitor granted analytics consent in the cookie banner
 *      (apex.consent.v1 → { analytics: true }).
 * "Reject" in the banner means PostHog never initializes. No-op until both hold;
 * Choices and withdrawal apply immediately; the SDK loads only after opt-in.
 */
export function PosthogScript() {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://app.posthog.com';
  const [analyticsOk, setAnalyticsOk] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const browser = window as Window & { __apexAnalyticsConsent?: () => boolean };
    browser.__apexAnalyticsConsent = hasAnalyticsConsent;
    const read = () => setAnalyticsOk(hasAnalyticsConsent());
    const loaded = () => {
      setAnalyticsConsent(hasAnalyticsConsent());
      setSdkReady(true);
    };
    read();
    const unsubscribe = subscribeToConsentChanges(read);
    window.addEventListener('apex:analytics-ready', loaded);
    return () => {
      unsubscribe();
      window.removeEventListener('apex:analytics-ready', loaded);
      if (browser.__apexAnalyticsConsent === hasAnalyticsConsent) delete browser.__apexAnalyticsConsent;
    };
  }, []);

  useEffect(() => {
    if (sdkReady && analyticsOk) captureClient('pageview', { path: pathname });
  }, [pathname, sdkReady, analyticsOk]);

  const sdkConfig = `{
    api_host:${JSON.stringify(host)},
    capture_pageview:false,
    capture_pageleave:false,
    autocapture:false,
    disable_session_recording:true,
    opt_out_capturing_by_default:true,
    persistence:'localStorage+cookie',
    before_send:function(event){try{return window.__apexAnalyticsConsent&&window.__apexAnalyticsConsent()===true?event:null;}catch(e){return null;}},
    loaded:function(){window.dispatchEvent(new Event('apex:analytics-ready'));}
  }`;

  if (!analyticsConfigured() || !key || !analyticsOk) return null;
  return (
    <Script id="posthog-init" strategy="afterInteractive">
      {`!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys getNextSurveyStep onSessionId".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);posthog.init(${JSON.stringify(key)},${sdkConfig})`}
    </Script>
  );
}

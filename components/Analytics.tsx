import Script from "next/script";

// PostHog via the official loader snippet rather than the npm package: posthog-js drags in
// core-js, whose ignored build script fails `pnpm install` under pnpm 11 and breaks verify.
//
// Key-gated the same way checkout is: with no key this renders nothing, so previews and local
// runs never emit events into the production project.
export default function Analytics() {
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST || "https://us.i.posthog.com";

  return (
    <Script id="posthog" strategy="afterInteractive">
      {`!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once unregister identify alias people.set people.set_once set_config get_distinct_id".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);
posthog.init(${JSON.stringify(key)}, {
  api_host: ${JSON.stringify(host)},
  person_profiles: 'identified_only',
  // register() must run in the loaded callback. Called bare after init it lands on the
  // stub queue and is discarded when the real library initializes persistence, so
  // product never reaches the super properties and every event ships unlabelled.
  loaded: function (ph) { ph.register({ product: 'plays' }); },
});`}
    </Script>
  );
}

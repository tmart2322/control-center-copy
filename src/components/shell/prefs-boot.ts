/** Shared by the server layout (inline boot script) and the client PrefsProvider. Not a client module. */

export const PREFS_KEY = 'cc:prefs';
/** Stored-shape version. v1 (no `v`) carried the Lightning/Cosmos brand ramp and light/compact defaults. */
export const PREFS_VERSION = 2;

/** v2 defaults (DESIGN-V2: dark first, roomy, 16 px base), the same as the tokens' own defaults in brand.css. */
export const PREFS_DEFAULTS = { scheme: 'dark', density: 'comfortable', textSize: 'md' } as const;

/**
 * Inline <head> script: apply stored prefs before first paint (data-theme, data-density, data-text), so
 * dark loads without a flash of light. `system` resolves through prefers-color-scheme here as well.
 * v1 values that were only the old defaults (light, compact) give way to the v2 defaults; the old
 * brand ramp is ignored. Anything unreadable falls back to the defaults. `?theme=dark|light|system`
 * overrides the scheme for that page load only (screenshots, side-by-side checks); nothing is stored.
 */
export const PREFS_BOOT_SCRIPT = `(function(){try{var h=document.documentElement;var p=JSON.parse(localStorage.getItem('${PREFS_KEY}')||'{}')||{};var v2=p.v===${PREFS_VERSION};var s=p.scheme,d=p.density,t=p.textSize;if(!(s==='dark'||s==='light'||s==='system')||(!v2&&s==='light'))s='${PREFS_DEFAULTS.scheme}';if(!(d==='compact'||d==='comfortable')||(!v2&&d==='compact'))d='${PREFS_DEFAULTS.density}';if(!(t==='sm'||t==='md'||t==='lg'))t='${PREFS_DEFAULTS.textSize}';var q=new URLSearchParams(location.search).get('theme');if(q==='dark'||q==='light'||q==='system')s=q;if(s==='system')s=window.matchMedia&&window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';h.setAttribute('data-theme',s);h.setAttribute('data-density',d);h.setAttribute('data-text',t);}catch(e){}})();`;

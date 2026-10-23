import { useEffect } from 'react';
import { usePublicSettings } from '../hooks/usePublicSettings';
import { useMenuItems } from '../services/useMenuItems.ts';
import { buildRestaurantJsonLd } from '../lib/restaurantSchema.ts';

const SCRIPT_ID = 'ember-restaurant-jsonld';

/**
 * Injects the Restaurant JSON-LD (GEO) once the live settings arrive,
 * and refreshes it when the menu loads — the schema is generated from
 * the same public settings + menu the page renders (see
 * lib/restaurantSchema.ts), never hard-coded in index.html, so a
 * client install's name, contact details, hours and prices reach
 * search/AI readers exactly as the owner set them. Renders nothing;
 * while the settings are still loading (or failed) no tag is written
 * at all — an absent schema is honest, a stale one would not be.
 */
export default function StructuredData() {
  const settings = usePublicSettings();
  const { items } = useMenuItems();

  useEffect(() => {
    if (!settings) return;
    const data = buildRestaurantJsonLd({ settings, menu: items, siteUrl: window.location.origin });
    let el = document.head.querySelector<HTMLScriptElement>(`script#${SCRIPT_ID}`);
    if (!el) {
      el = document.createElement('script');
      el.id = SCRIPT_ID;
      el.type = 'application/ld+json';
      document.head.appendChild(el);
    }
    el.textContent = JSON.stringify(data);
  }, [settings, items]);

  return null;
}

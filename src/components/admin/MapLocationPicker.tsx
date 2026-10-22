import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import './MapLocationPicker.css';
import { ghostBtn, inputCls } from './ui';

/**
 * Interactive map-pin picker for Admin → Settings → Website locations.
 * Leaflet + OpenStreetMap tiles, Nominatim for search / reverse geocode
 * (no API key exists in this project, and none is needed for either).
 * This module is loaded lazily (React.lazy in AdminSettings) so Leaflet
 * never reaches the customer-facing bundles.
 *
 * The pin is the ONLY thing this component owns: every settle (search
 * pick, map click, drag end) reports (lat, lng, resolvedAddress) to the
 * parent, which writes it into the settings form state — the page's
 * normal Save persists it. Coordinates are rounded to 6 decimals
 * (~0.1 m) before they leave.
 */

interface NominatimPlace {
  lat: string;
  lon: string;
  display_name: string;
}

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
// Leaflet happily reports longitudes past ±180 when the admin pans
// across a wrapped copy of the world; the API (rightly) rejects those,
// so the pin is wrapped back into range at the source.
const wrapLng = (v: number) => ((((v + 540) % 360) + 360) % 360) - 180;

async function nominatimSearch(q: string): Promise<NominatimPlace[]> {
  const res = await fetch(`${NOMINATIM}/search?format=json&limit=5&q=${encodeURIComponent(q)}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`search ${res.status}`);
  return (await res.json()) as NominatimPlace[];
}

async function nominatimReverse(lat: number, lng: number): Promise<string | null> {
  const res = await fetch(`${NOMINATIM}/reverse?format=json&zoom=18&lat=${lat}&lon=${lng}`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as { display_name?: string };
  return data.display_name ?? null;
}

// Leaflet's bundled marker images break under Vite (the icon URLs are
// resolved relative to the CSS), so the pin is a styled divIcon: an
// ember-gradient diamond with a dark-green rim and a cream centre dot —
// the admin design system's colours, no image assets at all.
const pinIcon = L.divIcon({
  className: 'ember-map-pin-wrap',
  html: '<div style="width:22px;height:22px;margin:2px;transform:rotate(45deg);background:linear-gradient(135deg,#C98A44,#A66932);border:2px solid #0D1A0E;border-radius:5px;box-shadow:0 10px 18px rgba(13,26,14,0.45);display:flex;align-items:center;justify-content:center"><div style="width:7px;height:7px;border-radius:9999px;background:#F5F0E8"></div></div>',
  iconSize: [26, 26],
  iconAnchor: [13, 20],
});

interface Props {
  lat: number | null;
  lng: number | null;
  /** Text used for the one initial geocode-to-center when no pin exists. */
  fallbackText: string | null;
  onPin: (lat: number, lng: number, resolvedAddress: string | null) => void;
  onClear: () => void;
}

export default function MapLocationPicker({ lat, lng, fallbackText, onPin, onClear }: Props) {
  const mapDivRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const onPinRef = useRef(onPin);
  onPinRef.current = onPin;
  // The last position THIS picker emitted — prop echoes of it are ignored
  // by the sync effect below; genuinely external changes (Clear pin)
  // still land.
  const emittedRef = useRef<{ lat: number; lng: number } | null>(null);
  const reverseSeq = useRef(0);
  const searchSeq = useRef(0);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<NominatimPlace[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchFailed, setSearchFailed] = useState(false);
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(
    lat !== null && lng !== null ? { lat, lng } : null,
  );
  const [resolved, setResolved] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);

  const ensureMarker = (p: { lat: number; lng: number }) => {
    const map = mapRef.current;
    if (!map) return;
    if (!markerRef.current) {
      const marker = L.marker([p.lat, p.lng], { icon: pinIcon, draggable: true }).addTo(map);
      marker.on('dragend', () => {
        const ll = marker.getLatLng();
        settleRef.current(ll.lat, ll.lng);
      });
      markerRef.current = marker;
    } else {
      markerRef.current.setLatLng([p.lat, p.lng]);
    }
  };

  // ── settle: the single path every pin placement flows through ──────
  const settle = (rawLat: number, rawLng: number, knownAddress?: string) => {
    const p = { lat: round6(rawLat), lng: round6(wrapLng(rawLng)) };
    emittedRef.current = p;
    setPin(p);
    ensureMarker(p);
    if (knownAddress) {
      reverseSeq.current += 1; // a slower reverse for an older pin must not win
      setResolved(knownAddress);
      setResolving(false);
      onPinRef.current(p.lat, p.lng, knownAddress);
      return;
    }
    // Report the coordinates immediately; the resolved address follows
    // when Nominatim answers (a failure just keeps the previous text).
    onPinRef.current(p.lat, p.lng, null);
    const seq = ++reverseSeq.current;
    setResolving(true);
    nominatimReverse(p.lat, p.lng)
      .then((name) => {
        if (seq !== reverseSeq.current) return;
        setResolving(false);
        setResolved(name);
        if (name) onPinRef.current(p.lat, p.lng, name);
      })
      .catch(() => {
        if (seq === reverseSeq.current) setResolving(false);
      });
  };
  const settleRef = useRef(settle);
  settleRef.current = settle;

  // ── map initialisation (once) ───────────────────────────────────────
  useEffect(() => {
    const div = mapDivRef.current;
    if (!div || mapRef.current) return;
    const map = L.map(div, { scrollWheelZoom: true });
    mapRef.current = map;
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors',
    }).addTo(map);
    map.on('click', (e: L.LeafletMouseEvent) => settleRef.current(e.latlng.lat, e.latlng.lng));

    if (lat !== null && lng !== null) {
      // Existing pin: show it and resolve its address for the READOUT
      // only — mounting the picker must not rewrite the form (no onPin).
      map.setView([lat, lng], 16);
      const p = { lat, lng };
      emittedRef.current = p;
      setPin(p);
      ensureMarker(p);
      const seq = ++reverseSeq.current;
      setResolving(true);
      nominatimReverse(lat, lng)
        .then((name) => {
          if (seq !== reverseSeq.current) return;
          setResolving(false);
          setResolved(name);
        })
        .catch(() => {
          if (seq === reverseSeq.current) setResolving(false);
        });
    } else if (fallbackText) {
      // No pin yet: one geocode attempt just to centre the map somewhere
      // relevant. It deliberately does NOT drop a pin — only the admin
      // chooses the point.
      map.setView([20, 0], 2);
      nominatimSearch(fallbackText)
        .then((places) => {
          const first = places[0];
          if (first && mapRef.current) mapRef.current.setView([Number(first.lat), Number(first.lon)], 15);
        })
        .catch(() => { /* a failed centre is fine — the hint explains the map */ });
    } else {
      map.setView([20, 0], 2);
    }
    const t = setTimeout(() => map.invalidateSize(), 60);
    return () => {
      clearTimeout(t);
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Init reads the mount-time props only; later prop changes are the
    // sync effect's job.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── external changes (Clear pin in the parent) ─────────────────────
  useEffect(() => {
    if (lat === null || lng === null) {
      if (emittedRef.current !== null || markerRef.current) {
        emittedRef.current = null;
        markerRef.current?.remove();
        markerRef.current = null;
        setPin(null);
        setResolved(null);
      }
      return;
    }
    const emitted = emittedRef.current;
    if (emitted && Math.abs(emitted.lat - lat) < 1e-9 && Math.abs(emitted.lng - lng) < 1e-9) return;
    settleRef.current(lat, lng);
    mapRef.current?.setView([lat, lng], Math.max(mapRef.current.getZoom(), 15));
  }, [lat, lng]);

  // ── search (debounced) ──────────────────────────────────────────────
  // Sequence-guarded like the reverse-geocode path: the debounce only
  // delays the NEXT fetch, it cannot recall one already in flight, so a
  // slow stale response must never overwrite a newer query's results.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 3) {
      searchSeq.current += 1; // any in-flight search is now stale
      setResults(null);
      setSearching(false);
      setSearchFailed(false);
      return;
    }
    setSearching(true);
    const t = setTimeout(() => {
      const seq = ++searchSeq.current;
      nominatimSearch(q)
        .then((places) => {
          if (seq !== searchSeq.current) return;
          setResults(places);
          setSearchFailed(false);
        })
        .catch(() => {
          if (seq !== searchSeq.current) return;
          setResults(null);
          setSearchFailed(true);
        })
        .finally(() => {
          if (seq === searchSeq.current) setSearching(false);
        });
    }, 450);
    return () => clearTimeout(t);
  }, [query]);

  const pickResult = (place: NominatimPlace) => {
    const p = { lat: Number(place.lat), lng: Number(place.lon) };
    setResults(null);
    setQuery('');
    mapRef.current?.setView([p.lat, p.lng], 16);
    settleRef.current(p.lat, p.lng, place.display_name);
  };

  return (
    <div>
      <div className="relative">
        <input
          className={inputCls}
          placeholder="Search a place or address — e.g. Clifton Block 5, Karachi"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search for a place"
        />
        {searching && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 font-bodytext text-[12px] text-[#98A096]">Searching…</span>
        )}
        {results !== null && (
          <div className="absolute left-0 right-0 top-full z-20 mt-1.5 overflow-hidden rounded-[10px] border border-[#EAE3D3] bg-white shadow-[0_18px_36px_-16px_rgba(22,36,26,0.35)]">
            {results.length === 0 && (
              <p className="px-3 py-2.5 font-bodytext text-[12.5px] text-[#98A096]">No places found — try a fuller address, or click the map.</p>
            )}
            {results.map((r, i) => (
              <button
                key={`${r.lat}-${r.lon}-${i}`}
                type="button"
                className="block w-full px-3 py-2.5 text-left font-bodytext text-[12.5px] text-[#16241A] hover:bg-[#FBF8F1]"
                onClick={() => pickResult(r)}
              >
                {r.display_name}
              </button>
            ))}
          </div>
        )}
      </div>
      {searchFailed && (
        <p className="pt-2 font-bodytext text-[12px] text-[#B0492F]">Search is unavailable right now — you can still click the map to drop the pin.</p>
      )}
      {/* isolation keeps Leaflet's internal z-indexes inside the panel */}
      <div
        ref={mapDivRef}
        className="mt-3 h-[340px] w-full overflow-hidden rounded-[10px] border border-[#EAE3D3]"
        style={{ isolation: 'isolate' }}
      />
      {pin ? (
        <div className="pt-2.5">
          <p className="font-bodytext text-[12.5px] text-[#16241A]">
            {resolving ? 'Resolving address…' : resolved ?? 'Pin set — the address could not be resolved, the coordinates are what count.'}
          </p>
          <p className="font-mono text-[11.5px] text-[#98A096]">{pin.lat.toFixed(6)}, {pin.lng.toFixed(6)}</p>
        </div>
      ) : (
        <p className="pt-2.5 font-bodytext text-[12px] text-[#98A096]">
          Search above, or click the map to drop the pin — you can drag it to fine-tune. The Contact page map will show exactly that point.
        </p>
      )}
      {pin && (
        <div className="pt-2">
          <button type="button" className={ghostBtn} onClick={onClear}>
            Clear pin
          </button>
        </div>
      )}
    </div>
  );
}

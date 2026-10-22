import { useEffect, useRef, useState } from 'react';
import { sendContactMessage } from '../services/api.ts';
import { openingHoursLines, usePublicSettings } from '../hooks/usePublicSettings';
import {
  MapPin, Phone, Mail, Clock, Car,
  Send, CheckCircle,
} from 'lucide-react';

/* ─── Scroll reveal ──────────────────────────────────────────────────────── */
function useReveal<T extends HTMLElement>(delay = 0) {
  const ref = useRef<T>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let obs: IntersectionObserver;
    let raf2: number;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        obs = new IntersectionObserver(
          ([entry]) => {
            if (entry.isIntersecting) {
              setTimeout(() => el.classList.add('c-visible'), delay);
              obs.disconnect();
            }
          },
          { threshold: 0.12 }
        );
        obs.observe(el);
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      cancelAnimationFrame(raf2);
      obs?.disconnect();
    };
  }, [delay]);
  return ref;
}

/* ─── Contact info items ─────────────────────────────────────────────────── */
type InfoItem = {
  Icon: typeof MapPin;
  label: string;
  lines: string[];
  href: string | null;
};

// The parking card is static page content — everything else comes from
// the restaurant settings (see the component body).
const PARKING: InfoItem = {
  Icon: Car,
  label: 'Parking',
  lines: ['Complimentary valet parking', 'available on weekends'],
  href: null,
};

const SUBJECTS = [
  'Reservations',
  'General Inquiry',
  'Private Events',
  'Feedback',
  'Other',
];

/* ─── Floating label input ───────────────────────────────────────────────── */
function FloatInput({
  id, label, type = 'text', required = false,
  value, onChange,
}: {
  id: string; label: string; type?: string;
  required?: boolean; value: string;
  onChange: (v: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const lifted = focused || value.length > 0;
  return (
    <div style={{ position: 'relative', paddingTop: 20 }}>
      <label
        htmlFor={id}
        style={{
          position: 'absolute',
          left: 0,
          top: lifted ? 0 : 32,
          fontSize: lifted ? '0.65rem' : '0.85rem',
          letterSpacing: lifted ? '0.2em' : '0.05em',
          textTransform: 'uppercase',
          color: lifted ? '#C17A3A' : 'rgba(28,43,30,0.48)',
          fontFamily: 'Jost, sans-serif',
          transition: 'all 0.25s cubic-bezier(0.22,1,0.36,1)',
          pointerEvents: 'none',
        }}
      >
        {label}
      </label>
      <input
        id={id}
        type={type}
        required={required}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          borderBottom: `1px solid ${focused ? '#C17A3A' : 'rgba(28,43,30,0.18)'}`,
          outline: 'none',
          color: '#1C2B1E',
          fontFamily: 'Jost, sans-serif',
          fontWeight: 300,
          fontSize: '0.95rem',
          padding: '10px 0 8px',
          transition: 'border-color 0.25s ease',
          boxSizing: 'border-box',
        }}
      />
    </div>
  );
}

/* ─── Floating label select ──────────────────────────────────────────────── */
function FloatSelect({
  id, label, value, onChange,
}: {
  id: string; label: string; value: string;
  onChange: (v: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const lifted = focused || value.length > 0;
  return (
    <div style={{ position: 'relative', paddingTop: 20 }}>
      <label
        htmlFor={id}
        style={{
          position: 'absolute',
          left: 0,
          top: lifted ? 0 : 32,
          fontSize: lifted ? '0.65rem' : '0.85rem',
          letterSpacing: lifted ? '0.2em' : '0.05em',
          textTransform: 'uppercase',
          color: lifted ? '#C17A3A' : 'rgba(28,43,30,0.48)',
          fontFamily: 'Jost, sans-serif',
          transition: 'all 0.25s cubic-bezier(0.22,1,0.36,1)',
          pointerEvents: 'none',
        }}
      >
        {label}
      </label>
      <select
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          borderBottom: `1px solid ${focused ? '#C17A3A' : 'rgba(28,43,30,0.18)'}`,
          outline: 'none',
          color: value ? '#1C2B1E' : 'transparent',
          fontFamily: 'Jost, sans-serif',
          fontWeight: 300,
          fontSize: '0.95rem',
          padding: '10px 0 8px',
          transition: 'border-color 0.25s ease',
          boxSizing: 'border-box',
          cursor: 'pointer',
          appearance: 'none',
          WebkitAppearance: 'none',
        }}
      >
        <option value="" style={{ background: '#FFFFFF' }} />
        {SUBJECTS.map(s => (
          <option key={s} value={s} style={{ background: '#FFFFFF', color: '#1C2B1E' }}>
            {s}
          </option>
        ))}
      </select>
      {/* chevron */}
      <span style={{
        position: 'absolute', right: 0, top: 32,
        color: 'rgba(28,43,30,0.45)', fontSize: '0.7rem', pointerEvents: 'none',
      }}>▾</span>
    </div>
  );
}

/* ─── Floating label textarea ────────────────────────────────────────────── */
function FloatTextarea({
  id, label, required = false, error, value, onChange,
}: {
  id: string; label: string; required?: boolean; error?: string | null;
  value: string;
  onChange: (v: string) => void;
}) {
  const [focused, setFocused] = useState(false);
  const lifted = focused || value.length > 0;
  return (
    <div style={{ position: 'relative', paddingTop: 20 }}>
      <label
        htmlFor={id}
        style={{
          position: 'absolute',
          left: 0,
          top: lifted ? 0 : 32,
          fontSize: lifted ? '0.65rem' : '0.85rem',
          letterSpacing: lifted ? '0.2em' : '0.05em',
          textTransform: 'uppercase',
          color: lifted ? '#C17A3A' : 'rgba(28,43,30,0.48)',
          fontFamily: 'Jost, sans-serif',
          transition: 'all 0.25s cubic-bezier(0.22,1,0.36,1)',
          pointerEvents: 'none',
        }}
      >
        {label}
      </label>
      <textarea
        id={id}
        rows={5}
        required={required}
        value={value}
        onChange={e => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        style={{
          width: '100%',
          background: 'transparent',
          border: 'none',
          borderBottom: `1px solid ${error ? '#ef4444' : focused ? '#C17A3A' : 'rgba(28,43,30,0.18)'}`,
          outline: 'none',
          color: '#1C2B1E',
          fontFamily: 'Jost, sans-serif',
          fontWeight: 300,
          fontSize: '0.95rem',
          padding: '10px 0 8px',
          transition: 'border-color 0.25s ease',
          resize: 'none',
          boxSizing: 'border-box',
          lineHeight: 1.7,
        }}
      />
      {error && (
        <p className="text-[#ef4444]" style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px', marginTop: '8px' }}>{error}</p>
      )}
    </div>
  );
}

/* ─── Page ───────────────────────────────────────────────────────────────── */
export default function Contact() {
  const headerRef = useReveal<HTMLDivElement>(0);
  const infoRef = useReveal<HTMLDivElement>(100);
  const formRef = useReveal<HTMLDivElement>(200);
  const mapRef = useReveal<HTMLDivElement>(0);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => { window.scrollTo(0, 0); }, []);

  // Contact details: the contact page's own overrides win, the global
  // Restaurant profile fields are the fallback, and a card whose value
  // resolves to null is omitted entirely — no hardcoded stand-ins.
  const settings = usePublicSettings();
  const contactContacts = settings?.siteLocations?.contact;
  const infoAddress = contactContacts?.address ?? settings?.address ?? null;
  const infoPhone = contactContacts?.phone ?? settings?.phone ?? null;
  const infoEmail = contactContacts?.email ?? settings?.email ?? null;
  const hoursLines = contactContacts?.hours
    ? contactContacts.hours.split('\n').filter((l) => l.trim())
    : openingHoursLines(settings);
  const mapTarget = contactContacts?.mapLocation ?? infoAddress;
  const INFO: InfoItem[] = [
    infoAddress
      ? {
          Icon: MapPin,
          label: 'Location',
          lines: infoAddress.split('\n').filter((l) => l.trim()),
          href: mapTarget ? `https://maps.google.com/?q=${encodeURIComponent(mapTarget)}` : null,
        }
      : null,
    infoPhone
      ? { Icon: Phone, label: 'Phone', lines: [infoPhone], href: `tel:${infoPhone.replace(/[^0-9+]/g, '')}` }
      : null,
    infoEmail
      ? { Icon: Mail, label: 'Email', lines: [infoEmail], href: `mailto:${infoEmail}` }
      : null,
    hoursLines.length > 0
      ? { Icon: Clock, label: 'Hours', lines: hoursLines, href: null }
      : null,
    PARKING,
  ].filter((item): item is InfoItem => item !== null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Name/email are guarded by their native `required` attributes, so
    // the browser stops an empty submit before it reaches this handler.
    // The message field used to fail silently here — say so visibly.
    if (!message.trim()) {
      setMessageError('Please write a message so we know how to help.');
      return;
    }
    setMessageError(null);
    setSendError(null);
    setSending(true);
    const res = await sendContactMessage({ name, email, phone: phone || undefined, subject: subject || undefined, message });
    setSending(false);
    if (!res.ok) {
      setSendError(res.error ?? 'We could not send your message — please try again.');
      return;
    }
    setSent(true);
  };

  return (
    <>
      <style>{`
        .c-hidden {
          opacity: 0;
          transform: translateY(32px);
          transition: opacity 0.8s cubic-bezier(0.22,1,0.36,1),
                      transform 0.8s cubic-bezier(0.22,1,0.36,1);
        }
        .c-visible { opacity: 1 !important; transform: none !important; }
      `}</style>

      <div style={{ minHeight: '100vh', background: '#0D1A0E' }}>

        {/* ══════════════════════════════════════════
            HEADER
        ══════════════════════════════════════════ */}
        <section
          className="h-auto md:h-[45vh] md:min-h-[360px] flex items-center justify-center pt-[60px] pb-[40px] md:pt-[80px] md:pb-0"
          style={{
            background: 'radial-gradient(circle at center, #233425 0%, #0D1A0E 100%)',
            borderBottom: '1px solid rgba(193,122,58,0.1)',
          }}
        >
          <div
            ref={headerRef}
            className="c-hidden"
            style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}
          >
            <span style={{
              color: '#C17A3A', fontFamily: 'Jost, sans-serif',
              fontSize: '0.7rem', letterSpacing: '0.3em', textTransform: 'uppercase',
            }}>
              ✦ Get In Touch
            </span>
            <h1 style={{
              fontFamily: 'Cormorant Garamond, serif',
              fontWeight: 300,
              fontSize: 'clamp(48px, 8vw, 72px)',
              color: '#F5F0E8',
              margin: 0,
              lineHeight: 1.1,
              letterSpacing: '-0.02em',
            }}>
              Contact Us
            </h1>
            <div style={{ width: 56, height: 1, background: '#C17A3A' }} />
          </div>
        </section>

        {/* ══════════════════════════════════════════
            TWO-COLUMN MAIN
        ══════════════════════════════════════════ */}
        <div style={{ display: 'flex', flexWrap: 'wrap', minHeight: 'fit-content', background: '#F5F0E8' }}>

          {/* ── LEFT: Info panel ── */}
          <div
            ref={infoRef}
            className="c-hidden"
            style={{
              flex: '1 1 340px',
              background: '#FFFFFF',
              padding: 'clamp(40px, 6vw, 60px) clamp(28px, 5vw, 48px)',
              display: 'flex',
              flexDirection: 'column',
              gap: 40,
            }}
          >
            <div>
              <span style={{
                color: '#C17A3A', fontFamily: 'Jost, sans-serif',
                fontSize: '0.65rem', letterSpacing: '0.3em', textTransform: 'uppercase',
              }}>
                Find Us
              </span>
              <h2 style={{
                fontFamily: 'Cormorant Garamond, serif', fontWeight: 300,
                fontSize: 'clamp(32px, 4vw, 42px)', color: '#1C2B1E',
                margin: '12px 0 0', lineHeight: 1.15, letterSpacing: '0.01em',
              }}>
                We'd love to hear from you
              </h2>
              <div style={{ width: 40, height: 1, background: '#C17A3A', marginTop: 20 }} />
            </div>

            {/* Info items */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
              {INFO.map(({ Icon, label, lines, href }) => (
                <div key={label} style={{ display: 'flex', gap: 18, alignItems: 'flex-start' }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%',
                    border: '1px solid rgba(193,122,58,0.3)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, marginTop: 2,
                  }}>
                    <Icon size={15} color="#C17A3A" strokeWidth={1.5} />
                  </div>
                  <div>
                    <p style={{
                      fontFamily: 'Jost, sans-serif', fontSize: '0.65rem',
                      letterSpacing: '0.22em', textTransform: 'uppercase',
                      color: 'rgba(28,43,30,0.45)', margin: '0 0 6px',
                    }}>
                      {label}
                    </p>
                    {lines.map((line, i) =>
                      href && i === 0 ? (
                        <a
                          key={i}
                          href={href}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            display: 'block',
                            fontFamily: 'Cormorant Garamond, serif',
                            fontSize: '1.05rem', fontWeight: 400,
                            color: '#1C2B1E', textDecoration: 'none',
                            transition: 'color 0.2s ease',
                            lineHeight: 1.5,
                          }}
                          onMouseEnter={e => (e.currentTarget.style.color = '#C17A3A')}
                          onMouseLeave={e => (e.currentTarget.style.color = '#1C2B1E')}
                        >
                          {line}
                        </a>
                      ) : (
                        <span
                          key={i}
                          style={{
                            display: 'block',
                            fontFamily: 'Cormorant Garamond, serif',
                            fontSize: '1.05rem', fontWeight: 400,
                            color: i === 0 ? '#1C2B1E' : 'rgba(28,43,30,0.62)',
                            lineHeight: 1.5,
                          }}
                        >
                          {line}
                        </span>
                      )
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ── RIGHT: Contact form ── */}
          <div
            ref={formRef}
            className="c-hidden"
            style={{
              flex: '1 1 400px',
              background: 'transparent',
              padding: 'clamp(40px, 6vw, 60px) clamp(28px, 5vw, 48px)',
            }}
          >
            {sent ? (
              /* ── Success state ── */
              <div style={{
                height: '100%', minHeight: 440,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                gap: 20, textAlign: 'center',
              }}>
                <CheckCircle size={52} color="#C17A3A" strokeWidth={1.2} />
                <h3 style={{
                  fontFamily: 'Cormorant Garamond, serif', fontWeight: 400,
                  fontSize: '2rem', color: '#1C2B1E', margin: 0,
                }}>
                  Message Received
                </h3>
                <div style={{ width: 36, height: 1, background: '#C17A3A' }} />
                <p style={{
                  fontFamily: 'Jost, sans-serif', fontWeight: 300,
                  color: 'rgba(28,43,30,0.65)', fontSize: '0.9rem',
                  lineHeight: 1.8, maxWidth: 360,
                }}>
                  Thank you for reaching out. A member of our team will be in touch within 24 hours.
                </p>
                <button
                  onClick={() => { setSent(false); setName(''); setEmail(''); setPhone(''); setSubject(''); setMessage(''); setMessageError(null); }}
                  style={{
                    marginTop: 8,
                    background: 'transparent',
                    border: '1px solid rgba(193,122,58,0.5)',
                    color: '#C17A3A',
                    fontFamily: 'Jost, sans-serif',
                    fontSize: '0.7rem',
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                    padding: '12px 32px',
                    cursor: 'pointer',
                    transition: 'all 0.25s ease',
                  }}
                  onMouseEnter={e => {
                    (e.currentTarget as HTMLButtonElement).style.background = '#C17A3A';
                    (e.currentTarget as HTMLButtonElement).style.color = '#fff';
                  }}
                  onMouseLeave={e => {
                    (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                    (e.currentTarget as HTMLButtonElement).style.color = '#C17A3A';
                  }}
                >
                  Send Another
                </button>
              </div>
            ) : (
              /* ── Form ── */
              <>
                <div style={{ marginBottom: 40 }}>
                  <span style={{
                    color: '#C17A3A', fontFamily: 'Jost, sans-serif',
                    fontSize: '0.65rem', letterSpacing: '0.3em', textTransform: 'uppercase',
                  }}>
                    Send a Message
                  </span>
                  <h2 style={{
                    fontFamily: 'Cormorant Garamond, serif', fontWeight: 300,
                    fontSize: 'clamp(32px, 4vw, 42px)', color: '#1C2B1E',
                    margin: '12px 0 0', lineHeight: 1.15, letterSpacing: '0.01em',
                  }}>
                    How can we help?
                  </h2>
                  <div style={{ width: 40, height: 1, background: '#C17A3A', marginTop: 20 }} />
                </div>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>
                    <FloatInput
                      id="cf-name" label="Full Name" required
                      value={name} onChange={setName}
                    />
                    <FloatInput
                      id="cf-email" label="Email Address" type="email" required
                      value={email} onChange={setEmail}
                    />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>
                    <FloatInput
                      id="cf-phone" label="Phone (optional)" type="tel"
                      value={phone} onChange={setPhone}
                    />
                    <FloatSelect
                      id="cf-subject" label="Subject"
                      value={subject} onChange={setSubject}
                    />
                  </div>
                  <FloatTextarea
                    id="cf-message" label="Your Message" required
                    error={messageError}
                    value={message}
                    onChange={(v) => { setMessage(v); if (v.trim()) setMessageError(null); }}
                  />

                  {sendError && (
                    <p className="text-[#ef4444]" style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px' }}>{sendError}</p>
                  )}

                  <button
                    type="submit"
                    disabled={sending}
                    style={{
                      width: '100%',
                      background: sending ? 'rgba(193,122,58,0.2)' : 'transparent',
                      color: sending ? 'rgba(28,43,30,0.5)' : '#C17A3A',
                      border: '1px solid rgba(193,122,58,0.5)',
                      fontFamily: 'Jost, sans-serif',
                      fontSize: '0.72rem',
                      letterSpacing: '0.25em',
                      textTransform: 'uppercase',
                      padding: '18px 32px',
                      cursor: sending ? 'not-allowed' : 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 12,
                      transition: 'all 0.3s ease',
                      marginTop: 12,
                    }}
                    onMouseEnter={e => {
                      if (!sending) {
                        (e.currentTarget as HTMLButtonElement).style.background = '#C17A3A';
                        (e.currentTarget as HTMLButtonElement).style.color = '#fff';
                      }
                    }}
                    onMouseLeave={e => {
                      if (!sending) {
                        (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
                        (e.currentTarget as HTMLButtonElement).style.color = '#C17A3A';
                      }
                    }}
                  >
                    {sending ? (
                      <>Sending…</>
                    ) : (
                      <>
                        Send Message
                        <Send size={14} strokeWidth={1.8} />
                      </>
                    )}
                  </button>
                </form>
              </>
            )}
          </div>
        </div>

        {/* ══════════════════════════════════════════
            MAP SECTION
        ══════════════════════════════════════════ */}
        <div
          ref={mapRef}
          className="c-hidden"
          style={{ position: 'relative', width: '100%', height: mapTarget ? 400 : 0, overflow: 'hidden' }}
        >
          {mapTarget && (
            <>
              <iframe
                title="Ember & Co. Location"
                src={`https://www.google.com/maps?q=${encodeURIComponent(mapTarget)}&output=embed`}
                width="100%"
                height="400"
                style={{ border: 0, display: 'block' }}
                allowFullScreen
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
              {/* Address overlay */}
              <div style={{
                position: 'absolute',
                bottom: 32, left: 'clamp(20px, 4vw, 48px)',
                background: 'rgba(13,26,14,0.7)',
                backdropFilter: 'blur(20px)',
                padding: '24px 32px',
                border: '1px solid rgba(245,240,232,0.05)',
                borderLeft: '3px solid #C17A3A',
                boxShadow: '0 20px 40px rgba(0,0,0,0.4)',
              }}>
                <p style={{
                  fontFamily: 'Jost, sans-serif', fontSize: '0.6rem',
                  letterSpacing: '0.25em', textTransform: 'uppercase',
                  color: '#C17A3A', margin: '0 0 6px',
                }}>
                  ✦ Find Us
                </p>
                <p style={{
                  fontFamily: 'Cormorant Garamond, serif', fontSize: '1.1rem',
                  color: '#F5F0E8', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-line',
                }}>
                  {infoAddress ?? mapTarget}
                </p>
              </div>
            </>
          )}
        </div>

      </div>
    </>
  );
}

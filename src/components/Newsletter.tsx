import { useState } from 'react';
import { Check } from 'lucide-react';
import { useInView } from '../hooks/useInView';
import { subscribeNewsletter } from '../services/api.ts';

export default function Newsletter() {
  const [email, setEmail] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const { ref, isInView } = useInView<HTMLDivElement>(0.1);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return; // ignore repeat taps while a subscribe is in flight
    setSubmitError(null);
    setSubmitting(true);
    const res = await subscribeNewsletter(email.trim());
    setSubmitting(false);
    if (!res.ok) {
      setSubmitError(res.error ?? 'We could not subscribe you — please try again.');
      return;
    }
    setSubmitted(true);
    setTimeout(() => {
      setSubmitted(false);
      setEmail('');
    }, 2000);
  };

  const getRevealStyle = (delay: string) => ({
    opacity: isInView ? 1 : 0,
    transform: isInView ? 'translateY(0)' : 'translateY(30px)',
    transition: `opacity 0.7s ease ${delay}, transform 0.7s ease ${delay}`
  });

  return (
    <section id="newsletter" className="py-16" style={{ background: '#F5F0E8' }}>
      <div className="max-w-2xl mx-auto px-6" ref={ref}>
        <div className="text-center mb-8">
          <p
            className="text-[#C17A3A] uppercase tracking-[0.25em] text-xs mb-4"
            style={{ fontFamily: 'Jost, sans-serif', ...getRevealStyle('0s') }}
          >
            ✦ Newsletter
          </p>
          <h2
            className="text-4xl md:text-5xl font-light mb-3"
            style={{ 
              fontFamily: 'Cormorant Garamond, serif', 
              color: '#1C2B1E',
              ...getRevealStyle('0.1s')
            }}
          >
            Stay in the Loop
          </h2>
          <p
            className="text-sm"
            style={{ 
              fontFamily: 'Jost, sans-serif', 
              color: 'rgba(28,43,30,0.6)', 
              fontWeight: 300,
              ...getRevealStyle('0.2s')
            }}
          >
            Seasonal menus, special events, and exclusive tastings
          </p>
        </div>

        {submitted ? (
          <div className="flex items-center justify-center gap-2 text-forest" style={getRevealStyle('0.3s')}>
            <Check size={18} />
            <span style={{ fontFamily: 'Jost, sans-serif', fontSize: '0.875rem' }}>Subscription confirmed</span>
          </div>
        ) : (
          <>
          <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-3" style={getRevealStyle('0.3s')}>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="your@email.com"
              className="flex-1 bg-white border border-forest/10 focus:border-ember outline-none px-4 py-3 text-sm transition-colors duration-200"
              style={{ fontFamily: 'Jost, sans-serif', color: '#1C2B1E' }}
            />
            <button
              type="submit"
              disabled={submitting}
              className="text-white px-8 py-3 text-xs tracking-widest uppercase transition-all duration-200 disabled:opacity-60"
              style={{ fontFamily: 'Jost, sans-serif', letterSpacing: '0.12em', fontSize: '0.7rem', background: '#C17A3A' }}
              onMouseEnter={e => (e.currentTarget.style.background = '#A66932')}
              onMouseLeave={e => (e.currentTarget.style.background = '#C17A3A')}
            >
              {submitting ? 'Subscribing…' : 'Subscribe'}
            </button>
          </form>
          {submitError && (
            <p className="text-[#ef4444] mt-3" style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px' }}>{submitError}</p>
          )}
          </>
        )}
      </div>
    </section>
  );
}

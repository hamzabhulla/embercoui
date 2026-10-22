import { useState } from 'react';
import { ArrowRight, Check } from 'lucide-react';
import { useInView } from '../hooks/useInView';
import { submitReservation } from '../services/api.ts';

// ONE slot list for both layouts. The desktop <select> and the mobile
// slot grid used to keep separate lists that had drifted apart (lunch
// slots only on mobile, 17:00/17:30 only on desktop) — the same kitchen
// hours must be offered everywhere.
const TIME_SLOTS = [
  '12:00', '12:30', '13:00', '13:30',
  '17:00', '17:30', '18:00', '18:30', '19:00', '19:30',
  '20:00', '20:30', '21:00', '21:30',
];

// Today in the visitor's local timezone, as a yyyy-mm-dd value for the
// date inputs' min attribute (toISOString would give the UTC date,
// which is already tomorrow for part of the local evening).
function todayLocal(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export default function Reservation() {
  const [form, setForm] = useState({
    name: '', email: '', phone: '', date: '', time: '', guests: ''
  });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const { ref, isInView } = useInView<HTMLDivElement>(0.1);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return; // one booking per tap — no duplicate submissions
    setSubmitError(null);
    setSubmitting(true);
    const res = await submitReservation({
      name: form.name, email: form.email, phone: form.phone,
      date: form.date, time: form.time, guests: Number(form.guests),
    });
    setSubmitting(false);
    if (!res.ok) {
      // Never fake a booking: keep the details and show what went wrong.
      setSubmitError(res.error ?? 'We could not save your reservation — please try again or call us.');
      return;
    }
    setSubmitted(true);
    setTimeout(() => setSubmitted(false), 4000);
    setForm({ name: '', email: '', phone: '', date: '', time: '', guests: '' });
  };

  const getLabelClass = (value: string) => `
    absolute left-0 pointer-events-none transition-all duration-[250ms] ease-in-out
    peer-focus:top-0 peer-focus:text-[10px] peer-focus:text-[#C17A3A] 
    ${value ? 'top-0 text-[10px]' : 'top-6 text-[14px]'}
  `;

  const getRevealStyle = (delay: string) => ({
    opacity: isInView ? 1 : 0,
    transform: isInView ? 'translateY(0)' : 'translateY(30px)',
    transition: `opacity 0.7s ease ${delay}, transform 0.7s ease ${delay}`
  });

  return (
    <section id="reservations" className="py-24 lg:py-32" style={{ background: '#1C2B1E' }}>
      <div className="max-w-7xl mx-auto px-6">
        <div className="flex flex-col lg:flex-row w-full shadow-2xl" ref={ref}>
          {/* LEFT SIDE */}
          <div 
            className="hidden md:flex w-full lg:w-1/2 flex-col justify-center px-[24px] py-[32px] md:p-12 lg:p-20"
            style={{ backgroundColor: '#0D1A0E' }}
          >
            <p
              className="text-[#C17A3A] uppercase tracking-[0.25em] text-xs mb-6"
              style={{ fontFamily: 'Jost, sans-serif', ...getRevealStyle('0s') }}
            >
              ✦ Reservations
            </p>
            
            <h2
              className="leading-[1.1] mb-8"
              style={{ 
                fontFamily: 'Cormorant Garamond, serif', 
                fontSize: '48px', 
                color: '#F5F0E8',
                fontWeight: 300,
                ...getRevealStyle('0.1s')
              }}
            >
              Secure<br />
              Your<br />
              <i style={{ fontStyle: 'italic' }}>Table</i>
            </h2>

            <div 
              className="w-[40px] h-[1px] bg-[#C17A3A] mb-8"
              style={getRevealStyle('0.2s')}
            ></div>

            <p
              className="mb-12 max-w-sm"
              style={{ 
                color: 'rgba(245,240,232,0.5)', 
                fontFamily: 'Jost, sans-serif',
                fontWeight: 300,
                fontSize: '16px',
                lineHeight: '1.6',
                ...getRevealStyle('0.3s')
              }}
            >
              Join us for an unforgettable dining experience rooted in forest-to-table philosophy.
            </p>

            <div 
              className="space-y-3"
              style={{ 
                color: 'rgba(245,240,232,0.4)', 
                fontFamily: 'Jost, sans-serif',
                fontSize: '12px',
                fontWeight: 300,
                ...getRevealStyle('0.4s')
              }}
            >
              <p>📍 412 Heritage Lane, Portland</p>
              <p>📞 +1 (503) 555-1234</p>
              <p>🕐 Mon–Sun: 11am – 11pm</p>
            </div>
          </div>

          {/* RIGHT SIDE */}
          <div 
            className="w-full lg:w-1/2 flex flex-col justify-center md:p-12 lg:p-20"
            style={{ backgroundColor: '#1C2B1E' }}
          >
            {submitted ? (
              <div className="flex flex-col items-center justify-center text-center h-full min-h-[400px] px-[24px] py-[32px] md:p-0" style={getRevealStyle('0.1s')}>
                <div className="text-[#C17A3A] text-4xl mb-6">✦</div>
                <h3
                  className="text-3xl mb-4"
                  style={{ fontFamily: 'Cormorant Garamond, serif', color: '#F5F0E8' }}
                >
                  Reservation Received
                </h3>
                <p
                  className="text-sm"
                  style={{ color: 'rgba(245,240,232,0.5)', fontFamily: 'Jost, sans-serif' }}
                >
                  We've received your reservation request. Our team will review it and call you to confirm — please keep your phone handy. We look forward to welcoming you.
                </p>
              </div>
            ) : (
              <>
                {/* DESKTOP FORM */}
                <form onSubmit={handleSubmit} className="hidden md:block w-full max-w-md mx-auto lg:mx-0 space-y-10">
                {submitError && (
                  <p className="text-[#ef4444]" style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px' }}>{submitError}</p>
                )}
                  {/* Full Name */}
                  <div className="relative group pt-4" style={getRevealStyle('0.1s')}>
                    <input
                      type="text" name="name" id="name" value={form.name} onChange={handleChange} required
                      className="peer w-full bg-transparent border-0 border-b border-[rgba(255,255,255,0.15)] focus:border-[#C17A3A] py-2 text-[#F5F0E8] focus:outline-none transition-colors duration-[250ms]"
                      style={{ fontFamily: 'Jost, sans-serif', fontSize: '14px' }}
                    />
                    <label htmlFor="name" className={getLabelClass(form.name)} style={{ fontFamily: 'Jost, sans-serif', color: 'rgba(245,240,232,0.5)' }}>Full Name</label>
                  </div>

                  {/* Email Address */}
                  <div className="relative group pt-4" style={getRevealStyle('0.2s')}>
                    <input
                      type="email" name="email" id="email" value={form.email} onChange={handleChange} required
                      className="peer w-full bg-transparent border-0 border-b border-[rgba(255,255,255,0.15)] focus:border-[#C17A3A] py-2 text-[#F5F0E8] focus:outline-none transition-colors duration-[250ms]"
                      style={{ fontFamily: 'Jost, sans-serif', fontSize: '14px' }}
                    />
                    <label htmlFor="email" className={getLabelClass(form.email)} style={{ fontFamily: 'Jost, sans-serif', color: 'rgba(245,240,232,0.5)' }}>Email Address</label>
                  </div>

                  {/* Phone Number */}
                  <div className="relative group pt-4" style={getRevealStyle('0.3s')}>
                    <input
                      type="tel" name="phone" id="phone" value={form.phone} onChange={handleChange} required
                      className="peer w-full bg-transparent border-0 border-b border-[rgba(255,255,255,0.15)] focus:border-[#C17A3A] py-2 text-[#F5F0E8] focus:outline-none transition-colors duration-[250ms]"
                      style={{ fontFamily: 'Jost, sans-serif', fontSize: '14px' }}
                    />
                    <label htmlFor="phone" className={getLabelClass(form.phone)} style={{ fontFamily: 'Jost, sans-serif', color: 'rgba(245,240,232,0.5)' }}>Phone Number</label>
                  </div>

                  {/* Date */}
                  <div className="relative group pt-4" style={getRevealStyle('0.4s')}>
                    <input
                      type="text" name="date" id="date" value={form.date} onChange={handleChange} min={todayLocal()}
                      onFocus={(e) => (e.target.type = 'date')} onBlur={(e) => (e.target.type = form.date ? 'date' : 'text')} required
                      className="peer w-full bg-transparent border-0 border-b border-[rgba(255,255,255,0.15)] focus:border-[#C17A3A] py-2 text-[#F5F0E8] focus:outline-none transition-colors duration-[250ms] [color-scheme:dark] min-h-[36px]"
                      style={{ fontFamily: 'Jost, sans-serif', fontSize: '14px' }}
                    />
                    <label htmlFor="date" className={getLabelClass(form.date)} style={{ fontFamily: 'Jost, sans-serif', color: 'rgba(245,240,232,0.5)' }}>Date</label>
                  </div>

                  {/* Time + Guests Side by Side */}
                  <div className="grid grid-cols-2 gap-8" style={getRevealStyle('0.5s')}>
                    {/* Time */}
                    <div className="relative group pt-4">
                      <select
                        name="time" id="time" value={form.time} onChange={handleChange} required
                        className="peer w-full bg-transparent border-0 border-b border-[rgba(255,255,255,0.15)] focus:border-[#C17A3A] py-2 text-[#F5F0E8] focus:outline-none transition-colors duration-[250ms] appearance-none cursor-pointer min-h-[36px]"
                        style={{ fontFamily: 'Jost, sans-serif', fontSize: '14px' }}
                      >
                        <option value="" disabled className="bg-[#1C2B1E] hidden"></option>
                        {TIME_SLOTS.map(t => (
                          <option key={t} value={t} className="bg-[#1C2B1E] text-[#F5F0E8]">{t}</option>
                        ))}
                      </select>
                      <label htmlFor="time" className={getLabelClass(form.time)} style={{ fontFamily: 'Jost, sans-serif', color: 'rgba(245,240,232,0.5)' }}>Time</label>
                    </div>

                    {/* Guests */}
                    <div className="relative group pt-4">
                      <select
                        name="guests" id="guests" value={form.guests} onChange={handleChange} required
                        className="peer w-full bg-transparent border-0 border-b border-[rgba(255,255,255,0.15)] focus:border-[#C17A3A] py-2 text-[#F5F0E8] focus:outline-none transition-colors duration-[250ms] appearance-none cursor-pointer min-h-[36px]"
                        style={{ fontFamily: 'Jost, sans-serif', fontSize: '14px' }}
                      >
                        <option value="" disabled className="bg-[#1C2B1E] hidden"></option>
                        {[1, 2, 3, 4, 5, 6, 7, 8].map(n => (
                          <option key={n} value={n} className="bg-[#1C2B1E] text-[#F5F0E8]">{n} {n === 1 ? 'Guest' : 'Guests'}</option>
                        ))}
                      </select>
                      <label htmlFor="guests" className={getLabelClass(form.guests)} style={{ fontFamily: 'Jost, sans-serif', color: 'rgba(245,240,232,0.5)' }}>Guests</label>
                    </div>
                  </div>

                  {/* SUBMIT BUTTON */}
                  <div className="pt-4" style={getRevealStyle('0.6s')}>
                    <button
                      type="submit"
                      disabled={submitting}
                      className="w-full bg-[#C17A3A] hover:bg-[#A66932] text-white py-4 px-6 flex items-center justify-between transition-all duration-[250ms] hover:shadow-[0_0_20px_rgba(193,122,58,0.4)] uppercase disabled:opacity-50"
                      style={{ fontFamily: 'Jost, sans-serif', fontSize: '11px', letterSpacing: '0.2em' }}
                    >
                      <span>{submitting ? 'Submitting…' : 'Submit'}</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </form>

                {/* MOBILE FORM (SaaS Style) */}
                <form onSubmit={(e) => { e.preventDefault(); if(step === 2) handleSubmit(e); }} 
                      className="md:hidden w-full flex flex-col bg-[#0D1A0E] rounded-t-[20px] shadow-[0_-8px_40px_rgba(0,0,0,0.4)] px-[24px] pt-[12px] pb-[28px] mt-12 relative overflow-y-auto">
                  {submitError && (
                    <p className="text-[#ef4444]" style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px' }}>{submitError}</p>
                  )}
                  
                  {/* iOS Style Handle */}
                  <div className="w-[40px] h-[3px] bg-white/20 rounded-full mx-auto mb-[24px]" />

                  {/* MOBILE HEADING */}
                  <div>
                    <p className="text-[#C17A3A] uppercase mb-[8px]" style={{ fontFamily: 'Jost, sans-serif', fontSize: '9px', letterSpacing: '0.2em' }}>
                      ✦ Reservations
                    </p>
                    <h2 className="mb-[4px] leading-none" style={{ fontFamily: 'Cormorant Garamond, serif', fontSize: '28px', color: '#F5F0E8', fontWeight: 300 }}>
                      Book Your Table
                    </h2>
                    <p className="mb-[24px]" style={{ fontFamily: 'Jost, sans-serif', fontSize: '12px', color: 'rgba(245,240,232,0.4)' }}>
                      Portland, Oregon
                    </p>
                  </div>

                  {/* STEP INDICATOR */}
                  <div className="flex items-center justify-center gap-[40px] mb-[28px] relative" style={{ fontFamily: 'Jost, sans-serif' }}>
                    <div className="absolute top-[16px] w-[80px] h-[1px] bg-white/10 z-0" />
                    
                    <div className="relative z-10 flex flex-col items-center gap-2 cursor-pointer" onClick={() => setStep(1)}>
                      <div className={`w-[32px] h-[32px] rounded-full flex items-center justify-center text-[12px] font-medium transition-colors duration-300 ${step === 1 || step === 2 ? 'bg-[#C17A3A] text-white' : 'bg-[rgba(255,255,255,0.15)] text-white/50'}`}>
                        {step === 2 ? <Check size={14} strokeWidth={3} /> : '1'}
                      </div>
                      <span className={`text-[9px] uppercase tracking-[0.1em] transition-colors ${step === 1 || step === 2 ? 'text-[#C17A3A]' : 'text-white/40'}`}>Details</span>
                    </div>
                    
                    <div className="relative z-10 flex flex-col items-center gap-2">
                      <div className={`w-[32px] h-[32px] rounded-full flex items-center justify-center text-[12px] font-medium transition-colors duration-300 ${step === 2 ? 'bg-[#C17A3A] text-white' : 'bg-[rgba(255,255,255,0.15)] text-white/50'}`}>
                        2
                      </div>
                      <span className={`text-[9px] uppercase tracking-[0.1em] transition-colors ${step === 2 ? 'text-[#C17A3A]' : 'text-white/40'}`}>Date & Time</span>
                    </div>
                  </div>

                  <div className="overflow-hidden relative" style={{ minHeight: '520px' }}>
                    {/* STEP 1 */}
                    <div className={`absolute top-0 left-0 w-full transition-all duration-500 flex flex-col space-y-[28px] ${step === 1 ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-full pointer-events-none'}`}>
                      <div className="relative">
                        <label htmlFor="name-mobile" className="text-[9px] text-[#C17A3A] uppercase tracking-[0.15em] block mb-[6px]" style={{ fontFamily: 'Jost, sans-serif' }}>Full Name</label>
                        <input
                          type="text" name="name" id="name-mobile" value={form.name} onChange={handleChange} required={step === 1}
                          className="w-full bg-[rgba(255,255,255,0.05)] border-0 border-b border-[rgba(255,255,255,0.12)] focus:border-b-[#C17A3A] text-[#F5F0E8] p-[14px_0] outline-none text-[16px] transition-colors rounded-none"
                        />
                      </div>
                      <div className="relative">
                        <label htmlFor="email-mobile" className="text-[9px] text-[#C17A3A] uppercase tracking-[0.15em] block mb-[6px]" style={{ fontFamily: 'Jost, sans-serif' }}>Email Address</label>
                        <input
                          type="email" name="email" id="email-mobile" value={form.email} onChange={handleChange} required={step === 1}
                          className="w-full bg-[rgba(255,255,255,0.05)] border-0 border-b border-[rgba(255,255,255,0.12)] focus:border-b-[#C17A3A] text-[#F5F0E8] p-[14px_0] outline-none text-[16px] transition-colors rounded-none"
                        />
                      </div>
                      <div className="relative">
                        <label htmlFor="phone-mobile" className="text-[9px] text-[#C17A3A] uppercase tracking-[0.15em] block mb-[6px]" style={{ fontFamily: 'Jost, sans-serif' }}>Phone Number</label>
                        <input
                          type="tel" name="phone" id="phone-mobile" value={form.phone} onChange={handleChange} required={step === 1}
                          className="w-full bg-[rgba(255,255,255,0.05)] border-0 border-b border-[rgba(255,255,255,0.12)] focus:border-b-[#C17A3A] text-[#F5F0E8] p-[14px_0] outline-none text-[16px] transition-colors rounded-none"
                        />
                      </div>
                      
                      {/* Guests Selector */}
                      <div>
                        <label className="text-[9px] text-[#C17A3A] uppercase tracking-[0.15em] block mb-[16px]" style={{ fontFamily: 'Jost, sans-serif' }}>Guests</label>
                        <div className="flex flex-wrap gap-[8px]">
                          {[1,2,3,4,5,6,7].map(n => (
                            <button 
                              key={n} type="button"
                              onClick={() => setForm(prev => ({...prev, guests: n.toString()}))}
                              className={`w-[40px] h-[40px] rounded-full text-[14px] font-medium transition-all duration-200 ease-in-out border flex items-center justify-center ${
                                form.guests === n.toString() 
                                ? 'bg-[#C17A3A] border-[#C17A3A] text-white scale-110 shadow-[0_4px_12px_rgba(193,122,58,0.4)]' 
                                : 'bg-transparent text-[rgba(245,240,232,0.6)] border-[rgba(255,255,255,0.15)] hover:border-white/30'
                              }`}
                            >
                              {n}
                            </button>
                          ))}
                        </div>
                      </div>
                      
                      <button 
                        type="button"
                        onClick={() => {
                          if(form.name && form.email && form.phone && form.guests) setStep(2);
                        }}
                        className="w-full bg-[#C17A3A] text-white p-[18px] text-[12px] tracking-[0.2em] uppercase flex items-center justify-between transition-colors shadow-lg disabled:opacity-50 hover:bg-[#A66932] mt-[28px] sticky bottom-0 z-10 rounded-none"
                        style={{ fontFamily: 'Jost, sans-serif' }}
                        disabled={!form.name || !form.email || !form.phone || !form.guests}
                      >
                        <span>Continue</span> <ArrowRight size={16} />
                      </button>
                    </div>

                    {/* STEP 2 */}
                    <div className={`absolute top-0 left-0 w-full transition-all duration-500 flex flex-col space-y-[28px] ${step === 2 ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-full pointer-events-none'}`}>
                      <div className="relative">
                        <label htmlFor="date-mobile" className="text-[9px] text-[#C17A3A] uppercase tracking-[0.15em] block mb-[6px]" style={{ fontFamily: 'Jost, sans-serif' }}>Select Date</label>
                        <input
                          type="date" name="date" id="date-mobile" value={form.date} onChange={handleChange} required={step === 2} min={todayLocal()}
                          className="w-full bg-[rgba(255,255,255,0.05)] border-0 border-b border-[rgba(255,255,255,0.12)] focus:border-b-[#C17A3A] text-[#F5F0E8] p-[14px_0] outline-none text-[16px] [color-scheme:dark] transition-colors rounded-none"
                        />
                      </div>

                      <div>
                        <label className="text-[9px] text-[#C17A3A] uppercase tracking-[0.15em] block mb-[16px]" style={{ fontFamily: 'Jost, sans-serif' }}>Select Time</label>
                        <div className="grid grid-cols-3 gap-[10px]">
                          {TIME_SLOTS.map(t => (
                            <button 
                              key={t} type="button"
                              onClick={() => setForm(prev => ({...prev, time: t}))}
                              className={`py-3 text-[14px] rounded-md transition-all duration-200 ${
                                form.time === t 
                                ? 'bg-[#C17A3A] text-white shadow-[0_4px_12px_rgba(193,122,58,0.4)]' 
                                : 'bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] text-[rgba(245,240,232,0.6)]'
                              }`}
                            >
                              {t}
                            </button>
                          ))}
                        </div>
                      </div>
                      
                      <div className="flex gap-[12px] pt-[12px] sticky bottom-0 z-10 bg-[#0D1A0E] mt-auto">
                        <button 
                          type="button" onClick={() => setStep(1)}
                          className="w-1/3 border border-white/20 text-white/70 p-[18px] text-[10px] tracking-widest uppercase flex items-center justify-center transition-colors rounded-none"
                          style={{ fontFamily: 'Jost, sans-serif' }}
                        >
                          Back
                        </button>
                        <button
                          type="submit"
                          className="w-2/3 bg-[#C17A3A] text-white p-[18px] text-[10px] tracking-[0.2em] uppercase flex items-center justify-center transition-all duration-300 shadow-lg disabled:opacity-50 hover:bg-[#A66932] rounded-none"
                          style={{ fontFamily: 'Jost, sans-serif' }}
                          disabled={!form.date || !form.time || submitting}
                        >
                          {submitting ? 'Confirming…' : 'Confirm'}
                        </button>
                      </div>
                    </div>
                  </div>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

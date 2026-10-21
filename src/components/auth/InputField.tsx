import React, { useState } from 'react';

export interface InputFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  /** Optional control rendered at the right edge of the field (e.g. a password visibility toggle). */
  trailing?: React.ReactNode;
}

/**
 * Shared floating-label field for all auth forms (login / signup / forgot
 * password). One implementation so the three forms can never drift apart.
 */
export default function InputField({ label, type = 'text', value, onChange, error, trailing, ...props }: InputFieldProps) {
  const [focused, setFocused] = useState(false);
  const active = focused || String(value ?? '').length > 0;

  return (
    <div className="relative mb-6">
      <label
        className={`absolute left-0 transition-all duration-250 ease-in-out pointer-events-none ${
          active
            ? '-top-4 text-[10px] text-[#C17A3A]'
            : 'top-3 text-[12px] md:text-sm text-[rgba(245,240,232,0.45)]'
        }`}
        style={{
          fontFamily: 'Jost, sans-serif',
          textTransform: 'uppercase',
          letterSpacing: '0.1em',
        }}
      >
        {label}
      </label>
      <input
        type={type}
        value={value}
        onChange={onChange}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        className={`w-full bg-transparent outline-none transition-all duration-300 ease-in-out text-[#F5F0E8] text-[16px] md:text-[15px] min-h-[48px] md:min-h-0 ${
          trailing ? 'pr-10' : ''
        } ${
          error ? 'border-[#ef4444]' : focused ? 'border-[#C17A3A]' : 'border-[rgba(255,255,255,0.15)]'
        }`}
        style={{
          borderBottomWidth: '1px',
          borderBottomStyle: 'solid',
          paddingBottom: '8px',
          paddingTop: active ? '8px' : '12px',
          boxShadow: focused && !error ? '0 14px 22px -16px rgba(193,122,58,0.55)' : 'none',
        }}
        {...props}
      />
      {trailing && <div className="absolute right-0 bottom-[6px]">{trailing}</div>}
      {error && (
        <span
          className="absolute -bottom-5 left-0 text-[#ef4444]"
          style={{ fontFamily: 'Jost, sans-serif', fontSize: '11px' }}
        >
          {error}
        </span>
      )}
    </div>
  );
}

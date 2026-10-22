import { useNavigate } from 'react-router-dom';

const headingFont: React.CSSProperties = { fontFamily: 'Cormorant Garamond, serif', fontWeight: 300, color: '#F5F0E8' };
const emberButton: React.CSSProperties = {
  background: '#C17A3A', color: 'white', textTransform: 'uppercase', letterSpacing: '0.18em',
  fontFamily: 'Jost, sans-serif', fontSize: '11px', padding: '16px 36px',
};
const ghostButton: React.CSSProperties = {
  ...emberButton, background: 'transparent', border: '1px solid rgba(245,240,232,0.35)', color: '#F5F0E8',
};

export default function NotFound() {
  const navigate = useNavigate();
  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-24" style={{ background: '#0D1A0E' }}>
      <div className="text-center max-w-md">
        <p className="uppercase mb-3" style={{ fontFamily: 'Jost, sans-serif', fontSize: '10px', letterSpacing: '0.25em', color: '#C17A3A' }}>✦ &nbsp; 404</p>
        <h1 className="mb-4" style={{ ...headingFont, fontSize: '40px', lineHeight: 1.1 }}>Page not found</h1>
        <p className="mb-8" style={{ fontFamily: 'Jost, sans-serif', fontSize: '13px', color: 'rgba(245,240,232,0.55)', lineHeight: 1.7 }}>
          The page you are looking for is not on the menu. It may have moved, or the link may have a typo.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <button onClick={() => navigate('/')} style={emberButton} className="transition-all duration-300 hover:brightness-110">
            Back to Home
          </button>
          <button onClick={() => navigate('/menu')} style={ghostButton} className="transition-all duration-300 hover:brightness-110">
            View the Menu
          </button>
        </div>
      </div>
    </div>
  );
}

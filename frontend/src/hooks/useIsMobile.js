import { useState, useEffect } from 'react';

const MOBILE_BREAKPOINT_PX = 768;

/**
 * Simple viewport-width based mobile gate. This is a UX convenience,
 * not a security boundary — someone could still hit the API directly
 * from a mobile device. Good enough for "please use desktop" gating.
 */
export function useIsMobile() {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT_PX : false
  );

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < MOBILE_BREAKPOINT_PX);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return isMobile;
}

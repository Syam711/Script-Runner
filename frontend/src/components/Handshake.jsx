import { useState, useEffect, useRef } from 'react';

/* The most characteristic thing this product does is walk a server
   through a login sequence and hand you a ready prompt. So that is the
   hero: not a marketing illustration, but the actual loop, typing
   itself out. It mirrors the real flow — connect, authenticate, switch
   to the service account, run — so someone who has done this in PuTTY
   recognises it immediately. */

const SCRIPT = [
  { text: 'ssh ops@10.24.8.15 -p 2202', kind: 'prompt', pause: 520 },
  { text: "ops@10.24.8.15's password:", kind: 'sys', pause: 300 },
  { text: '••••••••••', kind: 'sys', pause: 460 },
  { text: 'su serviceacc', kind: 'prompt', pause: 300 },
  { text: 'Password:', kind: 'sys', pause: 420 },
  { text: '••••••••••', kind: 'sys', pause: 520 },
  { text: 'connected · ap-south-1', kind: 'ok', pause: 640 },
  { text: './deploy-status.sh', kind: 'prompt', pause: 560 },
  { text: '3 services healthy · 0 pending', kind: 'ok', pause: 2400 },
];

const CHAR_MS = 26;

export default function Handshake() {
  const [lines, setLines] = useState([]);
  const [typing, setTyping] = useState('');
  const timers = useRef([]);

  useEffect(() => {
    // Respect a reduced-motion preference by showing the finished
    // transcript rather than animating toward it — the information is
    // the point, the typing is only the delivery.
    const calm = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (calm.matches) {
      setLines(SCRIPT);
      return;
    }

    let alive = true;
    const wait = (ms) =>
      new Promise((resolve) => {
        const t = setTimeout(resolve, ms);
        timers.current.push(t);
      });

    const run = async () => {
      while (alive) {
        setLines([]);
        setTyping('');
        await wait(420);

        for (const line of SCRIPT) {
          if (!alive) return;

          if (line.kind === 'prompt') {
            for (let i = 1; i <= line.text.length; i += 1) {
              if (!alive) return;
              setTyping(line.text.slice(0, i));
              await wait(CHAR_MS);
            }
            await wait(140);
            setTyping('');
          }

          if (!alive) return;
          setLines((prev) => [...prev, line]);
          await wait(line.pause);
        }
        await wait(900);
      }
    };

    run();

    return () => {
      alive = false;
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };
  }, []);

  return (
    <div className="handshake">
      <div className="handshake-bar">
        <span className="dot dot-ok" />
        <span>ap-south-1 · 10.24.8.15</span>
      </div>
      <div className="handshake-body">
        {lines.map((line, i) => (
          <span key={i} className={`hs-line hs-${line.kind}`}>
            {line.kind === 'prompt' ? `$ ${line.text}` : line.text}
          </span>
        ))}
        {typing && (
          <span className="hs-line hs-prompt">
            {`$ ${typing}`}
            <span className="caret" />
          </span>
        )}
      </div>
    </div>
  );
}

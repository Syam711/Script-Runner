import { useEffect } from 'react';
import { Icon } from '../lib/icons';

/* One modal, used everywhere, so dismissal behaves the same way each
   time: click the scrim, press Escape, or use the close control. */
export default function Modal({ title, sub, children, foot, onClose, wide = false }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    // Stop the page behind from scrolling while a modal is open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div className="scrim" onClick={onClose} role="presentation">
      <div
        className={`modal${wide ? ' modal-wide' : ''}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <div>
            <h2 className="card-title">{title}</h2>
            {sub && <p className="field-note">{sub}</p>}
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Close">
            <Icon.X size={16} />
          </button>
        </div>

        <div className="modal-body">{children}</div>

        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  );
}

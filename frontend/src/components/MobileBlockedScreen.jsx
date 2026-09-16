import { Wordmark, Icon } from '../lib/icons';

export default function MobileBlockedScreen() {
  return (
    <div className="gate">
      <div className="gate-inner">
        <Wordmark />
        <Icon.Sliders size={26} />
        <h2>Better on a bigger screen</h2>
        <p className="muted">
          Running scripts means reading output, and that needs room. Open this on a desktop to
          get going.
        </p>
      </div>
    </div>
  );
}

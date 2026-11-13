const MESSAGES: Record<string, string> = {
  denied: "The connection was cancelled. Click the button to try again, and approve every permission it asks for.",
  state: "That sign-in took too long. Please click the button and try again.",
  no_page: "We couldn't find a Facebook Page on your account. Your Instagram must be linked to a Facebook Page, and you need to select that Page when Meta asks which ones to share.",
  no_instagram: "We couldn't find an Instagram professional account. In the Instagram app, switch to a Business or Creator account and link it to your Facebook Page, then try again.",
  failed: "We couldn't finish connecting your Instagram. Please try again, and tell your teacher if it keeps happening.",
  setup: "This app isn't fully set up yet. Please tell your teacher.",
};

export default function Login({ error }: { error?: string }) {
  return (
    <main className="gate">
      <div className="gatecard">
        <span className="eyebrow">Feed Preview Studio</span>
        <h1>Plan your month, then let it post itself</h1>
        <p>Connect your Instagram once. After that you add a photo, write the caption, pick a time, and we publish it for you.</p>
        {error && <div className="alert" role="alert">{MESSAGES[error] || MESSAGES.failed}</div>}
        <a className="btn primary big" href="/api/auth/meta/login">Continue with Meta</a>
        <p style={{ fontSize: 12.5 }}>
          You sign in on Meta&apos;s own page with your usual Facebook or Instagram login. We never see your password.
        </p>
      </div>
    </main>
  );
}

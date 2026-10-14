export default function SetupPage() {
  return <main className="access-page"><section className="access-card"><div className="access-mark">S</div><h1>Finish workspace setup</h1><p>This deployment is private by default. Add <strong>SEO_ACCESS_PASSWORD</strong> to the Vercel project’s Production environment variables, using a unique password with at least 16 characters, then redeploy.</p><p className="access-note">The app will stay locked until that password is configured.</p></section></main>;
}

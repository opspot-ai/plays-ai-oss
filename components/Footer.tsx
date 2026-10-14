import Link from "next/link";

export default function Footer() {
  return (
    <footer className="site-footer">
      <div className="container">
        <div className="footer-row">
          <div className="footer-brand">
            plays
          </div>
          <div className="footer-links">
            <Link href="/plays">Playbook</Link>
            <Link href="/how-it-works">How it works</Link>
            <Link href="/library">My roster</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

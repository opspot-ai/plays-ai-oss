import Link from "next/link";

export default function Header() {
  return (
    <header className="site-header">
      <div className="container">
        <Link href="/" className="brand" aria-label="Plays home">
          <span className="dot" aria-hidden />
          plays
        </Link>
        <nav className="nav" aria-label="Primary">
          <Link className="nav-link" href="/plays">Playbook</Link>
          <Link className="nav-link" href="/how-it-works">How it works</Link>
          <div className="nav-cta">
            <Link className="btn btn-ghost" href="/library">My roster</Link>
            <Link className="btn btn-primary" href="/plays">Draft a play</Link>
          </div>
        </nav>
      </div>
    </header>
  );
}

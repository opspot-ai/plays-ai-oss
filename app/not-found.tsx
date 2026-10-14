import Link from "next/link";

export default function NotFound() {
  return (
    <section className="section">
      <div className="container center">
        <span className="eyebrow">404</span>
        <h1>That play doesn&rsquo;t exist.</h1>
        <p className="lead" style={{ margin: "0 auto 24px" }}>
          It may have moved, or never existed. Browse the shelf instead.
        </p>
        <Link className="btn btn-primary btn-lg" href="/plays">
          Browse plays
        </Link>
      </div>
    </section>
  );
}

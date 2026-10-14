import Link from "next/link";
import { Play, formatPrice } from "@/lib/plays";

export default function PlayCard({ play }: { play: Play }) {
  return (
    <Link href={`/plays/${play.slug}`} className="card" data-testid={`play-card-${play.slug}`}>
      <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
        <span className="badge badge-cat">{play.category}</span>
        {play.flagship && <span className="badge badge-flag">★ MVP</span>}
      </div>
      <h3>{play.name}</h3>
      <p className="tagline">{play.tagline}</p>
      <div className="card-foot">
        <span className="price">
          {formatPrice(play.price)} <small>one-time</small>
        </span>
        <span className="btn btn-ghost" style={{ padding: "9px 16px" }}>
          Available →
        </span>
      </div>
    </Link>
  );
}

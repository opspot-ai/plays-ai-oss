export default function PlayDiagram() {
  const players = [
    [240, 292], [150, 238], [210, 220], [270, 220], [330, 238], [105, 155], [375, 155],
  ];
  return (
    <svg
      viewBox="0 0 480 400"
      className="play-diagram"
      role="img"
      aria-label="An anonymous Team formation running one Play toward a verified outcome"
    >
      <rect x="1" y="1" width="478" height="398" rx="20" fill="var(--green-50)" stroke="var(--border-hairline)" />
      <g stroke="rgba(20,22,28,0.08)" strokeWidth="2">
        <line x1="0" y1="90" x2="480" y2="90" />
        <line x1="0" y1="160" x2="480" y2="160" />
        <line x1="0" y1="230" x2="480" y2="230" />
      </g>
      <g stroke="var(--brand-violet)" strokeWidth="3" fill="none" strokeLinecap="round">
        <path d="M105 145 C 120 105 175 105 195 72" />
        <path d="M375 145 C 360 105 305 105 285 72" />
        <path d="M240 210 L240 70" />
      </g>
      <circle cx="240" cy="54" r="18" fill="var(--brand-green)" />
      <path d="M231 54 l7 7 12-15" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      {players.map(([x, y], index) => (
        <g key={index}>
          <circle cx={x} cy={y} r="20" fill={index === 0 ? "var(--brand-gold)" : "var(--brand-violet)"} stroke="var(--brand-ink)" strokeWidth="2" />
          <circle cx={x} cy={y - 4} r="5" fill="#fff" />
          <path d={`M${x - 9} ${y + 10} Q${x} ${y + 1} ${x + 9} ${y + 10}`} stroke="#fff" strokeWidth="3" fill="none" />
        </g>
      ))}
      <text x="240" y="340" textAnchor="middle" fontSize="18" fontWeight="800" fill="var(--text-primary)">
        One Play. One complete Team.
      </text>
      <text x="240" y="364" textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--text-muted)">
        Harnesses are replaceable. The Team and workflow are the product.
      </text>
    </svg>
  );
}

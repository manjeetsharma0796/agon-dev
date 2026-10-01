// The Agon mark, the same paths and gold gradient as waitlist.getagon.tech. A server-safe SVG with
// no state. `id` keeps the gradient unique when the mark is drawn more than once on a page.
// Decorative everywhere it is used: the word "Agon" sits beside it as text or as the link's label,
// so a screen reader is not told the name twice.
export default function Mark({ className, id }: { className?: string; id: string }) {
  const grad = `lg-gold-${id}`
  return (
    <svg className={className} viewBox="0 0 243 177" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={grad} gradientUnits="userSpaceOnUse" x1="40" y1="0" x2="200" y2="177">
          <stop offset="0" stopColor="#f6dea6" />
          <stop offset="0.5" stopColor="#cfa662" />
          <stop offset="1" stopColor="#94703a" />
        </linearGradient>
      </defs>
      <path
        d="M13.0 165.8Q4.0 165.0 8.5 157.2L52.0 80.8Q56.5 73.0 65.2 70.6L84.3 65.4Q93.0 63.0 98.4 70.2L112.6 88.8Q118.0 96.0 112.8 103.3L69.7 163.2Q64.5 170.5 55.5 169.7Z"
        fill={`url(#${grad})`}
      />
      <path
        d="M187.5 169.7Q178.5 170.5 173.3 163.2L130.2 103.3Q125.0 96.0 130.4 88.8L144.6 70.2Q150.0 63.0 158.7 65.4L177.8 70.6Q186.5 73.0 191.0 80.8L234.5 157.2Q239.0 165.0 230.0 165.8Z"
        fill={`url(#${grad})`}
      />
      <path
        d="M116.4 11.4Q121.5 4.0 126.6 11.4L146.9 40.6Q152.0 48.0 144.8 53.3L128.7 65.2Q121.5 70.5 114.3 65.2L98.2 53.3Q91.0 48.0 96.1 40.6Z"
        fill={`url(#${grad})`}
      />
    </svg>
  )
}

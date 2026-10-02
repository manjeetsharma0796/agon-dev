'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// The 2 screens a person can be on. The active one carries the waitlist's lit pill.
const LINKS = [
  { href: '/', label: 'Your history' },
  { href: '/arm', label: 'Your vault' },
] as const

export default function NavLinks() {
  const path = usePathname()
  return (
    <nav className="nav__links" aria-label="Pages">
      {LINKS.map((l) => {
        const active = l.href === '/' ? path === '/' || path.startsWith('/report') : path === l.href
        return (
          <Link
            key={l.href}
            href={l.href}
            className={active ? 'nav__link is-active' : 'nav__link'}
            aria-current={active ? 'page' : undefined}
          >
            {l.label}
          </Link>
        )
      })}
    </nav>
  )
}

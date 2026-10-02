import './globals.css'
import Mark from './Mark'
import NavLinks from './NavLinks'
import NetworkBanner from './NetworkBanner'

export const metadata = {
  title: 'Agon',
  description: 'Your own trading history, as a spending limit your agent has to trade inside.',
}

// The waitlist page's frame: a pill nav with the gold mark, the page, and the footer. The network
// strip sits directly under the nav so it is the first thing read on every screen.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="page">
          <header className="nav">
            <a className="nav__brand" href="https://waitlist.getagon.tech/" aria-label="Agon">
              <Mark className="nav__mark" id="nav" />
              <span className="nav__word">Agon</span>
            </a>
            <NavLinks />
            <span className="nav__end" aria-hidden="true" />
          </header>
          <NetworkBanner />
          {children}
          <footer className="foot">
            <span className="foot__brand">
              <Mark className="foot__mark" id="foot" />
              <span className="foot__name">Agon</span>
            </span>
            <span className="foot__copy">
              Your key never leaves your wallet. The cap is enforced by Solana, not by us.
            </span>
            <a className="foot__x" href="https://waitlist.getagon.tech/">
              Join the beta
            </a>
          </footer>
        </div>
      </body>
    </html>
  )
}

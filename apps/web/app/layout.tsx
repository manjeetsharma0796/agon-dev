import './globals.css'
import NetworkBanner from './NetworkBanner'

export const metadata = {
  title: 'Agon',
  description: 'Your own trading history, as a spending limit your agent has to trade inside.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0 }}>
        <NetworkBanner />
        {children}
      </body>
    </html>
  )
}

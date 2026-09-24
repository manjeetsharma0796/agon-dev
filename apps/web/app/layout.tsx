export const metadata = {
  title: 'Agon',
  description: 'Your own trading history, as a spending limit your agent has to trade inside.',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}

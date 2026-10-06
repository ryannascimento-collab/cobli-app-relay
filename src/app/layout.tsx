// Este projeto só expõe rotas de API (/api/app/v1/*). O layout existe porque o Next.js exige um.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}

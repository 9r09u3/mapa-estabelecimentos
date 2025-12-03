import "./globals.css";
import "leaflet/dist/leaflet.css";
import React from "react";

export const metadata = {
  title: "Avalie os Estabelecimentos",
  description: "Embiras de Motocas 062",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
